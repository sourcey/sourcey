import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { projectNavigation, type SiteNavigation } from "../core/navigation.js";
import { referenceOperation } from "../core/reference-identity.js";
import { safeOutputPath, type RedirectRecord, type RouteTable, type SitePage } from "../core/site-model.js";
import { artifactBytes, type ArtifactBody } from "../core/source-file.js";
import type { NormalizedSpec } from "../core/types.js";
import { isAbsoluteHttpUrl, toAbsoluteUrl, toPublicPath } from "../site-url.js";
import { escapeHtml as escapeXml } from "../utils/html.js";
import { buildAssets } from "./assets.js";
import type { RenderAssetPaths, RenderOptions, SiteConfig } from "./context.js";
import { renderPage } from "./static-renderer.js";
import { writeArtifacts } from "./writer.js";

/** Snapshot-local artifacts: unchanged HTML is shared across immutable compilations. */
export type PageRenderCache = Map<string, { key: string; html: Buffer }>;
const referenceIds = new WeakMap<NormalizedSpec, number>();
const referenceMetadata = new WeakMap<NormalizedSpec, string>();
const sharedDigests = new WeakMap<object, string>();
function sharedDigest(value: object | undefined): string | undefined {
  if (!value) return undefined;
  let digest = sharedDigests.get(value);
  if (!digest) { digest = createHash("sha256").update(JSON.stringify(value)).digest("hex"); sharedDigests.set(value, digest); }
  return digest;
}
let referenceSequence = 0;
function renderCached(page: SitePage, options: RenderOptions, navigation: SiteNavigation, site: SiteConfig, siteDigest: string, cache: PageRenderCache | undefined, outputPath = page.outputPath): Buffer {
  const current = page.currentPage;
  // Keep finished UTF-8 bytes, not Preact's tree of concatenated JS strings.
  // The same bytes feed the writer, HTTP hosts and unchanged-page cache.
  const render = () => Buffer.from(renderPage(current.kind === "spec" ? current.spec : undefined, options, navigation, current, site));
  if (!cache) return render();
  let content: unknown;
  if (current.kind === "spec") {
    const { spec, view } = current;
    let reference: number | string | undefined, document: string | undefined;
    if (view?.kind === "operation" || view?.kind === "schema") {
      reference = referenceMetadata.get(spec);
      if (!reference) {
        reference = sharedDigest({ info: spec.info, servers: spec.servers, securitySchemes: spec.securitySchemes, sourceUrl: spec.sourceUrl })!;
        referenceMetadata.set(spec, reference);
      }
      document = sharedDigest(view.kind === "operation" ? referenceOperation(spec, view.id) : spec.schemas[view.name]);
    } else {
      reference = referenceIds.get(spec);
      if (reference === undefined) { reference = ++referenceSequence; referenceIds.set(spec, reference); }
    }
    content = { kind: "spec", reference, document, view, tryIt: current.tryIt, specKey: current.specKey };
  } else if (current.kind === "markdown") {
    const document = { ...current.markdown };
    delete document.assets;
    content = { kind: "markdown", document };
  } else content = current;
  // Reference destinations and locale messages are immutable shared inputs.
  // Hash their full value once, rather than serialize all routes per page.
  const optionKey = { ...options, referenceTargets: sharedDigest(options.referenceTargets), messages: sharedDigest(options.messages) };
  const key = createHash("sha256").update(siteDigest).update(JSON.stringify([content, optionKey, navigation])).digest("hex");
  const cached = cache.get(outputPath);
  if (cached?.key === key) return cached.html;
  const html = render();
  cache.set(outputPath, { key, html });
  return html;
}

export interface BuildOutput {
  htmlPath: string;
  outputDir: string;
}

