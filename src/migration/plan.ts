/**
 * The framework-neutral result of extraction: a native configuration and the
 * source documents with the routes their framework published. Every converter
 * produces one; the shared document pass and verification consume it.
 */
import { posix } from "node:path";
import type { GroupConfig, IconSet } from "../config.js";
import { slugFromPath } from "../core/markdown-loader.js";
import { Call, type ConfigSource, type ConfigValue } from "./config-writer.js";
import type { HostDependency } from "./types.js";
import { convertMdxDocument, type DocumentContext } from "./document.js";
import { normaliseFences } from "./code-fences.js";
import { parseDocument, SourceSyntaxError, type Dialect, type SyntaxNode } from "./mdx.js";
import type { JsonValue } from "../core/markdown-components.js";
import type { FragmentRule } from "./slugs.js";
import { applyEdits, frontmatterEdits, lineAt, readFrontmatter } from "./text-edits.js";

/** How the source framework read a document. */
export interface SourceDialect extends Dialect {
  /** How heading fragments were derived. */
  fragments: FragmentRule;
  /**
   * Compare the native build with the converted document rather than the
   * original, for dialects remark cannot read (Python-Markdown's indented
   * blocks). The converter then proves separately that no original line was
   * lost. The converted document is native Markdown, so its GitHub alerts are
   * read as the callouts native renders.
   */
  compareConverted?: boolean;
  /** The framework's own text rewrite before it parses a document, applied wherever the source is read for its meaning. */
  preprocess?: (source: string) => string;
  /** A fence's bare words after its language are its title, as Mintlify writes ```bash Install```. */
  fenceTitles?: boolean;
  /**
   * The framework's functions whose value is fixed by the site, by
   * `module#export`, evaluated where content calls them with static arguments:
   * Docusaurus's `useBaseUrl`.
   */
  calls?: ReadonlyMap<string, (args: readonly JsonValue[]) => JsonValue | undefined>;
  /**
   * Components the framework shows as a code block of their children, by
   * `module#export`: Docusaurus's CodeBlock. Verification reads their text as code.
   */
  codeElements?: ReadonlySet<string>;
  /** The project directories the framework publishes at its base path (`/` or `/docs/`), as `useBaseUrl` addresses them. */
  statics?: { base: string; directories: readonly string[] };
}

/** What a converter produces: native plans and the host dependencies they change. */
export interface FrameworkMigration {
  plans: NativePlan[];
  dependencies: HostDependency[];
}

export interface PlannedDocument {
  /** Project-relative source file. */
  file: string;
  /** Where the native document lives, when it has to move (out of a framework's route directory). */
  target?: string;
  /** Public path the source framework published, with leading and trailing slash. */
  route: string;
  /** Native locale key, when the project is translated. */
  locale?: string;
  dialect: SourceDialect;
  /** Source rewrites around the shared MDX conversion: before it parses the document, and after it. */
  before?: (source: string) => string;
  after?: (text: string) => Promise<string>;
  /** Native frontmatter changes. */
  frontmatter: { set: Record<string, string | boolean | number>; remove: string[] };
}

/** An Astro site that mounts the native documentation through `sourcey/astro`. */
export interface AstroHost {
  /** The `sourcey/astro` options the converter writes. */
  options: { routeBase: string; allowRootOutput?: true; landingPage?: false };
  base?: string;
  site?: string;
  format?: "directory" | "file";
}

export interface NativePlan {
  /** Project-relative directory that holds `sourcey.config.ts`. */
  configDir: string;
  /** Present when an Astro site hosts the documentation. */
  host?: AstroHost;
  config: ConfigSource;
  documents: PlannedDocument[];
  /**
   * Files pages include (snippets, partials): converted like pages, at their own
   * file's path so their links and media resolve from it, and never published.
   */
  partials?: PlannedDocument[];
  /** Other public paths the source published, which the native build must keep, with the fragments each page had. */
  routes: { route: string; origin: string; fragments?: string[] }[];
  /**
   * Directory the source served at its site root, files and pages alike
   * (MkDocs `docs_dir`): a page linking a file there expects it published.
   */
  publishedRoot?: string;
  /** Native group IDs by the public path of each group's landing page. */
  sections?: Map<string, string>;
  /** The icon set the native project draws from (`theme.icons`), when it is not Heroicons. */
  icons?: IconSet;
  /**
   * Files the build copies into its root before running (root-relative path to
   * project file). Verification copies them the same way.
   */
  assembly?: { root: string; files: Map<string, string> };
  /** Other files the conversion writes (`null` removes), keyed by project-relative path. */
  files: Map<string, { bytes: Buffer | string | null; reason: string }>;
}

