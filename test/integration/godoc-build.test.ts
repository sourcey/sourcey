import { describe, it, expect, afterAll } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSiteDocs } from "../../src/index.js";

const FIXTURE_MODULE = resolve(import.meta.dirname, "../fixtures/godoc/basic");
const OUTPUT_DIR = resolve(import.meta.dirname, "../../.test-output-godoc-build");

const goAvailable = (() => {
  try {
    const result = spawnSync("go", ["version"], { stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
})();

const skipWithoutGo = goAvailable ? describe : describe.skip;

// keep output for inspection during dev; cleanup in CI is fine, but for
// debugging we leave it on disk if KEEP_GODOC_BUILD=1 is set.
afterAll(async () => {
  if (!process.env.KEEP_GODOC_BUILD) {
    await rm(OUTPUT_DIR, { recursive: true, force: true });
  }
});

skipWithoutGo("buildSiteDocs (integration) – godoc tab", () => {
  it("emits package pages, search entries, llms entries, and sitemap urls", async () => {
    const config = await resolveConfigFromRaw(
      {
        name: "Go Docs",
        siteUrl: "https://docs.example.com",
        repo: "https://github.com/sourcey/example",
        editBranch: "main",
        editBasePath: "docs",
        navigation: {
          tabs: [
            {
              tab: "Go API",
              godoc: {
                module: FIXTURE_MODULE,
                packages: ["./..."],
                mode: "live",
                includeTests: true,
                sourceBasePath: "go/basic",
              },
            },
          ],
        },
      },
      FIXTURE_MODULE,
    );

    const result = await buildSiteDocs({
      config,
      outputDir: OUTPUT_DIR,
    });

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.godocDiagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // Package page exists
    const packagePage = await readFile(resolve(OUTPUT_DIR, "go-api/package-root.html"), "utf-8");
    expect(packagePage).toContain("example.com/basic");
    expect(packagePage).toContain("Widget");
    expect(packagePage).toContain('id="func-New"');
    expect(packagePage.match(/<h1/g)?.length ?? 0).toBe(1);
    expect(packagePage).toContain(
      "https://github.com/sourcey/example/edit/main/go/basic/widget.go",
    );
    expect(packagePage).toContain(
      "https://github.com/sourcey/example/blob/main/go/basic/widget.go#L",
    );
    expect(packagePage).not.toContain(
      "https://github.com/sourcey/example/edit/main/docs/widget.go",
    );
    expect(packagePage).not.toContain(
      "https://github.com/sourcey/example/blob/main/docs/widget.go#L",
    );

    // Index page lists the package
    const indexPage = await readFile(resolve(OUTPUT_DIR, "go-api.html"), "utf-8");
    expect(indexPage).toContain("example.com/basic");

    // Sitemap contains both pages.
    const sitemap = await readFile(resolve(OUTPUT_DIR, "sitemap.xml"), "utf-8");
    expect(sitemap).toContain("go-api/package-root.html");
    expect(sitemap).toContain("go-api.html");

    // llms.txt links the package page
    const llms = await readFile(resolve(OUTPUT_DIR, "llms.txt"), "utf-8");
    expect(llms).toContain("# Go Docs");
    expect(llms).toContain("go-api/package-root.md");
    const packageMarkdown = await readFile(resolve(OUTPUT_DIR, "go-api/package-root.md"), "utf-8");
    expect(packageMarkdown).toContain("```go");
    expect(packageMarkdown).toContain("func New(name string) *Widget");

    // llms-full.txt has the package content
    const llmsFull = await readFile(resolve(OUTPUT_DIR, "llms-full.txt"), "utf-8");
    expect(llmsFull).toContain("example.com/basic");
    expect(llmsFull).toContain("Widget");

    // Search index includes the package symbols
    const searchIndex = JSON.parse(
      await readFile(resolve(OUTPUT_DIR, "search-index.json"), "utf-8"),
    ) as Array<{ title: string; content: string; category: string }>;
    const titles = searchIndex.map((entry) => entry.title);
    expect(titles.some((t) => t.includes("example.com/basic"))).toBe(true);
    expect(titles).toContain("func New(name string) *Widget");
    expect(titles).toContain("type Widget");
    expect(titles).toContain("Widget.Publish");
    expect(titles).toContain("Example New");
    expect(
      searchIndex.some(
        (entry) =>
          entry.category === "go function" && entry.content.includes("New constructs a Widget"),
      ),
    ).toBe(true);
    expect(
      searchIndex.some((entry) => entry.category === "go type" && entry.title === "type Widget"),
    ).toBe(true);
    expect(
      searchIndex.some(
        (entry) => entry.category === "go method" && entry.title === "Widget.Publish",
      ),
    ).toBe(true);
    expect(
      searchIndex.some((entry) => entry.category === "go example" && entry.title === "Example New"),
    ).toBe(true);
  });

  it("emits prettyUrls=strip Godoc navigation without html suffixes", async () => {
    const config = await resolveConfigFromRaw(
      {
        name: "Go Docs",
        siteUrl: "https://docs.example.com",
        prettyUrls: "strip",
        navigation: {
          tabs: [
            {
              tab: "Go API",
              godoc: {
                module: FIXTURE_MODULE,
                packages: ["./..."],
                mode: "live",
                includeTests: true,
              },
            },
          ],
        },
      },
      FIXTURE_MODULE,
    );

    await buildSiteDocs({
      config,
      outputDir: OUTPUT_DIR,
    });

    const packagePage = await readFile(resolve(OUTPUT_DIR, "go-api/package-root.html"), "utf-8");
    expect(packagePage).toContain('href="../go-api"');
    expect(packagePage).toContain('href="../go-api/package-root"');
    expect(packagePage).not.toMatch(/href="[^"]*\.html/);

    const indexPage = await readFile(resolve(OUTPUT_DIR, "go-api.html"), "utf-8");
    expect(indexPage).toContain('href="go-api/package-root"');
    expect(indexPage).not.toMatch(/href="[^"]*\.html/);

    const sitemap = await readFile(resolve(OUTPUT_DIR, "sitemap.xml"), "utf-8");
    expect(sitemap).toContain("go-api/package-root");
    expect(sitemap).not.toContain("go-api/package-root.html");

    const llms = await readFile(resolve(OUTPUT_DIR, "llms.txt"), "utf-8");
    expect(llms).toContain("go-api/package-root");
    expect(llms).not.toContain("go-api/package-root.html");
  });
});
