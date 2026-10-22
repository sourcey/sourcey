import type { AstroIntegration, AstroConfig } from "astro";
import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, stat } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { PrettyUrls, SourceyConfig, ResolvedConfig } from "../config.js";
import { applySiteHostConfig, loadConfig, resolveConfigFromRaw } from "../config.js";
import { buildSourceySite, collectSourceyWatchPaths, sourceyArtifacts, updateSourceySite, type SourceySiteArtifacts } from "../site.js";
import { contentTypeForPath, outputPathCandidatesForRequest, requestPathMatchesBase } from "../renderer/static-files.js";
import { normalizeBaseUrl, toPublicPath } from "../site-url.js";
import { redirectLocation } from "../core/site-model.js";
import { formatBuildDiagnostics } from "../core/build-diagnostics.js";
import { formatSiteDiagnostics } from "../core/site-diagnostics.js";
export interface SourceyAstroOptions {
  /**
   * A path to `sourcey.config.ts`, a directory containing it, or an already
   * imported Sourcey config object. Defaults to `sourcey.config.ts` in the
   * Astro project root.
   */
  config?: string | SourceyConfig | ResolvedConfig;
  /**
   * Directory used to resolve relative paths when `config` is an object.
   * Defaults to the Astro project root.
   */
  configDir?: string;
  /**
   * URL mount point within the Astro site. Defaults to the Sourcey config
   * `baseUrl` when present, otherwise `/docs`.
   */
  routeBase?: string;
  /** Override the public Sourcey `baseUrl`. Defaults to Astro `base` + `routeBase`. */
  baseUrl?: string;
  /** Override the public Sourcey `siteUrl`. Defaults to Astro `site`. */
  siteUrl?: string | false;
  /** Override Sourcey pretty URL behavior for the Astro-mounted output. */
  prettyUrls?: PrettyUrls;
  /** Treat changelog warnings as build errors. */
  strictChangelog?: boolean;
  /** Enable or configure Astro dev-server integration. */
  dev?: boolean | { enabled?: boolean; generateOgImages?: boolean };
  /** Enable or configure Astro build integration. */
  build?: boolean | { enabled?: boolean; generateOgImages?: boolean };
  /**
   * Allow enumerated Sourcey routes at the host root. Host files remain host-owned.
   */
  allowRootOutput?: boolean;
  /**
   * Serve a copy of the first page at the mount root, so `routeBase` itself
   * opens the docs. On by default. Turn it off when an Astro page owns the
   * root, such as a product page at `/docs` above the documentation.
   */
  landingPage?: boolean;
}


