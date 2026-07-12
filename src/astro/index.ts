import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import type { PrettyUrls, ResolvedConfig, SourceyConfig } from "../config.js";
import { loadConfig, resolveConfigFromRaw } from "../config.js";
import {
  contentTypeForPath,
  outputPathCandidatesForRequest,
  requestPathMatchesBase,
} from "../renderer/static-files.js";
import { buildSourceySite, collectSourceyWatchPaths, writeSourceySite } from "../site.js";
import { normalizeBaseUrl, normalizeSiteUrl } from "../site-url.js";

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
   * Allow writing Sourcey at Astro's output root. Off by default because the
   * standalone renderer prunes its output directory before writing.
   */
  allowRootOutput?: boolean;
}

interface AstroIntegration {
  name: string;
  hooks: {
    "astro:config:setup"?: (options: AstroConfigSetupOptions) => void | Promise<void>;
    "astro:build:done"?: (options: AstroBuildDoneOptions) => void | Promise<void>;
  };
}

interface AstroConfigSetupOptions {
  command: "dev" | "build" | "preview" | "sync" | string;
  config: AstroResolvedConfig;
  logger: AstroLogger;
  addWatchFile: (path: URL | string) => void;
  createCodegenDir?: () => URL;
  updateConfig: (config: { vite?: { plugins?: Plugin[] } }) => void;
}

interface AstroBuildDoneOptions {
  dir: URL;
  logger: AstroLogger;
}

interface AstroResolvedConfig {
  root: URL;
  site?: string;
  base?: string;
}

interface AstroLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
}

interface PreparedAstroSourcey {
  config: ResolvedConfig;
  configPath?: string;
  routeBase: string;
  outputRoute: string;
  devOutputDir: string;
  watchPaths: string[];
}

export default function sourceyAstro(options: SourceyAstroOptions = {}): AstroIntegration {
  let prepared: Promise<PreparedAstroSourcey> | null = null;

  const prepareOnce = (astroConfig: AstroResolvedConfig, codegenDir?: URL) => {
    prepared ??= prepareAstroSourcey(options, astroConfig, codegenDir);
    return prepared;
  };

  return {
    name: "sourcey",
    hooks: {
      async "astro:config:setup"({
        command,
        config,
        logger,
        addWatchFile,
        createCodegenDir,
        updateConfig,
      }) {
        const codegenDir = createCodegenDir?.() ?? new URL("./.sourcey/", config.root);
        const preparedSourcey = await prepareOnce(config, codegenDir);

        for (const path of preparedSourcey.watchPaths) {
          addWatchFile(path);
        }

        if (command === "dev" && phaseEnabled(options.dev, true)) {
          updateConfig({
            vite: {
              plugins: [
                sourceyAstroDevPlugin({
                  prepared: preparedSourcey,
                  logger,
                  strictChangelog: options.strictChangelog,
                  generateOgImages: phaseGenerateOgImages(options.dev, false),
                }),
              ],
            },
          });
        }
      },

      async "astro:build:done"({ dir, logger }) {
        if (!phaseEnabled(options.build, true)) return;

        const fallbackConfig: AstroResolvedConfig = {
          root: new URL("./", dir),
        };
        const preparedSourcey = await (prepared ?? prepareOnce(fallbackConfig));
        if (preparedSourcey.outputRoute === "" && !options.allowRootOutput) {
          throw new Error(
            `sourcey/astro routeBase "/" would prune Astro's full output directory. ` +
              `Use routeBase: "/docs" or set allowRootOutput: true intentionally.`,
          );
        }

        const outputDir = fileURLToPath(new URL(`./${preparedSourcey.outputRoute}`, dir));
        logger.info(`Sourcey: building docs at ${displayRoute(preparedSourcey.routeBase)}`);
        const sourceySite = await buildSourceySite({
          config: preparedSourcey.config,
          outputDir,
          strictChangelog: options.strictChangelog,
          generateOgImages: phaseGenerateOgImages(options.build, true),
        });
        await writeSourceySite(sourceySite);
        await writeAstroRouteAlias({
          outputRoot: fileURLToPath(dir),
          outputDir,
          routeBase: preparedSourcey.routeBase,
        });
        logger.info(
          `Sourcey: wrote ${sourceySite.pageCount} page${sourceySite.pageCount === 1 ? "" : "s"}`,
        );
      },
    },
  };
}

