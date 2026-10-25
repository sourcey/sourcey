import { basename, dirname, relative, resolve } from "node:path";
import { load as parseYaml } from "js-yaml";
import { normalizeChangelog } from "./changelog-normalizer.js";
import { slugify } from "../utils/slug.js";
import { smartypants } from "../utils/typography.js";
import {
  htmlText,
  renderMarkdownInline,
  extractFirstParagraph,
  firstHeadingText,
  lexBlocks,
  stripMarkdownLinks,
  type PageHeading,
} from "../utils/markdown.js";
import { InputReader } from "./loader.js";
import { hasAgentContent, openingHasComponent, parseComponents, readableContent, renderContent, componentStyles, contentFonts, contentHeadings, contentAnchors, contentDiagnostics, resolveSectionIndexes, type ContentLinks, type ContentNode, type NativeComponentDefinition, type NativeContentContext } from "./markdown-components.js";
import type { Links } from "marked";
import type { NormalizedChangelog } from "./types.js";
import { english, type UiMessages } from "./messages.js";
import type { SiteTab } from "./navigation.js";
import type { ArtifactBody } from "./source-file.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentDiagnostic = ReturnType<typeof contentDiagnostics>[number];

export interface MarkdownPage {
  id?: string;
  hideInMenu?: boolean;
  draft?: boolean;
  assets?: Map<string, ArtifactBody>;
  componentStyles?: string[];
  /** Font families the page's content is drawn in beyond the theme's */
  fonts?: string[];
  diagnostics?: ContentDiagnostic[];
  kind: "markdown";
  /** Page title from frontmatter */
  title: string;
  /** Page description from frontmatter */
  description: string;
  /**
   * The description repeats a paragraph the body keeps, so the page header
   * shows no lede.
   */
  hideLede?: boolean;
  /** Short navigation label, independent of the article title. */
  navTitle?: string;
  /** URL slug for this page (derived from filename) */
  slug: string;
  /** Rendered HTML body */
  html: string;
  /** Readable content retained by the owning adapter, before presentation rendering; machine exports read it. */
  markdown: string;
  /** The readable content people's surfaces (search) read, when it differs: without agent-only content. */
  readerMarkdown?: string;
  /** Extracted h2/h3 headings for table of contents */
  headings: PageHeading[];
  anchors?: string[];
  /** Original file path (for error messages and dev server watching) */
  sourcePath: string;
  /** Optional repo-relative path used for "Edit this page" links. Null disables the link. */
  editPath?: string | null;
  /** The page's own edit link (frontmatter `editUrl`), for a page edited somewhere other than the site's repository. */
  editUrl?: string;
  /** Frontmatter `feedback: false`: the page asks no feedback where the site does. */
  feedback?: false;
  /** Optional base path override for this page's edit link. Undefined uses the site default. */
  editBasePath?: string | null;
  /** Optional page-local entries that should be indexed in addition to headings. */
  searchEntries?: PageSearchEntry[];
  /** Optional source root used to rewrite source-format-relative assets. */
  sourceRoot?: string;
  /**
   * How the page is drawn, when its frontmatter says: `page` keeps the site's
   * header and footer around a body of its own, `blank` keeps nothing but the
   * body. Unset, documentation is `doc` and a site page is `page`.
   */
  layout?: PageLayout;
  /** The page's own stylesheets (frontmatter `css`), resolved from its folder. */
  css?: string[];
}

/** How a page is drawn: the documentation frame, the site's header and footer alone, or nothing. */
export type PageLayout = "doc" | "page" | "blank";
const LAYOUTS: readonly string[] = ["doc", "page", "blank", "changelog"];

export interface PageSearchEntry {
  title: string;
  content: string;
  anchor?: string;
  category: string;
  symbolKind?: string;
  owner?: string;
  ownerKind?: string;
  namespace?: string;
  qualifiedName?: string;
}

export interface ChangelogPage {
  kind: "changelog";
  title: string;
  description: string;
  slug: string;
  headings: PageHeading[];
  sourcePath: string;
  editPath?: string | null;
  changelog: NormalizedChangelog;
  rawBody: string;
  /** Set on generated per-version pages; undefined for the full changelog page. */
  permalinkVersionId?: string;
}

export type DocsPage = MarkdownPage | ChangelogPage;
/** Parsed and resolved content, before navigation-dependent projections. */
export interface MarkdownSource extends Omit<MarkdownPage, "html" | "markdown" | "headings" | "anchors" | "hideLede" | "componentStyles" | "fonts" | "diagnostics"> {
  messages: UiMessages;
  nodes: readonly ContentNode[];
  /** The page's reference link definitions, which its `[text][name]` links read. */
  definitions?: Links;
  explicitDescription: boolean;
  smartypants?: boolean;
}
export type DocsSource = MarkdownSource | ChangelogPage;
export type NavigationDocument = Pick<DocsPage, "kind" | "title" | "slug"> & Partial<Pick<MarkdownPage, "id" | "navTitle" | "hideInMenu">>;