type HostConfig = Pick<AstroConfig, "root"> & Partial<Pick<AstroConfig, "base" | "site">> & { build?: Pick<AstroConfig["build"], "format"> };
export interface PreparedAstroSourcey {
  config: ResolvedConfig;
  configPath?: string;
  routeBase: string;
  outputRoute: string;
  devOutputDir: string;
  watchPaths: string[];
}
export async function prepareAstroSourcey(options: SourceyAstroOptions, host: HostConfig, codegen = new URL(".sourcey/", host.root)): Promise<PreparedAstroSourcey> {
  const root = fileURLToPath(host.root);
  const configPath = typeof options.config === "string" ? resolve(root, options.config.endsWith(".ts") ? options.config : `${options.config}/sourcey.config.ts`) : !options.config ? resolve(root, "sourcey.config.ts") : undefined;
  const raw = options.config;
  const hostPretty = host.build?.format === "directory" ? "slash" as const : host.build ? "strip" as const : undefined;
  if (options.prettyUrls && hostPretty && options.prettyUrls !== hostPretty) throw new Error(`Sourcey prettyUrls=${options.prettyUrls} conflicts with Astro build.format=${host.build?.format}`);
  const policy = {
    siteUrl: options.siteUrl ?? host.site,
    prettyUrls: options.prettyUrls ?? hostPretty,
  };
  const config = configPath ? await loadConfig(configPath, policy) : raw && typeof raw === "object" && "contexts" in raw ? raw : await resolveConfigFromRaw(raw as SourceyConfig, resolve(root, options.configDir ?? "."), policy);
  const routeBase = normalizeBaseUrl(options.routeBase ?? (config.baseUrl || "/docs")) || "/";
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? [host.base ?? "", routeBase].map(p => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/"));
  const merged = applySiteHostConfig(config, { ...policy, baseUrl, landingPage: options.landingPage, statusPageFormat: routeBase !== "/" && host.build?.format === "directory" ? "directory" : "file" });
  const identity = createHash("sha256").update(JSON.stringify([configPath ?? root, baseUrl, config.contexts.map(c => c.key)])).digest("hex").slice(0, 16);
  return { config: merged, configPath, routeBase, outputRoute: routeBase.replace(/^\/+|\/+$/g, ""),
    devOutputDir: fileURLToPath(new URL(`${identity}/`, codegen)), watchPaths: collectSourceyWatchPaths(merged, configPath) };
}
function enabled(value: SourceyAstroOptions["build"]): boolean { return value !== false && (typeof value !== "object" || value.enabled !== false); }

export default function sourceyAstro(options: SourceyAstroOptions = {}): AstroIntegration {
  let prepared: PreparedAstroSourcey;
  let snapshot: SourceySiteArtifacts;
  let files = new Map<string, string | Buffer>();
  let hostBase = "";
  const routes = new Map<string, { file: string; type: string; hash: string }>();
  // Everything but HTML needs no rendering, so it skips the host bundle (whose
  // module graph would carry every image as a string) and joins the output as is.
  const written = new Map<string, { file: string; body: string | Buffer }>();
  return { name: "sourcey", hooks: {
    async "astro:config:setup"({ command, config, createCodegenDir, addWatchFile, injectRoute, updateConfig }) {
      prepared = await prepareAstroSourcey(options, config, createCodegenDir());
      if (prepared.routeBase === "/" && !options.allowRootOutput) throw new Error("Sourcey root routes require allowRootOutput: true");
      for (const path of prepared.watchPaths) addWatchFile(path);
      if (command === "dev") {
        if (enabled(options.dev)) updateConfig({ vite: { plugins: [devPlugin()] } });
        return;
      }
      if (!enabled(options.build) || command !== "build") return;
      snapshot = await compile();
      // A build publishes, so it says what publishing needs; dev stays quiet about it.
      for (const diagnostic of formatSiteDiagnostics(snapshot.siteDiagnostics)) console.warn(diagnostic);
      files = await sourceyArtifacts(snapshot, { landingPage: options.landingPage });
      hostBase = normalizeBaseUrl(config.base);
      const dir = prepared.devOutputDir;
      await mkdir(dir, { recursive: true });
      const manifest: string[] = [];
      const payloads = new Set<string>();
      await mkdir(resolve(dir, "artifacts"), { recursive: true });
      for (const [path, body] of files) {
        // The host root sitemap remains host-owned.
        const published = path === "sitemap.xml" && prepared.routeBase === "/" ? "sourcey-sitemap.xml" : path;
        const compiledRoute = snapshot.assembly.routes.byOutputPath.get(path);
        const publicPath = compiledRoute?.publicPath ?? toPublicPath(published, prepared.config.baseUrl, prepared.config.prettyUrls);
        const pattern = hostBase ? "/" + publicPath.slice(hostBase.length).replace(/^\/+/, "") : publicPath;
        const type = snapshot.mediaTypes.get(path) ?? contentTypeForPath(path);
        const htmlPage = type.startsWith("text/html") && !pattern.endsWith(".html");
        const flatPage = config.build.format !== "directory";
        const stem = pattern.replace(/^\/+|\/+$/g, "");
        const emitted = !htmlPage ? pattern.replace(/^\/+/, "") : flatPage || pattern === "/404" || pattern === "/500" ? `${stem || "index"}.html` : `${stem ? stem + "/" : ""}index.html`;
        const renderPath = htmlPage && flatPage ? `${hostBase || "/"}${emitted}` : publicPath;
        const publicFile = resolve(fileURLToPath(config.publicDir), pattern.replace(/^\/+/, ""));
        const publicArtifact = resolve(fileURLToPath(config.publicDir), emitted);
        if (await access(publicArtifact).then(() => true, () => false) || await stat(publicFile).then(info => info.isFile(), () => false)) throw new Error(`Sourcey output conflicts with host public asset: ${publicPath}`);
        // A page search engines are not to index, such as the missing-page page, is written as a
        // file rather than registered as a page the host's sitemap would list.
        if (!type.startsWith("text/html") || compiledRoute?.index === false) {
          written.set(pattern.replace(/\/$/, "") || "/", { file: emitted, body });
          continue;
        }
        const hash = createHash("sha256").update(body).digest("hex");
        // Prerenderers may run outside Node. Import the prepared page through
        // the host bundle rather than reading the build machine's filesystem,
        // gzipped: a tenth of the text for the bundler to hold.
        if (!payloads.has(hash)) {
          await writeFile(resolve(dir, "artifacts", `${hash}.js`), `export default ${JSON.stringify(gzipSync(body).toString("base64"))};\n`);
          payloads.add(hash);
        }
        manifest.push(`${JSON.stringify(renderPath)}:{load:()=>import('./artifacts/${hash}.js'),type:${JSON.stringify(type)},status:${compiledRoute?.status ?? 200}}`);
        routes.set(pattern.replace(/\/$/, "") || "/", { file: emitted, type, hash });
      }
      const bridge = resolve(dir, "bridge.js");
      await writeFile(bridge, `const files={${manifest.join(",")}};\nexport async function response(url){const path=decodeURI(url.pathname);const item=files[path]??files[path.replace(/\\/$/,'')]??files[path+'/'];if(!item)throw new Error('Unknown Sourcey artifact '+path);const packed=Uint8Array.from(atob((await item.load()).default),char=>char.charCodeAt(0));return new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),{status:item.status,headers:{'Content-Type':item.type}})}\n`);
      const pageEntry = resolve(dir, "page.astro"), endpointEntry = resolve(dir, "endpoint.js");
      await writeFile(pageEntry, `---\nimport {response} from './bridge.js';\nreturn await response(Astro.url);\n---\n`);
      await writeFile(endpointEntry, `import {response} from './bridge.js';\nexport const prerender=true;\nexport const GET=({url})=>response(url);\n`);
      for (const [pattern, route] of routes) injectRoute({ pattern, entrypoint: route.type.startsWith("text/html") && !pattern.endsWith(".html") ? pageEntry : endpointEntry, prerender: true });
      const redirects: Record<string, { destination: string; status: 301 | 302 | 303 | 307 | 308 }> = {};
      for (const [from, redirect] of snapshot.assembly.routes.redirects) {
        if (!requestPathMatchesBase(from, hostBase)) throw new Error(`Sourcey redirect is outside Astro base: ${from}`);
        const path = hostBase ? "/" + from.slice(hostBase.length).replace(/^\/+/, "") : from;
        if (config.redirects[path]) throw new Error(`Sourcey redirect conflicts with host: ${from}`);
        redirects[path] = { destination: redirect.to, status: redirect.status };
      }
      updateConfig({ redirects });
    },
    "astro:routes:resolved"({ routes: hostRoutes }) {
      const counts = new Map<string, number>();
      for (const route of hostRoutes) {
        if (!route.pathname) continue;
        const path = route.pathname.replace(/\/$/, "") || "/";
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
      for (const path of routes.keys()) {
        if ((counts.get(path) ?? 0) > 1) throw new Error(`Sourcey route conflicts with host: ${path}`);
      }
      for (const path of written.keys()) {
        if (counts.has(path)) throw new Error(`Sourcey route conflicts with host: ${path}`);
      }
      for (const redirect of snapshot?.assembly.routes.redirects.values() ?? []) {
        const from = hostBase ? "/" + redirect.publicPath.slice(hostBase.length).replace(/^\/+/, "") : redirect.publicPath;
        if ((counts.get(from.replace(/\/$/, "") || "/") ?? 0) > 1) throw new Error(`Sourcey redirect conflicts with host: ${redirect.publicPath}`);
        if (!redirect.to.startsWith("/")) continue;
        const path = new URL(redirect.to, "https://sourcey.invalid").pathname.replace(/\/$/, "") || "/";
        const hostPath = hostBase ? "/" + path.slice(hostBase.length).replace(/^\/+/, "") : path;
        if (!counts.has(hostPath)) throw new Error(`Sourcey redirect target does not exist in Astro: ${redirect.to}`);
      }
    },
    async "astro:build:generated"({ dir }) {
      // After Astro writes its pages and before adapters package the output.
      for (const [path, { file, body }] of written) {
        const target = resolve(fileURLToPath(dir), file);
        if (await access(target).then(() => true, () => false)) throw new Error(`Sourcey output conflicts with host output: ${path}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
      }
    },
    async "astro:build:done"({ dir }) {
      // Readback only. No rendering, copying, or repair after Astro packaging.
      for (const [pattern, route] of routes) {
        const file = resolve(fileURLToPath(dir), route.file);
        const data = await readFile(file).catch(error => { throw new Error(`Astro did not emit Sourcey route ${pattern} at ${file}`, { cause: error }); });
        if (createHash("sha256").update(data).digest("hex") !== route.hash) throw new Error(`Astro changed Sourcey artifact: ${pattern}`);
      }
    },
  } };
  async function compile(signal?: AbortSignal) {
    const result = await buildSourceySite({ config: prepared.config, strictChangelog: options.strictChangelog, generateOgImages: false, signal });
    for (const diagnostic of formatBuildDiagnostics(result)) console.warn(diagnostic);
    return result;
  }
  function devPlugin(): Plugin {
    let ready: Promise<void> | undefined;
    const pending = new Set<string>();
    const shutdown = new AbortController();
    let failed: string[] = [];
    return { name: "sourcey-documents", closeBundle() { shutdown.abort(); pending.clear(); }, async configureServer(server) {
      snapshot = await compile(shutdown.signal); files = await sourceyArtifacts(snapshot, { landingPage: options.landingPage });
      server.watcher.add([...prepared.watchPaths, ...snapshot.assembly.cache.reader.dependents.keys()].filter(p => !/^https?:/.test(p)));
      async function drain() {
        while (pending.size && !shutdown.signal.aborted) {
          const changes = [...new Set([...failed, ...pending])]; pending.clear();
          try {
            const next = await updateSourceySite(snapshot, changes, { signal: shutdown.signal });
            const nextFiles = await sourceyArtifacts(next, { landingPage: options.landingPage });
            if (shutdown.signal.aborted) return;
            for (const diagnostic of formatBuildDiagnostics(next)) console.warn(diagnostic);
            failed = [];
            snapshot = next; files = nextFiles;
            prepared.watchPaths = collectSourceyWatchPaths(next.config, prepared.configPath);
            server.watcher.add([...prepared.watchPaths, ...next.assembly.cache.reader.dependents.keys()].filter(path => !/^https?:/.test(path)));
            server.ws.send({ type: "full-reload" });
          } catch (error) { if (shutdown.signal.aborted) return; failed = changes; server.ws.send({ type: "error", err: { message: (error as Error).message, stack: (error as Error).stack ?? "" } }); }
        }
      }
      const change = (file: string) => {
        if (shutdown.signal.aborted) return;
        const watched = [...prepared.watchPaths, ...snapshot.assembly.cache.reader.dependents.keys()];
        if (!watched.some(path => file === path || relative(path, file) && !relative(path, file).startsWith(".."))) return;
        pending.add(resolve(file));
        if (!ready) ready = drain().finally(() => { ready = undefined; if (pending.size) change([...pending][0]); });
      };
      server.watcher.on("change", change); server.watcher.on("add", change); server.watcher.on("unlink", change);
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://sourcey.local").pathname;
        const redirect = snapshot.assembly.routes.redirectFor(pathname);
        if (redirect) { res.writeHead(redirect.status, { Location: redirectLocation(redirect, req.url ?? "/") }); res.end(); return; }
        if (!requestPathMatchesBase(pathname, snapshot.config.baseUrl)) return next();
        const path = outputPathCandidatesForRequest(pathname, snapshot.config.baseUrl, snapshot.config.prettyUrls).find(p => files.has(p));
        if (!path) return next();
        const type = snapshot.mediaTypes.get(path) ?? contentTypeForPath(path);
        let body = files.get(path)!;
        if (type.startsWith("text/html")) body = await server.transformIndexHtml(pathname, body.toString());
        res.writeHead(snapshot.assembly.routes.match(pathname)?.status ?? 200, { "Content-Type": type, "Cache-Control": "no-cache", ...snapshot.responseHeaders.get(pathname) });
        res.end(body);
      });
    } };
  }
}