export async function prepareAstroSourcey(
  options: SourceyAstroOptions,
  astroConfig: AstroResolvedConfig,
  codegenDir = new URL("./.sourcey/", astroConfig.root),
): Promise<PreparedAstroSourcey> {
  const rootDir = fileURLToPath(astroConfig.root);
  const { config, configPath } = await loadSourceyConfigForAstro(options, rootDir);
  const routeBase = normalizeRouteBase(options.routeBase ?? (config.baseUrl || "/docs"));
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? joinBasePaths(astroConfig.base, routeBase),
  );
  const siteUrl =
    options.siteUrl === false
      ? undefined
      : normalizeSiteUrl(options.siteUrl ?? astroConfig.site ?? config.siteUrl);

  const mergedConfig: ResolvedConfig = {
    ...config,
    baseUrl,
    siteUrl,
    prettyUrls: options.prettyUrls ?? config.prettyUrls,
  };

  const outputRoute = routeBase === "/" ? "" : `${routeBase.replace(/^\/+|\/+$/g, "")}/`;
  const devOutputDir = fileURLToPath(new URL("./sourcey-output/", codegenDir));
  const watchPaths = collectSourceyWatchPaths(mergedConfig, configPath);

  return {
    config: mergedConfig,
    configPath,
    routeBase,
    outputRoute,
    devOutputDir,
    watchPaths,
  };
}

async function loadSourceyConfigForAstro(
  options: SourceyAstroOptions,
  rootDir: string,
): Promise<{ config: ResolvedConfig; configPath?: string }> {
  if (typeof options.config === "string") {
    const configPath = resolveConfigPath(rootDir, options.config);
    return { config: await loadConfig(configPath), configPath };
  }

  if (!options.config) {
    const configPath = resolve(rootDir, "sourcey.config.ts");
    return { config: await loadConfig(configPath), configPath };
  }

  if (isResolvedConfig(options.config)) {
    return { config: options.config };
  }

  const configDir = resolve(rootDir, options.configDir ?? ".");
  return { config: await resolveConfigFromRaw(options.config, configDir) };
}

function sourceyAstroDevPlugin(options: {
  prepared: PreparedAstroSourcey;
  logger: AstroLogger;
  strictChangelog?: boolean;
  generateOgImages: boolean;
}): Plugin {
  const { prepared, logger } = options;
  let buildPromise: Promise<void> | null = null;
  let built = false;

  async function rebuild(): Promise<void> {
    buildPromise ??= (async () => {
      const sourceySite = await buildSourceySite({
        config: prepared.config,
        outputDir: prepared.devOutputDir,
        strictChangelog: options.strictChangelog,
        generateOgImages: options.generateOgImages,
      });
      await writeSourceySite(sourceySite);
      built = true;
      logger.info(
        `Sourcey: ready at ${displayRoute(prepared.routeBase)} (${sourceySite.pageCount} pages)`,
      );
    })().finally(() => {
      buildPromise = null;
    });

    return buildPromise;
  }

  async function ensureBuilt(): Promise<void> {
    if (built) return;
    await rebuild();
  }

  return {
    name: "sourcey:astro-dev",
    configureServer(server: ViteDevServer) {
      for (const path of prepared.watchPaths) {
        server.watcher.add(path);
      }

      server.watcher.on("change", (file) => {
        if (!shouldRebuildForChange(file, prepared.watchPaths)) return;
        built = false;
        rebuild()
          .then(() => {
            server.ws.send({ type: "full-reload" });
          })
          .catch((error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            server.ssrFixStacktrace(err);
            logger.error(`Sourcey: ${err.message}`);
            server.ws.send({ type: "error", err: { message: err.message, stack: err.stack ?? "" } });
          });
      });

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "/";
        const pathname = url.split("?", 1)[0] ?? "/";

        if (
          url.startsWith("/@") ||
          url.startsWith("/__vite") ||
          url.startsWith("/node_modules/")
        ) {
          return next();
        }

        if (!requestPathMatchesBase(pathname, prepared.config.baseUrl)) {
          return next();
        }

        try {
          await ensureBuilt();
          const file = await readGeneratedFile(
            prepared.devOutputDir,
            pathname,
            prepared.config.baseUrl,
            prepared.config.prettyUrls,
          );
          if (!file) return next();

          res.writeHead(200, {
            "Content-Type": contentTypeForPath(file.outputPath),
            "Cache-Control": "no-cache",
          });
          res.end(file.data);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          server.ssrFixStacktrace(err);
          logger.error(`Sourcey: ${err.message}`);
          server.ws.send({ type: "error", err: { message: err.message, stack: err.stack ?? "" } });
          res.writeHead(500, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(`<!DOCTYPE html><html><head><script type="module" src="/@vite/client"></script></head><body></body></html>`);
        }
      });
    },
  };
}