export type { PageHeading } from "../utils/markdown.js";

interface Frontmatter {
  title?: string;
  description?: string;
  order?: number;
  navTitle?: string;
  layout?: string;
  [key: string]: unknown;
}

export interface LoadDocsPageOptions {
  changelog?: boolean;
  repoUrl?: string;
  sourceRoot?: string;
  preprocess?: MarkdownPreprocessor[];
  /** Title for a page that sets none and has no heading of its own. */
  title?: string;
  input?: InputReader;
  configDir?: string;
  /** Source tree at the selected repository revision, when content is a local snapshot. */
  editRoot?: string;
  /** The language and version the page is read in. */
  context: NativeContentContext;
  baseUrl?: string;
  components?: Record<string, NativeComponentDefinition>;
  /** Typographer's quotes, dashes and ellipses in the page's prose. */
  smartypants?: boolean;
}

export interface MarkdownPreprocessContext {
  filePath: string;
  sourceRoot?: string;
}

export type MarkdownPreprocessor = (body: string, context: MarkdownPreprocessContext) => string;

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const meta = (parseYaml(match[1]) as Frontmatter) ?? {};
  return { meta, body: match[2] };
}

/** A Markdown file drawn as a page on its own, outside a site: never read as a changelog. */
export async function loadMarkdownPage(filePath: string, slug: string): Promise<MarkdownPage> {
  return await loadDocsPage(filePath, slug, { changelog: false }) as MarkdownPage;
}

/** The language and version a page drawn on its own is read in: English, and the current version. */
const STANDALONE: NativeContentContext = { locale: "en", lang: "en", dir: "ltr", contentLocale: "en", version: { id: "current", label: "Current" }, versionScope: "", messages: english, icons: "heroicons" };

/** A page drawn on its own, outside a site, with its Markdown export's links as written. */
export async function loadDocsPage(filePath: string, slug: string, options: Partial<LoadDocsPageOptions> = {}): Promise<DocsPage> {
  return renderDocsSource(await loadDocsSource(filePath, slug, { ...options, context: options.context ?? STANDALONE }));
}

export async function loadDocsSource(
  filePath: string,
  slug: string,
  options: LoadDocsPageOptions,
): Promise<DocsSource> {
  // A page read outside a build reads through a reader of its own, which its components read through too.
  const input = options.input ?? new InputReader();
  const { meta, body } = parseFrontmatter(await input.readText(filePath, filePath));

  if (shouldTreatAsChangelog(filePath, meta, options)) {
    const sourcePath = relative(options.configDir ?? process.cwd(), filePath);
    const changelog = normalizeChangelog(body, {
      title: typeof meta.title === "string" ? meta.title : undefined,
      description: typeof meta.description === "string" ? meta.description : undefined,
      repoUrl: options.repoUrl,
    });
    const description =
      typeof meta.description === "string" ? meta.description : (changelog.description ?? "");

    return {
      kind: "changelog",
      title: changelog.title,
      description,
      slug,
      headings: changelog.versions.map((version) => ({
        level: 2 as const,
        text: version.version ?? "Unreleased",
        id: version.id,
      })),
      sourcePath,
      editPath: relative(options.editRoot ?? options.configDir ?? process.cwd(), filePath),
      changelog,
      rawBody: body,
    };
  }

  return loadMarkdownSourceFromBody(filePath, slug, body, meta, { ...options, input });
}

function shouldTreatAsChangelog(
  filePath: string,
  meta: Frontmatter,
  options: LoadDocsPageOptions,
): boolean {
  if (options.changelog === false) return false;
  if (typeof meta.layout === "string" && meta.layout.toLowerCase() === "changelog") return true;
  return basename(filePath).toLowerCase() === "changelog.md";
}