export function createRenderOptions(
  page: SitePage,
  site: SiteConfig,
  options?: {
    embeddable?: boolean;
    assets?: RenderAssetPaths;
  },
): RenderOptions {
  // A page names its assets from the site's base, so it renders whole at any
  // address it answers at: with or without a trailing slash, or as a copy at
  // another address.
  const assetBase = site.baseUrl || "/";
  const { canonical, context } = page;
  if (canonical === undefined) throw new Error(`Rendering a page the site's routes never placed: ${page.outputPath}`);
  const translated = page.contentLocale === context.locale;

  return {
    anchorAliases: page.anchorAliases,
    embeddable: options?.embeddable ?? false,
    referenceTargets: page.referenceTargets,
    sourceRevision: context.version.revision,
    componentStyles: [...(page.currentPage.kind === "markdown" ? page.currentPage.markdown.componentStyles ?? [] : []), ...page.stylesheets ?? []],
    lang: translated ? context.localeConfig.lang : context.defaultLang,
    equivalents: page.equivalents?.map(link => ({ ...link, href: site.siteUrl ? toAbsoluteUrl(link.href, site.siteUrl) : link.href })),
    searchIndexes: page.searchIndexes?.map(path => `${assetBase}${path}`),
    dir: context.localeConfig.dir,
    messages: context.localeConfig.messages,
    noindex: page.status === 404 || context.version.index === false || !translated,
    notice: translated ? context.version.notice || undefined : context.localeConfig.messages.fallback,
    assetBase,
    assets: options?.assets && {
      ...options.assets,
      styles: options.assets.styles.map(path => assetBase + path),
      languageIcons: assetBase + options.assets.languageIcons,
      client: assetBase + options.assets.client,
      theme: assetBase + options.assets.theme,
      search: assetBase + options.assets.search,
      tryIt: options.assets.tryIt && assetBase + options.assets.tryIt,
    },
    pageUrl: site.siteUrl ? toAbsoluteUrl(canonical, site.siteUrl) : canonical,
    ogImageUrl: page.ogImagePath ? resolveRenderHref(page.ogImagePath, assetBase, site) : undefined,
    alternateLinks: page.alternateLinks?.map((link) => ({
      ...link,
      href: resolveRenderHref(link.href, assetBase, site),
    })),
  };
}

export interface SiteArtifactOptions {
  routes: RouteTable;
  /** Rendered pages kept across compilations; only a rebuilding host keeps one. */
  cache?: PageRenderCache;
  embeddable?: boolean;
  landingPage?: boolean;
  /** Social cards still to draw, each just before the page that names it is rendered. */
  cards?: ReadonlyMap<SitePage, () => Promise<Buffer | undefined>>;
  extraFiles?: Map<string, ArtifactBody>;
}

/** Cards drawn ahead of the page being rendered, so a page waits for none. */
const CARDS_AHEAD = 32;

/** Low-level renderer; SourceySite owns compilation and its artifact inventory. */
export async function buildSite(
  pages: SitePage[], navigation: SiteNavigation, outputDir: string, site: SiteConfig,
  options: SiteArtifactOptions,
): Promise<BuildOutput> {
  await writeArtifacts(outputDir, siteArtifacts(pages, navigation, site, options));
  return { htmlPath: resolve(outputDir, "index.html"), outputDir: resolve(outputDir) };
}

/** Every artifact in memory at once, for a host that serves them. */
export async function renderSiteArtifacts(
  pages: SitePage[], navigation: SiteNavigation, site: SiteConfig,
  options: SiteArtifactOptions,
): Promise<Map<string, string | Buffer>> {
  const files = new Map<string, string | Buffer>();
  for await (const [path, body] of siteArtifacts(pages, navigation, site, options)) files.set(path, await artifactBytes(body));
  return files;
}

/**
 * A site's artifacts, one at a time: each page is rendered only when it is
 * reached, and its card drawn just ahead of it, so no host need hold every
 * page of a site at once.
 */
