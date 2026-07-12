import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
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

      const introduction = await readFile(
        resolve(outputDir, "docs/introduction.html"),
        "utf-8",
      );
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
