import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown, openapi } from "../../src/adapters/index.js";
import { resolveConfigFromRaw, type SourceyConfig } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-site-pages-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}
const api = { openapi: "3.1.0", info: { title: "Pet API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "Pets" } } } } } };
async function site(root: string, extra: Partial<SourceyConfig> = {}, theme: "default" | "minimal" | "api-first" | "reader" = "default") {
  await file(root, "docs/start.md", "# Start\n\nInstall it.\n");
  await file(root, "api.json", JSON.stringify(api));
  const config = await resolveConfigFromRaw({ name: "Pets", prettyUrls: "slash", pages: "pages", theme: { name: theme, fonts: { google: false } }, ...extra, navigation: { tabs: [
    { id: "docs", tab: "Documentation", slug: "docs", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start"] }] }) },
    { id: "api", tab: "API Reference", slug: "api", source: openapi("api.json") },
  ] } }, root);
  const built = await buildSourceySite({ config, generateOgImages: false });
  return { built, files: await sourceyArtifacts(built) };
}
const html = (files: Map<string, string | Buffer>, path: string) => files.get(path)!.toString();

describe("site pages", () => {
  for (const theme of ["default", "minimal", "api-first", "reader"] as const) it(`${theme}: draws a page layout with the site's header and footer around the page's own body, in no tab`, () => fixture(async root => {
    await file(root, "pages/index.md", "---\ntitle: Pets for everyone\ndescription: Find a pet.\n---\n# Pets for everyone\n\nFind a pet. [Start](<operation:GET /pets>).\n");
    const { built, files } = await site(root, { siteUrl: "https://pets.example" }, theme);
    const home = html(files, "index.html");
    expect(home).toContain("<title>Pets for everyone");
    // The author's heading and opening stay theirs; there is no sidebar or contents.
    expect(home).toMatch(/<h1[^>]*>Pets for everyone<\/h1>/);
    expect(home).not.toContain('id="nav"');
    expect(home).not.toContain("On this page");
    expect(home).toContain("Docs by Sourcey");
    expect(home).toContain('href="/api/#operation-pets-get"');
    // No section is current, and the sections are in the drawer.
    if (theme !== "reader") {
      expect(home).not.toMatch(/\[text-shadow:[^"]*"[^>]*>Documentation/);
      expect(home).toMatch(/<nav class="sourcey-nav-scroll[^"]*" aria-label="All sections"><ul class="space-y-px"><li><a href="\/docs\/start\/" class="nav-link">/);
      expect(home).toContain('<span class="font-semibold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] truncate min-w-0">Pets for everyone</span>');
    }
    // The site's home is where the logo leads.
    expect(home).toMatch(theme === "reader" ? /<a class="home-link" href="\/"/ : /<a href="\/" class="sourcey-logo/);
    const page = built.pages.find(candidate => candidate.outputPath === "index.html")!;
    expect(page.identity.tab).toBe("@pages");
    expect(built.searchRows.find(row => row.title === "Pets for everyone")).toMatchObject({ url: "/", tab: "" });
    expect(html(files, "sitemap.xml")).toContain("<loc>https://pets.example/</loc>");
  }));

  it("draws a blank page as its body alone, with its own stylesheet and the fonts it names", () => fixture(async root => {
    await file(root, "pages/launch.md", '---\ntitle: Launch\nlayout: blank\ncss: ./launch.css\n---\n<section class="hero"><h1>Launch</h1></section>\n');
    await file(root, "pages/launch.css", '@font-face { font-family: Display; src: url("./display.woff2"); }\n.hero { font-family: Display; }\n');
    await file(root, "pages/display.woff2", "font");
    const { built, files } = await site(root);
    const page = html(files, "launch/index.html");
    expect(page).toContain('<div id="page" data-sourcey-theme="default" class="sourcey-blank"><section class="hero"><h1>Launch</h1></section>');
    expect(page).not.toContain('id="navbar"');
    expect(page).not.toContain("Docs by Sourcey");
    const stylesheet = page.match(/<link rel="stylesheet" href="\/(_media\/[0-9a-f]{20}\.css)"/)![1];
    const css = html(files, stylesheet);
    const font = css.match(/url\("(\/_media\/[0-9a-f]{20}\.woff2)"\)/)![1];
    expect(files.has(font.slice(1))).toBe(true);
    expect(built.pages.find(candidate => candidate.outputPath === "launch/index.html")!.stylesheets).toEqual([stylesheet]);
  }));

  it("lets a documentation page drop its sidebar with layout: page", () => fixture(async root => {
    await file(root, "docs/start.md", "---\nlayout: page\n---\n# Start\n\nInstall it.\n");
    await file(root, "api.json", JSON.stringify(api));
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [
      { id: "docs", tab: "Documentation", slug: "docs", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start"] }] }) },
    ] } }, root);
    const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
    const page = html(files, "docs/start/index.html");
    expect(page).toContain('<main id="main" class="sourcey-page">');
    expect(page).toMatch(/<h1[^>]*>Start<\/h1>/);
  }));

  it("replaces the generated not-found page, naming its assets and links from the root", () => fixture(async root => {
    await file(root, "pages/404.md", "# Lost\n\nTry the [start](../docs/start.md).\n");
    const { built, files } = await site(root, { baseUrl: "/manual", siteUrl: "https://pets.example" });
    const page = html(files, "404.html");
    expect(page).toContain("Lost");
    expect(page).not.toContain("Page not found");
    expect(page).toContain('href="/manual/docs/start/"');
    expect(page).toMatch(/<link rel="stylesheet" href="\/manual\/_assets\//);
    expect(page).toContain('<meta name="robots" content="noindex,follow"');
    expect(built.assembly.routes.match("/manual/404")).toMatchObject({ status: 404, index: false });
    expect(built.searchRows.some(row => row.title === "Lost")).toBe(false);
    expect(html(files, "sitemap.xml")).not.toContain("404");
  }));

  it("names the generated not-found page's assets from the root too", () => fixture(async root => {
    await file(root, "docs/start.md", "# Start\n");
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [{ id: "docs", tab: "Docs", slug: "docs", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start"] }] }) }] } }, root);
    const page = html(await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false })), "404.html");
    expect(page).toMatch(/<link rel="stylesheet" href="\/_assets\//);
    expect(page).toContain('href="/docs/start/"');
  }));

  it("gives each language its own pages, the default language's standing in for one it lacks", () => fixture(async root => {
    await file(root, "pages/index.md", "# Welcome\n");
    await file(root, "pages/about.md", "# About\n");
    await file(root, "pages/fr/index.md", "# Bienvenue\n");
    await file(root, "pages/_partials/note.md", "Not a page.\n");
    const { built } = await site(root, { i18n: { defaultLocale: "en", locales: { en: { label: "English" }, fr: { label: "Français" } } } });
    const published = built.pages.filter(page => page.identity.tab === "@pages").map(page => [page.outputPath, page.contentLocale]).sort();
    expect(published).toEqual([["about/index.html", "en"], ["fr/about/index.html", "en"], ["fr/index.html", "fr"], ["index.html", "en"]]);
    const english = built.pages.find(page => page.outputPath === "index.html")!;
    expect(english.equivalents?.filter(link => link.kind === "locale").map(link => [link.label, link.href])).toEqual([["English", "/"], ["Français", "/fr/"]]);
  }));

  it("refuses a site page drawn as documentation, and a layout it does not know", () => fixture(async root => {
    await file(root, "pages/index.md", "---\nlayout: doc\n---\n# Home\n");
    await expect(site(root)).rejects.toThrow("a site page is drawn as page or blank, not doc");
    await file(root, "pages/index.md", "---\nlayout: wide\n---\n# Home\n");
    await expect(site(root)).rejects.toThrow('layout "wide" is not doc, page, blank or changelog');
  }));
});
