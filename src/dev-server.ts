import { resolveThemeAssets } from "./themes/assets.js";
import { createServer as createViteServer, normalizePath, type ViteDevServer } from "vite";
import { resolve, dirname, relative } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { buildSourceySite, updateSourceySite, collectSourceyWatchPaths } from "./site.js";
import { artifactBytes } from "./core/source-file.js";
import { projectNavigation } from "./core/navigation.js";
import { createRenderOptions } from "./renderer/html-builder.js";
import { renderPage } from "./renderer/static-renderer.js";
import { redirectLocation } from "./core/site-model.js";
import { formatBuildDiagnostics } from "./core/build-diagnostics.js";
import { sourceyPlugin } from "./vite-plugin.js";
import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import { languageIconsDevUrl, languageIconsPlugin } from "./renderer/assets.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
function fsUrl(path: string) { return `/@fs/${normalizePath(path).replace(/^\/+/, "")}`; }
export interface DevServerOptions { port: number; host?: string; config?: string; strictChangelog?: boolean }

export async function startDevServer(options: DevServerOptions): Promise<ViteDevServer> {
  const shutdown = new AbortController();
  let snapshot = await buildSourceySite({ config: await loadConfig(options.config, undefined, "development"), strictChangelog: options.strictChangelog, generateOgImages: false, signal: shutdown.signal });
  for (const diagnostic of formatBuildDiagnostics(snapshot)) console.warn(diagnostic);
  let config = snapshot.config;
  const pending = new Set<string>();
  let running: Promise<void> | undefined;
  let failed: string[] = [];
  async function drain() {
    while (pending.size && !shutdown.signal.aborted) {
      const changed = [...new Set([...failed, ...pending])]; pending.clear();
      try {
        const next = await updateSourceySite(snapshot, changed, { signal: shutdown.signal });
        if (shutdown.signal.aborted) return;
        for (const diagnostic of formatBuildDiagnostics(next)) console.warn(diagnostic);
        failed = [];
        snapshot = next; config = next.config;
        vite.watcher.add([...collectSourceyWatchPaths(config), ...next.assembly.cache.reader.dependents.keys()].filter(file => !/^https?:/.test(file)));
        vite.ws.send({ type: "full-reload" });
      } catch (error) {
        if (shutdown.signal.aborted) return;
        failed = changed;
        const err = error as Error;
        vite.ws.send({ type: "error", err: { message: err.message, stack: err.stack ?? "" } });
        console.error(err.message);
      }
    }
  }
  function changed(file: string) {
    if (shutdown.signal.aborted) return;
    const watched = [...collectSourceyWatchPaths(config), ...snapshot.assembly.cache.reader.dependents.keys()];
    if (!watched.some(path => resolve(file) === resolve(path) || !relative(path, file).startsWith("..") && !relative(path, file).startsWith("/"))) return;
    pending.add(resolve(file));
    if (!running) running = drain().finally(() => { running = undefined; if (pending.size) changed([...pending][0]); });
  }
  async function render(url: string): Promise<{ html: string; status: number } | null> {
    const pathname = new URL(url, "http://sourcey.local").pathname;
    const route = snapshot.assembly.routes.match(pathname);
    const page = route?.page ?? snapshot.pages.find(page => page.currentPage.kind === "not-found");
    if (!page) return null;
    const {
      foundationCss: tailwindCssPath,
      sourceyCssPaths,
      clientEntry,
      themeInit,
      tryItEntry,
      searchEntry,
    } = resolveThemeAssets(config.theme.name);

    const renderOptions = createRenderOptions(page, snapshot.site);
    renderOptions.assets = {
      styles: [fsUrl(tailwindCssPath), ...sourceyCssPaths.map(path => fsUrl(path) + "?direct")],
      languageIcons: languageIconsDevUrl,
      client: fsUrl(clientEntry), clientType: "module", theme: fsUrl(themeInit),
      search: fsUrl(searchEntry), tryIt: fsUrl(tryItEntry),
    };
    const html = renderPage(page.currentPage.kind === "spec" ? page.currentPage.spec : undefined,
      renderOptions, projectNavigation(page.navigation ?? snapshot.navigation, page.tabSlug, page.pageSlug), page.currentPage, snapshot.site);
    return { html, status: page.currentPage.kind === "not-found" ? 404 : 200 };
  }
  const projectRoot = resolve(__dirname, "..");
  const hasSrc = await access(resolve(projectRoot, "src/client/index.ts")).then(() => true, () => false);
  const vite = await createViteServer({
    root: process.cwd(), clearScreen: false, logLevel: "warn",
    server: { port: options.port, host: options.host, strictPort: true, hmr: true, fs: { allow: [process.cwd(), projectRoot] } },
    plugins: [...(hasSrc ? [preact()] : []), tailwindcss(), languageIconsPlugin(), sourceyPlugin({
      dispose: () => { shutdown.abort(); pending.clear(); },
      watchPaths: collectSourceyWatchPaths(config), baseUrl: () => config.baseUrl, render,
      extraFile: async path => { const body = snapshot.extraFiles.get(path); return body === undefined ? undefined : artifactBytes(body); },
      extraFileType: async path => snapshot.mediaTypes.get(path),
      responseHeaders: async path => snapshot.responseHeaders.get(path),
      redirect: url => {
        const route = snapshot.assembly.routes.redirectFor(new URL(url, "https://sourcey.invalid").pathname);
        return route && { location: redirectLocation(route, url), status: route.status };
      },
    })], optimizeDeps: { exclude: ["sourcey"] },
  });
  vite.watcher.on("change", changed); vite.watcher.on("add", changed); vite.watcher.on("unlink", changed);
  await vite.listen();
  console.log(`Sourcey: http://${options.host || "localhost"}:${options.port}${config.baseUrl || "/"}`);
  return vite;
}
