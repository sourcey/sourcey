import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdown, mcp, openapi } from "../src/adapters/index.js";
import { resolveConfigFromRaw } from "../src/config.js";
import { buildSourceySite, writeSourceySite } from "../src/site.js";
import { rgbToOklch, shadedNeutrals } from "../src/utils/palette.js";
import { engineAsset } from "./built-site.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function buildDemo(theme: "api-first" | "default", customCss?: string) {
  const dir = await mkdtemp(join(tmpdir(), `sourcey-${theme}-`));
  directories.push(dir);
  await writeFile(
    join(dir, "quickstart.md"),
    "---\ntitle: Quickstart\ndescription: Build the demo.\n---\n\nRun `npm run build`.\n\n## First step\n\nText.\n\n### Detail\n\nMore.\n",
  );
  if (customCss) await writeFile(join(dir, "brand.css"), customCss);
  await copyFile(new URL("fixtures/cheese.yml", import.meta.url), join(dir, "cheese.yml"));
  await copyFile(
    new URL("fixtures/nitrosend.mcp.json", import.meta.url),
    join(dir, "tools.mcp.json"),
  );
  const config = await resolveConfigFromRaw(
    {
      name: "Cheese Store",
      theme: {
        name: theme,
        colors: { primary: "#d97706" },
        ...(customCss ? { css: ["brand.css"] } : {}),
      },
      navigation: {
        tabs: [
          {
            tab: "Documentation",
            slug: "",
            source: markdown({ groups: [{ group: "Getting Started", pages: ["quickstart"] }] }),
          },
          { tab: "API Reference", slug: "api", source: openapi("./cheese.yml") },
          { tab: "MCP Tools", slug: "mcp", source: mcp("./tools.mcp.json") },
        ],
      },
    },
    dir,
  );
  const site = await buildSourceySite({
    config,
    outputDir: join(dir, "output"),
    generateOgImages: false,
  });
  await writeSourceySite(site);
  const read = (path: string) => readFile(join(dir, "output", path), "utf8");
  return {
    guide: await read("quickstart.html"),
    api: await read("api.html"),
    mcp: await read("mcp.html"),
    css: await readFile(await engineAsset(join(dir, "output"), "sourcey.css"), "utf8"),
  };
}

describe("api-first theme", () => {
  it("runs the frame edge to edge and gives guides a trail and a plain table of contents", async () => {
    const { guide, css } = await buildDemo("api-first");
    expect(guide).toContain('id="page" data-sourcey-theme="api-first"');
    expect(guide).not.toContain("max-w-[92rem]");
    expect(guide).toContain("navbar-band");
    expect(guide).toContain('class="api-first-page"');
    expect(guide).toContain("api-first-reading");
    expect(guide).toMatch(/<nav class="page-trail" aria-label="Breadcrumb">.*Getting Started/s);
    expect(guide).toMatch(
      /<aside id="toc" aria-labelledby="sourcey-toc-label" class="toc-wide[^"]*"[^>]*>\s*<p id="sourcey-toc-label" class="toc-wide-label"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>On this page<\/p>\s*<nav aria-labelledby="sourcey-toc-label">/s,
    );
    expect(guide).not.toContain("noreferrer");
    expect(css).toContain(".operation-split");
    expect(css).toContain("var(--sidebar-width)");
  });

  it("shades its neutrals from the primary colour, ahead of custom CSS so a site can override them", async () => {
    const { guide } = await buildDemo("api-first", ":root { --color-gray-50: 1 2 3; }");
    const shades = shadedNeutrals("217 119 6");
    const injected = guide.indexOf(`--color-gray-50: ${shades.gray[50]};`);
    expect(injected).toBeGreaterThan(-1);
    expect(guide).toContain(`--color-background-dark: ${shades.backgroundDark};`);
    expect(guide.indexOf("--color-gray-50: 1 2 3;")).toBeGreaterThan(injected);
    expect(guide).toContain("--sidebar-width: 17.5rem;");
    expect(guide).toContain("--toc-width: 13.5rem;");
    expect(guide).toContain("--content-max-width: 44rem;");
  });

  it("hard-codes no colour in its stylesheet", async () => {
    const css = await readFile(
      new URL("../src/themes/api-first/sourcey.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toMatch(/rgb\(\s*\d/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("splits operations into content and examples with a full-width interactive HTTP endpoint", async () => {
    const { api, mcp } = await buildDemo("api-first");
    expect(api).toMatch(/<section id="operation-[^"]+" class="operation-split"/);
    expect(api).toContain('class="sourcey-endpoint ');
    expect(api).toContain("data-try-it-trigger");
    expect(api).toContain('class="operation-split-examples"');
    expect(api).toContain("code-group code-samples not-prose");
    expect(api).toContain("https://cheese.sourcey.com/v2</span>");
    expect(mcp).not.toContain("data-try-it-trigger");
    expect(mcp).toContain('class="operation-split"');
    // A tool under "Tools" whose title is its name says neither again beneath it; a
    // resource's address is more than its name.
    expect(mcp).not.toMatch(/<div class="operation-line" data-method="tool">/);
    expect(mcp).not.toContain('class="method-badge"');
    expect(mcp).toMatch(/<div class="operation-line" data-method="resource"><span class="operation-line-path">[a-z]+:\/\//);
  });

  it("leaves the default theme's layout and neutrals as they were", async () => {
    const { guide, api } = await buildDemo("default");
    expect(guide).toContain("max-w-[92rem]");
    // Each header row runs the window's width, so a theme can colour it edge to edge, and holds
    // its contents to the page's frame.
    expect(guide).toMatch(/<div class="sourcey-header-top relative"><div class="sourcey-header-frame [^"]* max-w-\[92rem\] lg:mx-auto">/);
    expect(guide).toContain('<div class="sourcey-header-navigation max-w-[92rem] mx-auto"');
    expect(guide).not.toContain("--color-gray-50:");
    expect(guide).toContain("--color-background-dark: 11 12 16;");
    expect(guide).not.toContain("page-trail");
    expect(guide).not.toContain("toc-wide");
    expect(api).not.toContain("operation-split");
  });
});

describe("inline code", () => {
  it("renders as a chip in every theme, without literal backticks", async () => {
    const css = await readFile(
      new URL("../src/themes/default/sourcey.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toMatch(/content:\s*"`"/);
    expect(css).toMatch(/:where\(code\)[^{]*::before,[^{]*::after \{\s*content: none;/);
  });
});

describe("primary shading", () => {
  const hueOf = (rgb: string) =>
    rgbToOklch(rgb.split(" ").map(Number) as [number, number, number])[2];

  it("tints every neutral toward the primary's hue and steps lightness down the scale", () => {
    const amber = shadedNeutrals("217 119 6");
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    const lightness = steps.map(
      (step) => rgbToOklch(amber.gray[step].split(" ").map(Number) as [number, number, number])[0],
    );
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
    const primaryHue = rgbToOklch([217, 119, 6])[2];
    for (const step of [200, 500, 800])
      expect(Math.abs(hueOf(amber.gray[step]) - primaryHue)).toBeLessThan(0.2);
    expect(shadedNeutrals("99 102 241").gray[800]).not.toEqual(amber.gray[800]);
  });

  it("leaves the scale grey for a grey primary", () => {
    const grey = shadedNeutrals("128 128 128");
    for (const rgb of Object.values(grey.gray)) {
      const [r, g, b] = rgb.split(" ").map(Number);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
    }
  });
});
