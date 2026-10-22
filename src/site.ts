import { canonicalInputPath } from "./core/loader.js";
import { markdownPages } from "./adapters/shared.js";
import { readFile, access } from "node:fs/promises";
import { toPublicPath } from "./site-url.js";
import { extname, resolve, relative, isAbsolute } from "node:path";
import type { ResolvedConfig } from "./config.js";
import { loadConfig, resolveConfigFromRaw } from "./config.js";
import { buildSiteNavigation } from "./core/navigation.js";
import { buildSearchIndex, searchDocuments, type SearchEntry } from "./core/search-indexer.js";
import type { ChangelogDiagnostic } from "./core/types.js";
import type { GodocLoaderDiagnostic } from "./core/godoc-loader.js";
import type { RustdocLoaderDiagnostic } from "./core/rustdoc-loader.js";
import type { SiteNavigation } from "./core/navigation.js";
import type { SiteConfig } from "./renderer/context.js";
import { buildSite as buildSiteHtml, renderSiteArtifacts, type PageRenderCache } from "./renderer/html-builder.js";
import type { SitePage } from "./core/site-model.js";
import { generateExports } from "./exports/index.js";
import { pageMetadata } from "./core/page-metadata.js";
import { collectSiteDiagnostics, type SiteDiagnostic } from "./core/site-diagnostics.js";
import { closeDiagramRenderer } from "./core/diagrams.js";
import { contentTypeForPath, outputPathFromRequestPath } from "./renderer/static-files.js";
import { assembleSite } from "./site-assembly.js";
import { publishSearch, type SearchCache } from "./site-search.js";
import { buildSiteConfig } from "./site-assets.js";
import { enforceBuildDiagnostics } from "./core/build-diagnostics.js";
import { artifactBytes, type ArtifactBody } from "./core/source-file.js";

interface CompilationCache {
  pages: PageRenderCache;
  searches: SearchCache;
  /** Social cards, drawn as the site's artifacts are produced. */
  cards?: Map<SitePage, () => Promise<Buffer | undefined>>;
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
  overlayDiagnostics: import("./core/overlay.js").OverlayDiagnostic[];
  contentDiagnostics: import("./core/markdown-loader.js").ContentDiagnostic[];
  anchorDiagnostics: import("./core/site-model.js").AnchorDiagnostic[];
  siteDiagnostics: SiteDiagnostic[];
  references: Map<string, import("./core/types.js").NormalizedSpec>;
  assembly: import("./site-assembly.js").SiteAssembly;
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

  const assembled = await assembleSite(config, options.previous?.assembly.cache, options.changedPaths, options.signal, { copyFromSource: options.copyFromSource });
  // Diagrams are drawn as pages load; their renderer's memory goes with it.
  await closeDiagramRenderer();
  const site = await buildSiteConfig(config, assembled.cache.reader, assembled.extraFiles);
  const root = config.baseUrl || "/";
  if (assembled.routes.match(root) && !assembled.routes.match(root)!.aliasOf) site.home = root;
  const pages = Array.from(assembled.pageMap.values());
  const navigation = buildSiteNavigation(assembled.siteTabs);

  enforceBuildDiagnostics(assembled, options.strictChangelog);

  const allSearchRows = buildSearchIndex(assembled.references, searchDocuments(pages), navigation, assembled.referenceTargets, config.search.featured);
  const defaults = pages.filter(p => p.context.isDefaultVersion && p.context.locale === p.context.defaultLocale);
  const defaultUrls = new Set(defaults.map(p => toPublicPath(p.outputPath, config.baseUrl, config.prettyUrls)));
  const searchRows = allSearchRows.filter(row => defaultUrls.has(row.url.split("#")[0]));
  const exports = generateExports(assembled, pages, navigation, site, config);

  const extraFiles = new Map(assembled.extraFiles);
  for (const [path, body] of exports.files) extraFiles.set(path, body);
  const cache: CompilationCache = {
    pages: new Map(previousCache?.pages),
    searches: publishSearch(config, pages, allSearchRows, extraFiles, previousCache?.searches),
    cards: options.generateOgImages === false ? undefined : await planOgImages(pages, config, site, extraFiles),
  };

  const result: SourceySiteArtifacts = {
    config,
    outputDir,
    site,
    navigation,
    pages,
    pageCount: pages.length,
    searchRows,
    llmsTxt: exports.llmsTxt,
    llmsFullTxt: exports.llmsFullTxt,
    mediaTypes: exports.mediaTypes,
    responseHeaders: exports.responseHeaders,
    extraFiles,
    changelogDiagnostics: assembled.changelogDiagnostics,
    godocDiagnostics: assembled.godocDiagnostics,
    rustdocDiagnostics: assembled.rustdocDiagnostics,
    overlayDiagnostics: assembled.overlayDiagnostics,
    contentDiagnostics: assembled.contentDiagnostics,
    anchorDiagnostics: assembled.anchorDiagnostics,
    siteDiagnostics: collectSiteDiagnostics(pages, assembled.routes, config),
    references: assembled.references,
    assembly: assembled,
  };
  compilationCaches.set(result, cache);
  return result;
}

