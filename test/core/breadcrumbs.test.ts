import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown, openapi } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-breadcrumbs-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}
const api = { openapi: "3.1.0", info: { title: "Pet API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "Pets" } } } } } };
async function pages(root: string, breadcrumbs: boolean | undefined, theme: "default" | "api-first" | "reader" = "default") {
  for (const page of ["start", "install", "install/linux", "install/docker"]) await file(root, `docs/${page}.md`, `# ${page}\n\nText.\n`);
  await file(root, "api.json", JSON.stringify(api));
  const config = await resolveConfigFromRaw({ name: "Pets", siteUrl: "https://pets.example", prettyUrls: "slash", theme: { name: theme, fonts: { google: false } }, navigation: { breadcrumbs, tabs: [
    { tab: "Guides", slug: "guides", source: markdown({ root: "docs", groups: [
      { group: "", pages: ["start"] },
      { group: "How-to guides", pages: [{ group: "How to install", href: "/guides/install/", pages: ["install", "install/linux", { group: "Containers", pages: ["install/docker"] }] }] },
    ] }) },
    { tab: "API", slug: "api", source: openapi("api.json") },
  ] } }, root);
  const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
  return (path: string) => files.get(path)!.toString();
}
const trail = (html: string) => html.match(/<nav class="sourcey-breadcrumbs[^"]*" aria-label="Breadcrumb"><ol>.*?<\/ol><\/nav>/)?.[0];

describe("breadcrumbs", () => {
  for (const theme of ["default", "api-first", "reader"] as const) it(`${theme}: lead from home through the tab and each section, linked where a section has a page`, () => fixture(async root => {
    const page = await pages(root, true, theme);
    const docker = trail(page("guides/install/docker/index.html"))!;
    expect(docker).toMatch(/^<nav class="sourcey-breadcrumbs[^"]*" aria-label="Breadcrumb"><ol><li><a href="\/guides\/start\/" aria-label="Pets"><svg class="sourcey-breadcrumbs-home"/);
    expect(docker).toContain('<li><a href="/guides/start/">Guides</a></li><li><span>How-to guides</span></li><li><a href="/guides/install/">How to install</a></li><li><span>Containers</span></li></ol>');
    // A section's own page is not a step on the way to itself.
    expect(trail(page("guides/install/index.html"))).toContain("<li><span>How-to guides</span></li></ol>");
    // A page in no named section has the tab alone.
    expect(trail(page("guides/start/index.html"))).toContain('<li><a href="/guides/start/">Guides</a></li></ol>');
    expect(trail(page("api/index.html"))).toContain('<li><a href="/api/">API</a></li></ol>');
  }));

  it("are off unless the site asks, leaving the theme's own trail", () => fixture(async root => {
    const page = await pages(root, undefined);
    expect(page("guides/install/docker/index.html")).not.toContain("sourcey-breadcrumbs");
    expect(page("guides/install/docker/index.html")).toContain(">Containers</div>");
  }));
});
