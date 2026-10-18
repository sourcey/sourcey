import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveConfigFromRaw } from "../src/config.js";
import { buildSourceySite } from "../src/site.js";
import { loadDocsPage } from "../src/core/markdown-loader.js";
import { contentTypeForPath } from "../src/renderer/static-files.js";
import { collectReadableDocuments, type DocumentationIndex } from "../src/exports/documents.js";
import { marked } from "marked";
import { closeMarkdownFence } from "../src/core/markdown-loader.js";

const fixture = resolve(import.meta.dirname, "fixtures");
const config = (overrides = {}) =>
  resolveConfigFromRaw(
    {
      name: "Cheesestore",
      siteUrl: "https://docs.example.com",
      baseUrl: "/reference",
      prettyUrls: "strip",
      exports: { openapi: true },
      discovery: { ard: true, apiCatalog: true },
      navigation: { tabs: [{ tab: "API", openapi: join(fixture, "cheese.yml") }] },
      ...overrides,
    },
    fixture,
  );

describe("static documentation exports", () => {
  it("closes a page's EOF-terminated code fence before another page is concatenated", () => {
    expect(
      closeMarkdownFence("# Example\n\n````md\n### Literal\n\nPath: `example.html`\n```\n"),
    ).toMatch(/\n````\n$/);
    expect(closeMarkdownFence("~~~sh\necho hi\n~~~\n")).toBe("~~~sh\necho hi\n~~~\n");
  });
  it("publishes the same operations, contracts and discovery across a mounted site", async () => {
    const site = await buildSourceySite({ config: await config(), generateOgImages: false });
    const index = JSON.parse(String(site.extraFiles.get("documents.json"))) as DocumentationIndex;
    const operation = index.documents.find((doc) => doc.title === "GET /cheeses/{cheeseId}")!;
    expect(operation.kind).toBe("operation");
    expect(operation.markdown).toMatch(/^https:\/\/docs.example.com\/reference\/api\/operations\//);
    const markdown = String(site.extraFiles.get(operation.file));
    expect(markdown).toContain("cheeseId");
    expect(markdown).toContain("required");
    expect(markdown).toContain("Responses:");
    const schema = index.documents.find((doc) => doc.title === "Cheese" && doc.kind === "schema")!;
    expect(markdown).toContain(`](${schema.markdown})`);
    expect(schema.url).toContain("#definition-cheese");
    expect(site.responseHeaders.get(new URL(operation.markdown).pathname)?.Link).toContain(
      `<${operation.url}>; rel="canonical"`,
    );
    const schemaHtml = site.pages.find((page) => page.tabSlug === schema.tab)!.currentPage;
    expect(schemaHtml.kind).toBe("spec");
    expect(markdown).toContain("```bash");
    expect(site.llmsTxt).toContain(operation.markdown);
    expect(site.llmsFullTxt).toContain(markdown.trim().replace(/^# /, "## "));
    const ard = JSON.parse(String(site.extraFiles.get("ard.json")));
    expect(
      ard.entries.some(
        (entry: { url: string }) =>
          entry.url === "https://docs.example.com/reference/documents.json",
      ),
    ).toBe(true);
    expect(site.extraFiles.has(".well-known/ard.json")).toBe(false);
    const catalog = JSON.parse(String(site.extraFiles.get("api-catalog.json")));
    expect(catalog.linkset[0]["service-desc"][0].href).toBe(
      "https://docs.example.com/reference/api/openapi.json",
    );
    expect(site.mediaTypes.get("api-catalog.json")).toContain("application/linkset+json");
    const contract = JSON.parse(String(site.extraFiles.get("api/openapi.json")));
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.paths["/cheeses"].get).toBeDefined();
    expect(site.pages[0].alternateLinks?.some((link) => link.rel === "ard")).toBe(true);
  });

  it("preserves rich guide content and dollar signs without rendering HTML into the export", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sourcey-readable-"));
    try {
      const file = join(dir, "guide.md");
      await writeFile(
        file,
        '# Guide\n\n<Steps>\n<Step title="Send it">\n```sh\ncurl "$API/cheeses"\n```\n</Step>\n</Steps>\n\n<Tabs><Tab title="TypeScript">\n```ts\nconst price = "$5";\n```\n</Tab><Tab title="Python">\n```python\nprice = "$5"\n```\n</Tab></Tabs>\n\n:::accordion{title="Verify the signature"}\nKeep the raw request body.\n:::\n',
      );
      const page = await loadDocsPage(file, "guide");
      expect(page.kind).toBe("markdown");
      if (page.kind !== "markdown") return;
      expect(page.markdown).toContain('curl "$API/cheeses"');
      expect(page.markdown).toContain("1. **Send it**");
      expect(page.markdown).toContain("**TypeScript**");
      expect(page.markdown).toContain("**Python**");
      expect(page.markdown).toContain("Verify the signature");
      expect(page.markdown).not.toContain("<Tab");
      expect(page.markdown).not.toContain("directive-tab");
      expect(page.markdown).not.toContain(":::");
      const code: string[] = [];
      marked.walkTokens(marked.lexer(page.markdown), (token) => {
        if (token.type === "code") code.push(token.text);
      });
      expect(code).toContain('curl "$API/cheeses"');
      expect(code).toContain('const price = "$5";');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([false, "slash", "strip"] as const)(
    "keeps every emitted link valid with prettyUrls=%s",
    async (prettyUrls) => {
      const site = await buildSourceySite({
        config: await config({ prettyUrls }),
        generateOgImages: false,
      });
      const index = JSON.parse(String(site.extraFiles.get("documents.json"))) as DocumentationIndex;
      for (const entry of index.documents) expect(site.extraFiles.has(entry.file)).toBe(true);
      expect(new Set(index.documents.map((entry) => entry.file)).size).toBe(index.documents.length);
    },
  );

  it("honours independent switches and leaves no discovery links to disabled files", async () => {
    const site = await buildSourceySite({
      config: await config({ exports: false, discovery: false }),
      generateOgImages: false,
    });
    expect(site.llmsTxt).toBe("");
    expect(site.llmsFullTxt).toBe("");
    expect(site.extraFiles.size).toBe(0);
    expect(site.pages[0].alternateLinks).toEqual([]);
  });

  it("does not expose source contracts by default", async () => {
    const site = await buildSourceySite({
      config: await config({ exports: undefined, discovery: false }),
      generateOgImages: false,
    });
    expect(site.extraFiles.has("api/openapi.json")).toBe(false);
    expect(site.extraFiles.has("documents.json")).toBe(true);
  });

  it("publishes well-known discovery only from an explicitly owned origin root", async () => {
    await expect(config({ discovery: { ard: true, wellKnown: true } })).rejects.toThrow(
      "origin-root",
    );
    const site = await buildSourceySite({
      config: await config({
        baseUrl: "",
        discovery: { ard: true, apiCatalog: true, wellKnown: true },
      }),
      generateOgImages: false,
    });
    expect(site.extraFiles.has(".well-known/ard.json")).toBe(true);
    expect(site.extraFiles.has(".well-known/api-catalog")).toBe(true);
    expect(site.mediaTypes.get(".well-known/api-catalog")).toContain("application/linkset+json");
    await expect(config({ siteUrl: undefined })).rejects.toThrow("siteUrl");
  });

  it("publishes explicit service descriptors without inferring hosted capabilities from MCP docs", async () => {
    const resources = [
      {
        identifier: "urn:air:example.com:mcp:cheeses",
        displayName: "Cheese MCP",
        type: "application/mcp-server-card+json",
        url: "https://api.example.com/server-card.json",
        representativeQueries: ["find cheeses", "look up a cheese"],
      },
    ];
    const site = await buildSourceySite({
      config: await config({ discovery: { ard: true, resources } }),
      generateOgImages: false,
    });
    expect(JSON.parse(String(site.extraFiles.get("ard.json"))).entries).toContainEqual(
      resources[0],
    );
    await expect(
      config({ discovery: { ard: true, resources: [{ ...resources[0], data: {} }] } }),
    ).rejects.toThrow("exactly one");
    await expect(
      config({ discovery: { ard: true, resources: [resources[0], resources[0]] } }),
    ).rejects.toThrow("duplicate");
  });

  it("bundles local references without retaining local paths or changing the source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sourcey-contract-"));
    try {
      await mkdir(join(dir, "schemas"));
      const schema = '{"type":"object","properties":{"next":{"$ref":"#/"}}}';
      await writeFile(join(dir, "schemas/type.json"), schema.replace('"#/"', '"#"'));
      const source = JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Local", version: "1" },
        paths: {
          "/item": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  content: { "application/json": { schema: { $ref: "schemas/type.json" } } },
                },
              },
            },
          },
        },
      });
      await writeFile(join(dir, "api.json"), source);
      const resolved = await resolveConfigFromRaw(
        { exports: { openapi: true }, navigation: { tabs: [{ tab: "API", openapi: "api.json" }] } },
        dir,
      );
      const site = await buildSourceySite({ config: resolved, generateOgImages: false });
      const bundle = String(site.extraFiles.get("api/openapi.json"));
      expect(bundle).not.toContain("schemas/type.json");
      expect(bundle).not.toContain(dir);
      expect(JSON.parse(bundle).paths["/item"]).toBeDefined();
      expect(await readFile(join(dir, "api.json"), "utf8")).toBe(source);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps hidden operations out of readable docs while preserving the opted-in source contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sourcey-hidden-export-"));
    try {
      await writeFile(
        join(dir, "api.json"),
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "Visibility", version: "1" },
          paths: {
            "/private": {
              get: { "x-sourcey-hide": true, responses: { 200: { description: "OK" } } },
            },
            "/public": { get: { responses: { 200: { description: "OK" } } } },
          },
        }),
      );
      const resolved = await resolveConfigFromRaw(
        { exports: { openapi: true }, navigation: { tabs: [{ tab: "API", openapi: "api.json" }] } },
        dir,
      );
      const site = await buildSourceySite({ config: resolved, generateOgImages: false });
      expect(site.llmsFullTxt).not.toContain("GET /private");
      expect(String(site.extraFiles.get("documents.json"))).not.toContain("GET /private");
      expect(
        JSON.parse(String(site.extraFiles.get("api/openapi.json"))).paths["/private"],
      ).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes deterministically and gives Markdown a real media type", async () => {
    const first = await buildSourceySite({ config: await config(), generateOgImages: false });
    const second = await buildSourceySite({ config: await config(), generateOgImages: false });
    expect([...first.extraFiles]).toEqual([...second.extraFiles]);
    expect(contentTypeForPath("guide.md")).toBe("text/markdown; charset=utf-8");
    const docs = collectReadableDocuments(first.pages, first.site);
    expect(
      docs.some((doc) => doc.entry.kind === "schema" && doc.content.includes("required")),
    ).toBe(true);
  });
});
