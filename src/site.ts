import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { markdownPages } from "./adapters/shared.js";
import { loadConfig, resolveConfigFromRaw, type ResolvedConfig } from "./config.js";
import { enforceBuildDiagnostics, type ReferenceDiagnostic } from "./core/build-diagnostics.js";
import { closeDiagramRenderer } from "./core/diagrams.js";
import type { GodocLoaderDiagnostic } from "./core/godoc-loader.js";
import { canonicalInputPath } from "./core/loader.js";
import type { ContentDiagnostic } from "./core/markdown-loader.js";
import { buildSiteNavigation, type SiteNavigation } from "./core/navigation.js";
import { lastChanged, readRepository, type Repository } from "./core/page-dates.js";
import type { OverlayDiagnostic } from "./core/overlay.js";
import type { RustdocLoaderDiagnostic } from "./core/rustdoc-loader.js";
import { buildSearchIndex, searchDocuments, type SearchEntry } from "./core/search-indexer.js";
import { collectSiteDiagnostics, type SiteDiagnostic } from "./core/site-diagnostics.js";
import type { AnchorDiagnostic, SitePage } from "./core/site-model.js";
import type { ArtifactBody } from "./core/source-file.js";
import type { ChangelogDiagnostic, NormalizedSpec } from "./core/types.js";
import { generateExports } from "./exports/index.js";
import type { SiteConfig } from "./renderer/context.js";
import { buildSite as buildSiteHtml, renderSiteArtifacts, type PageRenderCache } from "./renderer/html-builder.js";
import { assembleSite, type SiteAssembly } from "./site-assembly.js";
import { buildSiteConfig, readNavbarLinks } from "./site-assets.js";
import { drawingCards, planCards, type SiteCards } from "./site-cards.js";
import { publishSearch, searchRowsByContext, type SearchCache } from "./site-search.js";
import { isAbsoluteHttpUrl } from "./site-url.js";

interface CompilationCache {
  pages: PageRenderCache;
  searches: SearchCache;
  /** Social cards, drawn as the site's artifacts are produced. */
  cards?: SiteCards;
}
/** Derived outputs live for exactly the immutable compilation that owns them. */
const compilationCaches = new WeakMap<SourceySiteArtifacts, CompilationCache>();

export interface SourceySiteOptions {
  configDir?: string;
  config?: ResolvedConfig;
  outputDir?: string;
  strictChangelog?: boolean;
  generateOgImages?: boolean;
  previous?: SourceySiteArtifacts;
  changedPaths?: string[];
  signal?: AbortSignal;
  /**
   * Files published unchanged, such as images and public assets, are copied
   * from their source when the site is written rather than held in memory.
   * For a build that writes its output; a host serving from memory leaves it off.
   */
  copyFromSource?: boolean;
}

export interface SourceySiteArtifacts {
  config: ResolvedConfig;
  outputDir: string;
  site: SiteConfig;
  navigation: SiteNavigation;
  pages: SitePage[];
  pageCount: number;
  /** The default language and version's search rows as indexed; the site publishes them as the `_search` artifacts. */
  searchRows: SearchEntry[];
  llmsTxt: string;
  llmsFullTxt: string;
  extraFiles: Map<string, ArtifactBody>;
  mediaTypes: Map<string, string>;
  responseHeaders: Map<string, Record<string, string>>;
  changelogDiagnostics: ChangelogDiagnostic[];
  godocDiagnostics: GodocLoaderDiagnostic[];
  rustdocDiagnostics: RustdocLoaderDiagnostic[];
  overlayDiagnostics: OverlayDiagnostic[];
  referenceDiagnostics: ReferenceDiagnostic[];
  contentDiagnostics: ContentDiagnostic[];
  anchorDiagnostics: AnchorDiagnostic[];
  siteDiagnostics: SiteDiagnostic[];
  references: Map<string, NormalizedSpec>;
  assembly: SiteAssembly;
}

export interface SourceySiteWriteOptions {
  embeddable?: boolean;
  /** Write a copy of the first page as the site root. On by default. */
  landingPage?: boolean;
}