/** A document's native page reference and the path its source published it at, both relative to the tab. */
export interface SourcePath {
  reference: string;
  path: string;
}

/**
 * The native Markdown source for documents published at known paths. It
 * takes the slug rule that already spells most of those paths and returns
 * the explicit `slug` each remaining document needs.
 */
export function markdownSource<T extends SourcePath>(root: string, groups: GroupConfig[], documents: readonly T[]): { source: Call; slugs: Map<T, string> } {
  const misses = (rule: "normalized" | "file") => documents.filter((document) => slugFromPath(document.reference, rule) !== document.path);
  const normalized = misses("normalized");
  const file = misses("file");
  const rule = file.length < normalized.length ? "file" : "normalized";
  return {
    source: new Call("markdown", [{ root, ...(rule === "file" ? { slugs: rule } : {}), groups: groups as unknown as ConfigValue }]),
    slugs: new Map((rule === "file" ? file : normalized).map((document) => [document, document.path])),
  };
}

/** Project-relative path of a plan's native configuration. */
export function configFile(plan: NativePlan): string {
  return posix.join(plan.configDir, "sourcey.config.ts");
}

/** Apply each document's frontmatter and content conversion as proposed project edits. */
export async function convertDocuments(documents: readonly PlannedDocument[], context: DocumentContext): Promise<void> {
  const { project, diagnostics } = context;
  for (const document of documents) {
    const original = await project.readText(document.file);
    const source = document.before?.(original) ?? original;
    const frontmatter = readFrontmatter(source);
    if (frontmatter.invalid) {
      diagnostics.error({
        file: document.file,
        line: lineAt(source, frontmatter.yaml?.start),
        code: "frontmatter",
        message: `The frontmatter is not valid YAML (${frontmatter.invalid})`,
        suggestion: "Fix the YAML, or remove the --- fences if the block is meant as page text.",
      });
      continue;
    }
    let tree: SyntaxNode;
    try {
      tree = await parseDocument(document.file, source, frontmatter.bodyStart, document.dialect);
    } catch (error) {
      if (!(error instanceof SourceSyntaxError)) throw error;
      diagnostics.error({ file: document.file, line: error.line, column: error.column, code: "syntax", message: error.message });
      continue;
    }
    let text = source;
    if (document.dialect.mdx ?? document.file.endsWith(".mdx")) {
      const converted = await convertMdxDocument(document, source, tree, context);
      if (converted.failed) continue;
      text = converted.text;
    }
    if (document.after) text = await document.after(text);
    // Body conversion never edits the frontmatter, so its offsets still hold.
    // Native frontmatter starts the file; drop anything the source let precede it.
    text = applyEdits(text, [
      ...(frontmatter.start ? [{ start: 0, end: frontmatter.start, text: "" }] : []),
      ...frontmatterEdits(text, frontmatter, document.frontmatter),
    ]);
    let fences;
    try {
      fences = await normaliseFences(document.file, text, readFrontmatter(text).bodyStart, document.dialect);
    } catch (error) {
      if (!(error instanceof SourceSyntaxError)) throw error;
      diagnostics.error({ file: document.file, line: error.line, column: error.column, code: "syntax", message: `The converted page does not parse: ${error.message}` });
      continue;
    }
    text = fences.text;
    for (const { line, meta } of fences.dropped)
      diagnostics.review({ file: document.file, line, code: "code-meta", message: `Code fence metadata "${meta}" has no native equivalent and is removed` });
    // Lines the conversion added follow the file's own line endings.
    if (original.includes("\r\n")) text = text.replace(/\r?\n/g, "\r\n");
    if (document.target && document.target !== document.file) {
      project.write(document.target, text, `Moved from ${document.file}`);
      project.remove(document.file, `Moved to ${document.target}`);
    } else if (text !== original) project.write(document.file, text, "Native Sourcey Markdown");
  }
}
