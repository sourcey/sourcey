import { describe, it, expect } from "vitest";
import { realpath, mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { defineConfig, markdown, mcp, openapi, godoc, rustdoc, defineComponent } from "../../src/index.js";
import { GODOC_SCHEMA_VERSION } from "../../src/core/godoc-types.js";
import { resolveConfigFromRaw, loadConfig } from "../../src/config.js";
import { buildSourceySite, collectSourceyWatchPaths, updateSourceySite, writeSourceySite, sourceyArtifacts } from "../../src/site.js";
import { loadMarkdownPage } from "../../src/core/markdown-loader.js";
import { rankSearch } from "../../src/core/search-query.js";
import { buildSearchArtifacts, indexSearch } from "../../src/core/search-artifacts.js";
import { loadSearchIndex } from "../../src/client/search-index.js";
import { writeArtifacts } from "../../src/renderer/writer.js";
import { openDocumentation } from "../../src/exports/document-index.js";
import { engineAsset, engineHref } from "../built-site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-compilation-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, name: string, content: string) {
  const path = join(root, name); await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, content); return path;
}
describe("native compilation", () => {
  it("builds an MCP reference from a web address, reading the document once", () => fixture(async root => {
    const document = await readFile(new URL("../fixtures/nitrosend.mcp.json", import.meta.url), "utf8");
    let reads = 0;
    const server = createServer((_request, response) => { reads++; response.setHeader("content-type", "application/json"); response.end(document); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP server");
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Tools", source: mcp(`http://127.0.0.1:${address.port}/mcp.json`) }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      expect(site.references.get("tools")!.operations.length).toBeGreaterThan(0);
      expect(reads).toBe(1);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }));

  it("shows a site's own social image on every page, from the config's folder, written and served alike", () => fixture(async root => {
    await file(root, "guide.md", "# Guide\n\nUseful content.\n");
    await file(root, "httpdocs/card.png", "card bytes");
    const config = await resolveConfigFromRaw({ ogImage: "httpdocs/card.png", theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", groups: [{ group: "Guide", pages: ["guide"] }] }] } }, root);
    const site = await buildSourceySite({ config, outputDir: join(root, "out"), copyFromSource: true });
    await writeSourceySite(site);
    expect(await readFile(join(root, "out", "_og", "static.png"), "utf8")).toBe("card bytes");
    const guide = site.pages.find(page => page.identity.document === "guide")!.outputPath;
    expect(await readFile(join(root, "out", guide), "utf8")).toMatch(/<meta property="og:image" content="[^"]*\/_og\/static\.png"/);
    const served = await sourceyArtifacts(await buildSourceySite({ config }));
    expect(served.get("_og/static.png")?.toString()).toBe("card bytes");
  }));

  it("renders system-font pages without third-party font requests in every theme", () => fixture(async root => {
    await file(root, "guide.md", "# Guide\n\nUseful content.\n");
    for (const name of ["default", "minimal", "api-first", "reader"] as const) {
      const config = await resolveConfigFromRaw({ theme: { name, fonts: { sans: "system", mono: "system" } }, navigation: { tabs: [{ tab: "Docs", groups: [{ group: "Guide", pages: ["guide"] }] }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = site.pages.find(page => page.identity.document === "guide")!;
      const html = (await sourceyArtifacts(site)).get(page.outputPath)!.toString();
      expect(html).toContain("--font-sans: ui-sans-serif, system-ui");
      expect(html).toContain("--font-mono: ui-monospace");
      expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|'system'/);
    }
  }));

  it("typesets prose with markdown.smartypants, keeping code, headings' anchors and Markdown exports as written", () => fixture(async root => {
    await file(root, "guide.md", "# Don't panic\n\n\"Stay calm\" -- it's fine...\n\n## Isn't it?\n\nRun `--load-only \"en\"` and:\n\n```sh\necho \"it's -- raw\"\n```\n");
    const build = async (smartypants: boolean) => {
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, markdown: { smartypants }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Guides", pages: ["guide"] }] }) }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = site.pages.find(page => page.identity.document === "guide")!;
      return { html: (await sourceyArtifacts(site)).get(page.outputPath)!.toString(), markdown: site.extraFiles.get("guide/index.md") ?? (await sourceyArtifacts(site)).get("guide.md")?.toString() };
    };
    const [typeset, plain] = [await build(true), await build(false)];
    const headingId = (html: string) => html.match(/<h2 id="([^"]+)"/)![1];
    expect(typeset.html).toContain("“Stay calm” — it’s fine…");
    expect(typeset.html).toContain(">Isn’t it?</h2>");
    expect(headingId(typeset.html)).toBe(headingId(plain.html));
    expect(typeset.html).toContain("<code>--load-only &quot;en&quot;</code>");
    expect(typeset.html).toMatch(/it&#39;s -- raw|it's -- raw/);
    // A title with an apostrophe is the page's one h1, typeset or not.
    for (const { html } of [typeset, plain]) expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(typeset.markdown).toContain("\"Stay calm\" -- it's fine...");
    expect(plain.html).toMatch(/&quot;Stay calm&quot; -- it&#39;s fine\.\.\.|"Stay calm" -- it's fine\.\.\./);
  }));

  it("shares frozen logo, favicon and component bytes across pages and prunes replaced hashes", () => fixture(async root => {
    const svg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><!-- brand-source-sentinel ${"x".repeat(20_000)} --><rect width="48" height="48" fill="${color}"/></svg>`;
    const light = await file(root, "logo.svg", svg("#ff0000"));
    const dark = await file(root, "dark.svg", svg("#0000ff"));
    await file(root, "guide.md", '# Guide\n\nDocumentation with <Icon icon="./logo.svg" label="Mark" />.\n');
    await file(root, "other.md", "# Other\n\nAnother page.\n");
    const config = await resolveConfigFromRaw({ baseUrl: "/project/docs", prettyUrls: "slash", theme: { name: "api-first", fonts: { google: false } }, logo: { light: "logo.svg", dark: "dark.svg" }, favicon: "logo.svg", navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Guides", pages: ["guide", "other"] }] }) }] } }, root);
    expect(collectSourceyWatchPaths(config)).toEqual(expect.arrayContaining([light, dark]));
    const cold = await buildSourceySite({ config, outputDir: join(root, "output") });
    const beforeUrl = cold.site.logo!.light!;
    expect(beforeUrl).toMatch(/^\/project\/docs\/_media\/[a-f0-9]{20}\.svg$/);
    expect(cold.site.favicon).toBe(beforeUrl);
    const beforePath = beforeUrl.replace("/project/docs/", "");
    const originalBytes = cold.extraFiles.get(beforePath);
    expect(originalBytes!.toString()).toContain("brand-source-sentinel");
    expect([...cold.extraFiles.keys()].filter(path => path.startsWith("_media/"))).toHaveLength(2);
    const files = await sourceyArtifacts(cold);
    for (const page of cold.pages) {
      const html = files.get(page.outputPath)!.toString();
      expect(html).toContain(beforeUrl);
      expect(html).not.toMatch(/brand-source-sentinel|data:image/);
      expect(html).toContain(cold.site.logo!.dark!);
    }
    const { default: sharp } = await import("sharp");
    const card = cold.pages.find(page => page.ogImagePath)!.ogImagePath!;
    const png = files.get(card) as Buffer;
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    // The social image is dark, so it draws the logo the site shows in dark mode.
    const pixels = await sharp(png).extract({ left: 80, top: 80, width: 24, height: 24 }).removeAlpha().raw().toBuffer();
    expect(pixels[0]).toBeLessThan(20);
    expect(pixels[1]).toBeLessThan(20);
    expect(pixels[2]).toBeGreaterThan(240);
    await writeSourceySite(cold);
    const untouched = await updateSourceySite(cold, []);
    expect(untouched.site.logo!.light).toBe(beforeUrl);
    await writeFile(light, svg("#00ff00"));
    const edited = await updateSourceySite(cold, [light]);
    expect(edited.site.logo!.light).not.toBe(beforeUrl);
    expect(edited.site.logo!.dark).toBe(cold.site.logo!.dark);
    expect(edited.extraFiles.has(beforePath)).toBe(false);
    expect(cold.extraFiles.get(beforePath)).toEqual(originalBytes);
    const editedFiles = await sourceyArtifacts(edited);
    const guide = edited.pages.find(page => page.identity.document === "guide")!;
    expect(editedFiles.get(guide.outputPath)!.toString()).toContain(edited.site.logo!.light!);
    expect(editedFiles.get(guide.outputPath)!.toString()).not.toContain(beforeUrl);
    await writeSourceySite(edited);
    await expect(stat(join(cold.outputDir, beforePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(cold.outputDir, edited.site.logo!.light!.replace("/project/docs/", "")))).toEqual(Buffer.from(svg("#00ff00")));
    const reader = await resolveConfigFromRaw({ ...config.authoring, theme: { name: "reader", fonts: { google: false } } }, root);
    const readerSite = await buildSourceySite({ config: reader, generateOgImages: false });
    expect(readerSite.site.logo).toEqual(edited.site.logo);
    expect((await sourceyArtifacts(readerSite)).get(guide.outputPath)!.toString()).not.toContain("data:image");
  }));

  it("keeps agent instructions in machine exports without changing human metadata, search or anchors", () => fixture(async root => {
    const guide = await file(root, "guide.md", '<ForAgents>\n# Machine title\n\nAgentExclusiveToken. Read [the detail](other.md).\n\n## Installation\n\nMachine instructions.\n\n## Hidden target\n</ForAgents>\n\n# Human guide\n\nA useful description for the person reading.\n\n## Installation\n\nFollow [the detail](other.md).\n');
    await file(root, "other.md", "# Other detail\n\nMore information.\n");
    const config = await resolveConfigFromRaw({ baseUrl: "/docs", prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Guides", pages: ["guide", "other"] }] }) }] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const page = first.pages.find(page => page.identity.document === "guide")!;
    if (page.currentPage.kind !== "markdown") throw new Error("Expected Markdown");
    const document = page.currentPage.markdown;
    expect(document.title).toBe("Human guide");
    expect(document.description).toBe("A useful description for the person reading.");
    expect(document.html).not.toMatch(/AgentExclusiveToken|Machine title|Machine instructions|Hidden target/);
    expect(document.headings).toEqual([{ level: 2, text: "Installation", id: "installation" }]);
    expect(first.assembly.routes.byOutputPath.get(page.outputPath)!.anchors.has("hidden-target")).toBe(false);
    expect(JSON.stringify(first.searchRows)).not.toMatch(/AgentExclusiveToken|Machine title|Machine instructions|Hidden target/);
    const readerLink = document.readerMarkdown!.match(/\[the detail\]\(([^)]+)\)/)![1];
    expect(new URL(readerLink, `https://docs.example.test${page.publicPath}`).pathname).toBe("/docs/other/");
    expect(document.markdown).toContain("AgentExclusiveToken");
    expect(first.extraFiles.get("guide/index.md")?.toString()).toContain("AgentExclusiveToken");
    expect(first.llmsFullTxt).toContain("AgentExclusiveToken");
    expect(first.extraFiles.get("documents.json")?.toString()).toContain("AgentExclusiveToken");
    await writeFile(guide, "# Human guide\n\nA useful description for the person reading.\n\n## Installation\n\nUpdated instructions.\n");
    const edited = await updateSourceySite(first, [guide]);
    const next = edited.pages.find(page => page.identity.document === "guide")!.currentPage;
    if (next.kind !== "markdown") throw new Error("Expected Markdown");
    expect(next.markdown.readerMarkdown).toBeUndefined();
    expect(edited.llmsFullTxt).not.toContain("AgentExclusiveToken");
    expect(document.markdown).toContain("AgentExclusiveToken");
  }));

  it("resolves the export's links where its content holds them: in prose, headings, cards, callout titles and by a definition elsewhere on the page", () => fixture(async root => {
    await file(root, "guide.md", [
      "# Guide", "",
      "Read [the detail][detail] first.", "",
      '<Note title="See [the other page](other.md)">', "Inside a callout.", "</Note>", "",
      "## Using [other](other.md)", "",
      '<Card title="Other" href="other.md">', "A card.", "</Card>", "",
      "Plain prose, `[not a link](other.md)` in code.", "",
      "[detail]: other.md", "",
    ].join("\n"));
    await file(root, "other.md", "# Other detail\n\nMore information.\n");
    const config = await resolveConfigFromRaw({ baseUrl: "/docs", prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Guides", pages: ["guide", "other"] }] }) }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const page = site.pages.find(page => page.identity.document === "guide")!;
    if (page.currentPage.kind !== "markdown") throw new Error("Expected Markdown");
    const exported = page.currentPage.markdown.markdown;
    expect(exported).toContain("Read [the detail](/docs/other/) first.");
    expect(exported).toContain("**See [the other page](/docs/other/)**");
    expect(exported).toContain("## Using [other](/docs/other/) {#using-other}");
    expect(exported).toContain("**[Other](/docs/other/)**");
    expect(exported).toContain("`[not a link](other.md)` in code.");
    expect(page.currentPage.markdown.html).toContain('href="/docs/other/"');
  }));

  it("retains refused diagram source and exposes its warning through cold and incremental builds", () => fixture(async root => {
    const source = "# Workflow\n\n```mermaid\ngitGraph\n  commit\n  branch develop\n```\n";
    const guide = await file(root, "workflow.md", source);
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Guides", pages: ["workflow"] }] }) }] } }, root);
    const cold = await buildSourceySite({ config, generateOgImages: false });
    expect(cold.contentDiagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "diagram", file: await realpath(guide), message: expect.stringContaining('Unsupported diagram type: "gitgraph"') })]);
    const page = cold.pages.find(page => page.identity.document === "workflow")!.currentPage;
    if (page.kind !== "markdown") throw new Error("Expected a Markdown page");
    expect(page.markdown.html).toContain('class="sourcey-diagram sourcey-diagram-unrendered"');
    expect(page.markdown.html).not.toContain("<picture");
    expect(JSON.stringify(cold.searchRows)).toContain("branch develop");
    expect(cold.extraFiles.get("workflow.md")?.toString()).toContain("```mermaid\ngitGraph");
    const unchanged = await updateSourceySite(cold, []);
    expect(unchanged.contentDiagnostics).toEqual(cold.contentDiagnostics);
    await writeFile(guide, "# Workflow\n\nThe diagram was replaced by a description.\n");
    const edited = await updateSourceySite(unchanged, [guide]);
    expect(edited.contentDiagnostics).toEqual([]);
    expect(cold.contentDiagnostics).toHaveLength(1);
  }));

  it("counts the anchors a generated reference page draws, so its section links are not reported missing", () => fixture(async root => {
    const config = await resolveConfigFromRaw({ siteUrl: "https://docs.example.com", theme: { fonts: { google: false } }, navigation: { tabs: [
      { tab: "Rust", slug: "", source: rustdoc({ manifest: new URL("../fixtures/rustdoc/basic/Cargo.toml", import.meta.url).pathname, mode: "snapshot", snapshot: new URL("../fixtures/rustdoc/basic/snapshots/rustdoc.json", import.meta.url).pathname }) },
    ] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const module = site.pages.find(page => page.outputPath === "pkg-basic-basic.html")!;
    expect(module.currentPage.kind === "markdown" && module.currentPage.markdown.html).toMatch(/href="#[a-z]+"/);
    expect(site.siteDiagnostics.filter(diagnostic => diagnostic.code === "broken-fragment")).toEqual([]);
  }));

  it("shares immutable Go/Rust snapshot output across edits and invalidates changed snapshot bytes", () => fixture(async root => {
    const guide = await file(root, "guide.md", "# Guide\n\nFirst article.\n");
    const goData = { schema_version: GODOC_SCHEMA_VERSION, source: "sourcey-godoc", module_path: "example.test/fixture", generated_at: "2026-05-04T00:00:00Z", packages: [{ importPath: "example.test/fixture", name: "fixture", synopsis: "First Go snapshot.", doc: "First Go snapshot.", dir: ".", files: [], consts: [], vars: [], funcs: [], types: [], examples: [] }] };
    const goSnapshot = await file(root, "go.json", JSON.stringify(goData));
    const rustData = JSON.parse(await readFile(new URL("../fixtures/rustdoc/basic/snapshots/rustdoc.json", import.meta.url), "utf8"));
    const rustSnapshot = await file(root, "rust.json", JSON.stringify(rustData));
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [
      { tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["guide"] }] },
      { tab: "Go", slug: "go", source: godoc({ module: root, mode: "snapshot", snapshot: "go.json" }) },
      { tab: "Rust", slug: "rust", source: rustdoc({ manifest: new URL("../fixtures/rustdoc/basic/Cargo.toml", import.meta.url).pathname, mode: "snapshot", snapshot: "rust.json" }) },
    ] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const rustPage = first.pages.find(page => page.outputPath === "rust/pkg-basic-basic.html")!;
    await writeFile(guide, "# Guide\n\nEdited article.\n");
    const articleEdit = await updateSourceySite(first, [guide]);
    const unchanged = articleEdit.pages.find(page => page.outputPath === rustPage.outputPath)!;
    expect(unchanged.currentPage.kind === "markdown" && rustPage.currentPage.kind === "markdown" && unchanged.currentPage.markdown === rustPage.currentPage.markdown).toBe(true);
    goData.packages[0].doc = "Updated Go snapshot.";
    rustData.crates[0].modules[0].docs_markdown = "Updated Rust snapshot.";
    await writeFile(goSnapshot, JSON.stringify(goData));
    await writeFile(rustSnapshot, JSON.stringify(rustData));
    const edited = await updateSourceySite(articleEdit, [goSnapshot, rustSnapshot]);
    expect(JSON.stringify(edited.searchRows)).toContain("Updated Go snapshot.");
    expect(JSON.stringify(edited.searchRows)).toContain("Updated Rust snapshot.");
    expect(JSON.stringify(first.searchRows)).not.toContain("Updated Go snapshot.");
    expect(JSON.stringify(first.searchRows)).not.toContain("Updated Rust snapshot.");
  }));

  it("retains dotted page references, GitHub alert titles and media after an unmatched inline backtick", () => fixture(async root => {
    await file(root, "img.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await file(root, "versions/3.6-3.7.md", '# Upgrade\n\nAn unmatched `backtick here.\n\n![Original diagram](../img.svg)\n\nLater `code` span.\n\n> [!IMPORTANT]\n> Keep the exact warning.\n\n> [!NOTE] Custom title\n> This stays a plain quote.\n');
    const config = await resolveConfigFromRaw({ navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Versions", pages: ["versions/3.6-3.7"] }] }) }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const page = site.pages.find(page => page.outputPath === "versions/3.6-3.7.html")!.currentPage;
    if (page.kind !== "markdown") throw new Error("Expected markdown");
    expect(page.markdown.html).toMatch(/src="\/_media\/[a-f0-9]+\.svg"/);
    expect(page.markdown.html).toContain('class="callout-title">Important</div>');
    expect(page.markdown.html).toContain("[!NOTE] Custom title");
    expect(page.markdown.html).toContain("This stays a plain quote.");
    expect(page.markdown.html.match(/role="note"/g)).toHaveLength(1);
    expect(page.markdown.markdown).toContain("Later `code` span.");
  }));

  it("keeps config-relative source links, revision-correct edits and unchanged link projections", () => fixture(async root => {
    const guide = await file(root, "docs/guide.md", "# Guide\n\n[Implementation](../src/index.ts)\n");
    await file(root, "docs/second.md", "# Second\n\n[Guide](guide.md)\n");
    await file(root, "archive/docs/guide.md", "# Guide\n\n[Implementation](../src/index.ts)\n");
    await file(root, "archive/docs/second.md", "# Second\n\n[Guide](guide.md)\n");
    const config = await resolveConfigFromRaw({ repo: "https://github.com/example/project", editBranch: "main", theme: { fonts: { google: false } },
      versions: { default: "current", items: [{ id: "current", label: "Current", content: "." }, { id: "archive", label: "Archive", content: "archive", path: "archive", revision: "release-tag" }] },
      navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["guide", "second"] }] }) }] },
    }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const archived = first.pages.find(page => page.outputPath === "archive/guide.html")!;
    expect(archived.currentPage.kind === "markdown" && archived.currentPage.markdown.sourcePath).toBe("archive/docs/guide.md");
    const files = await sourceyArtifacts(first);
    expect(files.get("guide.html")!.toString()).toContain("https://github.com/example/project/edit/main/docs/guide.md");
    expect(files.get("archive/guide.html")!.toString()).toContain("https://github.com/example/project/edit/release-tag/docs/guide.md");
    expect(files.get("archive/guide.html")!.toString()).toContain("https://github.com/example/project/tree/release-tag/src/index.ts");
    const second = first.pages.find(page => page.outputPath === "second.html")!.currentPage;
    await writeFile(guide, "# Guide\n\nChanged body.\n");
    const next = await updateSourceySite(first, [guide]);
    const unchanged = next.pages.find(page => page.outputPath === "second.html")!.currentPage;
    expect(unchanged.kind === "markdown" && second.kind === "markdown" && unchanged.markdown === second.markdown).toBe(true);
    expect(files.get("guide.html")!.toString()).toContain("Implementation");
    expect((await sourceyArtifacts(next)).get("guide.html")!.toString()).toContain("Changed body.");
    expect(next.assembly.routes.match("/archive/guide.html")?.page).toBeDefined();
  }));

  it("matches encoded Unicode routes without decoding a path separator into another route", () => fixture(async root => {
    await file(root, "guide.md", "---\nslug: café/日本語\n---\n# Guide\n");
    const config = await resolveConfigFromRaw({ navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["guide"] }] }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    expect(site.assembly.routes.match("/caf%C3%A9/%E6%97%A5%E6%9C%AC%E8%AA%9E.html")?.outputPath).toBe("café/日本語.html");
    expect(site.assembly.routes.match("/café%2F日本語.html")).toBeUndefined();
    expect(site.assembly.routes.match("/%not-a-valid-escape")).toBeUndefined();
  }));

  it("compiles redirects once and emits exact standalone fallbacks without indexing them", () => fixture(async root => {
    await file(root, "guide.md", "# Guide\n\n## Install\n\nFollow the instructions.\n");
    const raw = { baseUrl: "/manual", prettyUrls: "slash" as const, theme: { fonts: { google: false as const } }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["guide"] }] }] } };
    const config = await resolveConfigFromRaw({ ...raw, redirects: { "/manual/old": "/manual/guide/#install", "/manual/earlier.html": { to: "/manual/old?from=archive", status: 302 } } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    // Both, and the root, which no page publishes.
    expect(site.assembly.routes.redirects.size).toBe(3);
    expect(site.assembly.routes.redirectFor("/manual/")).toMatchObject({ to: "/manual/guide/", status: 302 });
    const files = await sourceyArtifacts(site);
    const html = files.get("old/index.html")!.toString();
    expect(html).toContain('href="/manual/guide/#install"');
    expect(html).toContain('name="robots" content="noindex"');
    expect(files.get("_redirects")).toBe("/manual/old /manual/guide/#install 301\n/manual/earlier.html /manual/old?from=archive 302\n/manual/ /manual/guide/ 302\n");
    expect(files.get("earlier.html")).toBeDefined();
    expect(JSON.stringify(site.searchRows)).not.toContain("earlier");
    expect(files.get("sitemap.xml")).not.toContain("/old");
    for (const redirects of [
      { "/manual/guide/": "/manual/old" },
      { "/manual/old": "/manual/missing/" },
      { "/manual/old": "/manual/guide/#missing" },
      { "/manual/old": "/manual/earlier?x=1", "/manual/earlier": "/manual/old#install" },
      { "/outside": "/manual/guide/" },
    ]) await expect(buildSourceySite({ config: await resolveConfigFromRaw({ ...raw, redirects }, root), generateOgImages: false })).rejects.toThrow(/Redirect|redirect/);
  }));

  it("keeps article pagination across branches that the bounded sidebar omits", () => fixture(async root => {
    // An authored tree is shown whole up to 400 pages; past that, only the branch around the page.
    const names = Array.from({ length: 402 }, (_, index) => `page-${index}`);
    await Promise.all(names.map((name, index) => file(root, `${name}.md`, `# Guide ${index}\n\nA complete article.\n`)));
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "First", pages: names.slice(0, 201) }, { group: "Second", pages: names.slice(201) }] }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const html = (await sourceyArtifacts(site)).get("page-200.html")!.toString();
    expect(html).toContain('href="/page-201.html"');
    expect(html).toContain("Guide 201");
    expect(html).not.toContain("Guide 401");
    // Its section pages are composed from navigation, with no source to give them a summary.
    expect(site.pages.some(page => page.outputPath.startsWith("_sections/"))).toBe(true);
    expect(site.siteDiagnostics.filter(diagnostic => diagnostic.page?.includes("_sections"))).toEqual([]);
  }));

  it("keeps inline components in sentences and table cells and publishes the explicit public asset closure", () => fixture(async root => {
    await file(root, "index.md", '# Reference\n\nUse <Badge text="stable" /> with care.\n\n| Runtime | Support |\n| --- | --- |\n| v8 | ✔ <Badge text="limited" /> |\n\n<picture><source srcset="./small.svg 1x, ./large.svg 2x"><img src="./small.svg" srcset="./large.svg 2x" alt="Architecture"></picture>\n\n[Download](/files/manual.pdf)\n');
    await file(root, "small.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await file(root, "large.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="2"/>');
    const asset = await file(root, "public/files/manual.pdf", "original manual bytes");
    await file(root, "public/.well-known/proof.txt", "public declaration");
    const config = await resolveConfigFromRaw({ publicDir: "public", theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["index"] }] }] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const files = await sourceyArtifacts(first);
    const html = files.get("index.html")!.toString();
    expect(html).toMatch(/href="\/" class="nav-link active" aria-current="page"/);
    expect(html).toContain('<p>Use <span class="sourcey-badge"><strong>stable</strong></span> with care.</p>');
    expect(html).toContain('<td>✔ <span class="sourcey-badge"><strong>limited</strong></span></td>');
    expect(html).toMatch(/srcset="\/_media\/[a-f0-9]+\.svg 1x, \/_media\/[a-f0-9]+\.svg 2x"/);
    expect(files.get("files/manual.pdf")!.toString()).toBe("original manual bytes");
    expect(files.get(".well-known/proof.txt")!.toString()).toBe("public declaration");
    await writeFile(asset, "updated manual bytes");
    const edited = await updateSourceySite(first, [asset]);
    expect((await sourceyArtifacts(edited)).get("files/manual.pdf")!.toString()).toBe("updated manual bytes");
    expect(files.get("files/manual.pdf")!.toString()).toBe("original manual bytes");
    await file(root, "public/index.html", "route collision");
    await expect(sourceyArtifacts(await updateSourceySite(edited, [join(root, "public/index.html")]))).rejects.toThrow("Output collision");
  }));

  it("places imported API fragments at their real sections in every theme", () => fixture(async root => {
    await file(root, "spec.json", JSON.stringify({ openapi: "3.1.0", info: { title: "API", version: "fixture" }, paths: { "/translate": { post: { operationId: "translate", requestBody: { content: { "application/json": { schema: { type: "object", properties: { q: { type: "string", example: "Hello" } } } } } }, responses: { "200": { description: "Translation", headers: { "X-Limit": { description: "Remaining translations", schema: { type: "integer", example: 0 } } }, content: { "application/json": { schema: { type: "array", items: { description: "Supported language", type: "object", properties: { enabled: { type: "boolean", description: "Whether translation is available", example: false }, settings: { description: "Frontend settings", oneOf: [{ type: "object", properties: { timeout: { type: "integer", example: 0 } } }, { type: "null" }] } } } } } } }, "400": { description: "Invalid request" } } } } } }));
    for (const theme of ["default", "minimal", "reader", "api-first"] as const) {
      const config = await resolveConfigFromRaw({ theme: { name: theme, fonts: { google: false } }, navigation: { tabs: [{ tab: "API", slug: "api", source: openapi("spec.json"), reference: { split: "operations", operations: "operations/{operationId}" }, anchors: { introduction: { overview: "introduction" }, "POST /translate": { parameters: "request-body", "formdata-parameters": "request-body", "200": "response-200" } } }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const route = site.assembly.routes.byPath.get("/api/operations/translate.html")!;
      expect([...route.anchors]).toEqual(expect.arrayContaining(["request-body", "parameters", "formdata-parameters", "responses", "response-200", "200"]));
      const files = await sourceyArtifacts(site);
      const html = files.get(route.outputPath)!.toString();
      expect(html).toMatch(/id="request-body"[^>]*><span[^>]*id="parameters"[^>]*><\/span><span[^>]*id="formdata-parameters"/);
      expect(html).toMatch(/id="response-200"><span[^>]*id="200"[^>]*aria-hidden="true"/);
      for (const detail of ["Remaining translations", "Supported language", "Frontend settings", "Whether translation is available", "false"]) expect(html).toContain(detail);
      expect(html).toMatch(/schema-expandable-toggle"><svg[^>]*schema-expandable-icon/);
      const overview = site.pages.find(page => page.currentPage.kind === "spec" && page.currentPage.view?.kind === "overview")!;
      expect(files.get(overview.outputPath)!.toString()).toContain('id="overview"');
    }
  }));

  it("frames a split reference's pages as each theme frames a guide", () => fixture(async root => {
    const responses = { "200": { description: "OK" } };
    await file(root, "spec.json", JSON.stringify({ openapi: "3.2.0", info: { title: "Pets API", version: "1", description: "Welcome.\n\n## Rate limits\n\nTen a second.\n\n## Errors\n\nAs JSON." },
      tags: [{ name: "Pets" }, { name: "Toys", parent: "Pets" }, { name: "Stores" }], security: [{ key: [] }],
      components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } }, schemas: { Pet: { type: "object", properties: { name: { type: "string" } } } } },
      paths: { "/pets": { get: { operationId: "listPets", summary: "List pets", description: "Every pet.", tags: ["Pets"], parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }], responses }, post: { operationId: "addPet", summary: "Add a pet", tags: ["Pets"], responses } },
        "/toys": { get: { operationId: "listToys", summary: "List toys", tags: ["Toys"], responses } },
        "/stores": { get: { operationId: "listStores", summary: "List stores", tags: ["Stores"], responses } } } }));
    for (const theme of ["default", "minimal", "reader", "api-first"] as const) {
      const config = await resolveConfigFromRaw({ theme: { name: theme, fonts: { google: false } }, navigation: { tabs: [{ tab: "API", slug: "api", source: openapi("spec.json"), reference: { split: "operations" } }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const files = await sourceyArtifacts(site);
      const main = (document: string) => {
        const html = files.get(site.pages.find(page => page.identity.document === document)!.outputPath)!.toString();
        return html.slice(html.indexOf("<main"));
      };
      const operation = main("GET /pets");
      // Its section over its title, previous and next, and the theme's own footer.
      expect(operation.indexOf(">Pets<")).toBeGreaterThan(-1);
      expect(operation.indexOf(">Pets<")).toBeLessThan(operation.indexOf("reference-page-title"));
      expect(operation).toMatch(/href="[^"#]*"[^>]*>[^]*?Introduction[^]*?Add a pet/);
      if (theme === "reader") expect(operation).toMatch(/class="doc-breadcrumb"><span>API<\/span><svg[^]*?<\/svg><span>Pets<\/span>/);
      expect(operation.includes('class="doc-footer"')).toBe(theme === "reader");
      expect(operation.includes("mt-16 mb-8")).toBe(theme !== "reader");
      // The description, then the examples, then the fields.
      const order = (theme === "api-first" ? ["operation-split-intro", "operation-split-examples", "operation-split-content"] : ["operation-intro", "sourcey-operation-examples", "operation-details"]).map(name => operation.indexOf(`class="${name}"`));
      expect(order.every(position => position > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // The overview's contents list its introduction's own headings, where the theme has a
      // contents column; its sections, authentication and models are the sidebar's to list.
      const overview = main("introduction");
      const contents = overview.slice(overview.search(/id="toc"|class="docs-toc"/));
      if (theme === "minimal") expect(overview).not.toMatch(/id="toc"/);
      else {
        for (const label of ["Rate limits", "Errors"]) expect(contents).toContain(`>${label}</a>`);
        for (const label of ["Authentication", "Pets", "Toys", "Stores", "Models"]) expect(contents.slice(0, contents.search(/<\/aside>/))).not.toContain(`>${label}</a>`);
      }
      expect(main("schema:Pet").match(/sourcey-operation-examples/g)).toHaveLength(1);
    }
  }));

  it("names the page's tab before the page in the phone row, where the site has several", () => fixture(async root => {
    await file(root, "docs/install.md", "# Install\n\nRun it.\n");
    await file(root, "spec.json", JSON.stringify({ openapi: "3.1.0", info: { title: "Pets API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "OK" } } } } } }));
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [
      { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["install"] }] }) },
      { tab: "API", slug: "api", source: openapi("spec.json") },
    ] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const files = await sourceyArtifacts(site);
    const trail = (path: string) => { const html = files.get(path)!.toString(); return html.slice(html.indexOf('class="sourcey-mobile-trail"'), html.indexOf('class="sourcey-section-tabs"')); };
    expect(trail("install.html")).toMatch(/<span>Docs<\/span><svg[^]*?<\/svg><\/span><span[^>]*>Install<\/span>/);
    expect(trail("api.html")).toMatch(/<span>API<\/span><svg[^]*?<\/svg><\/span><span[^>]*>Introduction<\/span>/);
    // A missing page is in no tab.
    expect(trail("404.html")).not.toContain("<span>Docs</span>");
  }));

  it("links the code-language icons only from pages that draw code samples, outside the shared stylesheet", () => fixture(async root => {
    await file(root, "docs/install.md", "# Install\n\nRun it.\n");
    await file(root, "spec.json", JSON.stringify({ openapi: "3.1.0", info: { title: "Pets API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "OK" } } } } } }));
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [
      { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["install"] }] }) },
      { tab: "API", slug: "api", source: openapi("spec.json") },
    ] } }, root);
    const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
    const html = (path: string) => files.get(path)!.toString();
    expect(engineHref(html("install.html"), "sourcey-lang-icons.css")).toBeUndefined();
    const icons = engineHref(html("api.html"), "sourcey-lang-icons.css")!;
    expect(files.get(icons.slice(1))!.toString()).toContain('[data-lang="python"]');
    expect(files.get(engineHref(html("install.html"), "sourcey.css")!.slice(1))!.toString()).not.toContain("M49.33%2062h29.159");
  }));

  it("defines every custom property each theme's stylesheet reads", () => fixture(async root => {
    await file(root, "docs/install.md", "# Install\n\nRun it.\n");
    const undefinedByTheme: Record<string, string[]> = {};
    const notChannels: Record<string, string[]> = {};
    for (const name of ["default", "minimal", "api-first", "reader"] as const) {
      const config = await resolveConfigFromRaw({ theme: { name, fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["install"] }] }) }] } }, root);
      const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
      const page = files.get("install.html")!.toString();
      const css = files.get(engineHref(page, "sourcey.css")!.slice(1))!.toString();
      // A colour that reads an undefined property is invalid, and the rule silently draws nothing.
      // Highlighted code sets its own token colours on each token.
      const values = new Map<string, string[]>();
      for (const [, property, value] of `${css}\n${page}`.matchAll(/(--[\w-]+)\s*:\s*([^;}]*)/g)) values.set(property, [...values.get(property) ?? [], value.trim()]);
      const read = [...new Set([...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map(([, property]) => property))];
      undefinedByTheme[name] = read.filter(property => !values.has(property) && !property.startsWith("--shiki-"));
      // rgb() takes Sourcey's channel triplets; a full colour such as an oklch() palette step inside it is just as invalid.
      const channels = [...new Set([...css.matchAll(/rgb\(var\((--[\w-]+)\)/g)].map(([, property]) => property))];
      notChannels[name] = channels.filter(property => (values.get(property) ?? []).some(value => !/^\d{1,3} \d{1,3} \d{1,3}$/.test(value)));
    }
    expect(undefinedByTheme).toEqual({ default: [], minimal: [], "api-first": [], reader: [] });
    expect(notChannels).toEqual({ default: [], minimal: [], "api-first": [], reader: [] });
  }));

  it("keeps a section's own link beside its toggle, and names a picker by what it shows", () => fixture(async root => {
    await file(root, "index.md", "# Start\n\nHello.\n");
    await file(root, "install.md", "# Install\n\nRun it.\n");
    await file(root, "archive/index.md", "# Start\n\nBefore.\n");
    await file(root, "archive/install.md", "# Install\n\nRan it.\n");
    for (const theme of ["default", "reader"] as const) {
      const config = await resolveConfigFromRaw({
        theme: { name: theme, fonts: { google: false } },
        versions: { default: "current", items: [{ id: "current", label: "Current", content: ".", path: "" }, { id: "archive", label: "Archive", content: "archive", path: "archive" }] },
        navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Start", id: "start", href: "/", collapsed: false, pages: [{ page: "index", hidden: true }, "install"] }] }) }] },
      }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = (await sourceyArtifacts(site)).get("install.html")!.toString();
      // A summary is a control of its own, so the section's link is beside it, and the toggle is named for the section.
      expect(page).toMatch(/<div class="sourcey-nav-group-linked"><a [^>]*href="\/"[^>]*>Start<\/a><details (?:open class="sourcey-nav-group"|class="sourcey-nav-group" open)><summary (?:class="nav-section" )?aria-label="Start"><\/summary>/);
      expect(page).not.toMatch(/<summary[^>]*>(?:(?!<\/summary>)[^])*<a /);
      // The version picker is named by its label and the version it shows.
      expect(page).toMatch(/<summary><span class="sr-only">Version: <\/span><span>Current<\/span>/);
    }
  }));

  it("gives assistive technology named landmarks, ordered headings and reachable examples in every theme", () => fixture(async root => {
    await file(root, "docs/install.md", "# Install\n\nRun it.\n\n> [!NOTE]\n> Twice.\n\n## Requirements\n\n| | Version |\n| --- | --- |\n| Node | 22 |\n\n## Upgrade\n\nAgain.\n");
    await file(root, "spec.json", JSON.stringify({ openapi: "3.1.0", info: { title: "Pets API", version: "1" }, paths: { "/pets": { get: { operationId: "listPets", summary: "List pets",
      parameters: [{ name: "limit", in: "query", schema: { type: "integer", example: 20 } }],
      responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { name: { type: "string", example: "Rex" } } } } } } } } } } }));
    const navs = (html: string) => [...html.matchAll(/<nav\b([^>]*)>/g)].map(([, attributes]) => attributes).filter(attributes => !/\shidden\b/.test(attributes));
    const levels = (html: string) => [...html.slice(html.indexOf("<body")).matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));
    for (const theme of ["default", "minimal", "api-first", "reader"] as const) for (const split of [true, false]) {
      const config = await resolveConfigFromRaw({ theme: { name: theme, fonts: { google: false } }, navigation: { tabs: [
        { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["install"] }] }) },
        { tab: "API", slug: "api", source: openapi("spec.json"), ...(split ? { reference: { split: "operations" as const } } : {}) },
      ] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const files = await sourceyArtifacts(site);
      const html = (document: string) => files.get(site.pages.find(page => page.identity.document === document)!.outputPath)!.toString();
      for (const page of [html("install"), html(split ? "GET /pets" : "introduction")]) {
        // The masthead is the page's banner, and each navigation on show has a name of its own; none is empty.
        expect(page).toMatch(theme === "reader" ? /<header class="site-header"/ : /<header id="navbar"/);
        const names = navs(page).map(attributes => attributes.match(/aria-label(?:ledby)?="([^"]*)"/)?.[1]);
        expect(names.every(Boolean), `${theme}: ${navs(page).join(" | ")}`).toBe(true);
        expect(new Set(names).size).toBe(names.length);
        expect(page).not.toMatch(/<nav\b[^>]*>\s*<ul[^>]*>\s*<\/ul>\s*<\/nav>/);
        // Headings never skip a level on the way down.
        const order = levels(page);
        expect(order.every((level, i) => i === 0 || level <= order[i - 1] + 1), `${theme}: ${order.join(",")}`).toBe(true);
      }
      const operation = html(split ? "GET /pets" : "introduction");
      // An operation's sections sit one level below its title: h2 on its own page, h3 under its h2 in a listing.
      expect(operation).toMatch(split ? /<h2 class="flex-1[^>]*>Parameters<\/h2>/ : /<h3 class="flex-1[^>]*>Parameters<\/h3>/);
      // A scrolling example can be reached from the keyboard to scroll it.
      expect(operation).toContain('<span class="schema-example-label">Example</span><pre tabindex="0"><code>Rex</code></pre>');
      if (theme !== "reader") {
        // The search control is named by the placeholder it shows; its shortcut is announced, not read as text.
        expect(operation).toMatch(/<button id="search-open" type="button" aria-keyshortcuts="\/" class=/);
        expect(operation).toContain('<kbd aria-hidden="true">/</kbd>');
      }
      // "On this page" labels the contents navigation rather than heading the page.
      const guide = html("install");
      // A callout is a note in the page's content, not a landmark beside it, and a wide table scrolls under the keyboard.
      expect(guide).toMatch(/<div class="callout callout-note not-prose" role="note">/);
      expect(guide).toContain('<div class="table-wrap" tabindex="0"><table>');
      // A header row's empty corner is a plain cell, not a header that names nothing.
      expect(guide).toContain("<thead><tr><td></td><th>Version</th></tr></thead>");
      if (theme !== "minimal" && theme !== "reader") expect(guide).toMatch(/<p id="sourcey-toc-label"[^>]*>[^]*?On this page<\/p><nav aria-labelledby="sourcey-toc-label">/);
      if (theme === "reader") expect(guide).toMatch(/<aside class="docs-sidebar-region" aria-label="Docs"><details open class="docs-sidebar" data-reader-chapters/);
    }
    // Landmark names follow the site's language.
    await file(root, "docs/configure.md", "# Configure\n\nSet it.\n");
    const french = await resolveConfigFromRaw({ i18n: { defaultLocale: "fr", locales: { fr: { label: "Français" } } }, theme: { fonts: { google: false } }, navigation: { tabs: [
      { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["install", "configure"] }] }) },
      { tab: "API", slug: "api", source: openapi("spec.json") },
    ] } }, root);
    const site = await buildSourceySite({ config: french, generateOgImages: false });
    const page = (await sourceyArtifacts(site)).get(site.pages.find(page => page.identity.document === "install")!.outputPath)!.toString();
    expect(page).toContain('aria-label="Sections de la documentation"');
    expect(page).toContain('aria-label="Page précédente et page suivante"');
  }));

  it("keeps IDs, authored slugs, sparse translations, archives and canonical exports in agreement", () => fixture(async root => {
    await file(root, "guide.md", "---\nid: install\nslug: setup\ntitle: Install\n---\n\n## Details {#stable-heading}\n\nThe marmalade is in the full body.\n");
    await file(root, "fr/guide.md", "---\nid: install\nslug: installation\ntitle: Installer\n---\n\n## Détails\n\nBonjour.\n");
    await file(root, "second.md", "# Second\n\nFallback content.\n");
    await file(root, "archive/guide.md", "# Original guide\n\nOriginal content.\n");
    await file(root, "archive/second.md", "# Original second\n");
    const config = await resolveConfigFromRaw(defineConfig({ name: "Fixture", siteUrl: "https://docs.example.org", prettyUrls: "slash", theme: { fonts: { google: false } },
      i18n: { defaultLocale: "en", locales: { en: { label: "English" }, fr: { label: "Français", messages: { navigation: { Docs: "Guides" } } } } },
      versions: { default: "current", items: [{ id: "current", label: "Current", content: ".", path: "" }, { id: "archive", label: "Archive", content: "archive", path: "archive", status: "archived", index: false }] },
      navigation: { tabs: [{ tab: "Docs", id: "docs", slug: "", source: markdown({ groups: [{ group: "Start", pages: ["guide", "second"] }] }) }] },
    }), root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    expect(site.pages.filter(page => page.currentPage.kind !== "not-found")).toHaveLength(8);
    expect(site.assembly.routes.byPath.get("/404")?.status).toBe(404);
    expect(site.assembly.routes.byPath.has("/setup/")).toBe(true);
    const translated = site.assembly.routes.byPath.get("/fr/installation/")!;
    expect(translated.page.identity.document).toBe("install");
    expect(translated.page.navigation?.tabs[0].label).toBe("Guides");
    const fallback = site.assembly.routes.byPath.get("/fr/second/")!;
    expect(fallback.canonical).toBe("/second/"); expect(fallback.index).toBe(false);
    const html = (await sourceyArtifacts(site)).get("setup/index.html")!.toString();
    expect(html).toContain('id="stable-heading"'); expect(html).toContain('hreflang="fr"');
    const fallbackHtml = (await sourceyArtifacts(site)).get("fr/second/index.html")!.toString();
    expect(fallbackHtml).toContain("Français"); expect(fallbackHtml).toContain("n’est pas encore traduite");
    expect(fallbackHtml).not.toContain('hreflang="fr"');
    expect(site.searchRows.some((entry: {searchText?: string}) => entry.searchText?.includes("marmalade"))).toBe(true);
    const index = JSON.parse(site.extraFiles.get("documents.json")!.toString());
    expect(index.documents.some((entry: {url: string}) => entry.url.includes("archive"))).toBe(false);
  }));

  it("declares each page's language by its tag: its own, or the language it falls back to", () => fixture(async root => {
    await file(root, "guide.md", "# Guide\n\nHello.\n");
    await file(root, "pt/guide.md", "# Guia\n\nOlá.\n");
    await file(root, "second.md", "# Second\n\nOnly in English.\n");
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } },
      i18n: { defaultLocale: "en", locales: { en: { label: "English", lang: "en-GB" }, pt: { label: "Português", lang: "pt-BR" } } },
      navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Start", pages: ["guide", "second"] }] }) }] } }, root);
    const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
    const lang = (path: string) => files.get(path)?.toString().match(/<html lang="([^"]+)"/)?.[1];
    expect(lang("guide.html")).toBe("en-GB");
    expect(lang("pt/guide.html")).toBe("pt-BR");
    expect(lang("pt/second.html")).toBe("en-GB");
    expect(files.get("guide.html")!.toString()).toContain('hreflang="pt-BR"');
  }));

  it("indexes the home of a version, a language and an API version in its own exports, in every URL style", () => fixture(async root => {
    await file(root, "index.md", "# Start\n\nHello.\n");
    await file(root, "archive/index.md", "# Start\n\nBefore.\n");
    await file(root, "fr/index.md", "# Début\n\nBonjour.\n");
    const spec = { openapi: "3.1.0", info: { title: "Pets API", version: "1" }, paths: { "/pets": { get: { operationId: "listPets", responses: { "200": { description: "OK" } } } } } };
    await file(root, "spec.json", JSON.stringify(spec));
    await file(root, "v1/spec.json", JSON.stringify(spec));
    const docs = { tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Start", pages: ["index"] }] }) };
    const sites = {
      archive: { versions: { default: "current", items: [{ id: "current", label: "Current", content: ".", path: "" }, { id: "archive", label: "Archive", content: "archive", path: "archive" }] }, navigation: { tabs: [docs] } },
      fr: { i18n: { defaultLocale: "en", locales: { en: { label: "English" }, fr: { label: "Français" } } }, navigation: { tabs: [docs] } },
      "api/v1": { navigation: { tabs: [docs, { tab: "API", slug: "api", source: openapi("spec.json"), versions: { default: "v2", items: [{ id: "v2", label: "v2", content: "." }, { id: "v1", label: "v1", content: "v1" }] } }] } },
    };
    for (const [home, raw] of Object.entries(sites)) for (const prettyUrls of [false, "strip", "slash"] as const) {
      const config = await resolveConfigFromRaw({ ...raw, prettyUrls, theme: { fonts: { google: false } } } as Parameters<typeof resolveConfigFromRaw>[0], root);
      const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
      // The home sits beside its directory unless URLs are directories; its Markdown is inside, where that index lists it.
      const page = files.get(prettyUrls === "slash" ? `${home}/index.html` : `${home}.html`)!.toString();
      expect(page).toContain(`<link rel="alternate" type="text/markdown" href="/${home}/index.md" title="Markdown"/>`);
      expect(files.has(`${home}/index.md`)).toBe(true);
      const own = JSON.parse(files.get(`${home}/documents.json`)!.toString()).documents.map((entry: { file: string }) => entry.file);
      expect(own, `${home} ${prettyUrls}`).toContain("index.md");
      const site = JSON.parse(files.get("documents.json")!.toString()).documents.map((entry: { file: string }) => entry.file);
      expect(site).not.toContain(`${home}/index.md`);
      expect(files.get(`${home}/llms.txt`)!.toString()).toContain(`(/${home}/index.md)`);
      // Its pages are described by that index, not the default version's.
      expect(page).toContain(`<link rel="describedby" type="text/plain" href="/${home}/llms.txt" title="Documentation index"/>`);
      const headers = JSON.parse(files.get("response-headers.json")!.toString());
      expect(headers[`/${home}/index.md`].Link).toContain(`</${home}/llms.txt>; rel="describedby"`);
      expect(headers["/index.md"].Link).toContain('</llms.txt>; rel="describedby"');
    }
  }));

  it("shows a version's or language's notice over the page wherever no sidebar rail carries it", () => fixture(async root => {
    await file(root, "docs/install.md", "# Install\n\nRun it.\n");
    await file(root, "v2/docs/install.md", "# Install\n\nRan it.\n");
    const notice = "v2 is maintained for existing projects.";
    for (const theme of ["default", "api-first", "minimal", "reader"] as const) {
      const config = await resolveConfigFromRaw({
        theme: { name: theme, fonts: { google: false } },
        i18n: { defaultLocale: "en", locales: { en: { label: "English" }, fr: { label: "Français" } } },
        versions: { default: "v3", items: [{ id: "v3", label: "v3", content: "." }, { id: "v2", label: "v2", content: "v2", notice }] },
        navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["install"] }] }) }] },
      }, root);
      const files = await sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
      const notices = (path: string) => [...files.get(path)!.toString().matchAll(/<aside class="sourcey-context-notice([^"]*)" role="note"( data-rail="true")?>([^<]*)<\/aside>/g)].map(([, place, rail, text]) => `${place.trim() || "sidebar"}${rail ? " on rail" : ""}: ${text}`);
      const fallback = "Cette page n’est pas encore traduite. La version originale est affichée.";
      if (theme === "reader") {
        // The reader theme states it once, under its masthead.
        expect(notices("v2/install.html")).toEqual([`sidebar: ${notice}`]);
        expect(notices("fr/install.html")).toEqual([`sidebar: ${fallback}`]);
      } else if (theme === "minimal") {
        // No rail ever carries it, so the page does, at every width; the drawer does not repeat it.
        expect(notices("v2/install.html")).toEqual([`sourcey-page-notice: ${notice}`]);
        expect(notices("fr/install.html")).toEqual([`sourcey-page-notice: ${fallback}`]);
      } else {
        // The rail carries it from 1024px; below that the page does.
        expect(notices("v2/install.html")).toEqual([`sidebar: ${notice}`, `sourcey-page-notice on rail: ${notice}`]);
        expect(notices("fr/install.html")).toEqual([`sidebar: ${fallback}`, `sourcey-page-notice on rail: ${fallback}`]);
      }
      expect(notices("install.html")).toEqual([]);
    }
  }));

  it("retains authored section order across independent version scopes", () => fixture(async root => {
    for (const prefix of ["", "archive/"]) {
      await file(root, `${prefix}start.md`, "# Start\n");
      await file(root, `${prefix}more.md`, "# More\n");
    }
    await file(root, "reference.md", "# Reference\n");
    const config = await resolveConfigFromRaw({
      theme: { fonts: { google: false } },
      versions: { default: "current", items: [{ id: "current", label: "Current", content: ".", path: "" }, { id: "archive", label: "Archive", content: "archive", path: "archive" }] },
      navigation: { tabs: [
        { tab: "Start", slug: "", groups: [{ group: "Start", pages: ["start"] }] },
        { tab: "Reference", slug: "reference", versions: false, groups: [{ group: "Reference", pages: ["reference"] }] },
        { tab: "More", slug: "more", groups: [{ group: "More", pages: ["more"] }] },
      ] },
    }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    for (const page of site.pages.filter(page => page.currentPage.kind !== "not-found")) {
      expect(page.navigation?.tabs.map(tab => tab.label)).toEqual(["Start", "Reference", "More"]);
    }
  }));

  it("projects generated component headings and content into HTML, TOC, full-text search and Markdown after a data edit", () => fixture(async root => {
    const data = await file(root, "options.json", JSON.stringify({ title: "Storage", body: "Keep the exact durable detail." }));
    await file(root, "index.md", "---\ntitle: Configuration\n---\n\n<Config />\n");
    const component = defineComponent({ parseProps: attrs => attrs, async resolve(_input, context) {
      const value = await context.readJson("options.json") as { title: string; body: string };
      return { content: [{ kind: "heading" as const, level: 2, text: value.title, id: "storage" }, { kind: "markdown" as const, value: value.body }] };
    } });
    const config = await resolveConfigFromRaw({ components: { Config: component }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Docs", pages: ["index"] }] }] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const page = first.pages[0].currentPage;
    expect(page.kind).toBe("markdown");
    if (page.kind !== "markdown") throw new Error("Expected guide");
    expect(page.markdown.html).toContain('id="storage"'); expect(page.markdown.headings).toContainEqual({ level: 2, text: "Storage", id: "storage" });
    expect(first.llmsFullTxt).toContain("Keep the exact durable detail."); expect(JSON.stringify(first.searchRows)).toContain("Keep the exact durable detail.");
    await writeFile(data, JSON.stringify({ title: "Backups", body: "The changed detail stays searchable." }));
    const next = await updateSourceySite(first, [data]);
    expect(next.llmsFullTxt).toContain("Backups"); expect(first.llmsFullTxt).not.toContain("Backups");
  }));

  it("keeps interleaved sections, authored routes and section indexes consistent through a metadata edit", () => fixture(async root => {
    await file(root, "index.md", '# Start\n\n<PageCards section="start" />\n');
    await file(root, "one.md", '# First\n\nFirst body.\n');
    const second = await file(root, "two.md", '---\nid: second\nslug: custom-path\ntitle: Second\n---\nSecond body.\n');
    await file(root, "last.md", '# Last\n');
    const config = await resolveConfigFromRaw({ prettyUrls: "slash", navigation: { tabs: [{ tab: "Docs", slug: "", routes: { second: "stable-route" }, groups: [{ group: "Start", id: "start", pages: ["index", "one", { group: "Nested", id: "nested", collapsed: true, pages: ["two", { href: "https://example.org", label: "Outside" }] }, "last"] }] }] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const index = first.pages.find(page => page.identity.document === "index")!.currentPage;
    if (index.kind !== "markdown") throw new Error("Expected markdown");
    expect(index.markdown.markdown).toContain("stable-route/");
    expect(index.markdown.markdown.indexOf("First")).toBeLessThan(index.markdown.markdown.indexOf("Nested"));
    expect(index.markdown.markdown.indexOf("Nested")).toBeLessThan(index.markdown.markdown.indexOf("Last"));
    expect(index.markdown.markdown).toContain("https://example.org");
    expect(first.assembly.routes.byPath.has("/stable-route/")).toBe(true);
    const searchRows = first.searchRows;
    expect(searchRows.find(row => row.title === "Second")?.url).toBe("/stable-route/");
    expect(searchRows.some(row => row.url.includes("custom-path"))).toBe(false);
    const artifacts = await sourceyArtifacts(first);
    expect(artifacts.get("index/index.html") ?? artifacts.get("index.html")).toBeDefined();
    const pageHtml = artifacts.get("stable-route/index.html")!.toString();
    expect(pageHtml).toContain('<details open class="sourcey-nav-group">');
    await writeFile(second, '---\nid: second\nslug: custom-path\ntitle: Updated second\n---\nBody.\n');
    const updated = await updateSourceySite(first, [second]);
    const updatedIndex = updated.pages.find(page => page.identity.document === "index")!.currentPage;
    if (updatedIndex.kind !== "markdown") throw new Error("Expected markdown");
    expect(updatedIndex.markdown.markdown).toContain("Updated second");
    expect(index.markdown.markdown).not.toContain("Updated second");
  }));

  it("retains nested native content and exact code while rejecting unknown components", () => fixture(async root => {
    const path = await file(root, "nested.md", '# Modes\n\n<Tabs>\n<Tab title="Stream">\n## Stream\n\n<CodeGroup>\n```sh title="Run"\nprintf "$&"\n```\n</CodeGroup>\n</Tab>\n<Tab title="Record">\n<Warning title="Read this">\nDo not lose this warning.\n</Warning>\n</Tab>\n</Tabs>\n');
    const page = await loadMarkdownPage(path, "nested");
    expect(page.html).toContain('role="tablist"'); expect(page.html).toContain('aria-controls=');
    expect(page.markdown).toContain('printf "$&"'); expect(page.markdown).toContain("Do not lose this warning.");
    expect(page.headings).toContainEqual({ level: 2, text: "Stream", id: "stream" });
    await writeFile(path, "# Guide\n<UnmappedWidget />");
    await expect(loadMarkdownPage(path, "nested")).rejects.toThrow(/Unknown component/);
  }));

  it("ignores matching native tags inside code examples and preserves multiple video sources", () => fixture(async root => {
    await file(root, "demo.webm", "webm-bytes"); await file(root, "demo.mp4", "mp4-bytes");
    await file(root, "index.md", '# Nested\n\n<Note>\nKeep this before.\n\n```md\n</Note>\n<Note>\n```\n\nAnd `</Note>` stays inline.\n\n<Note>Inner note.</Note>\nAfter the inner note.\n</Note>\n\n<Video sources={[{"src":"demo.webm","type":"video/webm"},{"src":"demo.mp4","type":"video/mp4"}]} muted={true} loop={true} title="Recorded demo" />\n');
    const config = await resolveConfigFromRaw({ navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Docs", pages: ["index"] }] }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const page = site.pages[0].currentPage; if (page.kind !== "markdown") throw new Error("Expected markdown");
    expect(page.markdown.markdown).toContain('After the inner note.');
    expect(page.markdown.html.match(/role="note"/g)).toHaveLength(2);
    expect(page.markdown.html).toContain('video/webm'); expect(page.markdown.html).toContain('video/mp4');
    expect(page.markdown.html).toContain('muted loop');
    expect([...site.extraFiles.keys()].filter(path => /\.(webm|mp4)$/.test(path))).toHaveLength(2);
  }));

  it("publishes titled images, linked previews, reference images and raw HTML media while preserving examples", () => fixture(async root => {
    await writeFile(join(root, "thumb.png"), await readFile(new URL("../fixtures/cheese.png", import.meta.url)));
    await file(root, "full.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
    await file(root, "logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="blue"/></svg>');
    const sample = '<img src="logo.svg" alt="Exact logo" title="x &gt; y">';
    await file(root, "index.md", '# Media\n\n![Caption](thumb.png "An image title")\n\n[![Preview](thumb.png "Preview title")](full.svg)\n\n[Download](full.svg)\n\n' + sample + '\n\n<a href="full.svg" title="A link">Download the diagram</a>\n\n![Reference][logo]\n\n[logo]: full.svg "Ref title"\n\n```html\n' + sample + '\n```\n');
    const config = await resolveConfigFromRaw({ baseUrl: "/docs", navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ groups: [{ group: "Docs", pages: ["index"] }] }) }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const page = site.pages.find(page => page.currentPage.kind === "markdown")!.currentPage;
    if (page.kind !== "markdown") throw new Error("Expected markdown");
    expect([...site.extraFiles.keys()].filter(path => path.startsWith("_media/"))).toHaveLength(3);
    expect(page.markdown.html).toMatch(/<img src="\/docs\/_media\/[^"]+"[^>]*title="An image title"/);
    expect(page.markdown.html).toMatch(/<a href="\/docs\/_media\/[^"]+"><img/);
    expect(page.markdown.html).toMatch(/<img src="\/docs\/_media\/[^"]+"[^>]*alt="Exact logo"/);
    expect(page.markdown.html).toContain('title="A link"');
    expect(page.markdown.markdown).toContain('```html\n' + sample + '\n```');
    expect(site.llmsFullTxt).toContain("Download the diagram");
  }));

  it("refuses unowned or symlinked outputs before promoting any changed file", () => fixture(async root => {
    const output = join(root, "output");
    await writeArtifacts(output, new Map([["guide/index.html", "Original"], ["other.html", "Other original"]]));
    await file(output, "manual.html", "Manual");
    await expect(writeArtifacts(output, new Map([["other.html", "Changed"], ["manual.html", "Overwrite"]]))).rejects.toThrow(/unowned/);
    expect(await readFile(join(output, "other.html"), "utf8")).toBe("Other original");
    await rm(join(output, "guide"), { recursive: true });
    await file(root, "outside/index.html", "Source file");
    await symlink(join(root, "outside"), join(output, "guide"), "dir");
    await expect(writeArtifacts(output, new Map([["other.html", "Changed"], ["guide/index.html", "Overwrite"]]))).rejects.toThrow(/symbolic link/);
    expect(await readFile(join(root, "outside/index.html"), "utf8")).toBe("Source file");
    expect(await readFile(join(output, "other.html"), "utf8")).toBe("Other original");
    // A directory an earlier version built has no inventory; the refusal says how to move on.
    await file(root, "earlier/index.html", "Built before 3.8");
    await expect(writeArtifacts(join(root, "earlier"), new Map([["index.html", "New"]]))).rejects.toThrow(/before 3\.8 kept no record of its files, so delete a directory one built once/);
    expect(await readFile(join(root, "earlier/index.html"), "utf8")).toBe("Built before 3.8");
  }));

  it("writes only changed artifacts and leaves source files and a failed snapshot intact", () => fixture(async root => {
    const source = await file(root, "index.md", "# One\n\nOriginal content.\n");
    const other = await file(root, "other.md", "# Two\n\nUntouched.\n");
    const config = await resolveConfigFromRaw({ navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Docs", pages: ["index", "other"] }] }] } }, root);
    const outputDir = join(root, "output");
    const first = await buildSourceySite({ config, outputDir, generateOgImages: false }); await writeSourceySite(first);
    const before = await stat(join(outputDir, "other.html")), assets = await stat(await engineAsset(outputDir, "sourcey.js"));
    await writeFile(source, "# One\n\nChanged content.\n");
    const next = await updateSourceySite(first, [source]); await writeSourceySite(next);
    expect((await stat(join(outputDir, "other.html"))).mtimeMs).toBe(before.mtimeMs);
    expect((await stat(await engineAsset(outputDir, "sourcey.js"))).mtimeMs).toBe(assets.mtimeMs);
    expect(await readFile(other, "utf8")).toContain("Untouched.");
    const docs = await openDocumentation(outputDir); expect(docs.search("Changed")[0].title).toBe("One");
    await writeFile(source, "<Unknown />"); await expect(updateSourceySite(next, [source])).rejects.toThrow();
    expect((await readFile(join(outputDir, "index.html"), "utf8"))).toContain("Changed content.");
  }));

  it("bundles a native client component once, exposes only clientProps, and invalidates imported client inputs", () => fixture(async root => {
    await file(root, "public/_redirects", "/old /new 301");
    await file(root, "index.md", "# Examples\n\n<DateExamples />\n");
    const helper = await file(root, "helper.ts", 'export const value = "initial";');
    await file(root, "dates.ts", 'import {value} from "./helper"; export default function mount(root, props) { root.dataset.value = value; root.dataset.example = props.example; return () => root.removeAttribute("data-value"); }');
    await file(root, "dates.css", '.date-example { color: red; }');
    const component = defineComponent({ parseProps: attrs => attrs, resolve: () => ({ content: [{ kind: "markdown" as const, value: "A useful static date table." }], data: { privateBuildData: "must-not-serialize" }, clientProps: { example: "today" } }),
      renderHtml: (resolved, helpers) => `${helpers.render(resolved.content)}<span data-date-math="now" aria-live="polite" onclick="alert(1)"></span><script>alert(1)</script>`,
      client: { entry: "dates.ts", css: ["dates.css"] } });
    const config = await resolveConfigFromRaw({ components: { DateExamples: component }, navigation: { tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Docs", pages: ["index"] }] }] } }, root);
    const first = await buildSourceySite({ config, generateOgImages: false });
    const html = (await sourceyArtifacts(first)).get("index.html")!.toString();
    expect([...first.extraFiles].some(([path, body]) => path.endsWith(".css") && body.toString().includes("date-example"))).toBe(true);
    expect(html).toContain("A useful static date table."); expect(html).toContain("data-sourcey-component"); expect(html).toContain("today"); expect(html).not.toContain("must-not-serialize");
    expect(html).toContain('data-date-math="now" aria-live="polite"');
    expect(html).not.toContain('onclick="'); expect(html).not.toContain("alert(1)");
    const assets = [...first.extraFiles].filter(([path]) => path.startsWith("_components/") && path.endsWith(".js"));
    expect([...first.extraFiles.keys()].some(path => path.includes("_redirects"))).toBe(false);
    expect(assets).toHaveLength(1); expect(assets[0][1].toString()).toContain("initial");
    await writeFile(helper, 'export const value = "changed";');
    const next = await updateSourceySite(first, [helper]);
    const changed = [...next.extraFiles].filter(([path]) => path.startsWith("_components/") && path.endsWith(".js"));
    expect(changed[0][0]).not.toBe(assets[0][0]); expect(changed[0][1].toString()).toContain("changed");
  }));

  it("reloads transitive native config imports and refreshes glob additions without losing changes", () => fixture(async root => {
    await file(root, "guide/one.md", "# One\n\nFirst.\n");
    const title = await file(root, "title.ts", 'export const title = "First title";');
    await file(root, "navigation.ts", 'export const navigation = {tabs:[{tab:"Docs",slug:"",groups:[{group:"Guide",pages:["guide/*"]}]}]};');
    await file(root, "sourcey.config.ts", 'import {title} from "./title"; import {navigation} from "./navigation"; export default {name:title,navigation};');
    const config = await loadConfig(root);
    expect(config.configDependencies).toContain(await realpath(title));
    const first = await buildSourceySite({ config, generateOgImages: false });
    await writeFile(title, 'export const title = "New title";');
    const next = await updateSourceySite(first, [title]);
    expect(next.config.name).toBe("New title"); expect(first.config.name).toBe("First title");
    const added = await file(root, "guide/two.md", "# Two\n\nSecond.\n");
    const withAddition = await updateSourceySite(next, [added]);
    expect(withAddition.pages.filter(page => page.currentPage.kind !== "not-found").map(p => p.pageSlug)).toEqual(["guide/one", "guide/two"]);
    await rm(added);
    const withRemoval = await updateSourceySite(withAddition, [added]);
    expect(withRemoval.pages.filter(page => page.currentPage.kind !== "not-found").map(p => p.pageSlug)).toEqual(["guide/one"]);
  }));

  it("uses the same deterministic Unicode/CJK search and prefers an exact symbol", async () => {
    const rows = [{ title: "Guide", searchText: "A very long body about iced cheese and 配置服务", url: "/guide/", tab: "Docs", category: "Pages" },
      { title: "widget", qualifiedName: "icey::widget", searchText: "A symbol", url: "/widget/", tab: "Docs", category: "Symbols" }];
    const index = indexSearch(rows);
    const first = (query: string) => rankSearch(index, query)[0]?.id;
    expect(first("iced cheese")).toBe(0);
    expect(first("配置")).toBe(0);
    expect(first("icey::widget")).toBe(1);
    // The browser ranks from the published files as the build ranks in memory.
    const { entry, files } = buildSearchArtifacts(rows);
    const published = await loadSearchIndex("https://docs.test/_search/context.json", (async (url: string) =>
      new Response(url.endsWith("context.json") ? JSON.stringify(entry) : files.get(new URL(url).pathname.slice(1)))) as typeof fetch);
    expect(await published.rank("iced cheese")).toEqual(rankSearch(index, "iced cheese"));
  });
});
