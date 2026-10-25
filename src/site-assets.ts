import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { ResolvedConfig, ResolvedTab } from "./config.js";
import type { InputReader } from "./core/loader.js";
import { staticMediaAsset } from "./core/media.js";
import { stringifyShared } from "./core/shared-json.js";
import type { SitePage } from "./core/site-model.js";
import type { ArtifactBody } from "./core/source-file.js";
import type { SiteConfig } from "./renderer/context.js";
import type { SiteDiagnostic } from "./core/site-diagnostics.js";
import { githubRepository, repositoryStats } from "./core/github-stats.js";
import { consoleArtifactPath, consoleData } from "./renderer/try-it.js";
import { tabPath, toPublicUrl } from "./site-url.js";

/**
 * The site as its pages draw it: its name, theme and links, with its logo,
 * favicon and theme stylesheets published as assets and named by their URLs.
 */
export async function buildSiteConfig(config: ResolvedConfig, input: InputReader, assets: Map<string, ArtifactBody>, links: SiteConfig["navbar"]["links"] = config.navbar.links): Promise<SiteConfig> {
  async function assetUrl(source: string): Promise<string> {
    if (!source || /^(?:data:|https?:\/\/)/.test(source)) return source;
    const asset = await staticMediaAsset(source, input, "site");
    assets.set(asset.path, asset.body);
    return toPublicUrl(asset.path, undefined, config.baseUrl, config.prettyUrls);
  }
  const logo = config.logo
    ? {
        light: await assetUrl(config.logo.light ?? ""),
        dark: config.logo.dark ? await assetUrl(config.logo.dark) : undefined,
        href: config.logo.href,
        mark: config.logo.mark,
      }
    : undefined;

  /**
   * A site without a favicon shows its logo where that is a mark, or else the square of its primary
   * colour its social cards draw beside its name. Without an icon, every page's browser asks for
   * /favicon.ico and logs the missing file.
   */
  function markIcon(primary: string): string {
    const fill = `#${primary.split(/\s+/).map(channel => Number(channel).toString(16).padStart(2, "0")).join("")}`;
    const body = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${fill}"/></svg>`);
    const path = `_media/${createHash("sha256").update(body).digest("hex").slice(0, 20)}.svg`;
    assets.set(path, body);
    return toPublicUrl(path, undefined, config.baseUrl, config.prettyUrls);
  }

  const customCSS = await loadCustomCSS(config.theme.css, input, assetUrl);

  return {
    name: config.name,
    tryIt: config.tryIt,
    titleSeparator: config.titleSeparator,
    siteUrl: config.siteUrl,
    baseUrl: config.baseUrl,
    prettyUrls: config.prettyUrls,
    theme: config.theme,
    logo: logo?.light ? logo : undefined,
    favicon: config.favicon ? await assetUrl(config.favicon) : config.logo?.mark && logo?.light ? logo.light : markIcon(config.theme.colors.primary),
    repo: config.repo,
    editBranch: config.editBranch,
    editBasePath: config.editBasePath,
    codeSamples: config.codeSamples,
    navbar: { ...config.navbar, links },
    footer: config.footer,
    customCSS: customCSS || undefined,
    changelog: config.changelog,
    ...(config.markdown.smartypants ? { smartypants: true } : {}),
    ...(Object.keys(config.pageParts).length > 0 ? { pageParts: config.pageParts } : {}),
    ...(config.feedback ? { feedback: config.feedback } : {}),
    ...(config.breadcrumbs ? { breadcrumbs: true as const } : {}),
  };
}

/**
 * The navbar's links, a GitHub link that asks for its repository's numbers
 * with them. When GitHub does not answer, the build says so and the link
 * shows without them; it never fails.
 */
export function readNavbarLinks(config: ResolvedConfig, warnings: SiteDiagnostic[]): Promise<SiteConfig["navbar"]["links"]> {
  return Promise.all(config.navbar.links.map(async (link) => {
    const repository = link.type !== "menu" && link.stats ? githubRepository(link.href) : undefined;
    if (link.type === "menu" || !repository) return link;
    try {
      return { ...link, repository: await repositoryStats(repository) };
    } catch (error) {
      warnings.push({ severity: "warning", code: "github-stats", message: `${link.href}: GitHub's release, stars and forks could not be read (${(error as Error).message}); the link shows without them` });
      return link;
    }
  }));
}