export async function buildSourceySite(
  options: SourceySiteOptions = {},
): Promise<SourceySiteArtifacts> {
  const outputDir = resolve(options.outputDir ?? "dist");
  const config = options.config ?? (await loadConfig(options.configDir));
  const previousCache = options.previous && compilationCaches.get(options.previous);

  // What the build reads from outside the site, GitHub's numbers and the repository's history, it reads while the pages load.
  const siteWarnings: SiteDiagnostic[] = [];
  const navbarLinks = readNavbarLinks(config, siteWarnings);
  const repository = config.lastUpdated ? readRepository(config.configDir) : undefined;
  const assembled = await assembleSite(config, options.previous?.assembly.cache, options.changedPaths, options.signal, { copyFromSource: options.copyFromSource });
  // Diagrams are drawn as pages load; their renderer's memory goes with it.
  await closeDiagramRenderer();
  const site = await buildSiteConfig(config, assembled.cache.reader, assembled.extraFiles, await navbarLinks);
  const root = config.baseUrl || "/";
  const home = assembled.routes.match(root);
  if (home && !home.aliasOf) site.home = root;
  const pages = Array.from(assembled.pageMap.values());
  if (repository) await datePages(pages, config.configDir, repository);
  const navigation = buildSiteNavigation(assembled.siteTabs);

  enforceBuildDiagnostics(assembled, options.strictChangelog);

  const rowsByContext = searchRowsByContext(pages, buildSearchIndex(assembled.references, searchDocuments(pages), navigation, assembled.referenceTargets, config.search.featured));
  const exports = generateExports(assembled, pages, navigation, site, config);

  const extraFiles = new Map(assembled.extraFiles);
  for (const [path, body] of exports.files) extraFiles.set(path, body);
  const cache: CompilationCache = {
    pages: new Map(previousCache?.pages),
    searches: publishSearch(config, pages, rowsByContext, extraFiles, previousCache?.searches),
    cards: options.generateOgImages === false ? undefined : await planCards(pages, config, site, assembled.cache.reader, extraFiles),
  };

  const result: SourceySiteArtifacts = {
    config,
    outputDir,
    site,
    navigation,
    pages,
    pageCount: pages.length,
    searchRows: config.contexts.filter(context => context.isDefaultVersion && context.locale === context.defaultLocale).flatMap(context => rowsByContext.get(context.key) ?? []),
    llmsTxt: exports.llmsTxt,
    llmsFullTxt: exports.llmsFullTxt,
    mediaTypes: exports.mediaTypes,
    responseHeaders: exports.responseHeaders,
    extraFiles,
    changelogDiagnostics: assembled.changelogDiagnostics,
    godocDiagnostics: assembled.godocDiagnostics,
    rustdocDiagnostics: assembled.rustdocDiagnostics,
    overlayDiagnostics: assembled.overlayDiagnostics,
    referenceDiagnostics: assembled.referenceDiagnostics,
    contentDiagnostics: assembled.contentDiagnostics,
    anchorDiagnostics: assembled.anchorDiagnostics,
    siteDiagnostics: [...siteWarnings, ...collectSiteDiagnostics(pages, assembled.routes, config, new Set(extraFiles.keys()))],
    references: assembled.references,
    assembly: assembled,
  };
  compilationCaches.set(result, cache);
  return result;
}

/** Date each documentation page and changelog by its file's last commit. */
async function datePages(pages: readonly SitePage[], configDir: string, repository: Promise<Repository>): Promise<void> {
  const files = new Map<SitePage, string>();
  for (const page of pages) {
    const current = page.currentPage;
    const source = current.kind === "markdown" ? current.markdown.sourcePath : current.kind === "changelog" ? current.changelog.sourcePath : undefined;
    if (source) files.set(page, resolve(configDir, source));
  }
  const dates = await lastChanged(repository, [...new Set(files.values())]);
  for (const [page, file] of files) page.updated = dates.get(file);
}

