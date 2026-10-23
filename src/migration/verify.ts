/**
 * Build the proposed native project in a staging copy and prove it keeps the
 * source: every published route, every heading fragment and every block of
 * prose and code. Nothing in the project is touched.
 */
import { decodeHTML } from "entities";
import { access, cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareAstroSourcey } from "../astro/index.js";
import { outputPathCandidatesForRequest, requestPathMatchesBase } from "../renderer/static-files.js";
import { toPublicPath } from "../site-url.js";
import { buildSourceySite, sourceyArtifacts, type SourceySiteArtifacts } from "../site.js";
import { identityKey } from "./components.js";
import type { Diagnostics } from "./diagnostics.js";
import { documentScope, elementBinding } from "./document.js";
import { alertMarker, childrenText, parseDocument, parseMarkdown, textContent, walk, type SyntaxNode } from "./mdx.js";
import { configFile, type NativePlan, type PlannedDocument } from "./plan.js";
import type { ProjectFiles } from "./project-files.js";
import { fragmentSlugger, type FragmentRule } from "./slugs.js";
import { readFrontmatter } from "./text-edits.js";
import type { MigrationChange, PreservedRoute } from "./types.js";

/** A heading whose source fragment the native build does not publish. */
export interface MissingFragment {
  file: string;
  /** Heading text as the reader sees it. */
  text: string;
  /** Position among the document's headings. */
  index: number;
  id: string;
}

type Artifacts = Awaited<ReturnType<typeof sourceyArtifacts>>;

export interface Verification {
  routes: PreservedRoute[];
  missingFragments: MissingFragment[];
}

