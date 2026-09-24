import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createServer, type Plugin } from "vite";
import sourceyAstro, { prepareAstroSourcey } from "../src/astro/index.js";
import { defineConfig, markdown, openapi } from "../src/index.js";

const outputDir = resolve(import.meta.dirname, "../.test-output-astro");
const llmsSiteDir = resolve(import.meta.dirname, "llms-site");

const logger = {
  info() {},
  warn() {},
  error() {},
};

function dirUrl(path: string): URL {
  return pathToFileURL(path.endsWith("/") ? path : `${path}/`);
}

describe("sourcey/astro", () => {
  it("serves reader HTML as a document in Astro development", async () => {
    const root = resolve(outputDir, "reader-dev");
    let plugins: Plugin[] = [];
    const integration = sourceyAstro({
      configDir: llmsSiteDir,
      config: defineConfig({
        name: "Reader",
        theme: { name: "reader", fonts: { google: false } },
        navigation: {
          tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["introduction"] }] }],
        },
      }),
      routeBase: "/docs",
      prettyUrls: "slash",
    });
    await integration.hooks["astro:config:setup"]!({
      command: "dev",
      config: { root: dirUrl(root) },
      logger,
      addWatchFile() {},
      updateConfig(config) {
        plugins = config.vite?.plugins ?? [];
      },
    });
    const server = await createServer({
      configFile: false,
      root,
      plugins,
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "silent",
    });
    try {
      await server.listen();
      const origin = server.resolvedUrls!.local[0];
      const response = await fetch(new URL("/docs/", origin));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain('data-sourcey-theme="reader"');
      const css = await fetch(new URL("/docs/sourcey.css", origin));
      expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await css.text()).toContain(".docs-shell");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the host base in reader aliases written to a Cloudflare client directory", async () => {
    const root = resolve(outputDir, "reader-base");
    const client = resolve(root, "client/project");
    await mkdir(client, { recursive: true });
    const integration = sourceyAstro({
      configDir: llmsSiteDir,
      config: defineConfig({
        name: "Reader",
        theme: { name: "reader", fonts: { google: false } },
        navigation: {
          tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["introduction"] }] }],
        },
      }),
      routeBase: "/docs",
      prettyUrls: "slash",
      build: { generateOgImages: false },
    });
    try {
      await integration.hooks["astro:config:setup"]!({
        command: "build",
        config: { root: dirUrl(root), base: "/project", site: "https://example.org" },
        logger,
        addWatchFile() {},
        updateConfig() {},
      });
      await integration.hooks["astro:build:done"]!({ dir: dirUrl(client), logger });
      const alias = await readFile(resolve(client, "docs.html"), "utf8");
      expect(alias).toContain('href="/project/docs/sourcey.css"');
      expect(alias).toContain('src="/project/docs/sourcey.js"');
      expect(alias).toContain('content="/project/docs/search-index.json"');
      expect(alias).toContain('href="/project/docs/introduction/"');
      expect(alias).not.toContain('href="/docs/');
      const index = JSON.parse(await readFile(resolve(client, "docs/search-index.json"), "utf8"));
      expect(index[0].url).toMatch(/^\/project\/docs\//);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("links a strip-mode reader alias to its route without a trailing slash", async () => {
    const root = resolve(outputDir, "reader-strip");
    const client = resolve(root, "client");
    await mkdir(client, { recursive: true });
    await writeFile(resolve(root, "index.md"), "---\ntitle: Overview\n---\n\nThe contract.\n");
    await writeFile(resolve(root, "authorization.md"), "---\ntitle: Authorization\n---\n\nPermission.\n");
    const integration = sourceyAstro({
      configDir: root,
      config: defineConfig({
        name: "Reader",
        theme: { name: "reader", fonts: { google: false } },
        navigation: {
          tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["index", "authorization"] }] }],
        },
      }),
      routeBase: "/docs",
      prettyUrls: "strip",
      build: { generateOgImages: false },
    });
    try {
      await integration.hooks["astro:config:setup"]!({
        command: "build",
        config: { root: dirUrl(root), base: "/project", site: "https://example.org" },
        logger,
        addWatchFile() {},
        updateConfig() {},
      });
      await integration.hooks["astro:build:done"]!({ dir: dirUrl(client), logger });
      const alias = await readFile(resolve(client, "docs.html"), "utf8");
      expect(alias).toContain('href="/project/docs"');
      expect(alias).toContain('href="/project/docs/authorization"');
      expect(alias).not.toMatch(/href="\/project\/docs\/(?:#[^"]*)?"/);
      expect(alias).not.toMatch(/<option[^>]*\bvalue=/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes shared config through Astro site/base routing", async () => {
    const config = defineConfig({
      name: "Shared Docs",
      navigation: {
        tabs: [
          {
            tab: "Docs",
            slug: "",
            source: markdown({
              groups: [{ group: "Guides", pages: ["introduction"] }],
            }),
          },
          {
            tab: "API",
            slug: "api",
            source: openapi("../fixtures/petstore-openapi3.yaml"),
          },
        ],
      },
    });

    const prepared = await prepareAstroSourcey(
      {
        config,
        configDir: llmsSiteDir,
        routeBase: "/docs",
      },
      {
        root: dirUrl(resolve(import.meta.dirname, "..")),
        site: "https://sourcey.com",
        base: "/product",
      },
      dirUrl(resolve(outputDir, ".astro")),
    );

    expect(prepared.routeBase).toBe("/docs/");
    expect(prepared.outputRoute).toBe("docs/");
    expect(prepared.config.siteUrl).toBe("https://sourcey.com");
    expect(prepared.config.baseUrl).toBe("/product/docs/");
    expect(prepared.config.tabs[0]?.source.kind).toBe("markdown");
    expect(prepared.watchPaths.some((path) => path.endsWith("introduction.md"))).toBe(true);
  });

  it("builds Sourcey into Astro output under /docs", async () => {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });

    try {
      const integration = sourceyAstro({
        config: "sourcey.config.ts",
        routeBase: "/docs",
        build: { generateOgImages: false },
      });

      const watched: string[] = [];
      await integration.hooks["astro:config:setup"]?.({
        command: "build",
        config: {
          root: dirUrl(llmsSiteDir),
          site: "https://sourcey.com",
          base: "/",
        },
        logger,
        addWatchFile(path) {
          watched.push(path.toString());
        },
        createCodegenDir() {
          return dirUrl(resolve(outputDir, ".astro"));
        },
        updateConfig() {
          throw new Error("build setup should not install the dev Vite plugin");
        },
      });

      await integration.hooks["astro:build:done"]?.({
        dir: dirUrl(outputDir),
        logger,
      });

      expect(watched.some((path) => path.endsWith("sourcey.config.ts"))).toBe(true);
      expect(existsSync(resolve(outputDir, "docs.html"))).toBe(true);
      expect(existsSync(resolve(outputDir, "docs/index.html"))).toBe(true);
      expect(existsSync(resolve(outputDir, "docs/introduction.html"))).toBe(true);
      expect(existsSync(resolve(outputDir, "docs/sourcey.css"))).toBe(true);
      expect(existsSync(resolve(outputDir, "docs/sourcey.js"))).toBe(true);

      const rootAlias = await readFile(resolve(outputDir, "docs.html"), "utf-8");
      expect(rootAlias).toContain('href="/docs/sourcey.css"');
      expect(rootAlias).toContain('src="/docs/sourcey.js"');
      expect(rootAlias).toContain('content="/docs/search-index.json"');

      const introduction = await readFile(resolve(outputDir, "docs/introduction.html"), "utf-8");
      expect(introduction).toContain(
        '<link rel="canonical" href="https://sourcey.com/docs/introduction.html"',
      );

      const searchIndex = await readFile(resolve(outputDir, "docs/search-index.json"), "utf-8");
      expect(searchIndex).toContain('"url":"/docs/introduction.html"');
      expect(searchIndex).toContain('"url":"/docs/api.html');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
