import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcp, openapi } from "../../src/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";
import { operationAnchor } from "../../src/core/reference-identity.js";

const snapshot = new URL("../fixtures/nitrosend.mcp.json", import.meta.url).pathname;

async function fixture<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "sourcey-sections-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function build(root: string, tabs: Record<string, unknown>[]) {
  const config = await resolveConfigFromRaw({ prettyUrls: "slash", theme: { fonts: { google: false } }, navigation: { tabs } }, root);
  const site = await buildSourceySite({ config, generateOgImages: false });
  const artifacts = await sourceyArtifacts(site);
  return { site, html: (path: string) => artifacts.get(path)!.toString() };
}

/** The sidebar of a page, as drawn. */
const sidebar = (html: string) => html.slice(html.indexOf('<nav id="nav"'), html.indexOf("</nav>", html.indexOf('<nav id="nav"')));

/** An OpenAPI document with an operation for each tag's count. */
function openApi(tags: Record<string, number>) {
  const paths: Record<string, unknown> = {};
  for (const [tag, count] of Object.entries(tags))
    for (let index = 0; index < count; index++) paths[`/${tag.toLowerCase()}/${index}`] = { get: { tags: [tag], summary: `${tag} ${index}`, responses: { "200": { description: "OK" } } } };
  return JSON.stringify({ openapi: "3.1.0", info: { title: "API", version: "1" }, paths });
}