export async function* siteArtifacts(
  pages: SitePage[], navigation: SiteNavigation, site: SiteConfig,
  options: SiteArtifactOptions,
): AsyncGenerator<[string, ArtifactBody]> {
  const { routes, cache } = options;
  const assets = await buildAssets(site.theme.name, pages.some(page =>
    page.currentPage.kind === "spec" && page.currentPage.tryIt !== false && page.currentPage.spec.operations.some(op => !op.hidden && !op.mcpExtras)));
  const siteDigest = createHash("sha256").update(JSON.stringify(site)).digest("hex");
  const folded = new Set<string>();
  const written = new Set<string>();
  const claim = <T extends ArtifactBody>(path: string, body: T): [string, T] => {
    safeOutputPath(path);
    const key = path.normalize("NFC").toLowerCase();
    if (folded.has(key)) throw new Error(`Output collision: ${path}`);
    folded.add(key); written.add(path);
    return [path, body];
  };
  const drawing = new Map<SitePage, Promise<Buffer | undefined>>();
  let ahead = 0;
  for (const page of pages) {
    for (; ahead < pages.length && drawing.size < CARDS_AHEAD; ahead++) {
      const draw = options.cards?.get(pages[ahead]);
      if (draw) drawing.set(pages[ahead], draw());
    }
    const card = drawing.get(page);
    if (card) {
      drawing.delete(page);
      const png = await card;
      // A card that could not be drawn leaves its page without one.
      if (png) yield claim(page.ogImagePath!, png);
      else page.ogImagePath = undefined;
    }
    const optionsForPage = createRenderOptions(page, site, { embeddable: options.embeddable, assets: assets.paths });
    const activeNav = projectNavigation(page.navigation ?? navigation, page.tabSlug, page.pageSlug);
    yield claim(page.outputPath, renderCached(page, optionsForPage, activeNav, site, siteDigest, cache));
  }
  for (const alias of options.landingPage === false ? [] : routes.aliases) {
    const page = alias.page;
    yield claim(alias.outputPath, renderCached(page, createRenderOptions(page, site, { embeddable: options.embeddable, assets: assets.paths }),
      projectNavigation(page.navigation ?? navigation, page.tabSlug, page.pageSlug), site, siteDigest, cache, alias.outputPath));
  }
  const redirects = [...routes.redirects.values()].filter((route): route is RedirectRecord & { outputPath: string } => !!route.outputPath);
  for (const route of redirects) yield claim(route.outputPath, redirectPage(route.to, site));
  if (redirects.length) yield claim("_redirects", redirects.map(route => `${route.publicPath} ${route.to} ${route.status}`).join("\n") + "\n");
  for (const [path, body] of assets.files) yield claim(path, body);
  // A sitemap names each page by its absolute URL, so only a site that knows its origin has one.
  if (site.siteUrl) {
    const siteUrl = site.siteUrl;
    const urls = pages.flatMap(page => {
      const route = routes.byOutputPath.get(page.outputPath);
      return route?.index ? [`  <url><loc>${escapeXml(toAbsoluteUrl(route.publicPath, siteUrl))}</loc></url>`] : [];
    });
    yield claim("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
  }
  for (const [path, body] of options.extraFiles ?? []) yield claim(path, body);
  if (cache) for (const path of cache.keys()) if (!written.has(path)) cache.delete(path);
}

/** The page a moved address serves: it leads on to where the page is now, keeping the query and fragment it was reached with. */
function redirectPage(to: string, site: SiteConfig): string {
  const target = escapeXml(to);
  const literal = JSON.stringify(to).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${escapeXml(toAbsoluteUrl(to, site.siteUrl))}"><title>Page moved</title></head><body><p>This page has moved. <a href="${target}">Continue to the page</a>.</p><script>const target=${literal},url=new URL(target,location.href);if(!target.includes('?'))url.search=location.search;if(!target.includes('#'))url.hash=location.hash;location.replace(url.href)</script></body></html>`;
}

function resolveRenderHref(pathOrUrl: string, assetBase: string, site: SiteConfig): string {
  if (
    !pathOrUrl ||
    pathOrUrl.startsWith("/") ||
    pathOrUrl.startsWith("#") ||
    pathOrUrl.startsWith("mailto:") ||
    pathOrUrl.startsWith("data:") ||
    isAbsoluteHttpUrl(pathOrUrl)
  ) {
    return pathOrUrl;
  }

  if (site.siteUrl) {
    return toAbsoluteUrl(toPublicPath(pathOrUrl, site.baseUrl), site.siteUrl);
  }

  if (site.baseUrl) {
    return toPublicPath(pathOrUrl, site.baseUrl);
  }

  return `${assetBase}${pathOrUrl}`;
}