/**
 * The files a site publishes besides its pages, in the order they claim
 * their paths: each reference's API console data, each page's own assets and
 * stylesheets, a Markdown tab's source assets, and the public directory, which
 * may not replace any of them.
 */
export async function attachSiteFiles(extraFiles: Map<string, ArtifactBody>, pages: readonly SitePage[], tabs: readonly ResolvedTab[], config: ResolvedConfig, reader: InputReader): Promise<void> {
  const consoles = new Set<string>();
  for (const page of pages) {
    if (page.currentPage.kind !== "spec" || page.currentPage.tryIt === false || consoles.has(page.tabSlug)) continue;
    consoles.add(page.tabSlug);
    const scope = page.currentPage.specKey ?? page.tabSlug;
    for (const operation of page.currentPage.spec.operations) {
      if (operation.hidden || operation.mcpExtras) continue;
      extraFiles.set(consoleArtifactPath(scope, operation), stringifyShared(
        consoleData(operation, page.currentPage.spec, scope, config.codeSamples, page.currentPage.tryIt)));
    }
  }
  for (const page of pages) if (page.currentPage.kind === "markdown") for (const [path, body] of page.currentPage.markdown.assets ?? []) extraFiles.set(path, body);
  // A page's own stylesheets, published once each as the theme's are.
  const stylesheets = new Map<string, string>();
  for (const page of pages) {
    for (const file of page.currentPage.kind === "markdown" ? page.currentPage.markdown.css ?? [] : []) {
      let path = stylesheets.get(file);
      if (!path) {
        const css = await loadCustomCSS([file], reader, async source => {
          const asset = await staticMediaAsset(source, reader, file);
          extraFiles.set(asset.path, asset.body);
          return toPublicUrl(asset.path, undefined, config.baseUrl, config.prettyUrls);
        }, file);
        path = `_media/${createHash("sha256").update(css).digest("hex").slice(0, 20)}.css`;
        extraFiles.set(path, css);
        stylesheets.set(file, path);
      }
      (page.stylesheets ??= []).push(path);
    }
  }
  for (const tab of tabs) {
    if (tab.source.kind !== "markdown") continue;
    for (const asset of tab.source.assets ?? []) extraFiles.set(tabPath(tab.slug, asset.outputPath), (await reader.file(asset.file, asset.file)).body);
  }
  if (config.publicDir) {
    const { publicAssets } = await import("./core/media.js");
    for (const [path, body] of await publicAssets(config.publicDir, reader)) {
      if (extraFiles.has(path)) throw new Error(`Public asset collides with a generated artifact: ${path}`);
      extraFiles.set(path, body);
    }
  }
}

/**
 * Theme stylesheets, with each relative `url()` (a site's own fonts or images)
 * resolved from the stylesheet's folder and published as a shared asset.
 */
async function loadCustomCSS(paths: string[], input: InputReader, assetUrl: (source: string) => Promise<string>, owner = "site"): Promise<string> {
  const parts: string[] = [];
  for (const path of paths) {
    const css = await input.readText(path, owner);
    const urls = new Map<string, string>();
    for (const [, , target] of css.matchAll(CSS_URL)) {
      if (urls.has(target) || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target)) continue;
      const [file, suffix = ""] = target.split(/(?=[?#])/, 2);
      const source = resolve(dirname(path), file);
      try {
        urls.set(target, (await assetUrl(source)) + suffix);
      } catch (error) {
        throw new Error(`${path} refers to ${target}, which cannot be read: ${(error as Error).message}`, { cause: error });
      }
    }
    parts.push(css.replace(CSS_URL, (match, quote: string, target: string) => (urls.has(target) ? `url(${quote}${urls.get(target)}${quote})` : match)));
  }
  return parts.join("\n");
}
const CSS_URL = /url\(\s*(["']?)([^"')]+?)\1\s*\)/g;
