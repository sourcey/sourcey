import { createServer as createViteServer, type InlineConfig } from "vite";
import { resolve, dirname, extname, basename, relative } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, pageOutputPath, resolveConfigFromRaw, tabIndexOutputPath } from "./config.js";
import type { ResolvedConfig, ResolvedPage } from "./config.js";
import { loadSpec } from "./core/loader.js";
import { convertToOpenApi3 } from "./core/converter.js";
import { parseSpec } from "./core/parser.js";
import { normalizeSpec } from "./core/normalizer.js";
import { normalizeMcpSpec } from "./core/mcp-normalizer.js";
import { buildNavFromSpec, buildSiteNavigation, withActivePage } from "./core/navigation.js";
import type { SiteConfig } from "./renderer/context.js";
import { loadDocsPage, slugFromPath } from "./core/markdown-loader.js";
import { loadDoxygenTab } from "./core/doxygen-loader.js";
import { loadGodocTab } from "./core/godoc-loader.js";
import { loadRustdocTab } from "./core/rustdoc-loader.js";
import { buildSearchIndex } from "./core/search-indexer.js";
import { createRenderOptions } from "./renderer/html-builder.js";
import {
  assembleSite,
  buildSiteConfig,
  collectDocsPagesByTab,
  enforceChangelogDiagnostics,
  formatChangelogDiagnostic,
  rebuildMarkdownTabNavigation,
  resolveInternalLinks,
} from "./site-assembly.js";
import { stripBaseUrl } from "./site-url.js";
import { sourceyPlugin } from "./vite-plugin.js";
import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function log(msg: string): void {
  const t = new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`  \x1b[2m${t}\x1b[0m ${msg}`);
}

function shortPath(path: string): string {
  return relative(process.cwd(), path) || basename(path);
}

export interface DevServerOptions {
  port: number;
  host?: string;
  config?: string;
  strictChangelog?: boolean;
}