async function loadMarkdownSourceFromBody(
  filePath: string,
  slug: string,
  body: string,
  meta: Frontmatter,
  options: LoadDocsPageOptions & { input: InputReader },
): Promise<MarkdownSource> {
  let sourcePreprocessed = body;
  for (const preprocess of options.preprocess ?? []) sourcePreprocessed = preprocess(sourcePreprocessed, { filePath, sourceRoot: options.sourceRoot });
  const assets = new Map<string, ArtifactBody>(), definitions: Links = {};
  const nodes = await parseComponents(sourcePreprocessed, { source: filePath, root: options.configDir ?? options.sourceRoot ?? process.cwd(), input: options.input, components: options.components, assets, definitions, baseUrl: options.baseUrl, context: options.context });
  // What the frontmatter leaves out, a title or a summary, is read once from
  // the page as its readers see it: lexed, so a `#` comment inside a fenced
  // code block is not a heading.
  let readable: ReturnType<typeof lexBlocks> | undefined;
  const read = () => readable ??= lexBlocks(readableContent(nodes, "people"));
  const description = typeof meta.description === "string" && meta.description.trim() ? meta.description : undefined;
  const title = meta.title ?? firstHeadingText(read().tokens, 1) ?? options.title ?? slug;
  const sourcePath = relative(options.configDir ?? process.cwd(), filePath);
  if (meta.layout !== undefined && (typeof meta.layout !== "string" || !LAYOUTS.includes(meta.layout))) throw new Error(`${sourcePath}: layout ${JSON.stringify(meta.layout)} is not doc, page, blank or changelog`);
  // A changelog layout with changelogs turned off is the page as written.
  const layout = meta.layout === "changelog" ? undefined : meta.layout as PageLayout | undefined;
  const css = meta.css === undefined ? [] : Array.isArray(meta.css) ? meta.css : [meta.css];
  // A page names where it is edited, or that it has no edit link.
  if (meta.editUrl !== undefined && meta.editUrl !== false && !(typeof meta.editUrl === "string" && /^https?:\/\//.test(meta.editUrl))) throw new Error(`${sourcePath}: editUrl is an http(s) address, or false for no edit link`);
  if (meta.feedback !== undefined && typeof meta.feedback !== "boolean") throw new Error(`${sourcePath}: feedback is true, or false to ask no feedback on this page`);
  if (css.some(path => typeof path !== "string" || !path || /^[a-z][a-z\d+.-]*:|^\//i.test(path))) throw new Error(`${sourcePath}: css names stylesheets beside the page, such as css: ./home.css`);
  return {
    kind: "markdown", title, description: description ?? stripMarkdownLinks(extractFirstParagraph(read().tokens, read().inline)).replace(/\s+/g, " ").trim(),
    navTitle: typeof meta.navTitle === "string" ? meta.navTitle : undefined,
    slug: typeof meta.slug === "string" ? meta.slug.replace(/^\/+|\/+$/g, "") || "index" : slug,
    id: typeof meta.id === "string" ? meta.id : undefined, draft: meta.draft === true, hideInMenu: meta.hideInMenu === true,
    ...(layout ? { layout } : {}), ...(css.length ? { css: css.map(path => resolve(dirname(filePath), path as string)) } : {}),
    assets, nodes, ...(Object.keys(definitions).length && { definitions }), messages: options.context.messages, explicitDescription: description !== undefined, ...(options.smartypants ? { smartypants: true } : {}),
    sourcePath, editPath: meta.editUrl === false ? null : relative(options.editRoot ?? options.configDir ?? process.cwd(), filePath), ...(typeof meta.editUrl === "string" ? { editUrl: meta.editUrl } : {}), ...(meta.feedback === false ? { feedback: false as const } : {}), sourceRoot: options.sourceRoot ? relative(options.configDir ?? process.cwd(), options.sourceRoot) : undefined,
  };
}

/** A page as drawn, before its Markdown export: its HTML and what its content says of it. */
export type DrawnDocsPage = Omit<MarkdownPage, "markdown" | "readerMarkdown"> | ChangelogPage;

/**
 * A page as the site's routes and navigation know it before it is drawn: its
 * title, summary, headings and anchors, read from its content. It is drawn
 * once those are compiled, so its HTML and export carry their final links.
 */
export function outlineDocsSource(source: DocsSource): DocsPage {
  if (source.kind === "changelog") return source;
  const { nodes, metadata } = sourceParts(source);
  return { ...metadata, html: "", markdown: "", headings: contentHeadings(nodes), anchors: contentAnchors(nodes) };
}

/** A source's content, how it is drawn, and the rest: what the page says of itself. */
function sourceParts(source: MarkdownSource) {
  const { nodes, explicitDescription, messages, smartypants, definitions, ...metadata } = source;
  return { nodes, explicitDescription, messages, smartypants, definitions, metadata };
}

/**
 * A page and its Markdown export, drawn from its source, with the export's
 * links as written. A site draws the page with `drawDocsSource` and writes
 * the export with `docsExport` once its routes resolve the links.
 */
export function renderDocsSource(source: DocsSource, navigation?: SiteTab, documentId = source.slug): DocsPage {
  const drawn = drawDocsSource(source, navigation, documentId);
  return drawn.kind === "changelog" ? drawn : { ...drawn, ...docsExport(source as MarkdownSource, navigation, documentId) };
}

/** A page's HTML, and its title, headings, anchors, styles and diagnostics as its content gives them. */
export function drawDocsSource(source: DocsSource, navigation?: SiteTab, documentId = source.slug): DrawnDocsPage {
  if (source.kind === "changelog") return source;
  const { nodes: sourceNodes, explicitDescription, messages, smartypants: smart, metadata } = sourceParts(source);
  const nodes = resolveSectionIndexes(sourceNodes, navigation, documentId);
  let html: string;
  // Content that cannot render, such as a code fence's unknown metadata, names its page.
  try { html = renderContent(nodes, messages); }
  catch (error) { throw new Error(`${source.sourcePath}: ${(error as Error).message}`, { cause: error }); }
  const page = { ...metadata, headings: contentHeadings(nodes), anchors: contentAnchors(nodes), diagnostics: contentDiagnostics(nodes), componentStyles: componentStyles(nodes), fonts: contentFonts(nodes) };
  // A page drawn by its author keeps its own heading and opening; the doc frame draws both for it.
  if (source.layout === "page" || source.layout === "blank") return { ...page, html: smart ? smartypants(html) : html };
  let cleanHtml = html.replace(/^\s*<h1([^>]*)>(.*?)<\/h1>\s*/i, (match, attributes: string, inner: string) => {
    // The heading's visible text against the title, so a title with an apostrophe or ampersand still matches.
    if (htmlText(inner) !== source.title.replace(/\s+/g, " ").trim()) return match;
    const id = attributes.match(/\bid="([^"]+)"/)?.[1];
    const aliases = inner.match(/<span\b[^>]*\bid="[^"]+"[^>]*><\/span>/g)?.join("") ?? "";
    return `${id ? `<span id="${id}" aria-hidden="true"></span>` : ""}${aliases}`;
  });
  let hideLede = false;
  if (source.description && !explicitDescription) {
    const opening = cleanHtml.match(/^(?:\s*<span\b[^>]*aria-hidden="true"[^>]*><\/span>)*\s*<p>([\s\S]*?)<\/p>\s*/);
    // The lede is plain text: an opening paragraph with links, code or emphasis stays in the body.
    if (opening && !/<[a-z]/i.test(opening[1]) && !openingHasComponent(nodes) && htmlText(opening[1]) === htmlText(renderMarkdownInline(source.description))) cleanHtml = opening[0].replace(/<p>[\s\S]*?<\/p>\s*$/, "") + cleanHtml.slice(opening[0].length);
    else hideLede = true;
  }
  return { ...page, html: smart ? smartypants(cleanHtml) : cleanHtml, ...(hideLede ? { hideLede } : {}) };
}

/**
 * A page's Markdown export: for agents, and for readers where the two
 * differ. `links` resolves the links its content marked as resolvable.
 */
export function docsExport(source: MarkdownSource, navigation?: SiteTab, documentId = source.slug, links?: ContentLinks): Pick<MarkdownPage, "markdown" | "readerMarkdown"> {
  const nodes = resolveSectionIndexes(source.nodes, navigation, documentId);
  try {
    return { markdown: readableContent(nodes, "agents", links), ...(hasAgentContent(nodes) && { readerMarkdown: readableContent(nodes, "people", links) }) };
  } catch (error) { throw new Error(`${source.sourcePath}: ${(error as Error).message}`, { cause: error }); }
}

/**
 * Derive a URL slug from a page path.
 * Preserves directory structure to avoid collisions:
 * "getting-started.md" → "getting-started"
 * "run/index"          → "run/index"
 * "run/install.md"     → "run/install"
 */
export function slugFromPath(filePath: string, rule: "normalized" | "file" = "normalized"): string {
  const stripped = filePath.replace(/\.(md|mdx)$/i, "");
  if (rule === "file") return stripped.replace(/\\/g, "/");
  return stripped
    .split("/")
    .map((s) => slugSegmentFromPath(s))
    .join("/");
}

function slugSegmentFromPath(segment: string): string {
  const normalized = segment
    .replace(/^operator=$/, "operator-assign")
    .replace(/^~(.+)$/, "destructor-$1")
    .replace(/<=>/g, "-spaceship")
    .replace(/<=/g, "-le")
    .replace(/>=/g, "-ge")
    .replace(/==/g, "-eq")
    .replace(/!=/g, "-ne")
    .replace(/\[\]/g, "-array")
    .replace(/\+=/g, "-plus-eq")
    .replace(/\/=/g, "-slash-eq")
    .replace(/\//g, "-slash")
    .replace(/=/g, "-eq")
    .replace(/\+/g, "-plus")
    .replace(/</g, "-lt")
    .replace(/>/g, "-gt");
  return slugify(normalized);
}