export async function writeSourceySite(
  site: SourceySiteArtifacts,
  options: SourceySiteWriteOptions = {},
): Promise<void> {
  const output = await canonicalInputPath(site.outputDir);
  const inputs = [site.config.configDir, ...site.assembly.cache.reader.inputs.keys()].filter((path): path is string => Boolean(path) && !isAbsoluteHttpUrl(path!));
  for (const source of inputs) {
    const path = relative(output, await canonicalInputPath(source));
    if (!path || !path.startsWith("..") && !isAbsolute(path)) throw new Error(`Output directory would encompass source input: ${source}`);
  }
  // Written as produced, page by page, rather than rendered whole first.
  await drawingCards(() => buildSiteHtml(site.pages, site.navigation, site.outputDir, site.site, {
    routes: site.assembly.routes,
    embeddable: options.embeddable,
    landingPage: options.landingPage,
    cards: compilationCaches.get(site)?.cards,
    extraFiles: site.extraFiles,
  }));
}

export function collectSourceyWatchPaths(config: ResolvedConfig, configPath?: string): string[] {
  const paths = new Set<string>();
  if (config.publicDir) paths.add(config.publicDir);
  if (config.pages) paths.add(config.pages);
  if (config.componentsDir) paths.add(config.componentsDir);
  if (configPath) paths.add(resolve(configPath));
  for (const file of config.configDependencies ?? []) paths.add(file);
  for (const file of config.theme.css) paths.add(file);
  for (const file of [config.logo?.light, config.logo?.dark, config.favicon]) if (file && !/^(?:data:|https?:\/\/)/.test(file)) paths.add(resolve(file));

  for (const tab of config.contexts.flatMap(c => c.tabs)) {
    for (const watchPath of tab.source.watchPaths ?? []) {
      paths.add(resolve(watchPath));
    }

    if (tab.source.kind === "rustdoc") {
      paths.add(resolve(tab.source.config.manifest));
      if (tab.source.config.snapshot) {
        paths.add(resolve(tab.source.config.snapshot));
      }
    }

    if (tab.source.kind === "markdown") {
      for (const page of markdownPages(tab.source.groups)) paths.add(resolve(page.file));
    }
  }

  return Array.from(paths);
}

/** Shared by standalone and Astro transports. A failed build never mutates previous. */
export async function updateSourceySite(previous: SourceySiteArtifacts, changedPaths: string[], options: { signal?: AbortSignal } = {}): Promise<SourceySiteArtifacts> {
  changedPaths = await Promise.all(changedPaths.map(canonicalInputPath));
  // A file in the components folder, a new one too, changes what every page draws.
  const ownComponents = previous.config.componentsDir;
  const structural = changedPaths.some(file => previous.config.configDependencies?.includes(resolve(file)) || (ownComponents !== undefined && resolve(file).startsWith(ownComponents + sep)));
  const sourceInventoryChanged = (await Promise.all(changedPaths.map(async file => {
    if (!/\.(md|mdx)$/.test(file)) return false;
    return !await previous.assembly.cache.reader.contains(file) || !await access(file).then(() => true, () => false);
  }))).some(Boolean);
  let config = previous.config;
  if (structural) config = config.configPath ? await loadConfig(config.configPath, config.host) : await resolveConfigFromRaw(config.authoring, config.configDir, config.host);
  else if (sourceInventoryChanged) {
    const refreshed = await resolveConfigFromRaw(config.authoring, config.configDir, config.host);
    config = { ...config, contexts: refreshed.contexts };
  }
  return buildSourceySite({ config, outputDir: previous.outputDir, previous: structural ? undefined : previous, changedPaths, generateOgImages: false, signal: options.signal });
}
export async function sourceyArtifacts(site: SourceySiteArtifacts, options: SourceySiteWriteOptions = {}) {
  const compilation = compilationCaches.get(site);
  return drawingCards(() => renderSiteArtifacts(site.pages, site.navigation, site.site, { ...options, routes: site.assembly.routes, cache: compilation?.pages, extraFiles: site.extraFiles, cards: compilation?.cards }));
}
