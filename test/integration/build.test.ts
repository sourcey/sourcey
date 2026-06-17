import { describe, it, expect } from "vitest";
import { buildDocs, buildSiteDocs } from "../../src/index.js";
import { loadConfig } from "../../src/config.js";
import { resolve, dirname } from "node:path";
import { readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

/** Concatenate every rendered HTML page under a build output directory. */
async function readAllHtml(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true });
  const html = await Promise.all(
    entries
      .filter((e) => e.endsWith(".html"))
      .map((e) => readFile(resolve(dir, e), "utf-8")),
  );
  return html.join("\n");
}

describe("buildDocs (integration)", () => {
  it("builds from a Swagger 2.0 JSON spec", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/petstore.json`,
      skipWrite: true,
    });

    expect(result.spec.info.title).toBe("Swagger Petstore");
    expect(result.spec.operations.length).toBeGreaterThan(0);
    expect(Object.keys(result.spec.schemas).length).toBeGreaterThan(0);
  });

  it("builds from a Swagger 2.0 YAML spec", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/petstore-expanded.yml`,
      skipWrite: true,
    });

    expect(result.spec.operations.length).toBeGreaterThan(0);
  });

  it("builds from an OpenAPI 3.0 YAML spec", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/petstore-openapi3.yaml`,
      skipWrite: true,
    });

    expect(result.spec.info.title).toBe("Petstore");
    expect(result.spec.operations.length).toBe(5);
  });

  it("builds from an OpenAPI 3.1 YAML spec", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/cheese.yml`,
      skipWrite: true,
    });

    expect(result.spec.info.title).toBe("Cheese Store");
    expect(result.spec.operations.length).toBe(20);
    expect(result.spec.tags.length).toBe(3);
    expect(Object.keys(result.spec.schemas).length).toBe(13);
    expect(result.spec.servers.length).toBe(3);
    expect(Object.keys(result.spec.securitySchemes).length).toBe(3);
  });

  it("handles OpenAPI 3.1 nullable types", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/cheese.yml`,
      skipWrite: true,
    });

    const cheese = result.spec.schemas["Cheese"];
    expect(cheese).toBeDefined();
    const origin = cheese.properties?.["origin"];
    expect(origin).toBeDefined();
    expect(origin!.nullable).toBe(true);
  });

  it("handles OpenAPI 3.1 oneOf schemas", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/cheese.yml`,
      skipWrite: true,
    });

    const customer = result.spec.schemas["Customer"];
    const favourite = customer.properties?.["favouriteCheese"];
    expect(favourite).toBeDefined();
    expect(favourite!.oneOf).toBeDefined();
    expect(favourite!.oneOf!.length).toBe(2);
  });

  it("uses custom output directory", async () => {
    const result = await buildDocs({
      specSource: `${FIXTURES}/petstore-openapi3.yaml`,
      outputDir: "custom-output",
      skipWrite: true,
    });

    expect(result.outputDir).toBe(resolve("custom-output"));
  });

  it("rejects missing spec file", async () => {
    await expect(
      buildDocs({ specSource: "/nonexistent/spec.yml" }),
    ).rejects.toThrow();
  });

  it("renders HTML output to disk", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output");
    try {
      const result = await buildDocs({
        specSource: `${FIXTURES}/petstore-openapi3.yaml`,
        outputDir,
      });

      expect(result.pageCount).toBeGreaterThan(0);

      // Root index.html renders the first page directly (no redirect)
      const indexHtml = await readFile(resolve(outputDir, "index.html"), "utf-8");
      expect(indexHtml).toContain("<!DOCTYPE html>");
      expect(indexHtml).not.toContain("Redirecting");

      const apiHtml = await readFile(resolve(outputDir, "api.html"), "utf-8");
      expect(apiHtml).toContain("<!DOCTYPE html>");
      expect(apiHtml).toContain("Petstore");
      expect(apiHtml).toContain("API Reference");
      expect(apiHtml).toContain("sourcey.css");
      expect(apiHtml).toContain("sourcey.js");
      expect(apiHtml).toContain("data-sourcey-sidebar-scroll");

      const css = await readFile(resolve(outputDir, "sourcey.css"), "utf-8");
      expect(css).toContain("#sourcey");

      const js = await readFile(resolve(outputDir, "sourcey.js"), "utf-8");
      expect(js).toContain("data-traverse-target");
      expect(js).toContain("sourcey:sidebar-scroll:v1");

      const llms = await readFile(resolve(outputDir, "llms.txt"), "utf-8");
      expect(llms).toContain("# Petstore");
      expect(llms).toContain("List all pets");

      const llmsFull = await readFile(resolve(outputDir, "llms-full.txt"), "utf-8");
      expect(llmsFull).toContain("Petstore");
      expect(llmsFull).toContain("GET /pets");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("removes stale output files when pages disappear from a rebuild", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-prune");
    try {
      await buildDocs({
        specSource: `${FIXTURES}/petstore-openapi3.yaml`,
        outputDir,
      });

      const stalePath = resolve(outputDir, "documentation/modules/pluga.html");
      await mkdir(dirname(stalePath), { recursive: true });
      await writeFile(stalePath, "stale", "utf-8");
      expect(existsSync(stalePath)).toBe(true);

      await buildDocs({
        specSource: `${FIXTURES}/petstore-openapi3.yaml`,
        outputDir,
      });

      expect(existsSync(stalePath)).toBe(false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("renders OpenAPI 3.1 spec to HTML with all sections", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-cheese");
    try {
      await buildDocs({
        specSource: `${FIXTURES}/cheese.yml`,
        outputDir,
      });

      const html = await readFile(resolve(outputDir, "api.html"), "utf-8");
      expect(html).toContain("Cheese Store");
      expect(html).toContain("Models");
      expect(html).toContain("operation-");
      expect(html).toContain('id="sidebar"');
      expect(html).toContain('id="nav"');
      expect(html).toContain("Authentication");
      expect(html).toContain("bearer");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("generates embeddable output without html wrapper", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-embed");
    try {
      await buildDocs({
        specSource: `${FIXTURES}/petstore-openapi3.yaml`,
        outputDir,
        embeddable: true,
      });

      const html = await readFile(resolve(outputDir, "api.html"), "utf-8");
      expect(html).not.toContain("<!DOCTYPE html>");
      expect(html).not.toContain("<html");
      expect(html).toContain("Petstore");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("generates llms artifacts for mixed sites with markdown, OpenAPI, and MCP tabs", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-llms-site");
    const configDir = resolve(import.meta.dirname, "../llms-site");
    try {
      const result = await buildSiteDocs({
        configDir,
        outputDir,
      });

      expect(result.pageCount).toBeGreaterThan(0);

      const llms = await readFile(resolve(outputDir, "llms.txt"), "utf-8");
      expect(llms).toContain("# Mixed Docs");
      expect(llms).toContain("[Welcome to Mixed Docs](/introduction.html)");
      expect(llms).toContain("List all pets");
      expect(llms).toContain("nitro_get_status");

      const llmsFull = await readFile(resolve(outputDir, "llms-full.txt"), "utf-8");
      expect(llmsFull).toContain("Welcome to Mixed Docs");
      expect(llmsFull).toContain("GET /pets");
      expect(llmsFull).toContain("TOOL nitro_get_status");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("emits a stable hosted-docs contract for search, llms-full, sitemap, and canonical URLs", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-langchain-contract");
    const configDir = resolve(import.meta.dirname, "../llms-site");
    try {
      const config = await loadConfig(configDir);
      config.siteUrl = "https://docs.example.com";
      config.baseUrl = "/reference";

      await buildSiteDocs({
        config,
        outputDir,
      });

      const searchIndex = JSON.parse(await readFile(resolve(outputDir, "search-index.json"), "utf-8")) as Array<{
        title: string;
        content: string;
        url: string;
        tab: string;
        category: string;
      }>;

      expect(searchIndex.length).toBeGreaterThan(0);
      expect(searchIndex).toContainEqual(expect.objectContaining({
        title: "Welcome to Mixed Docs",
        url: "/reference/introduction.html",
        tab: "Documentation",
        category: "Pages",
      }));
      expect(searchIndex).toContainEqual(expect.objectContaining({
        title: "Why it exists",
        url: "/reference/introduction.html#why-it-exists",
        tab: "Documentation",
        category: "Sections",
      }));

      const llmsFull = await readFile(resolve(outputDir, "llms-full.txt"), "utf-8");
      expect(llmsFull).toContain("### Welcome to Mixed Docs");
      expect(llmsFull).toContain("Path: `/reference/introduction.html`");
      expect(llmsFull).toContain("### Petstore");
      expect(llmsFull).toContain("Path: `/reference/api.html`");

      const sitemap = await readFile(resolve(outputDir, "sitemap.xml"), "utf-8");
      expect(sitemap).toContain("<loc>https://docs.example.com/reference/introduction.html</loc>");
      expect(sitemap).toContain("<loc>https://docs.example.com/reference/api.html</loc>");

      const introductionHtml = await readFile(resolve(outputDir, "introduction.html"), "utf-8");
      expect(introductionHtml).toContain('rel="canonical" href="https://docs.example.com/reference/introduction.html"');
      expect(introductionHtml).toContain('property="og:url" content="https://docs.example.com/reference/introduction.html"');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("builds changelog pages with feeds, llms integration, search entries, permalinks, and OG images", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-changelog");
    const configDir = resolve(import.meta.dirname, "../changelog-site");
    try {
      const result = await buildSiteDocs({
        configDir,
        outputDir,
      });

      expect(result.pageCount).toBeGreaterThanOrEqual(4);

      const changelogHtml = await readFile(resolve(outputDir, "changelog.html"), "utf-8");
      expect(changelogHtml).toContain("sourcey-changelog-version");
      expect(changelogHtml).toContain("1.2.0");
      expect(changelogHtml).toContain('id="1-2-0"');
      expect(changelogHtml).toContain('href="introduction.html"');
      expect(changelogHtml).toContain('property="og:image" content="https://docs.example.com/reference/_og/changelog.png"');
      expect(changelogHtml).toContain('rel="canonical" href="https://docs.example.com/reference/changelog.html"');

      const permalinkHtml = await readFile(resolve(outputDir, "changelog/1-2-0.html"), "utf-8");
      expect(permalinkHtml).toContain("1.2.0");
      expect(permalinkHtml).toContain("Added root feed generation");
      expect(permalinkHtml).toContain('href="../introduction.html"');
      expect(permalinkHtml).toContain('property="og:image" content="https://docs.example.com/reference/_og/changelog/1-2-0.png"');
      expect(permalinkHtml).toContain('rel="canonical" href="https://docs.example.com/reference/changelog/1-2-0.html"');

      const introHtml = await readFile(resolve(outputDir, "introduction.html"), "utf-8");
      expect(introHtml).toContain('rel="alternate" type="application/atom+xml" href="https://docs.example.com/reference/feed.xml"');
      expect(introHtml).toContain('rel="alternate" type="application/rss+xml" href="https://docs.example.com/reference/feed.rss"');

      const atom = await readFile(resolve(outputDir, "feed.xml"), "utf-8");
      expect(atom).toContain("<feed");
      expect(atom).toContain("1.2.0");
      expect(atom).toContain('<link rel="self" href="https://docs.example.com/reference/feed.xml" />');
      expect(atom).toContain('<link href="https://docs.example.com/reference/changelog.html" />');

      const rss = await readFile(resolve(outputDir, "feed.rss"), "utf-8");
      expect(rss).toContain("<rss");
      expect(rss).toContain("1.2.0");
      expect(rss).toContain("<link>https://docs.example.com/reference/changelog.html</link>");

      const llms = await readFile(resolve(outputDir, "llms.txt"), "utf-8");
      expect(llms).toContain("## Changelog");
      expect(llms).toContain("### 1.2.0 (2026-04-20)");

      const searchIndex = await readFile(resolve(outputDir, "search-index.json"), "utf-8");
      expect(searchIndex).toContain("\"category\":\"Releases\"");
      expect(searchIndex).toContain("1.2.0");
      expect(searchIndex).toContain("/reference/changelog.html#1-2-0");

      expect(existsSync(resolve(outputDir, "_og/changelog/1-2-0.png"))).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("emits prettyUrls=slash as foo/index.html with slashed links", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-pretty-slash");
    const configDir = resolve(import.meta.dirname, "../llms-site");
    try {
      const config = await loadConfig(configDir);
      config.prettyUrls = "slash";

      await buildSiteDocs({ config, outputDir });

      expect(existsSync(resolve(outputDir, "introduction/index.html"))).toBe(true);
      expect(existsSync(resolve(outputDir, "introduction.html"))).toBe(false);

      const sitemap = await readFile(resolve(outputDir, "sitemap.xml"), "utf-8");
      expect(sitemap).toContain("<loc>/introduction/</loc>");
      expect(sitemap).not.toContain(".html</loc>");

      const llms = await readFile(resolve(outputDir, "llms.txt"), "utf-8");
      expect(llms).toContain("(/introduction/)");

      const searchIndex = await readFile(resolve(outputDir, "search-index.json"), "utf-8");
      expect(searchIndex).toContain("\"url\":\"/introduction/\"");
      expect(searchIndex).not.toContain(".html\"");

      expect(existsSync(resolve(outputDir, "_redirects"))).toBe(false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("renders provided response/request examples with a variant switcher (issue #70)", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-issue-70");
    try {
      await buildDocs({ specSource: `${FIXTURES}/issue-70.json`, outputDir });
      const html = await readAllHtml(outputDir);

      // Provided named examples render (not just the schema-generated shape).
      expect(html).toContain("Bruce");
      expect(html).toContain("Two clients");
      expect(html).toContain("No clients");

      // A provided single response example renders.
      expect(html).toContain("a-real-token");
      // A provided request body example renders.
      expect(html).toContain("s3cret");

      // The variant switcher is wired up (dropdown + switchable panels).
      expect(html).toContain("code-lang-panel");
      expect(html).toContain("data-lang-panel");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("emits prettyUrls=strip as foo.html with extensionless links", async () => {
    const outputDir = resolve(import.meta.dirname, "../../.test-output-pretty-strip");
    const configDir = resolve(import.meta.dirname, "../llms-site");
    try {
      const config = await loadConfig(configDir);
      config.prettyUrls = "strip";

      await buildSiteDocs({ config, outputDir });

      expect(existsSync(resolve(outputDir, "introduction.html"))).toBe(true);
      expect(existsSync(resolve(outputDir, "introduction/index.html"))).toBe(false);
      expect(existsSync(resolve(outputDir, "api.html"))).toBe(true);
      expect(existsSync(resolve(outputDir, "api/index.html"))).toBe(false);

      const sitemap = await readFile(resolve(outputDir, "sitemap.xml"), "utf-8");
      expect(sitemap).toContain("<loc>/introduction</loc>");

      const llms = await readFile(resolve(outputDir, "llms.txt"), "utf-8");
      expect(llms).toContain("(/introduction)");

      const searchIndex = await readFile(resolve(outputDir, "search-index.json"), "utf-8");
      expect(searchIndex).toContain("\"url\":\"/introduction\"");
      expect(searchIndex).toContain("\"url\":\"/api#");
      expect(searchIndex).not.toContain(".html\"");

      expect(existsSync(resolve(outputDir, "_redirects"))).toBe(false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
