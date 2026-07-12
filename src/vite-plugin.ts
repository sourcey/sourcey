import type { Plugin, ViteDevServer } from "vite";
import { resolve, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeBaseUrl } from "./site-url.js";
import { contentTypeForPath, outputPathFromRequestPath } from "./renderer/static-files.js";

export interface SourceyPluginOptions {
  /** Additional file paths to watch (specs, markdown) */
  watchPaths: string[];
  /** Current public base URL, used for dev routes under subpaths. */
  baseUrl?: () => string;
  /** SSR render function: given a URL path, return HTML or null */
  render: (url: string) => Promise<string | null>;
  /** Optional: generate search index JSON on demand */
  searchIndex?: () => Promise<string>;
  /** Optional: serve generated/copied files that do not go through Vite's static handler. */
  extraFile?: (outputPath: string) => Promise<string | Buffer | undefined>;
}

/**
 * Vite plugin for Sourcey.
 * - Injects SSR middleware that renders pages on the fly
 * - Watches spec and markdown files; triggers full reload on change
 */
export function sourceyPlugin(options: SourceyPluginOptions): Plugin {
  const { watchPaths, baseUrl, render, searchIndex, extraFile } = options;
  const watchSet = new Set(watchPaths.map((p) => resolve(p)));

  return {
    name: "sourcey",

    configureServer(server: ViteDevServer) {
      // Add spec/markdown files to Vite's watcher
      for (const p of watchPaths) {
        server.watcher.add(resolve(p));
      }

      // Trigger full reload when watched files or source components change
      server.watcher.on("change", async (file) => {
        const ext = extname(file);
        if (
          watchSet.has(file) ||
          ext === ".md" ||
          ext === ".yml" ||
          ext === ".yaml" ||
          ext === ".tsx" ||
          ext === ".ts"
        ) {
          // Invalidate entire SSR module graph so next render uses fresh source.
          // Shallow invalidation misses transitive importers (e.g. markdown-loader
          // changes don't propagate to static-renderer), so nuke everything.
          server.moduleGraph.invalidateAll();

          const timestamp = new Date().toLocaleTimeString();
          console.log(`  [${timestamp}] ${file} changed, reloading…`);
          server.ws.send({ type: "full-reload" });
        }
      });

      // Return a post middleware (runs after Vite internals)
      // We use pre-middleware instead by calling server.middlewares.use directly
      // This runs BEFORE Vite's static file handler
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? "/";
        const pathname = url.split("?", 1)[0] ?? "/";
        const currentBaseUrl = normalizeBaseUrl(baseUrl?.());
        const baseSearchPath = currentBaseUrl ? `${currentBaseUrl}search-index.json` : "/search-index.json";

        // Let Vite handle its own requests
        if (
          url.startsWith("/@") ||
          url.startsWith("/__vite") ||
          url.startsWith("/node_modules/") ||
          url === "/favicon.ico"
        ) {
          return next();
        }

        // Serve search index on demand
        if (searchIndex && (pathname === "/search-index.json" || pathname === baseSearchPath)) {
          try {
            const json = await searchIndex();
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-cache",
            });
            res.end(json);
            return;
          } catch {
            return next();
          }
        }

        if (extraFile) {
          try {
            const outputPath = outputPathFromRequestPath(pathname, currentBaseUrl);
            const data = outputPath ? await extraFile(outputPath) : undefined;
            if (data !== undefined) {
              res.writeHead(200, {
                "Content-Type": contentTypeForPath(outputPath),
                "Cache-Control": "no-cache",
              });
              res.end(data);
              return;
            }
          } catch {
            return next();
          }
        }

        // Only handle HTML page requests (no extension, or .html)
        const ext = extname(url);
        if (ext && ext !== ".html") {
          return next();
        }

        try {
          let html = await render(url);
          if (!html) {
            return next();
          }

          // Let Vite transform the HTML (injects HMR client script)
          html = await server.transformIndexHtml(url, html);

          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(html);
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          const err = e as Error;
          console.error(`  SSR error for ${url}:`, err.message);

          // Send error to Vite's native overlay via websocket
          server.ws.send({ type: "error", err: { message: err.message, stack: err.stack ?? "" } });

          // Return a minimal page with just the HMR client so
          // the error overlay renders and livereload can recover.
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