export async function writeSourceySite(
  site: SourceySiteArtifacts,
  options: SourceySiteWriteOptions = {},
): Promise<void> {
  const output = await canonicalInputPath(site.outputDir);
  const inputs = [site.config.configDir, ...site.assembly.cache.reader.inputs.keys()].filter((path): path is string => Boolean(path) && !/^https?:\/\//.test(path!));
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
      for (const page of markdownPages(tab.source.groups)) {
        {
          paths.add(resolve(page.file));
        }
      }
    }
  }

  return Array.from(paths);
}

/**
 * Each page's social card, ready to draw: the page names its card now, and
 * the card is drawn as the site's artifacts are produced, just before its
 * page, so the build never holds every card at once.
 */
async function planOgImages(
  pages: SitePage[],
  config: ResolvedConfig,
  site: SiteConfig,
  extraFiles: Map<string, ArtifactBody>,
): Promise<Map<SitePage, () => Promise<Buffer | undefined>> | undefined> {
  if (config.ogImage) {
    const staticOg = config.ogImage;
    if (
      staticOg.startsWith("http://") ||
      staticOg.startsWith("https://") ||
      staticOg.startsWith("data:")
    ) {
      for (const page of pages) {
        page.ogImagePath = staticOg;
      }
    } else {
      const ogPath = `_og/static${extname(staticOg) || ".png"}`;
      extraFiles.set(ogPath, await readFile(staticOg));
      for (const page of pages) {
        page.ogImagePath = ogPath;
      }
    }
    return undefined;
  }

  const { embedRemoteLogo, generateOgImage } = await import("./og/generate-og-image.js");
  // The card is dark, so it draws the logo the site shows in dark mode.
  let logo = site.logo?.dark ?? site.logo?.light;
  if (logo && /^https?:\/\//.test(logo)) logo = await embedRemoteLogo(logo);
  else if (logo && !logo.startsWith("data:")) {
    const path = outputPathFromRequestPath(logo, config.baseUrl);
    const body = extraFiles.get(path);
    if (body === undefined) throw new Error(`Missing compiled logo asset: ${path}`);
    logo = `data:${contentTypeForPath(path)};base64,${Buffer.from(await artifactBytes(body)).toString("base64")}`;
  }

  const cards = new Map<SitePage, () => Promise<Buffer | undefined>>();
  for (const page of pages) {
    const ogMeta = describePageForOg(page, site, config.changelog.ogImages);
    if (!ogMeta) continue;
    page.ogImagePath = `_og/${page.outputPath.replace(/\.html$/, ".png")}`;
    cards.set(page, () => generateOgImage({
      title: ogMeta.title,
      description: ogMeta.description,
      siteName: config.name,
      theme: config.theme,
      logo,
      logoMark: site.logo?.mark,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Sourcey: skipping OG image for ${page.outputPath}: ${message}`);
      return undefined;
    }));
  }
  return cards;
}

function describePageForOg(
  page: SitePage,
  site: Pick<SiteConfig, "name" | "titleSeparator">,
  changelogPermalinkOg: boolean,
): { title: string; description?: string } | null {
  if (page.status === 404) return null;
  if (page.currentPage.kind === "changelog" && page.currentPage.changelog.permalinkVersionId && !changelogPermalinkOg) return null;
  const metadata = pageMetadata(page.currentPage, site);
  return { title: metadata.title, description: metadata.description };
}

/** Shared by standalone and Astro transports. A failed build never mutates previous. */
export async function updateSourceySite(previous: SourceySiteArtifacts, changedPaths: string[], options: { signal?: AbortSignal } = {}): Promise<SourceySiteArtifacts> {
  changedPaths = await Promise.all(changedPaths.map(canonicalInputPath));
  const structural = changedPaths.some(file => previous.config.configDependencies?.includes(resolve(file)));
  const sourceInventoryChanged = (await Promise.all(changedPaths.map(async file => {
    if (!/\.(md|mdx)$/.test(file)) return false;
    return !await previous.assembly.cache.reader.contains(file) || !await access(file).then(() => true, () => false);
  }))).some(Boolean);
  let config = previous.config;
  if (structural && config.configPath) config = await loadConfig(config.configPath, config.host);
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

/** The worker that lays cards out ends with the last of them, and frees what it held. */
async function drawingCards<T>(produce: () => Promise<T>): Promise<T> {
  try {
    return await produce();
  } finally {
    const { closeCardDrawer } = await import("./og/draw-card.js");
    await closeCardDrawer();
  }
}
