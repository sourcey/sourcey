import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfigFromRaw } from "../src/config.js";
import { buildNavFromPages } from "../src/core/navigation.js";
import { doxygen, godoc, markdown, mkdocs, openapi } from "../src/adapters/index.js";
import type { SourceyConfig } from "../src/config.js";
import type { DocsPage } from "../src/core/markdown-loader.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sourcey-config-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function baseConfig(extra: Partial<SourceyConfig> = {}): SourceyConfig {
  return {
    name: "Test",
    navigation: { tabs: [] },
    ...extra,
  };
}

describe("resolveConfigFromRaw – validation", () => {
  it("rejects invalid theme names", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(baseConfig({ theme: { name: "missing" as never } }), dir),
      ).rejects.toThrow(/Invalid theme/);
    });
  });

  it("accepts the deprecated theme.preset alias", async () => {
    await withTempDir(async (dir) => {
      const config = await resolveConfigFromRaw(baseConfig({ theme: { preset: "minimal" } }), dir);
      expect(config.theme.name).toBe("minimal");
    });
  });

  it("rejects conflicting theme name and preset values", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(baseConfig({ theme: { name: "reader", preset: "minimal" } }), dir),
      ).rejects.toThrow(/Conflicting theme names/);
    });
  });

  it("rejects reader options on another theme", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(
          baseConfig({
            theme: { name: "default", reader: { document: { label: "Protocol" } } },
          }),
          dir,
        ),
      ).rejects.toThrow(/theme\.reader options require theme\.name/);
    });
  });

  it("rejects invalid hex colors", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(baseConfig({ theme: { colors: { primary: "#zzzzzz" } } }), dir),
      ).rejects.toThrow(/Invalid hex color/);
    });
  });

  it("rejects invalid prettyUrls values", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(baseConfig({ prettyUrls: "pretty" as never }), dir),
      ).rejects.toThrow(/Invalid prettyUrls/);
    });
  });

  it("rejects unknown code sample languages", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(baseConfig({ codeSamples: ["node"] }), dir),
      ).rejects.toThrow(/Invalid codeSamples/);
    });
  });
});

describe("resolveConfigFromRaw – source adapters", () => {
  it("resolves markdown groups from the source adapter form", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "introduction.md"), "# Introduction\n");

      const raw = baseConfig({
        navigation: {
          tabs: [
            {
              tab: "Documentation",
              source: markdown({
                groups: [{ group: "Start", pages: ["introduction"] }],
              }),
            },
          ],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];

      expect(tab.source.kind).toBe("markdown");
      expect(tab.groups?.[0].label).toBe("Start");
      expect(tab.groups?.[0].pages[0].file).toBe(join(dir, "introduction.md"));
    });
  });

  it("resolves OpenAPI specs from the source adapter form", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "openapi.yaml"),
        "openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n",
      );

      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "API Reference", source: openapi("./openapi.yaml") }],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];

      expect(tab.source.kind).toBe("openapi");
      expect(tab.openapi).toBe(join(dir, "openapi.yaml"));
    });
  });

  it("preserves Doxygen source URL route maps from the source adapter form", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "xml"), { recursive: true });

      const raw = baseConfig({
        navigation: {
          tabs: [
            {
              tab: "API Reference",
              source: doxygen({
                xml: "./xml",
                sourceUrl: [
                  { prefix: "src/graft/" },
                  { prefix: "", url: "https://github.com/nilstate/icey/blob/main/{fullPath}" },
                ],
              }),
            },
          ],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];

      expect(tab.source.kind).toBe("doxygen");
      expect(tab.doxygen?.sourceUrl).toEqual([
        { prefix: "src/graft/" },
        { prefix: "", url: "https://github.com/nilstate/icey/blob/main/{fullPath}" },
      ]);
    });
  });

  it("rejects markdown globs that match no files", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [
            {
              tab: "Documentation",
              source: markdown({
                groups: [{ group: "Reference", pages: ["api/missing-*"] }],
              }),
            },
          ],
        },
      });

      await mkdir(join(dir, "api"), { recursive: true });
      await expect(resolveConfigFromRaw(raw, dir)).rejects.toThrow(/matched no files/);
    });
  });
});

