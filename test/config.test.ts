import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfigFromRaw } from "../src/config.js";
import { doxygen, godoc, markdown, openapi } from "../src/adapters/index.js";
import type { SourceyConfig } from "../src/config.js";
import { contrast, rgbToOklch } from "../src/utils/palette.js";

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
  it("resolves complete system font stacks without downloading a named family", async () => {
    await withTempDir(async dir => {
      const config = await resolveConfigFromRaw(baseConfig({ theme: { fonts: { sans: "system", mono: "system" } } }), dir);
      expect(config.theme.fonts.sans).toContain("system-ui");
      expect(config.theme.fonts.sans).not.toMatch(/'system'|Inter/);
      expect(config.theme.fonts.mono).toContain("ui-monospace");
      expect(config.theme.fonts.mono).not.toContain("'system'");
      expect(config.theme.fonts.google).toEqual([]);
    });
  });
  it("loads named text and code families from Google Fonts unless the site serves them", async () => {
    await withTempDir(async dir => {
      const named = await resolveConfigFromRaw(baseConfig({ theme: { fonts: { sans: "Work Sans", mono: "Roboto Mono" } } }), dir);
      expect(named.theme.fonts.mono).toMatch(/^'Roboto Mono', ui-monospace/);
      expect(named.theme.fonts.google).toEqual(["Work Sans", "Roboto Mono"]);
      expect((await resolveConfigFromRaw(baseConfig({ theme: { fonts: { mono: "Roboto Mono" } } }), dir)).theme.fonts.google).toEqual(["Inter", "Roboto Mono"]);
      expect((await resolveConfigFromRaw(baseConfig({ theme: { fonts: { sans: "Lato", google: false } } }), dir)).theme.fonts.google).toEqual([]);
    });
  });
  it("takes a logo as a wordmark unless it is a mark, which the reader theme's logoMark also says", async () => {
    await withTempDir(async dir => {
      expect((await resolveConfigFromRaw(baseConfig({ logo: "./logo.svg" }), dir)).logo).toEqual({ light: `${dir}/logo.svg` });
      expect((await resolveConfigFromRaw(baseConfig({ logo: { light: "./mark.svg", mark: true } }), dir)).logo?.mark).toBe(true);
      expect((await resolveConfigFromRaw(baseConfig({ logo: "./mark.svg", theme: { name: "reader", reader: { logoMark: true } } }), dir)).logo?.mark).toBe(true);
    });
  });
  it("keeps a navbar menu of links, and stops at one without a label or links", async () => {
    await withTempDir(async (dir) => {
      const menu = { type: "menu" as const, label: "Community", links: [{ type: "link" as const, href: "https://forum.example.com", label: "Forums" }] };
      expect((await resolveConfigFromRaw(baseConfig({ navbar: { links: [menu] } }), dir)).navbar.links).toEqual([menu]);
      await expect(resolveConfigFromRaw(baseConfig({ navbar: { links: [{ ...menu, links: [] }] } }), dir)).rejects.toThrow('Navbar menu "Community" needs links');
      await expect(resolveConfigFromRaw(baseConfig({ navbar: { links: [{ ...menu, label: " " }] } }), dir)).rejects.toThrow("A navbar menu needs a label");
      await expect(resolveConfigFromRaw(baseConfig({ navbar: { links: [{ ...menu, links: [menu as never] }] } }), dir)).rejects.toThrow('Navbar menu "Community" holds links with an href');
    });
  });
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

  it("derives each text shade a site leaves out from its primary, so links read in both schemes", async () => {
    await withTempDir(async (dir) => {
      const colours = async (colors: { primary: string; light?: string; dark?: string }) =>
        (await resolveConfigFromRaw(baseConfig({ theme: { colors } }), dir)).theme.colors;
      const channels = (triplet: string) => triplet.split(" ").map(Number) as [number, number, number];
      const reads = (triplet: string, pages: [number, number, number][]) => pages.every(page => contrast(channels(triplet), page) >= 4.5);
      const lightPages: [number, number, number][] = [[255, 255, 255], [247, 248, 251]];
      const darkPages: [number, number, number][] = [[11, 12, 16], [20, 22, 28]];
      // An emerald too light for text on white keeps its hue a step darker there, and itself in dark mode.
      const emerald = await colours({ primary: "#10b981" });
      expect(emerald.primary).toBe("16 185 129");
      expect(reads(emerald.dark, lightPages)).toBe(true);
      expect(emerald.light).toBe("16 185 129");
      // A deep red that reads on white stays itself there and lightens for dark pages.
      const red = await colours({ primary: "#BD1E1E" });
      expect(red.dark).toBe("189 30 30");
      expect(reads(red.light, darkPages)).toBe(true);
      expect(rgbToOklch(channels(red.light))[2]).toBeCloseTo(rgbToOklch([189, 30, 30])[2], 1);
      // Shades a site sets are its own.
      expect(await colours({ primary: "#10b981", light: "#34d399", dark: "#10b981" })).toEqual({ primary: "16 185 129", light: "52 211 153", dark: "16 185 129" });
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
      const tab = resolved.contexts[0].tabs[0];

      expect(tab.source.kind).toBe("markdown");
      expect(tab.source.groups[0].label).toBe("Start");
      expect(tab.source.groups[0].items[0].file).toBe(join(dir, "introduction.md"));
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
      const tab = resolved.contexts[0].tabs[0];

      expect(tab.source.kind).toBe("openapi");
      expect(tab.source.spec).toBe(join(dir, "openapi.yaml"));
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
      const tab = resolved.contexts[0].tabs[0];

      expect(tab.source.kind).toBe("doxygen");
      expect(tab.source.config.sourceUrl).toEqual([
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
      await expect(resolveConfigFromRaw(raw, dir)).rejects.toThrow(/matched no Markdown/);
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
      expect(resolved.contexts[0].tabs).toHaveLength(1);
      const tab = resolved.contexts[0].tabs[0];
      expect(tab.label).toBe("Go API");
      expect(tab.slug).toBe("go-api");
      expect(tab.source.kind).toBe("godoc");
      expect(tab.source.config).toBeDefined();
      expect(tab.source.config.module).toBe(dir);
      expect(tab.source.config.packages).toEqual(["./internal/core/...", "./cmd/..."]);
      expect(tab.source.config.snapshot).toBe(join(dir, "snapshot.json"));
      expect(tab.source.config.mode).toBe("live");
      expect(tab.source.config.includeTests).toBe(false);
      expect(tab.source.config.includeUnexported).toBe(true);
      expect(tab.source.config.hideUndocumented).toBe(false);
      expect(tab.source.config.exclude).toEqual(["./vendor/..."]);
      expect(tab.source.config.goEnv).toEqual({ GOOS: "linux", GOARCH: "amd64", tags: ["integration"] });
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
      const tab = resolved.contexts[0].tabs[0];
      expect(tab.source.config).toBeDefined();
      expect(tab.source.config.module).toBe(dir);
      expect(tab.source.config.packages).toEqual(["./..."]);
      expect(tab.source.config.mode).toBe("auto");
      expect(tab.source.config.includeTests).toBe(true);
      expect(tab.source.config.includeUnexported).toBe(false);
      expect(tab.source.config.snapshot).toBeUndefined();
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
      expect(resolved.contexts[0].tabs[0].source.config.module).toBe(dir);
      expect(resolved.contexts[0].tabs[0].source.config.packages).toEqual(["./..."]);
      expect(resolved.contexts[0].tabs[0].source.config.mode).toBe("auto");
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
      const tab = resolved.contexts[0].tabs[0];

      expect(tab.source.kind).toBe("godoc");
      expect(tab.source.config.module).toBe(dir);
      expect(tab.source.config.packages).toEqual(["./pkg/..."]);
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

  it("names the Doxygen languages moxygen has templates for", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, "xml"), { recursive: true });
      const config = (language: string) => baseConfig({
        navigation: { tabs: [{ tab: "API", source: doxygen({ xml: "./xml", language: language as "cpp" }) }] },
      });

      await expect(resolveConfigFromRaw(config("c"), dir)).rejects.toThrow('Doxygen language must be "cpp" or "java", not "c"; C uses "cpp"');
      const java = await resolveConfigFromRaw(config("java"), dir);
      expect(java.contexts[0].tabs[0].source.config.language).toBe("java");
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

