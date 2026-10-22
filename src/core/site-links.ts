import { createHash } from "node:crypto";
import { posix, relative } from "node:path";
import type { Links } from "marked";
import { tabPath, type ResolvedConfig, type ResolvedTab } from "../config.js";
import type { ResolvedMarkdownSource } from "../adapters/types.js";
import { markdownPages } from "../adapters/shared.js";
import { joinHref, toPrettyLink, type LinkStyle } from "../site-url.js";
import { OPERATION_LINK } from "../utils/markdown.js";
import { rewriteMarkdownDestinations } from "../utils/markdown-links.js";
import type { ContentLinks } from "./markdown-components.js";
import { isMainChangelogPage, type ReferenceTarget, type ReferenceTargets, type SitePage } from "./site-model.js";

/**
 * Where one language and version publishes its pages, by every name a link
 * may give one: its output path, its source file, and its path from the
 * source root it was read from. `digest` changes whenever any link could.
 */
export interface SiteLinks {
  readonly digest: string;
  /** What a page's links resolve against; nothing for a page with no source to resolve them from. */
  scope(page: SitePage): LinkScope | undefined;
}

export function siteLinks(pages: readonly SitePage[], config: ResolvedConfig, references: readonly LinkedReference[]): SiteLinks {
  const pathMap = new Map<string, string>();
  addSourceAssetAliases(pathMap, config.contexts.flatMap(c => c.tabs), config.configDir);
  for (const page of pages) {
    const out = page.outputPath;
    pathMap.set(out.replace(/\/index\.html$/, "").replace(/\.html$/, ""), out);
    const docsSourcePath = canonicalSourcePath(page);
    if (!docsSourcePath) continue;
    pathMap.set(stripMarkdownExtension(normalizeSourcePath(docsSourcePath)), out);
    const sourceRelative = sourceRootRelativePath(page);
    if (sourceRelative) pathMap.set(sourceRelative, out);
  }
  const repoBase = config.repo?.replace(/\/$/, "");
  return {
    digest: createHash("sha256").update(JSON.stringify([[...pathMap], config.baseUrl, config.prettyUrls, references])).digest("hex"),
    scope(page) {
      const sourcePath = docsSourcePath(page);
      if (!sourcePath) return undefined;
      const branch = page.context.version.revision ?? config.editBranch;
      const sourceBase = repoBase && branch ? { href: `${repoBase}/tree/${branch}`, root: page.context.version.revision ? page.context.version.content : undefined } : undefined;
      return { outputPath: page.outputPath, sourcePath, pathMap, sourceBase, links: config, references, root: config.baseUrl || "/" };
    },
  };
}

function canonicalSourcePath(page: SitePage): string | undefined {
  if (page.currentPage.kind === "markdown") return page.currentPage.markdown.sourcePath;
  if (isMainChangelogPage(page)) return page.currentPage.changelog.sourcePath;
  return undefined;
}

function docsSourcePath(page: SitePage): string | undefined {
  if (page.currentPage.kind === "markdown") return page.currentPage.markdown.sourcePath;
  if (page.currentPage.kind === "changelog") return page.currentPage.changelog.sourcePath;
  return undefined;
}

function sourceRootRelativePath(page: SitePage): string | undefined {
  if (page.currentPage.kind !== "markdown") return undefined;
  const markdown = page.currentPage.markdown;
  if (!markdown.sourceRoot) return undefined;

  const sourceRoot = normalizeSourcePath(markdown.sourceRoot);
  const sourcePath = normalizeSourcePath(markdown.sourcePath);
  if (!sourcePath.startsWith(`${sourceRoot}/`)) return undefined;
  return stripMarkdownExtension(sourcePath.slice(sourceRoot.length + 1));
}

function addSourceAssetAliases(pathMap: Map<string, string>, tabs: ResolvedTab[], configDir: string): void {
  for (const tab of tabs) {
    if (tab.source.kind !== "markdown") continue;
    for (const asset of tab.source.assets ?? []) {
      const outputPath = tabPath(tab.slug, asset.outputPath);
      pathMap.set(normalizeSourcePath(asset.outputPath), outputPath);
      for (const sourceRoot of sourceRootsForMarkdownSource(tab.source)) {
        const sourceRootPath = normalizeSourcePath(relative(configDir, sourceRoot));
        pathMap.set(posix.join(sourceRootPath, normalizeSourcePath(asset.outputPath)), outputPath);
      }
    }
  }
}

function sourceRootsForMarkdownSource(source: ResolvedMarkdownSource): string[] {
  const roots = new Set<string>();
  for (const page of markdownPages(source.groups)) {
    {
      if (page.sourceRoot) roots.add(page.sourceRoot);
    }
  }
  return [...roots];
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(md|mdx)$/, "");
}

