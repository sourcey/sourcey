import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigFromRaw } from "../src/config.js";
import { buildSourceySite, writeSourceySite } from "../src/site.js";
import { resolveThemeAssets } from "../src/themes/assets.js";
import { themeDefinitions } from "../src/themes/registry.js";
import { engineAsset, engineHref, publishedSearchRows } from "./built-site.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("reader theme", () => {
  it("ships every registered theme asset in the dist-only package", async () => {
    for (const theme of Object.values(themeDefinitions)) {
      await access(new URL(`../dist/client/${theme.client}.js`, import.meta.url));
      for (const css of theme.css) await access(new URL(`../dist/themes/${css}`, import.meta.url));
    }
  });

  it("builds from the package's own engine assets, which name no path of the machine that built them", async () => {
    const { buildAssets } = await import("../dist/renderer/assets.js");
    const root = new URL("..", import.meta.url).pathname;
    for (const theme of Object.keys(themeDefinitions) as (keyof typeof themeDefinitions)[]) {
      for (const consoleEnabled of [true, false]) {
        const { files, paths } = await buildAssets(theme, consoleEnabled, "production");
        expect(files.has(paths.client) && files.has(paths.search) && files.has(paths.styles[0])).toBe(true);
        expect(paths.tryIt !== undefined && files.has(paths.tryIt)).toBe(consoleEnabled);
        for (const body of files.values()) {
          expect(body.includes("//#region")).toBe(false);
          expect(body.includes(root)).toBe(false);
        }
      }
    }
  });

  it("selects assets for every theme through one registry", () => {
    for (const theme of ["default", "minimal", "api-first"] as const) {
      expect(resolveThemeAssets(theme).clientEntry).toMatch(/client\/index\.(ts|js)$/);
      expect(resolveThemeAssets(theme).sourceyCssPaths[0]).toMatch(/default\/sourcey\.css$/);
    }
    expect(themeDefinitions.minimal).toEqual(themeDefinitions.default);
    expect(resolveThemeAssets("default").sourceyCssPaths).toHaveLength(2);
    expect(resolveThemeAssets("default").sourceyCssPaths[1]).toMatch(/default\/forms\.css$/);
    expect(resolveThemeAssets("api-first").sourceyCssPaths.at(-1)).toMatch(
      /api-first\/sourcey\.css$/,
    );
    expect(resolveThemeAssets("reader").clientEntry).toMatch(/client\/reader\.(ts|js)$/);
    expect(resolveThemeAssets("reader").sourceyCssPaths.at(-1)).toMatch(/reader\/sourcey\.css$/);
  });

  it("builds branded chapters, navigation, local fonts, search and machine-readable output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sourcey-reader-"));
    directories.push(dir);
    await writeFile(
      join(dir, "index.md"),
      "---\ntitle: The interaction contract\nnavTitle: Overview\ndescription: A readable contract.\n---\n\n## Scope\n\nA real introduction.\n\n## Conformance\n\nWhat a service must do.\n\n[Continue](./authorization.md)\n",
    );
    await writeFile(
      join(dir, "authorization.md"),
      "---\ntitle: Authorization\n---\n\n## Permission\n\nThe service enforces permission.\n",
    );
    await writeFile(join(dir, "brand.css"), ":root { --lime: #eeff88; }");
    const config = await resolveConfigFromRaw(
      {
        name: "Example standards",
        baseUrl: "/specification/",
        prettyUrls: "slash",
        theme: {
          name: "reader",
          fonts: { sans: "Local Sans", google: false },
          css: ["brand.css"],
          reader: {
            document: { label: "Contract", version: "Draft", status: "Working draft" },
            sidebar: {
              links: [{ label: "Contribute", href: "/contribute/" }],
              note: "Owned by the host configuration.",
            },
            aside: {
              links: [
                {
                  label: "Run the workflow",
                  description: "See this contract in use.",
                  href: "/workflow/",
                  icon: "code",
                },
              ],
            },
            pagination: { after: { label: "Contribute", href: "/contribute/" } },
            footer: {
              text: "Example standards",
              links: [{ label: "Edit this contract", href: "/edit/" }],
            },
          },
        },
        navbar: { links: [{ type: "link", label: "Specification", href: "/specification/" }] },
        navigation: {
          tabs: [
            {
              tab: "Specification",
              slug: "",
              groups: [{ group: "Start", pages: ["index", "authorization"] }],
            },
          ],
        },
      },
      dir,
    );
    expect(config.theme.layout).toEqual({ sidebar: "245px", toc: "220px", content: "850px" });
    const site = await buildSourceySite({
      config,
      outputDir: join(dir, "output"),
      generateOgImages: false,
    });
    await writeSourceySite(site);
    const index = await readFile(join(dir, "output/index.html"), "utf8");
    const chapter = await readFile(join(dir, "output/authorization/index.html"), "utf8");
    expect(index).toContain('data-sourcey-theme="reader"');
    expect(index).toContain("<h1>The interaction contract</h1>");
    expect(index).toContain("<span>Overview</span>");
    // On a phone the folded chapters name the edition and the chapter being read.
    expect(chapter).toMatch(/class="reader-chapters-trigger"><span class="reader-chapters-place"><strong>[^<]+<\/strong><span>Authorization<\/span><\/span>/);
    expect(index).toContain('href="/specification/authorization/"');
    expect(index).toContain('href="#scope"');
    expect(index).toContain('href="#conformance"');
    // A contents list of one place says nothing the page does not.
    expect(chapter).not.toContain('id="sourcey-toc-label"');
    expect(index).toContain('id="search-dialog"');
    expect(index).toContain("data-reader-fallback");
    expect(index).toContain('href="https://sourcey.com/docs"');
    expect(index).toMatch(
      /<a[^>]+href="https:\/\/sourcey\.com\/docs"[^>]*>\s*Docs by Sourcey\s*<svg/,
    );
    expect(index).not.toMatch(/Docs by\s*<a/);
    expect(index).not.toContain("noreferrer");
    expect(index).not.toContain("sourcey-logo.png");
    expect(index).toContain("Owned by the host configuration.");
    expect(index).toContain("Run the workflow");
    expect(index).toContain("See this contract in use.");
    expect(index).toContain("Edit this contract");
    expect(index).not.toContain("fonts.googleapis.com");
    expect(engineHref(index, "sourcey-theme.js")).toMatch(/^\/specification\/_assets\//);
    expect(index).toContain('id="theme-toggle"');
    expect(index).not.toContain("MailSchema");
    expect(chapter).toContain('href="/specification/"');
    expect(chapter).toContain('href="/contribute/"');
    expect(engineHref(chapter, "sourcey.js")).toMatch(/^\/specification\/_assets\//);
    expect(chapter).toContain('href="/specification/authorization/index.md"');
    expect(chapter).not.toContain('/specification/specification/');
    expect(index.indexOf("--lime: #eeff88")).toBeGreaterThan(index.indexOf(`href="${engineHref(index, "sourcey.css")}"`));
    expect(await readFile(await engineAsset(join(dir, "output"), "sourcey.css"), "utf8")).toContain(".docs-shell");
    expect(await readFile(await engineAsset(join(dir, "output"), "sourcey.js"), "utf8")).toContain("reader-mobile-nav");
    expect(await publishedSearchRows(join(dir, "output"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: "/specification/authorization/" })]),
    );
    expect(await readFile(join(dir, "output/llms.txt"), "utf8")).toContain("Authorization");
  });

  it("links a strip-mode root under a base without a trailing slash, and navigates chapters through links", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sourcey-reader-strip-"));
    directories.push(dir);
    await writeFile(
      join(dir, "index.md"),
      "---\ntitle: Overview\n---\n\n[Continue](./authorization.md)\n",
    );
    await writeFile(
      join(dir, "authorization.md"),
      "---\ntitle: Authorization\n---\n\n[Back](./index.md)\n",
    );
    const config = await resolveConfigFromRaw(
      {
        name: "Example standards",
        baseUrl: "/specification/",
        prettyUrls: "strip",
        theme: { name: "reader", fonts: { google: false } },
        navigation: {
          tabs: [
            {
              tab: "Specification",
              slug: "",
              groups: [{ group: "Start", pages: ["index", "authorization"] }],
            },
          ],
        },
      },
      dir,
    );
    await writeSourceySite(
      await buildSourceySite({ config, outputDir: join(dir, "output"), generateOgImages: false }),
    );
    for (const page of ["index.html", "authorization.html"]) {
      const html = await readFile(join(dir, "output", page), "utf8");
      expect(html, page).toContain('href="/specification"');
      expect(html, page).not.toMatch(/href="(?:\.\/|\.\.\/|\/specification\/)(?:#[^"]*)?"/);
      expect(html.match(/data-reader-chapters=/g), page).toHaveLength(1);
      expect(html, page).not.toContain("reader-chapter-fallback");
      const chapters = html.match(/<nav aria-label="Chapters">([\s\S]*?)<\/nav>/)![1];
      expect(chapters.match(/<a /g), page).toHaveLength(2);
      expect(chapters, page).toContain('href="/specification"');
      expect(chapters, page).toContain('href="/specification/authorization"');
      // Without a document label the trail names the tab once.
      const trail = html.match(/class="doc-breadcrumb">([\s\S]*?)<\/div>/)![1];
      expect(trail.match(/Specification/g), page).toHaveLength(1);
    }
  });
});