export async function startDevServer(options: DevServerOptions): Promise<void> {
  const { port, host } = options;
  let config = await loadConfig(options.config);
  const configPath = options.config?.endsWith(".ts")
    ? resolve(options.config)
    : resolve(options.config ?? process.cwd(), "sourcey.config.ts");

  const watchPaths: string[] = [configPath];
  for (const tab of config.tabs) {
    watchPaths.push(...(tab.source.watchPaths ?? []));
    if (tab.source.kind === "godoc") {
      // The Go module directory is large; watching every .go file slows the
      // dev server. Restart manually after broad source edits.
    }
    if (tab.source.kind === "rustdoc") {
      // Cargo manifest is the watch surface; .rs files are intentionally not
      // watched because rustdoc recompile is expensive. Restart manually
      // after broad source edits, matching the godoc policy.
      watchPaths.push(resolve(tab.source.config.manifest));
      if (tab.source.config.snapshot) {
        watchPaths.push(resolve(tab.source.config.snapshot));
      }
    }
    if (tab.source.kind === "markdown") {
      for (const group of tab.source.groups) {
        for (const page of group.pages) {
          watchPaths.push(page.file);
        }
      }
    }
  }

  type ContentKind =
    | { kind: "markdown"; tabSlug: string; page: ResolvedPage }
    | { kind: "doxygen"; tabSlug: string; xmlDir: string }
    | { kind: "godoc"; tabSlug: string; snapshotPath: string }
    | { kind: "rustdoc"; tabSlug: string; snapshotPath: string }
    | { kind: "openapi"; tabSlug: string; specPath: string }
    | { kind: "mcp"; tabSlug: string; specPath: string }
    | { kind: "config" };

  function buildFileToContent(cfg: ResolvedConfig): Map<string, ContentKind> {
    const map = new Map<string, ContentKind>();
    map.set(configPath, { kind: "config" });

    for (const tab of cfg.tabs) {
      for (const watchPath of tab.source.watchPaths ?? []) {
        map.set(resolve(watchPath), { kind: "config" });
      }
      if (tab.source.kind === "openapi") {
        map.set(resolve(tab.source.spec), {
          kind: "openapi",
          tabSlug: tab.slug,
          specPath: tab.source.spec,
        });
      }
      if (tab.source.kind === "mcp") {
        map.set(resolve(tab.source.spec), {
          kind: "mcp",
          tabSlug: tab.slug,
          specPath: tab.source.spec,
        });
      }
      if (tab.source.kind === "doxygen") {
        map.set(resolve(tab.source.config.xml), {
          kind: "doxygen",
          tabSlug: tab.slug,
          xmlDir: tab.source.config.xml,
        });
      }
      if (tab.source.kind === "godoc" && tab.source.config.snapshot) {
        map.set(resolve(tab.source.config.snapshot), {
          kind: "godoc",
          tabSlug: tab.slug,
          snapshotPath: tab.source.config.snapshot,
        });
      }
      if (tab.source.kind === "rustdoc" && tab.source.config.snapshot) {
        map.set(resolve(tab.source.config.snapshot), {
          kind: "rustdoc",
          tabSlug: tab.slug,
          snapshotPath: tab.source.config.snapshot,
        });
      }
      if (tab.source.kind === "markdown") {
        for (const group of tab.source.groups) {
          for (const page of group.pages) {
            map.set(resolve(page.file), { kind: "markdown", tabSlug: tab.slug, page });
          }
        }
      }
    }

    return map;
  }

  let fileToContent = buildFileToContent(config);

  const projectRoot = resolve(__dirname, "..");
  const hasSrc = await exists(resolve(projectRoot, "src/client/index.ts"));
  const tailwindCssPath = resolve(
    projectRoot,
    hasSrc ? "src/themes/default/main.css" : "dist/themes/default/main.css",
  );
  const sourceyCssPath = resolve(
    projectRoot,
    hasSrc ? "src/themes/default/sourcey.css" : "dist/themes/default/sourcey.css",
  );
  const clientEntry = resolve(projectRoot, hasSrc ? "src/client/index.ts" : "dist/client/index.js");
  const ssrRendererPath = resolve(
    projectRoot,
    hasSrc ? "src/renderer/static-renderer.ts" : "dist/renderer/static-renderer.js",
  );

  interface CachedSite {
    data: Awaited<ReturnType<typeof assembleSite>>;
    siteConfig: SiteConfig;
  }
  let cache: CachedSite | null = null;
  let cachePromise: Promise<CachedSite> | null = null;

  function reportChangelogDiagnostics(
    diagnostics: CachedSite["data"]["changelogDiagnostics"],
  ): void {
    for (const diagnostic of diagnostics) {
      const writer = diagnostic.severity === "error" ? console.error : console.warn;
      writer(`  ${formatChangelogDiagnostic(diagnostic)}`);
    }
  }

  function fullRebuild(): Promise<CachedSite> {
    if (!cachePromise) {
      const start = performance.now();
      log("building site data...");
      cachePromise = (async () => {
        const data = await assembleSite(config);
        if (data.changelogDiagnostics.length) {
          reportChangelogDiagnostics(data.changelogDiagnostics);
        }
        enforceChangelogDiagnostics(data.changelogDiagnostics, options.strictChangelog ?? false);

        const siteConfig = await buildSiteConfig(config);
        const result: CachedSite = { data, siteConfig };
        cache = result;
        cachePromise = null;
        const ms = Math.round(performance.now() - start);
        log(`ready \x1b[2m(${data.pageMap.size} pages in ${ms}ms)\x1b[0m`);
        return result;
      })().catch((err) => {
        cachePromise = null;
        throw err;
      });
    }

    return cachePromise;
  }

  function getCached(): Promise<CachedSite> {
    if (cache) return Promise.resolve(cache);
    return fullRebuild();
  }

  async function incrementalUpdate(content: ContentKind): Promise<void> {
    const snapshot = cache;
    if (!snapshot) {
      await fullRebuild();
      return;
    }

    const { data } = snapshot;
    const start = performance.now();

    if (content.kind === "markdown") {
      const slug = slugFromPath(content.page.slug);
      log(`reloading ${shortPath(content.page.file)}`);
      const page = await loadDocsPage(content.page.file, slug, {
        changelog: config.changelog.enabled,
        repoUrl: config.repo,
        sourceRoot: content.page.sourceRoot,
        preprocess: content.page.preprocess,
      });
      if (cache !== snapshot) return;

      const pageKey = pageOutputPath(content.tabSlug, slug, config.prettyUrls);
      const existing = data.pageMap.get(pageKey);
      if (page.kind === "changelog" || existing?.currentPage.kind === "changelog") {
        cache = null;
        cachePromise = null;
        await fullRebuild();
        return;
      }

      if (existing) {
        existing.currentPage = { kind: "markdown", markdown: page };
      }
      rebuildMarkdownTabNavigation(
        data.pageMap,
        data.siteTabs,
        config.tabs,
        content.tabSlug,
        config.prettyUrls,
      );
    } else if (content.kind === "doxygen") {
      const tab = config.tabs.find((candidate) => candidate.slug === content.tabSlug);
      if (!tab || tab.source.kind !== "doxygen") return;

      log(`rebuilding doxygen tab "${tab.label}"`);
      const { pages, navTab } = await loadDoxygenTab(tab.source.config, tab.slug, tab.label, config.titleSeparator);
      if (cache !== snapshot) return;

      for (const [key, page] of data.pageMap) {
        if (page.tabSlug === content.tabSlug) data.pageMap.delete(key);
      }

      for (const [slug, page] of pages) {
        const outputPath = pageOutputPath(tab.slug, slug, config.prettyUrls);
        data.pageMap.set(outputPath, {
          outputPath,
          spec: data.primarySpec,
          currentPage: { kind: "markdown", markdown: page },
          tabSlug: tab.slug,
          pageSlug: slug,
        });
      }

      const idx = data.siteTabs.findIndex((candidate) => candidate.slug === content.tabSlug);
      if (idx !== -1) data.siteTabs[idx] = navTab;
      else data.siteTabs.push(navTab);
    } else if (content.kind === "godoc") {
      const tab = config.tabs.find((candidate) => candidate.slug === content.tabSlug);
      if (!tab || tab.source.kind !== "godoc") return;

      log(`rebuilding godoc tab "${tab.label}"`);
      const { pages, navTab } = await loadGodocTab(tab.source.config, tab.slug, tab.label, {
        repo: config.repo,
        editBranch: config.editBranch,
        editBasePath: tab.source.config.sourceBasePath,
      });
      if (cache !== snapshot) return;

      for (const [key, page] of data.pageMap) {
        if (page.tabSlug === content.tabSlug) data.pageMap.delete(key);
      }

      for (const [slug, page] of pages) {
        const outputPath = pageOutputPath(tab.slug, slug, config.prettyUrls);
        data.pageMap.set(outputPath, {
          outputPath,
          spec: data.primarySpec,
          currentPage: { kind: "markdown", markdown: page },
          tabSlug: tab.slug,
          pageSlug: slug,
        });
      }

      const idx = data.siteTabs.findIndex((candidate) => candidate.slug === content.tabSlug);
      if (idx !== -1) data.siteTabs[idx] = navTab;
      else data.siteTabs.push(navTab);
    } else if (content.kind === "rustdoc") {
      const tab = config.tabs.find((candidate) => candidate.slug === content.tabSlug);
      if (!tab || tab.source.kind !== "rustdoc") return;

      log(`rebuilding rustdoc tab "${tab.label}"`);
      const { pages, navTab } = await loadRustdocTab(
        tab.source.config,
        tab.slug,
        tab.label,
        {
          repo: config.repo,
          editBranch: config.editBranch,
          editBasePath: tab.source.config.sourceBasePath,
        },
      );
      if (cache !== snapshot) return;

      for (const [key, page] of data.pageMap) {
        if (page.tabSlug === content.tabSlug) data.pageMap.delete(key);
      }

      for (const [slug, page] of pages) {
        const outputPath = pageOutputPath(tab.slug, slug, config.prettyUrls);
        data.pageMap.set(outputPath, {
          outputPath,
          spec: data.primarySpec,
          currentPage: { kind: "markdown", markdown: page },
          tabSlug: tab.slug,
          pageSlug: slug,
        });
      }

      const idx = data.siteTabs.findIndex((candidate) => candidate.slug === content.tabSlug);
      if (idx !== -1) data.siteTabs[idx] = navTab;
      else data.siteTabs.push(navTab);
    } else if (content.kind === "openapi") {
      log(`reparsing spec ${shortPath(content.specPath)}`);
      const loaded = await loadSpec(content.specPath);
      const parsed = await parseSpec(loaded);
      const openapi3 = await convertToOpenApi3(parsed);
      const spec = normalizeSpec(openapi3);
      if (cache !== snapshot) return;

      data.specsBySlug.set(content.tabSlug, spec);

      const pageKey = tabIndexOutputPath(content.tabSlug, config.prettyUrls);
      const existing = data.pageMap.get(pageKey);
      if (existing) {
        existing.currentPage = { kind: "spec", spec };
        existing.spec = spec;
      }

      const tab = config.tabs.find((candidate) => candidate.slug === content.tabSlug);
      if (tab) {
        const navTab = buildNavFromSpec(spec, tab.slug, config.prettyUrls);
        navTab.label = tab.label;
        const idx = data.siteTabs.findIndex((candidate) => candidate.slug === content.tabSlug);
        if (idx !== -1) data.siteTabs[idx] = navTab;
      }
    } else if (content.kind === "mcp") {
      log(`reparsing mcp spec ${shortPath(content.specPath)}`);
      const { parse } = await import("mcp-parser");
      const mcpSpec = await parse(content.specPath);
      const spec = normalizeMcpSpec(mcpSpec);
      if (cache !== snapshot) return;

      data.specsBySlug.set(content.tabSlug, spec);

      const pageKey = tabIndexOutputPath(content.tabSlug, config.prettyUrls);
      const existing = data.pageMap.get(pageKey);
      if (existing) {
        existing.currentPage = { kind: "spec", spec };
        existing.spec = spec;
      }

      const tab = config.tabs.find((candidate) => candidate.slug === content.tabSlug);
      if (tab) {
        const navTab = buildNavFromSpec(spec, tab.slug, config.prettyUrls);
        navTab.label = tab.label;
        const idx = data.siteTabs.findIndex((candidate) => candidate.slug === content.tabSlug);
        if (idx !== -1) data.siteTabs[idx] = navTab;
      }
    }

    resolveInternalLinks(Array.from(data.pageMap.values()), config);

    const ms = Math.round(performance.now() - start);
    log(`updated \x1b[2m(${ms}ms)\x1b[0m`);
  }

  async function reloadConfig(): Promise<ResolvedConfig> {
    const configMod = await vite.ssrLoadModule(configPath);
    return resolveConfigFromRaw(configMod.default, dirname(configPath));
  }

  async function render(url: string): Promise<string | null> {
    const { renderPage } = (await vite.ssrLoadModule(ssrRendererPath)) as {
      renderPage: typeof import("./renderer/static-renderer.js").renderPage;
    };

    const { data, siteConfig: site } = await getCached();
    const navigation = buildSiteNavigation(data.siteTabs);

    const requestPath = stripBaseUrl(new URL(url, "http://sourcey.local").pathname, config.baseUrl);
    let pagePath = requestPath.replace(/^\//, "").replace(/\/$/, "");
    if (!pagePath || pagePath === "index.html") {
      const firstKey = data.pageMap.keys().next().value;
      if (!firstKey) return null;
      pagePath = firstKey;
    }
    if (!pagePath.endsWith(".html")) {
      if (config.prettyUrls === "strip") {
        pagePath += ".html";
      } else {
        pagePath += "/index.html";
      }
    }

    let pageData = data.pageMap.get(pagePath);
    if (
      !pageData &&
      config.prettyUrls === "slash" &&
      pagePath.endsWith(".html") &&
      !pagePath.endsWith("/index.html")
    ) {
      // Fallback for stale `.html` links when prettyUrls is enabled.
      const pretty = pagePath.replace(/\.html$/, "/index.html");
      pageData = data.pageMap.get(pretty);
    }
    if (!pageData) return null;

    const activeNav = withActivePage(navigation, pageData.tabSlug, pageData.pageSlug);
    const renderOptions = createRenderOptions(pageData, site, {
      embeddable: false,
      assetBase: config.baseUrl || "/",
    });

    let html = renderPage(pageData.spec, renderOptions, activeNav, pageData.currentPage, site);

    html = html.replace(
      /<link rel="stylesheet" href="[^"]*sourcey\.css"\s*\/?>/,
      `<link rel="stylesheet" href="/@fs${tailwindCssPath}" />\n<link rel="stylesheet" href="/@fs${sourceyCssPath}?direct" />`,
    );
    html = html.replace(
      /<script src="[^"]*sourcey\.js"[^>]*><\/script>/,
      `<script type="module" src="/@fs${clientEntry}"></script>`,
    );
    html = html.replace(
      /<script src="[^"]*sourcey\.js"\s*\/?>/,
      `<script type="module" src="/@fs${clientEntry}"></script>`,
    );

    return html;
  }

  async function buildSearchIndexForDev(): Promise<string> {
    const { data } = await getCached();
    const navigation = buildSiteNavigation(data.siteTabs);
    const docsPagesByTab = collectDocsPagesByTab(data.pageMap, config.tabs);

    return buildSearchIndex(
      data.specsBySlug,
      docsPagesByTab,
      navigation,
      config.baseUrl || "/",
      config.search.featured,
    );
  }

  async function loadExtraFileForDev(outputPath: string): Promise<string | Buffer | undefined> {
    const { data } = await getCached();
    return data.extraFiles.get(outputPath);
  }

  const viteConfig: InlineConfig = {
    root: process.cwd(),
    server: {
      port,
      host,
      strictPort: true,
      hmr: true,
      fs: {
        allow: [process.cwd(), projectRoot],
      },
    },
    plugins: [
      preact(),
      tailwindcss(),
      sourceyPlugin({
        watchPaths,
        baseUrl: () => config.baseUrl,
        render,
        searchIndex: buildSearchIndexForDev,
        extraFile: loadExtraFileForDev,
      }),
    ],
    clearScreen: false,
    logLevel: "warn",
    optimizeDeps: {
      exclude: ["sourcey"],
    },
  };

  const vite = await createViteServer(viteConfig);

  vite.watcher.on("change", async (file) => {
    let content = fileToContent.get(file);

    if (!content && extname(file) === ".xml") {
      for (const [, candidate] of fileToContent) {
        if (candidate.kind === "doxygen" && file.startsWith(resolve(candidate.xmlDir))) {
          content = candidate;
          break;
        }
      }
    }

    if (!content) return;

    if (content.kind === "config") {
      log("config changed, reloading...");
      config = await reloadConfig();
      fileToContent = buildFileToContent(config);
      for (const path of fileToContent.keys()) {
        vite.watcher.add(path);
      }
      cache = null;
      cachePromise = null;
      fullRebuild().catch((err) => {
        console.error("  Site data rebuild failed:", err.message);
      });
      return;
    }

    incrementalUpdate(content).catch((err) => {
      console.error("  Incremental update failed:", err.message);
    });
  });

  await vite.listen();

  const displayHost = !host || host === "127.0.0.1" || host === "localhost" ? "localhost" : host;
  console.log(
    `\n  Sourcey dev server running at http://${displayHost}:${port}${config.baseUrl || "/"}`,
  );
  console.log(
    `  Watching: ${watchPaths.length} content file${watchPaths.length === 1 ? "" : "s"} + components + CSS (HMR)`,
  );
  console.log(`  Press Ctrl+C to stop\n`);

  fullRebuild().catch((err) => {
    console.error("  Initial site data build failed:", err.message);
  });
}