describe("resolveConfigFromRaw – godoc tabs", () => {
  it("resolves godoc tab from object form with explicit packages and module", async () => {
    await withTempDir(async (dir) => {
      const moduleDir = join(dir, "go-module");
      await writeFile(join(dir, "go-module-marker"), "");
      await writeFile(join(dir, "snapshot.json"), "{}");
      // assertExists only requires the path to be accessible; the module
      // directory pointer is the temp dir itself for this test.

      const raw = baseConfig({
        navigation: {
          tabs: [
            {
              tab: "Go API",
              godoc: {
                module: ".",
                packages: ["./internal/core/...", "./cmd/..."],
                snapshot: "snapshot.json",
                mode: "live",
                includeTests: false,
                includeUnexported: true,
                exclude: ["./vendor/..."],
                goEnv: { GOOS: "linux", GOARCH: "amd64", tags: ["integration"] },
              },
            },
          ],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      expect(resolved.tabs).toHaveLength(1);
      const tab = resolved.tabs[0];
      expect(tab.label).toBe("Go API");
      expect(tab.slug).toBe("go-api");
      expect(tab.source.kind).toBe("godoc");
      expect(tab.godoc).toBeDefined();
      expect(tab.godoc!.module).toBe(dir);
      expect(tab.godoc!.packages).toEqual(["./internal/core/...", "./cmd/..."]);
      expect(tab.godoc!.snapshot).toBe(join(dir, "snapshot.json"));
      expect(tab.godoc!.mode).toBe("live");
      expect(tab.godoc!.includeTests).toBe(false);
      expect(tab.godoc!.includeUnexported).toBe(true);
      expect(tab.godoc!.hideUndocumented).toBe(false);
      expect(tab.godoc!.exclude).toEqual(["./vendor/..."]);
      expect(tab.godoc!.goEnv).toEqual({ GOOS: "linux", GOARCH: "amd64", tags: ["integration"] });
      // Suppress unused-binding warning.
      void moduleDir;
    });
  });

  it("expands the string shorthand into module + default packages and includeTests=true", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Go API", godoc: "." }],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];
      expect(tab.godoc).toBeDefined();
      expect(tab.godoc!.module).toBe(dir);
      expect(tab.godoc!.packages).toEqual(["./..."]);
      expect(tab.godoc!.mode).toBe("auto");
      expect(tab.godoc!.includeTests).toBe(true);
      expect(tab.godoc!.includeUnexported).toBe(false);
      expect(tab.godoc!.snapshot).toBeUndefined();
    });
  });

  it("defaults module to the config directory when omitted", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Go API", godoc: {} }],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      expect(resolved.tabs[0].godoc!.module).toBe(dir);
      expect(resolved.tabs[0].godoc!.packages).toEqual(["./..."]);
      expect(resolved.tabs[0].godoc!.mode).toBe("auto");
    });
  });

  it("resolves godoc from the source adapter form", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Go API", source: godoc({ module: ".", packages: ["./pkg/..."] }) }],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];

      expect(tab.source.kind).toBe("godoc");
      expect(tab.godoc!.module).toBe(dir);
      expect(tab.godoc!.packages).toEqual(["./pkg/..."]);
    });
  });

  it("rejects a tab with both godoc and another source", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [
            {
              tab: "Mixed",
              godoc: ".",
              mcp: "https://example.com/mcp.json",
            },
          ],
        },
      });

      await expect(resolveConfigFromRaw(raw, dir)).rejects.toThrow(/multiple sources/);
    });
  });

  it("rejects URL inputs for local-only adapters", async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveConfigFromRaw(
          baseConfig({
            navigation: { tabs: [{ tab: "Go API", source: godoc("https://example.com/go") }] },
          }),
          dir,
        ),
      ).rejects.toThrow(/must be a local file path/);

      await expect(
        resolveConfigFromRaw(
          baseConfig({
            navigation: {
              tabs: [{ tab: "C++ API", source: doxygen({ xml: "https://example.com/xml" }) }],
            },
          }),
          dir,
        ),
      ).rejects.toThrow(/must be a local file path/);
    });
  });

  it("includes godoc in the no-source error message", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Empty" }],
        },
      });

      await expect(resolveConfigFromRaw(raw, dir)).rejects.toThrow(/godoc/);
    });
  });

  it("throws when the configured module directory does not exist", async () => {
    await withTempDir(async (dir) => {
      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Go API", godoc: "./does-not-exist" }],
        },
      });

      await expect(resolveConfigFromRaw(raw, dir)).rejects.toThrow(/Go module directory/);
    });
  });
});