describe("reference sections", () => {
  it("publishes an MCP server's groups as pages, the rest by kind, each entry's kind only where kinds mix", () => fixture(async (root) => {
    const groups = {
      Contacts: ["nitro_search_contacts", "nitro_import_contacts", "nitro_manage_audience", "nitro_define_segment"],
      Guides: ["guide", "build-email"],
    };
    const { site, html } = await build(root, [{ tab: "MCP", slug: "mcp", source: mcp({ spec: snapshot, groups }), reference: { split: "sections", operations: "{operation}" } }]);
    const spec = site.references.get("mcp")!;
    expect(spec.tags.map((tag) => tag.name)).toEqual(["Contacts", "Guides", "Tools", "Resources", "Prompts"]);
    expect(site.pages.filter((page) => page.currentPage.kind === "spec" && page.currentPage.view?.kind === "section").map((page) => page.outputPath))
      .toEqual(["mcp/contacts/index.html", "mcp/guides/index.html", "mcp/tools/index.html", "mcp/resources/index.html", "mcp/prompts/index.html"]);
    expect(site.referenceDiagnostics).toEqual([expect.objectContaining({ code: "mcp-ungrouped", message: expect.stringContaining("nitro_get_status") })]);

    // An entry lives on its section's page, and its own address leads there.
    const search = spec.operations.find((op) => op.path === "nitro_search_contacts")!;
    const place = `/mcp/contacts/#${operationAnchor(search, spec)}`;
    expect(site.pages.find((page) => page.pageSlug === "introduction")!.referenceTargets!.operations["TOOL nitro_search_contacts"].href).toBe(place);
    expect(site.searchRows.some((row: { url: string }) => row.url === place)).toBe(true);
    expect(site.assembly.routes.redirectFor("/mcp/nitro_search_contacts/")?.to).toBe(place);

    // The overview lists the sections, each leading to its page, and keeps each entry's
    // single-page anchor on its section's row.
    const overview = html("mcp/index.html");
    expect(overview).toMatch(/<li id="tag-contacts"><span class="reference-anchor-alias" id="operation-nitro-search-contacts-tool"[^>]*><\/span>.*?<a href="\/mcp\/contacts\/"><span class="reference-operation-label"><strong>Contacts<\/strong><span class="reference-operation-summary">nitro_search_contacts, nitro_import_contacts, nitro_manage_audience and nitro_define_segment<\/span>/s);
    expect(overview).not.toContain("reference-method");

    const contacts = html("mcp/contacts/index.html");
    expect(contacts).toMatch(/<h1 class="reference-page-title[^"]*">Contacts<\/h1>/);
    expect(contacts).toContain(`id="${operationAnchor(search, spec)}"`);
    // A tool among tools says neither its kind nor, under a title that is its name, its name again.
    expect(contacts).not.toContain(">TOOL<");
    expect(html("mcp/guides/index.html")).toContain(">RESOURCE<");

    // The sidebar leads to each section's page and lists the places on the current one.
    const nav = sidebar(contacts);
    expect(nav).toContain('href="/mcp/contacts/" class="nav-group-label nav-group-link active"');
    expect(nav).toContain(`href="${place}"`);
    expect(nav).not.toContain("bg-purple-500");
    expect(nav).toContain("bg-green-500");
    // Previous and next name the sections they lead to.
    expect(contacts).toMatch(/<a href="\/mcp\/guides\/"[^>]*>.*?Next.*?<span[^>]*>Guides<\/span><\/a>/s);
  }));

  it("keeps a reference with one section on one page, and says so", () => fixture(async (root) => {
    await writeFile(join(root, "api.json"), openApi({ Items: 3 }));
    const { site } = await build(root, [{ tab: "API", slug: "api", source: openapi("api.json"), reference: { split: "sections" } }]);
    expect(site.pages.filter((page) => page.currentPage.kind === "spec").map((page) => page.outputPath)).toEqual(["api/index.html"]);
    expect(site.referenceDiagnostics).toEqual([expect.objectContaining({ code: "one-section", tab: "API" })]);
  }));

  it("says when a reference held on one page runs too long to open quickly", () => fixture(async (root) => {
    await writeFile(join(root, "api.json"), openApi({ Items: 60, Orders: 41 }));
    const single = await build(root, [{ tab: "API", slug: "api", source: openapi("api.json"), reference: { split: false } }]);
    expect(single.site.referenceDiagnostics).toEqual([expect.objectContaining({ code: "long-page", message: expect.stringContaining("101 operations") })]);
    const split = await build(root, [{ tab: "API", slug: "api", source: openapi("api.json"), reference: { split: "sections" } }]);
    expect(split.site.referenceDiagnostics).toEqual([]);
  }));

  it("chooses a shape by size where the config names none, and says which", () => fixture(async (root) => {
    const shape = async (tags: Record<string, number>) => {
      await writeFile(join(root, "api.json"), openApi(tags));
      const { site } = await build(root, [{ tab: "API", slug: "api", source: openapi("api.json") }]);
      const views = site.pages.filter((page) => page.currentPage.kind === "spec").map((page) => page.currentPage.kind === "spec" && page.currentPage.view?.kind);
      return { views: new Set(views), said: site.referenceDiagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.message}`) };
    };
    // Small: one page.
    expect(await shape({ Items: 12, Orders: 8 })).toEqual({ views: new Set([undefined]), said: [expect.stringMatching(/^info Published as one page: 20 operations and \d+ field rows\./)] });
    // Too large for one page, in sections that each make one: a page per section.
    expect(await shape({ Items: 30, Orders: 30, Users: 30 })).toEqual({ views: new Set(["overview", "section"]), said: [expect.stringMatching(/^info Published as a page per section: 90 operations and \d+ field rows in 3 sections/)] });
    // A section too large for a page: a page per operation.
    expect(await shape({ Items: 120, Orders: 2 })).toEqual({ views: new Set(["overview", "operation"]), said: [expect.stringMatching(/^info Published as a page per operation: 122 operations and \d+ field rows, and its section Items alone holds 120 operations/)] });
  }));

  it("shows the section around a page whole, and folds the others to their links", () => fixture(async (root) => {
    await writeFile(join(root, "api.json"), openApi({ Items: 90, Orders: 30 }));
    const { html } = await build(root, [{ tab: "API", slug: "api", source: openapi("api.json"), reference: { split: "operations" } }]);
    const nav = sidebar(html("api/operations/operation-items-45-get/index.html"));
    for (const index of [0, 45, 89]) expect(nav).toContain(`>Items ${index}<`);
    expect(nav).not.toContain(">Orders 0<");
    expect(nav).toContain('href="/api/#tag-orders"');
  }));

  it("lists a server of one section whole on every page, even its overview", () => fixture(async (root) => {
    const tools = Array.from({ length: 120 }, (_, index) => ({ name: `tool${index}`, inputSchema: { type: "object" } }));
    await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpSpec: "0.3.2", mcpVersion: "2025-11-25", server: { name: "server", version: "1" }, tools }));
    const { html } = await build(root, [{ tab: "MCP", slug: "mcp", source: mcp("mcp.json"), reference: { split: "operations" } }]);
    for (const page of ["mcp/index.html", "mcp/operations/operation-tool60-tool/index.html"]) {
      const nav = sidebar(html(page));
      for (const name of ["tool0", "tool60", "tool119"]) expect(nav).toContain(`>${name}<`);
    }
  }));

  it("names a method with one badge in the sidebar, a list and at the operation's head", () => fixture(async (root) => {
    const ok = { responses: { "200": { description: "OK" } } };
    await writeFile(join(root, "api.json"), JSON.stringify({ openapi: "3.1.0", info: { title: "API", version: "1" }, paths: {
      "/items/{id}": { get: { tags: ["Items"], summary: "Get an item", ...ok }, delete: { tags: ["Items"], summary: "Delete an item", ...ok } },
    } }));
    const { html } = await build(root, [
      { tab: "API", slug: "api", source: openapi("api.json"), reference: { split: "operations" } },
      { tab: "MCP", slug: "mcp", source: mcp({ spec: snapshot, groups: { Guides: ["guide", "build-email"] } }), reference: { split: "operations" } },
    ]);
    const page = html("api/operations/operation-items-id-delete/index.html");
    // The sidebar's narrow column shortens DELETE; elsewhere it is written out.
    expect(sidebar(page)).toContain('<span class="method-badge" data-method="delete">DEL</span>');
    expect(page).toMatch(/<div class="sourcey-endpoint[^"]*"><span class="method-badge" data-method="delete">DELETE<\/span>/);
    expect(html("api/index.html")).toContain('<span class="reference-method"><span class="method-badge" data-method="delete">DELETE</span></span>');
    // An MCP entry's kind, where its section mixes kinds, is the same badge.
    const resource = html("mcp/operations/operation-nitro-guide-resource/index.html");
    expect(resource).toMatch(/<div class="sourcey-endpoint[^"]*"><span class="method-badge" data-method="resource">RESOURCE<\/span>/);
    expect(html("mcp/index.html")).toContain('<span class="reference-method"><span class="method-badge" data-method="prompt">PROMPT</span></span>');
  }));
});