export async function verifyPlans(
  project: ProjectFiles,
  changes: readonly MigrationChange[],
  plans: readonly NativePlan[],
  diagnostics: Diagnostics,
): Promise<Verification> {
  const stage = await mkdtemp(join(tmpdir(), "sourcey-migrate-"));
  try {
    await stageProject(project.root, stage, changes, plans);
    const routes: PreservedRoute[] = [];
    const missingFragments: MissingFragment[] = [];
    for (const plan of plans) {
      let site: SourceySiteArtifacts;
      try {
        site = await buildStaged(stage, plan);
      } catch (error) {
        diagnostics.error({ file: configFile(plan), code: "build", message: `The native build failed: ${(error as Error).message}` });
        continue;
      }
      const artifacts = await sourceyArtifacts(site, { landingPage: plan.host?.options.landingPage });
      if (plan.host) await checkHostRoutes(stage, plan, site, artifacts, diagnostics);
      const published = publishedUrls(project, stage, plan, site, artifacts);
      for (const { route, origin, fragments = [] } of plan.routes) {
        const record = site.assembly.routes.byPath.get(route);
        // A static page the source served is a published file natively.
        if (!record) {
          if (!fragments.length && (await published.native(route, "/"))) continue;
          diagnostics.error({ file: configFile(plan), code: "route", message: `The native build does not publish ${route} (${origin})` });
          continue;
        }
        const ids = elementIds(String(artifacts.get(record.outputPath) ?? ""));
        for (const fragment of fragments.filter((fragment) => !ids.has(fragment)))
          diagnostics.error({ file: configFile(plan), code: "fragment", message: `${route}#${fragment} (${origin}) is not preserved` });
      }
      for (const document of plan.documents) {
        const result = await verifyDocument(project, site, document, diagnostics, published);
        if (!result) continue;
        routes.push(result.route);
        missingFragments.push(...result.missing);
      }
    }
    return { routes, missingFragments };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Copy the project, minus dependencies and VCS data, apply the proposed changes and the declared build-time copies. */
async function stageProject(root: string, stage: string, changes: readonly MigrationChange[], plans: readonly NativePlan[]): Promise<void> {
  await cp(root, stage, {
    recursive: true,
    filter: (source) => !/(^|[\\/])(node_modules|\.git)$/.test(source.slice(root.length)),
  });
  for (const change of changes) {
    const target = join(stage, change.path);
    if (change.bytes === null) await rm(target, { force: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, change.bytes);
    }
  }
  for (const plan of plans) {
    for (const [path, file] of plan.assembly?.files ?? []) {
      const target = join(stage, plan.assembly!.root, path);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(stage, file), target);
    }
  }
  // Resolve the project's own packages, plus this Sourcey as the dependency the migration adds.
  const modules = join(stage, "node_modules");
  await mkdir(modules, { recursive: true });
  const installed = await readdir(join(root, "node_modules")).catch(() => [] as string[]);
  for (const name of installed) if (name !== "sourcey" && !name.startsWith(".")) await symlink(join(root, "node_modules", name), join(modules, name));
  await symlink(packageRoot(), join(modules, "sourcey"));
}

function packageRoot(): string {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

async function buildStaged(stage: string, plan: NativePlan): Promise<SourceySiteArtifacts> {
  const dir = join(stage, plan.configDir);
  if (!plan.host) return buildSourceySite({ configDir: dir, generateOgImages: false });
  const prepared = await prepareAstroSourcey(plan.host.options, {
    root: pathToFileURL(`${dir}/`),
    base: plan.host.base ?? "/",
    site: plan.host.site,
    build: { format: plan.host.format ?? "directory" },
  });
  return buildSourceySite({ config: prepared.config, generateOgImages: false });
}

/** Sourcey must not publish a path an Astro page of the host already serves. */
async function checkHostRoutes(stage: string, plan: NativePlan, site: SourceySiteArtifacts, artifacts: Artifacts, diagnostics: Diagnostics): Promise<void> {
  const pages = join(stage, plan.configDir, "src/pages");
  const hostBase = (plan.host?.base ?? "").replace(/\/+$/, "");
  const bare = (path: string) => path.replace(/(.)\/$/, "$1");
  const published = new Set(
    [...artifacts.keys()]
      .filter((path) => path.endsWith(".html"))
      .map((path) => bare(toPublicPath(path, site.config.baseUrl, site.config.prettyUrls))),
  );
  for (const entry of (await readdir(pages, { recursive: true }).catch(() => [] as string[])).sort()) {
    const path = `/${entry.split("\\").join("/")}`;
    if (!/\.(astro|md|mdx|html)$/.test(path) || /\[/.test(path) || /\/_/.test(path)) continue;
    const route = `${hostBase}${path.replace(/\.(astro|md|mdx|html)$/, "").replace(/\/index$/, "")}/`.replace(/^\/\/$/, "/");
    if (published.has(bare(route)))
      diagnostics.error({ file: posix.join(plan.configDir, "src/pages", path.slice(1)), code: "host-route", message: `The native mount would also serve ${route}, which this host page owns` });
  }
}

/** What a URL a page references reaches, by the page's public path. */
interface PublishedUrls {
  /** A published native artifact or, under Astro, a host public file. */
  native(url: string, page: string): Promise<boolean>;
  /** A file the source served from its site root. */
  source(url: string, page: string): Promise<boolean>;
}

function publishedUrls(project: ProjectFiles, stage: string, plan: NativePlan, site: SourceySiteArtifacts, artifacts: Artifacts): PublishedUrls {
  const { baseUrl, prettyUrls } = site.config;
  const hostBase = (plan.host?.base ?? "").replace(/\/+$/, "");
  const pathname = (url: string, page: string) => decodeURI(new URL(url, `https://site.invalid${page}`).pathname);
  return {
    async native(url, page) {
      const path = pathname(url, page);
      if (requestPathMatchesBase(path, baseUrl) && outputPathCandidatesForRequest(path, baseUrl, prettyUrls).some((output) => artifacts.has(output)))
        return true;
      if (!plan.host || !path.startsWith(`${hostBase}/`)) return false;
      return access(join(stage, plan.configDir, "public", path.slice(hostBase.length))).then(() => true, () => false);
    },
    async source(url, page) {
      const path = pathname(url, page).slice(Math.max(baseUrl.length - 1, 0));
      return plan.publishedRoot !== undefined && project.isFileOnDisk(posix.join(plan.publishedRoot, path));
    },
  };
}

/** Any element ID serves a fragment link: heading IDs and the engine's alias anchors alike. */
function elementIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

/** Local media a page shows: image sources, responsive candidates, video sources and posters. */
function mediaReferences(html: string): string[] {
  const urls = [
    ...[...html.matchAll(/<(?:img|video|source|audio)\b[^>]*?\ssrc="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((match) => match[1].split(",").map((candidate) => candidate.trim().split(/\s+/)[0])),
    ...[...html.matchAll(/<video\b[^>]*?\sposter="([^"]+)"/g)].map((match) => match[1]),
  ];
  return [...new Set(urls)].filter((url) => url && !/^(?:[a-z]+:|\/\/)/i.test(url));
}

/** Local links a page makes to files (a name with an extension), not to pages. */
function fileLinks(html: string): string[] {
  const urls = [...html.matchAll(/<a\b[^>]*?\shref="([^"#?]+)/g)].map((match) => match[1]);
  return [...new Set(urls)].filter((url) => !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url) && /\.\w+$/.test(url));
}

async function verifyDocument(
  project: ProjectFiles,
  site: SourceySiteArtifacts,
  document: PlannedDocument,
  diagnostics: Diagnostics,
  published: PublishedUrls,
): Promise<{ route: PreservedRoute; missing: MissingFragment[] } | undefined> {
  const record = site.assembly.routes.byPath.get(document.route);
  if (!record) {
    diagnostics.error({ file: document.file, code: "route", message: `The native build does not publish ${document.route}` });
    return undefined;
  }
  const page = record.page.currentPage;
  if (page.kind !== "markdown") {
    diagnostics.error({ file: document.file, code: "route", message: `${document.route} is no longer this document` });
    return undefined;
  }
  const nativeFile = document.target ?? document.file;
  const written = document.dialect.compareConverted ? await project.readText(nativeFile) : await project.readOriginalText(document.file);
  const original = document.dialect.preprocess?.(written) ?? written;
  const tree = await parseDocument(document.file, original, readFrontmatter(original).bodyStart, document.dialect);
  // A link to the page-title heading lands at the top of the page, where native renders the title.
  // A heading with no text has an empty fragment, which no link can name: the source renders it without one.
  const headings = (await sourceHeadings(tree, document.dialect.fragments)).map((heading, index) => ({ ...heading, index }));
  const linkable = headings.filter((heading) => heading.id && !(heading.index === 0 && heading.depth === 1 && heading.text.trim() === page.markdown.title));
  const fragments = elementIds(page.markdown.html);
  const missing = linkable
    .filter((heading) => !fragments.has(heading.id))
    .map((heading) => ({ file: nativeFile, text: heading.text, index: heading.index, id: heading.id }));

  for (const url of mediaReferences(page.markdown.html)) {
    if (!(await published.native(url, record.publicPath)))
      diagnostics.error({ file: document.file, code: "media", message: `${url} is not published at ${record.publicPath}` });
  }
  for (const url of fileLinks(page.markdown.html)) {
    if (!(await published.native(url, record.publicPath)) && (await published.source(url, record.publicPath)))
      diagnostics.error({ file: document.file, code: "link", message: `${record.publicPath} links to ${url}, which the source published and the native build does not` });
  }


  const source = await contentBlocks(tree, { alerts: document.dialect.compareConverted ? original : undefined, code: await codeElement(project, document, original, tree) });
  // Native writes callouts as GitHub alerts in its readable Markdown.
  const native = await contentBlocks(await parseMarkdown(page.markdown.markdown, 0), { alerts: page.markdown.markdown });
  // The page's title is prose a reader sees, above it.
  const prose = normalise([page.markdown.title, ...native.prose].join(" "));
  const code = new Set(native.code);
  for (const block of source.prose) {
    if (!prose.includes(block))
      diagnostics.error({ file: document.file, code: "content", message: `Prose is not preserved: "${excerpt(block)}"` });
  }
  for (const block of source.code) {
    if (!code.has(block))
      diagnostics.error({ file: document.file, code: "content", message: `Code is not preserved: "${excerpt(block)}"` });
  }
  return {
    route: { source: document.route, native: record.publicPath, file: document.file, anchors: linkable.map((heading) => heading.id) },
    missing,
  };
}

/** Headings in document order with the fragment the source framework gave each. */
async function sourceHeadings(tree: SyntaxNode, rule: FragmentRule): Promise<{ text: string; id: string; depth: number }[]> {
  const slugger = await fragmentSlugger(rule);
  const headings: { text: string; id: string; depth: number }[] = [];
  for (const { node } of walk(tree)) {
    if (node.type !== "heading") continue;
    // A converted heading may already carry its source's explicit ID.
    const [, text, explicit] = textContent(node).match(/^([\s\S]*?)(?:\s+\{#([^}]+)\})?$/)!;
    headings.push({ text, id: explicit ?? slugger.slug(text), depth: node.depth ?? 0 });
  }
  return headings;
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();
const codeText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");

/** Whether an element is one the source framework shows as a code block of its children. */
async function codeElement(project: ProjectFiles, document: PlannedDocument, source: string, tree: SyntaxNode): Promise<((node: SyntaxNode) => boolean) | undefined> {
  const elements = document.dialect.codeElements;
  if (!elements?.size) return undefined;
  const scope = await documentScope(project, document.file, source, tree);
  return (node) => {
    if ((node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") || !node.name) return false;
    const binding = elementBinding(node.name, scope, document.dialect.globals);
    return !!binding && elements.has(identityKey(binding.module, binding.export));
  };
}

/** HTML elements that sit in a line of text, which a reader reads straight through. */
const INLINE_TAGS = new Set(["a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "i", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var"]);

/**
 * The text a reader sees in a node: an HTML element that is not inline, such
 * as a table cell, reads apart from its neighbours, as a block of raw HTML
 * does, and a line break, as MDX's `<br />` or Markdown's inline `<br>`, is a space.
 */
function readerText(node: SyntaxNode): string {
  if (node.type === "html" && /^<br\s*\/?>$/i.test(node.value ?? "")) return " ";
  const block = (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") && !!node.name && /^[a-z]/.test(node.name) && !INLINE_TAGS.has(node.name);
  const text = node.children ? node.children.map(readerText).join("") : textContent(node);
  return block ? ` ${text} ` : text;
}

/** Component attributes whose values a reader sees as text. */
const TEXT_ATTRIBUTES = new Set(["title", "description", "label", "alt", "caption"]);

/** A GitHub alert's marker line in a paragraph's text, which a reader sees as the alert's title. */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/;

/**
 * Visible prose and code of a document. Attribute text of components and the
 * text inside raw HTML count as prose, so a component converted to native
 * syntax is compared by what a reader sees; attribute text reads as the inline
 * Markdown both sides render it as. With `alerts`, the text the tree was read
 * from, a GitHub alert written there reads as native and GitHub show it:
 * titled by its type. A `code` element's
 * children are its code, as a reader sees their text.
 */
async function contentBlocks(tree: SyntaxNode, options: { alerts?: string; code?: (node: SyntaxNode) => boolean } = {}): Promise<{ prose: string[]; code: string[] }> {
  const prose: string[] = [];
  const code: string[] = [];
  const isCode = options.code ?? (() => false);
  for (const { node, parents } of walk(tree)) {
    if (parents.some(isCode)) continue;
    const text = node.type === "paragraph" ? readerText(node) : "";
    const quote = parents.at(-1);
    const alert = options.alerts !== undefined && quote?.children?.[0] === node && alertMarker(options.alerts, quote) ? text.match(ALERT_MARKER) : null;
    if (alert) prose.push(alert[1].charAt(0) + alert[1].slice(1).toLowerCase(), normalise(text.slice(alert[0].length)));
    else if (node.type === "code") code.push(codeText(node.value ?? ""));
    else if (node.type === "paragraph" && node.children?.some((child) => child.type === "mdxJsxTextElement")) {
      // MDX reads a line opening with an element as a paragraph; each element is its own piece to a reader (two one-line cards).
      let run = "";
      for (const child of node.children)
        if (child.type !== "mdxJsxTextElement") run += readerText(child);
        else {
          prose.push(normalise(run), isCode(child) ? "" : normalise(readerText(child)));
          run = "";
        }
      prose.push(normalise(run));
    } else if (["paragraph", "heading", "tableCell"].includes(node.type)) prose.push(normalise(readerText(node)));
    else if (node.type === "image" && node.alt) prose.push(normalise(node.alt));
    // Comments show nothing; the text between tags does, and an image's alternative text or a title, as a component's.
    else if (node.type === "html") {
      const html = (node.value ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, " ");
      // Text runs on through an inline tag and breaks at a block's; character references read as their characters.
      prose.push(normalise(decodeHTML(html.replace(/<\/?([a-z][\w-]*)?[^>]*>/gi, (_tag, name: string | undefined) => (name && INLINE_TAGS.has(name.toLowerCase()) ? "" : " ")))));
      for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi))
        for (const [, name, double, single] of tag.matchAll(/\s([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
          if (TEXT_ATTRIBUTES.has(name.toLowerCase())) prose.push(normalise(decodeHTML(double ?? single)));
    }
    else if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const shown = isCode(node) && codeText(childrenText(node) ?? "");
      if (shown) code.push(shown);
      for (const attribute of node.attributes ?? [])
        if (attribute.name && TEXT_ATTRIBUTES.has(attribute.name) && typeof attribute.value === "string") prose.push(normalise(textContent(await parseMarkdown(attribute.value, 0))));
    }
  }
  return { prose: prose.filter(Boolean), code };
}

function excerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