export function rewriteHtmlLinks(html: string, scope: LinkScope): string {
  return html.replace(/\b(href|src)="([^"]+)"/g, (match, attr: string, href: string) => {
    const resolved = resolveInternalHref(href, scope);
    return resolved ? `${attr}="${resolved}"` : match;
  });
}

export function rewriteMarkdownLinks(markdown: string, scope: LinkScope, definitions?: Links): string {
  return rewriteMarkdownDestinations(markdown, (href) => resolveInternalHref(href, scope) ?? href, definitions);
}

/** A page's links as its export resolves them: its marked blocks always, other text only where a link could be. */
export function pageLinks(scope: LinkScope, definitions?: Links): ContentLinks {
  const markdown = (text: string) => rewriteMarkdownLinks(text, scope, definitions);
  return { markdown, text: (text) => (text.includes("](") || (definitions && text.includes("[")) ? markdown(text) : text) };
}

export interface SourceLinkBase { href: string; root?: string }
/** A reference whose operations a page's `operation:` links can name. */
export interface LinkedReference { id: string; targets: ReferenceTargets }
/** What one page's links resolve against. */
export interface LinkScope {
  outputPath: string;
  sourcePath: string;
  pathMap: ReadonlyMap<string, string>;
  sourceBase?: SourceLinkBase;
  links: LinkStyle;
  references: readonly LinkedReference[];
  /** The site's base, which every link on the page starts from, so it lands from any address the page answers at. */
  root: string;
}

export function resolveInternalHref(href: string, scope: LinkScope): string | null {
  const { outputPath, sourcePath: docsSourcePath, pathMap, sourceBase, links } = scope;
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("#") ||
    href.startsWith("mailto:")
  ) {
    return null;
  }

  const pageDir = outputPath.includes("/")
    ? outputPath.substring(0, outputPath.lastIndexOf("/"))
    : "";
  if (href.startsWith(OPERATION_LINK)) {
    const target = operationTarget(decodeHrefPath(href.slice(OPERATION_LINK.length)), scope);
    return `${joinHref(scope.root, toPrettyLink(target.outputPath, links))}${target.anchor ? `#${target.anchor}` : ""}`;
  }

  const [path, hash] = href.split("#", 2);
  const hashSuffix = hash ? `#${hash}` : "";
  const sourcePath = decodeHrefPath(path).replace(/\\/g, "/");
  const clean = sourcePath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.(md|mdx|html)$/, "");

  const candidates = new Set<string>();

  if (!sourcePath.startsWith("/") && docsSourcePath) {
    const sourceDir = posix.dirname(docsSourcePath.replace(/\\/g, "/"));
    candidates.add(posix.normalize(posix.join(sourceDir, clean)));
  }

  if (!sourcePath.startsWith("/") && pageDir) {
    candidates.add(posix.normalize(posix.join(pageDir, clean)));
  }

  candidates.add(clean);

  let target: string | undefined;
  for (const initialCandidate of candidates) {
    let candidate = initialCandidate;
    while (!target && candidate && candidate !== ".") {
      target = pathMap.get(candidate);
      if (target) break;
      const slash = candidate.indexOf("/");
      if (slash === -1) break;
      candidate = candidate.substring(slash + 1);
    }
    if (target) break;
  }

  if (target) {
    return `${joinHref(scope.root, toPrettyLink(target, links))}${hashSuffix}`;
  }

  if (sourceBase && href.includes("../") && docsSourcePath) {
    const sourceDir = posix.dirname(docsSourcePath);
    const resolved = posix.relative(sourceBase.root || ".", posix.normalize(posix.join(sourceDir, path)));
    if (!resolved.startsWith("..")) {
      return `${sourceBase.href}/${resolved}${hashSuffix}`;
    }
  }

  return null;
}

/**
 * An operation a page links by name, `GET /pets` or `TOOL search` as navigation
 * names it, after its reference's tab ID when two references publish it
 * (`rest:GET /pets`). It lands wherever the operation is published: its own
 * page in a split reference, or its section on the single page.
 */
function operationTarget(name: string, scope: LinkScope): ReferenceTarget {
  const [, id, operation] = name.match(/^(?:([^:\s]+):)?([A-Z]+ \S.*)$/) ?? [];
  const found = operation ? scope.references.filter(reference => (id === undefined || reference.id === id) && reference.targets.operations[operation]) : [];
  if (found.length === 1) return found[0].targets.operations[operation];
  const problem = !operation ? "name an operation as METHOD /path"
    : found.length ? `${found.map(reference => reference.id).join(", ")} each publish it; name one, as ${OPERATION_LINK}${found[0].id}:${operation}`
    : id === undefined ? "no reference publishes it" : `reference ${JSON.stringify(id)} does not publish it`;
  throw new Error(`${scope.sourcePath}: link ${OPERATION_LINK}${name}: ${problem}`);
}

function decodeHrefPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