describe("resolveConfigFromRaw – mkdocs tabs", () => {
  it("imports docs_dir and nested MkDocs nav as Sourcey page groups", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "site", "content", "guides"), { recursive: true });
      await mkdir(join(dir, "site", "content", "api", "basic_json"), { recursive: true });
      await writeFile(join(dir, "site", "content", "index.md"), "# JSON for Modern C++\n");
      await writeFile(join(dir, "site", "content", "guides", "install.md"), "# Install\n");
      await writeFile(
        join(dir, "site", "content", "api", "basic_json", "basic_json.md"),
        "# Constructor\n",
      );
      await writeFile(
        join(dir, "site", "mkdocs.yml"),
        [
          "site_name: JSON for Modern C++",
          "docs_dir: content",
          "nav:",
          "  - Home:",
          "      - Overview: index.md",
          "      - Guide:",
          "          - Install: guides/install.md",
          "  - API Documentation:",
          "      - basic_json:",
          "          - Constructor: api/basic_json/basic_json.md",
          "markdown_extensions:",
          "  - pymdownx.emoji:",
          "      emoji_index: !!python/name:material.extensions.emoji.twemoji",
          "plugins:",
          "  - htmlproofer:",
          "      enabled: !ENV [ENABLED_HTMLPROOFER, False]",
        ].join("\n"),
      );

      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Manual", mkdocs: "site/mkdocs.yml" }],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];

      expect(tab.mkdocs).toBe(join(dir, "site", "mkdocs.yml"));
      expect(tab.source.kind).toBe("markdown");
      expect(tab.source.adapter).toBe("mkdocs");
      expect(tab.groups?.map((group) => group.label)).toEqual(["Home", "API Documentation"]);
      expect(tab.groups?.[0].pages.map((page) => [page.slug, page.label])).toEqual([
        ["index", "Overview"],
        ["guides/install", "Guide / Install"],
      ]);
      expect(tab.groups?.[0].pages.map((page) => page.sourceRoot)).toEqual([
        join(dir, "site", "content"),
        join(dir, "site", "content"),
      ]);
      expect(tab.groups?.[1].pages.map((page) => [page.slug, page.label])).toEqual([
        ["api/basic_json/basic_json", "basic_json / Constructor"],
      ]);

      const pagesByPath = new Map<string, DocsPage>();
      for (const group of tab.groups!) {
        for (const page of group.pages) {
          pagesByPath.set(page.slug, {
            kind: "markdown",
            title: "Markdown heading",
            description: "",
            slug: page.slug,
            html: "",
            headings: [],
            sourcePath: page.file,
            editPath: page.file,
          });
        }
      }
      const nav = buildNavFromPages(tab, pagesByPath);
      expect(nav.groups[0].items.map((item) => item.label)).toEqual([
        "Overview",
        "Guide / Install",
      ]);
    });
  });

  it("imports MkDocs from the source adapter form", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "docs"), { recursive: true });
      await writeFile(join(dir, "docs", "index.md"), "# Home\n");
      await writeFile(
        join(dir, "mkdocs.yml"),
        ["site_name: Docs", "nav:", "  - Home: index.md"].join("\n"),
      );

      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Manual", source: mkdocs({ config: "mkdocs.yml" }) }],
        },
      });

      const resolved = await resolveConfigFromRaw(raw, dir);
      const tab = resolved.tabs[0];

      expect(tab.source.kind).toBe("markdown");
      expect(tab.source.adapter).toBe("mkdocs");
      expect(tab.mkdocs).toBe(join(dir, "mkdocs.yml"));
      expect(tab.groups?.[0].pages[0].slug).toBe("index");
      expect(tab.groups?.[0].pages[0].preprocess).toHaveLength(1);
    });
  });

  it("rejects MkDocs nav pages outside docs_dir", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "docs"), { recursive: true });
      await writeFile(join(dir, "docs", "index.md"), "# Home\n");
      await writeFile(join(dir, "outside.md"), "# Outside\n");
      await writeFile(
        join(dir, "mkdocs.yml"),
        ["site_name: Docs", "nav:", "  - Home: index.md", "  - Outside: ../outside.md"].join("\n"),
      );

      const raw = baseConfig({
        navigation: {
          tabs: [{ tab: "Manual", source: mkdocs("mkdocs.yml") }],
        },
      });

      await expect(resolveConfigFromRaw(raw, dir)).rejects.toThrow(/escapes docs_dir/);
    });
  });
});
