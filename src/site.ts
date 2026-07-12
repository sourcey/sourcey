import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ResolvedConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { buildSiteNavigation } from "./core/navigation.js";
import { buildSearchIndex } from "./core/search-indexer.js";
import type { ChangelogDiagnostic, NormalizedChangelogVersion } from "./core/types.js";
import type { GodocLoaderDiagnostic } from "./core/godoc-loader.js";
import type { RustdocLoaderDiagnostic } from "./core/rustdoc-loader.js";
import type { SiteNavigation } from "./core/navigation.js";
import type { SiteConfig } from "./renderer/context.js";
import { buildSite as buildSiteHtml } from "./renderer/html-builder.js";
import type { SitePage } from "./renderer/html-builder.js";
import { generateLlmsFullTxt, generateLlmsTxt } from "./renderer/llms.js";
import {
  assembleSite,
  buildSiteConfig,
  collectDocsPagesByTab,
  enforceChangelogDiagnostics,
  enforceGodocDiagnostics,
  enforceRustdocDiagnostics,
} from "./site-assembly.js";

export interface SourceySiteOptions {
  configDir?: string;
  config?: ResolvedConfig;
  outputDir?: string;
  strictChangelog?: boolean;
  generateOgImages?: boolean;
}

export interface SourceySiteArtifacts {
  config: ResolvedConfig;
  outputDir: string;
  site: SiteConfig;
  navigation: SiteNavigation;
  pages: SitePage[];
  pageCount: number;
  searchIndex: string;
  llmsTxt: string;
  llmsFullTxt: string;
  extraFiles: Map<string, string | Buffer>;
  ogImages: Map<string, Buffer>;
  changelogDiagnostics: ChangelogDiagnostic[];
  godocDiagnostics: GodocLoaderDiagnostic[];
  rustdocDiagnostics: RustdocLoaderDiagnostic[];
  specsBySlug: Map<string, import("./core/types.js").NormalizedSpec>;
}

export interface SourceySiteWriteOptions {
  embeddable?: boolean;
}

export async function buildSourceySite(
  options: SourceySiteOptions = {},
): Promise<SourceySiteArtifacts> {
  const outputDir = resolve(options.outputDir ?? "dist");
  const config = options.config ?? (await loadConfig(options.configDir));

  const assembled = await assembleSite(config);
  const site = await buildSiteConfig(config);
  const pages = Array.from(assembled.pageMap.values());
  const navigation = buildSiteNavigation(assembled.siteTabs);

  enforceChangelogDiagnostics(assembled.changelogDiagnostics, options.strictChangelog);
  enforceGodocDiagnostics(assembled.godocDiagnostics);
  enforceRustdocDiagnostics(assembled.rustdocDiagnostics);

  const docsPagesByTab = collectDocsPagesByTab(assembled.pageMap, config.tabs);
  const searchIndex = buildSearchIndex(
    assembled.specsBySlug,
    docsPagesByTab,
    navigation,
    config.baseUrl || "/",
    config.search.featured,
    config.prettyUrls,
  );
  const llmsTxt = generateLlmsTxt(pages, navigation, site);
  const llmsFullTxt = generateLlmsFullTxt(pages, navigation, site);

  const extraFiles = new Map(assembled.extraFiles);
  const ogImages = new Map<string, Buffer>();

  if (options.generateOgImages !== false) {
    await attachOgImages(pages, config, site, extraFiles, ogImages);
  }

  return {
    config,
    outputDir,
    site,
    navigation,
    pages,
    pageCount: pages.length,
    searchIndex,
    llmsTxt,
    llmsFullTxt,
    extraFiles,
    ogImages,
    changelogDiagnostics: assembled.changelogDiagnostics,
    godocDiagnostics: assembled.godocDiagnostics,
    rustdocDiagnostics: assembled.rustdocDiagnostics,
    specsBySlug: assembled.specsBySlug,
  };
}

export async function writeSourceySite(
  site: SourceySiteArtifacts,
  options: SourceySiteWriteOptions = {},
): Promise<void> {
  await buildSiteHtml(site.pages, site.navigation, site.outputDir, site.site, {
    searchIndex: site.searchIndex,
    llmsTxt: site.llmsTxt,
    llmsFullTxt: site.llmsFullTxt,
    embeddable: options.embeddable,
    ogImages: site.ogImages,
    extraFiles: site.extraFiles,
  });
}

export function collectSourceyWatchPaths(
  config: ResolvedConfig,
  configPath?: string,
): string[] {
  const paths = new Set<string>();
  if (configPath) paths.add(resolve(configPath));

  for (const tab of config.tabs) {
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
      for (const group of tab.source.groups) {
        for (const page of group.pages) {
          paths.add(resolve(page.file));
        }
      }
    }
  }

  return Array.from(paths);
}

async function attachOgImages(
  pages: SitePage[],
  config: ResolvedConfig,
  site: SiteConfig,
  extraFiles: Map<string, string | Buffer>,
  ogImages: Map<string, Buffer>,
): Promise<void> {
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
    return;
  }

  const { generateOgImage } = await import("./og/generate-og-image.js");

  const concurrency = 8;
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (page) => {
        const ogMeta = describePageForOg(page, config.name || "API", config.changelog.ogImages);
        if (!ogMeta) return;

        try {
          const ogPath = `_og/${page.outputPath.replace(/\.html$/, ".png")}`;
          const png = await generateOgImage({
            title: ogMeta.title,
            description: ogMeta.description,
            siteName: config.name,
            theme: config.theme,
            logo: site.logo?.light,
          });

          page.ogImagePath = ogPath;
          ogImages.set(ogPath, png);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Sourcey: skipping OG image for ${page.outputPath}: ${message}`);
        }
      }),
    );
  }
}

function describePageForOg(
  page: SitePage,
  defaultSiteName: string,
  changelogPermalinkOg: boolean,
): { title: string; description?: string } | null {
  if (page.currentPage.kind === "markdown") {
    return {
      title: page.currentPage.markdown.title,
      description: page.currentPage.markdown.description || undefined,
    };
  }

  if (page.currentPage.kind === "changelog") {
    const changelog = page.currentPage.changelog;
    if (changelog.permalinkVersionId) {
      if (!changelogPermalinkOg) return null;

      const version = changelog.changelog.versions.find(
        (candidate) => candidate.id === changelog.permalinkVersionId,
      );
      if (!version) return null;

      return {
        title: `${version.version ?? "Unreleased"} - ${changelog.title}`,
        description: version.summary || summarizeVersion(version),
      };
    }

    return {
      title: changelog.title,
      description: changelog.description || changelog.changelog.description,
    };
  }

  return { title: `${defaultSiteName} Reference` };
}

function summarizeVersion(version: NormalizedChangelogVersion): string | undefined {
  if (version.summary) return version.summary;
  const texts = version.sections.flatMap((section) => section.entries.map((entry) => entry.text));
  const summary = texts.slice(0, 3).join(" ");
  return summary || undefined;
}
