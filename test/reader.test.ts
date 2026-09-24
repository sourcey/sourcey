import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigFromRaw } from "../src/config.js";
import { buildSourceySite, writeSourceySite } from "../src/site.js";
import { resolveThemeAssets } from "../src/themes/assets.js";
import { themeDefinitions } from "../src/themes/registry.js";

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

  it("selects assets for every theme through one registry", () => {
    for (const theme of ["default", "minimal", "api-first"] as const) {
      expect(themeDefinitions[theme]).toEqual(themeDefinitions.default);
      expect(resolveThemeAssets(theme).sourceyCssPaths).toHaveLength(1);
      expect(resolveThemeAssets(theme).clientEntry).toMatch(/client\/index\.(ts|js)$/);
    }
    expect(resolveThemeAssets("reader").clientEntry).toMatch(/client\/reader\.(ts|js)$/);
    expect(resolveThemeAssets("reader").sourceyCssPaths.at(-1)).toMatch(/reader\/sourcey\.css$/);
  });

  it("builds branded chapters, navigation, local fonts, search and machine-readable output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sourcey-reader-"));
    directories.push(dir);
    await writeFile(
      join(dir, "index.md"),
      "---\ntitle: The interaction contract\nnavTitle: Overview\ndescription: A readable contract.\n---\n\n## Scope\n\nA real introduction.\n\n[Continue](./authorization.md)\n",
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
    expect(index).toContain('href="authorization/"');
    expect(index).toContain('href="#scope"');
    expect(index).toContain('id="search-dialog"');
    expect(index).toContain("data-reader-fallback");
    expect(index).toContain('href="https://sourcey.com"');
    expect(index).toMatch(/<a[^>]+href="https:\/\/sourcey\.com"[^>]*>\s*Docs by Sourcey\s*<svg/);
    expect(index).not.toMatch(/Docs by\s*<a/);
    expect(index).not.toContain("sourcey-logo.png");
    expect(index).toContain("Owned by the host configuration.");
    expect(index).toContain("Run the workflow");
    expect(index).toContain("See this contract in use.");
    expect(index).toContain("Edit this contract");
    expect(index).not.toContain("fonts.googleapis.com");
    expect(index).not.toContain("localStorage.getItem('sourcey-theme')");
    expect(index).not.toContain("MailSchema");
    expect(chapter).toContain('href="../"');
    expect(chapter).toContain('href="/contribute/"');
    expect(chapter).toContain('src="../sourcey.js"');
    expect(index.indexOf("--lime: #eeff88")).toBeGreaterThan(index.indexOf('href="sourcey.css"'));
    expect(await readFile(join(dir, "output/sourcey.css"), "utf8")).toContain(".docs-shell");
    expect(await readFile(join(dir, "output/sourcey.js"), "utf8")).toContain("reader-mobile-nav");
    expect(JSON.parse(await readFile(join(dir, "output/search-index.json"), "utf8"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: "/specification/authorization/" })]),
    );
    expect(await readFile(join(dir, "output/llms.txt"), "utf8")).toContain("Authorization");
  });
});