async function readGeneratedFile(
  outputDir: string,
  pathname: string,
  baseUrl: string,
  prettyUrls: PrettyUrls,
): Promise<{ outputPath: string; data: string | Buffer } | null> {
  for (const outputPath of outputPathCandidatesForRequest(pathname, baseUrl, prettyUrls)) {
    const path = resolve(outputDir, outputPath);
    if (!(await exists(path))) continue;
    const data = await readFile(path);
    return {
      outputPath,
      data: shouldReadAsText(outputPath) ? data.toString("utf-8") : data,
    };
  }

  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveConfigPath(rootDir: string, config: string): string {
  const candidate = resolve(rootDir, config);
  return candidate.endsWith(".ts") ? candidate : resolve(candidate, "sourcey.config.ts");
}

function normalizeRouteBase(value: string): string {
  const normalized = normalizeBaseUrl(value);
  return normalized || "/";
}

function joinBasePaths(...paths: Array<string | undefined>): string {
  const joined = paths
    .map((path) => path?.trim())
    .filter((path): path is string => Boolean(path))
    .flatMap((path) => path.split("/"))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");

  return joined ? `/${joined}/` : "";
}

function displayRoute(routeBase: string): string {
  return routeBase === "/" ? "/" : routeBase.slice(0, -1);
}

async function writeAstroRouteAlias(options: {
  outputRoot: string;
  outputDir: string;
  routeBase: string;
}): Promise<void> {
  if (options.routeBase === "/") return;

  const route = options.routeBase.replace(/^\/+|\/+$/g, "");
  if (!route) return;

  const indexPath = resolve(options.outputDir, "index.html");
  if (!(await exists(indexPath))) return;

  const aliasPath = resolve(options.outputRoot, `${route}.html`);
  const html = await readFile(indexPath, "utf-8");
  await mkdir(dirname(aliasPath), { recursive: true });
  await writeFile(aliasPath, renderAstroRouteAlias(html, options.routeBase));
}

function renderAstroRouteAlias(html: string, routeBase: string): string {
  const basePath = routeBase.endsWith("/") ? routeBase : `${routeBase}/`;
  return html
    .replace(/\b(href|src)="([^"]+)"/g, (match, attr: string, value: string) => {
      if (!shouldPrefixAliasUrl(value)) return match;
      return `${attr}="${basePath}${value.replace(/^\.\//, "")}"`;
    })
    .replace(
      /(<meta\s+name="sourcey-search"\s+content=")([^"]+)(")/g,
      (match, prefix: string, value: string, suffix: string) => {
        if (!shouldPrefixAliasUrl(value)) return match;
        return `${prefix}${basePath}${value.replace(/^\.\//, "")}${suffix}`;
      },
    );
}

function shouldPrefixAliasUrl(value: string): boolean {
  return !/^(?:#|\/|[a-z][a-z0-9+.-]*:)/i.test(value);
}

function isResolvedConfig(config: SourceyConfig | ResolvedConfig): config is ResolvedConfig {
  return Array.isArray((config as ResolvedConfig).tabs);
}

function phaseEnabled(
  phase: boolean | { enabled?: boolean } | undefined,
  defaultEnabled: boolean,
): boolean {
  if (typeof phase === "boolean") return phase;
  return phase?.enabled ?? defaultEnabled;
}

function phaseGenerateOgImages(
  phase: boolean | { generateOgImages?: boolean } | undefined,
  defaultEnabled: boolean,
): boolean {
  return typeof phase === "object" ? phase.generateOgImages ?? defaultEnabled : defaultEnabled;
}

function shouldRebuildForChange(file: string, watchPaths: string[]): boolean {
  if (watchPaths.includes(file)) return true;
  const ext = extname(file);
  return ext === ".md" || ext === ".mdx" || ext === ".json" || ext === ".yml" || ext === ".yaml";
}

function shouldReadAsText(outputPath: string): boolean {
  switch (extname(outputPath).toLowerCase()) {
    case ".html":
    case ".css":
    case ".js":
    case ".mjs":
    case ".json":
    case ".svg":
    case ".txt":
    case ".xml":
      return true;
    default:
      return false;
  }
}
