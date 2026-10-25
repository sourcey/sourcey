import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown, openapi } from "../../src/adapters/index.js";
import { resolveConfigFromRaw, type SourceyConfig } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts, updateSourceySite } from "../../src/site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-site-components-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}
const api = { openapi: "3.1.0", info: { title: "Pet API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "Pets" } } } } } };
async function config(root: string, extra: Partial<SourceyConfig> = {}, theme: "default" | "minimal" | "api-first" | "reader" = "default") {
  await file(root, "docs/start.md", "# Start\n\nInstall it.\n");
  await file(root, "api.json", JSON.stringify(api));
  return resolveConfigFromRaw({ name: "Pets", siteUrl: "https://pets.example", prettyUrls: "slash", theme: { name: theme, fonts: { google: false } }, ...extra, navigation: { tabs: [
    { id: "docs", tab: "Documentation", slug: "docs", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start"] }] }) },
    { id: "api", tab: "API Reference", slug: "api", source: openapi("api.json") },
  ] } }, root);
}
async function site(root: string, extra: Partial<SourceyConfig> = {}, theme?: "default" | "minimal" | "api-first" | "reader") {
  const built = await buildSourceySite({ config: await config(root, extra, theme), generateOgImages: false });
  return { built, files: await sourceyArtifacts(built) };
}
const html = (files: Map<string, string | Buffer>, path: string) => files.get(path)!.toString();

describe("the components folder", () => {
  for (const theme of ["default", "minimal", "api-first", "reader"] as const) it(`${theme}: draws each page part where it belongs, and Header and Footer in place of the theme's`, () => fixture(async root => {
    await file(root, "components/Head.html", '<script src="https://analytics.pets.example/a.js" async></script>');
    await file(root, "components/Banner.html", '<p class="pets-banner">Adopt this week.</p>');
    await file(root, "components/Header.html", '<header class="pets-header">Pets</header>');
    await file(root, "components/ContentEnd.html", '<aside class="pets-end">Was this useful?</aside>');
    await file(root, "components/Footer.tsx", 'export default function Footer({ page }) { return <footer class="pets-footer">{page.title} at {page.url}</footer>; }');
    await file(root, "components/BodyEnd.html", "<script>window.petsReady = true;</script>");
    const { files } = await site(root, {}, theme);
    const guide = html(files, "docs/start/index.html");
    expect(guide).toMatch(/<script src="https:\/\/analytics\.pets\.example\/a\.js" async><\/script><\/head>/);
    expect(guide).toMatch(/<body[^>]*><p class="pets-banner">Adopt this week\.<\/p>/);
    expect(guide).toMatch(/<script>window\.petsReady = true;<\/script><\/body>/);
    expect(guide).toContain('<header class="pets-header">Pets</header>');
    expect(guide).not.toContain('class="site-header"');
    expect(guide).not.toContain('id="header"');
    expect(guide).toContain('<footer class="pets-footer">Start at https://pets.example/docs/start/</footer>');
    expect(guide).not.toContain("Docs by Sourcey");
    expect(guide.indexOf("Install it.")).toBeLessThan(guide.indexOf('<aside class="pets-end">'));
    expect(guide).not.toContain("sourcey-part");
    const reference = html(files, "api/index.html");
    expect(reference).toContain('<aside class="pets-end">Was this useful?</aside>');
    expect(reference).toContain('<footer class="pets-footer">');
  }));

  it("marks a not-found page on its root, and tells each part", () => fixture(async root => {
    await file(root, "components/Head.tsx", 'export default function Head({ page }) { return page.notFound ? <script>{"track404()"}</script> : null; }');
    const { files } = await site(root);
    const missing = html(files, "404.html");
    expect(missing).toMatch(/<html [^>]*data-sourcey-page="not-found"/);
    expect(missing).toContain("<script>track404()</script></head>");
    const guide = html(files, "docs/start/index.html");
    expect(guide).not.toContain("data-sourcey-page");
    expect(guide).not.toContain("track404");
  }));

  it("makes each other file a Markdown component, a built-in's name replacing it, the config's winning over a file", () => fixture(async root => {
    const { authoring } = await config(root);
    await file(root, "components/Note.html", '<div class="pets-note"><slot /></div>');
    await file(root, "components/Badge.tsx", 'import { label } from "./label.tsx";\nexport default function Badge({ tone, children }) { return <span class={label(tone)}>{children}</span>; }');
    await file(root, "components/label.tsx", "export const label = (tone) => `pets-badge pets-badge-${tone}`;");
    await file(root, "components/Card.html", '<div class="pets-card"><slot></slot></div>');
    await file(root, "components/Steps.html", '<ol class="from-file"><slot /></ol>');
    await file(root, "docs/start.md", '# Start\n\n<Note>\n\nFeed them **twice** a day.\n\n</Note>\n\nA <Badge tone="new">new</Badge> pet.\n\n<Card title="Cats">Cats nap.</Card>\n\n<Steps>One.</Steps>\n');
    const built = await buildSourceySite({ generateOgImages: false, config: await resolveConfigFromRaw({
      ...authoring,
      components: { Steps: { parseProps: attributes => attributes, resolve: ({ children }) => ({ content: children }), renderHtml: (resolved, helpers) => `<ol class="from-config">${helpers.render(resolved.content)}</ol>` } },
    }, root) });
    const files = await sourceyArtifacts(built);
    const guide = html(files, "docs/start/index.html");
    expect(guide).toMatch(/<div class="pets-note">\s*<p>Feed them <strong>twice<\/strong> a day\.<\/p>\s*<\/div>/);
    // In a sentence, a component's children are part of the sentence.
    expect(guide).toContain('<p>A <span class="pets-badge pets-badge-new">new</span> pet.</p>');
    expect(guide).toMatch(/<div class="pets-card"><p>Cats nap\.<\/p>\s*<\/div>/);
    expect(guide).toContain('<ol class="from-config">');
    expect(guide).not.toContain("from-file");
    // The children stay the page's text, for search and its Markdown copy.
    expect(html(files, "docs/start/index.md")).toContain("Feed them **twice** a day.");
  }));

  it("names each component by its file, and reads none where the site says so", () => fixture(async root => {
    await file(root, "components/note.html", "<div><slot /></div>");
    await expect(config(root)).rejects.toThrow(/note\.html: a component's file is named for it, starting with a capital, such as Note\.html/);
    await rm(join(root, "components/note.html"));
    await file(root, "components/Footer.html", "<footer>One</footer>");
    await file(root, "components/Footer.tsx", "export default () => <footer>Two</footer>;");
    await expect(config(root)).rejects.toThrow(/Footer\.tsx: Footer\.html is already the Footer component/);
    expect((await config(root, { componentsDir: false })).pageParts).toEqual({});
    await expect(config(root, { componentsDir: "parts" })).rejects.toThrow(/componentsDir: .*parts is not a folder/);
    await file(root, "parts/Note.tsx", "export const note = 1;");
    await expect(config(root, { componentsDir: "parts" })).rejects.toThrow(/Note\.tsx: its default export is the component, a function/);
  }));

  it("redraws every page when a component or a module it imports changes", () => fixture(async root => {
    await file(root, "components/Footer.tsx", 'import { year } from "./year.ts";\nexport default () => <footer>Pets {year}</footer>;');
    await file(root, "components/year.ts", "export const year = 2025;");
    const first = await buildSourceySite({ config: await config(root), generateOgImages: false });
    expect(html(await sourceyArtifacts(first), "docs/start/index.html")).toContain("<footer>Pets 2025</footer>");
    await file(root, "components/year.ts", "export const year = 2026;");
    const second = await updateSourceySite(first, [join(root, "components/year.ts")]);
    expect(html(await sourceyArtifacts(second), "docs/start/index.html")).toContain("<footer>Pets 2026</footer>");
    await file(root, "components/Head.html", '<meta name="author" content="Pets">');
    const third = await updateSourceySite(second, [join(root, "components/Head.html")]);
    expect(html(await sourceyArtifacts(third), "docs/start/index.html")).toContain('<meta name="author" content="Pets"></head>');
  }));
});
