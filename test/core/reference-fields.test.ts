import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openapi, mcp } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { definitionAnchors, definitionFieldRoot, operationKey, operationFieldRoot, operationFieldAnchors, referenceFieldPath } from "../../src/core/reference-identity.js";
import { buildSourceySite, sourceyArtifacts, updateSourceySite } from "../../src/site.js";
import { formatBuildDiagnostics } from "../../src/core/build-diagnostics.js";
import { renderPage } from "../../src/renderer/static-renderer.js";
import { createRenderOptions } from "../../src/renderer/html-builder.js";
import { projectNavigation } from "../../src/core/navigation.js";

const fields = {
  type: "object", required: ["name"],
  properties: {
    name: { type: "string" }, Name: { type: "string" }, "a/b": { type: "string" }, "a~002fb": { type: "string" }, "a b": { type: "string" }, "名字": { type: "string" }, "": { type: "string" },
    nested: { type: "array", items: { oneOf: [{ type: "object", properties: { repeated: { type: "string" } } }, { allOf: [{ type: "object", properties: { repeated: { type: "integer" } } }, { type: "object", properties: { repeated: { type: "boolean" } } }] }] } },
    boundClaims: { type: "object", additionalProperties: { type: "string", description: "Each mapped claim retains its description.", enum: ["allowed", "denied"] } },
    nestedMaps: { type: "object", additionalProperties: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } },
    matrix: { type: "array", items: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } },
    // Only the way each travels: a request never sends these read-only fields, a response never returns the write-only one.
    id: { type: "integer", readOnly: true }, secret: { type: "string", writeOnly: true },
    audit: { type: "object", properties: { createdBy: { type: "string", readOnly: true } } },
    stamped: { allOf: [{ type: "object", properties: { at: { type: "string", readOnly: true } } }, { type: "object", properties: { note: { type: "string" } } }] },
  },
  additionalProperties: { type: "string" },
};
const document = {
  openapi: "3.1.0", info: { title: "Field identities", version: "fixture" },
  components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, schemas: { Fields: { allOf: [fields, { type: "array", items: fields }] }, MapValues: { type: "object", additionalProperties: { type: "string", description: "The map-only value stays documented." }, allOf: [{ type: "object", properties: { fixed: { type: "string" } } }] } } },
  paths: { "/items": { post: {
    summary: "Create an item", security: [{ bearer: [] }],
    parameters: [{ name: "id", in: "query", schema: { type: "string" } }, { name: "id", in: "header", schema: { type: "string" } }],
    requestBody: { content: { "application/json": { schema: fields }, "application/vnd.fixture+json": { schema: fields } } },
    responses: Object.fromEntries(["200", "400"].map(status => [status, { description: "Response", headers: { id: { schema: { type: "string" } } }, content: { "application/json": { schema: fields }, "application/xml": { schema: fields } } }])),
  } } },
};

describe("reference field destinations", () => {
  it("keeps imported fragment history immutable through field removal and restoration", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-fragment-drift-"));
    try {
      const source = join(root, "api.json");
      const initial = structuredClone(document);
      await writeFile(source, JSON.stringify(initial));
      const spec = normalizeSpec({ source, document: initial });
      const target = referenceFieldPath(operationFieldRoot(spec.operations[0]), "request-body", "application/json", "properties", "name");
      const aliases = { "body-name": target, "body-current": "request-body" };
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("api.json"), reference: { split: "operations" }, anchors: { "POST /items": aliases }, anchorUnmatched: "warn" }] } }, root);
      const original = await buildSourceySite({ config, generateOgImages: false });
      const originalPage = original.pages.find(page => page.identity.document === "POST /items")!;
      const originalBytes = (await sourceyArtifacts(original)).get(originalPage.outputPath)!;
      expect(originalBytes.toString()).toContain('id="body-name"');
      const changed = structuredClone(initial);
      delete (changed.paths["/items"].post.requestBody.content["application/json"].schema.properties as Record<string, unknown>).name;
      await writeFile(source, JSON.stringify(changed));
      const updated = await updateSourceySite(original, [source]);
      const updatedPage = updated.pages.find(page => page.identity.document === "POST /items")!;
      const updatedBytes = (await sourceyArtifacts(updated)).get(updatedPage.outputPath)!;
      expect(updatedBytes.toString()).not.toContain('id="body-name"');
      expect(updatedBytes.toString()).toContain('id="body-current"');
      expect(updated.assembly.routes.byOutputPath.get(updatedPage.outputPath)!.anchors.has("body-name")).toBe(false);
      expect(updated.anchorDiagnostics).toEqual([expect.objectContaining({ alias: "body-name", target, tab: "api", document: "POST /items" })]);
      expect(formatBuildDiagnostics(updated).join("\n")).toContain("Unmatched aliases are omitted");
      expect(aliases).toEqual({ "body-name": target, "body-current": "request-body" });
      expect(originalPage.anchorAliases).toEqual(aliases);
      expect((await sourceyArtifacts(original)).get(originalPage.outputPath)).toEqual(originalBytes);
      await writeFile(source, JSON.stringify(initial));
      const restored = await updateSourceySite(updated, [source]);
      expect(restored.anchorDiagnostics).toEqual([]);
      expect((await sourceyArtifacts(restored)).get(originalPage.outputPath)!.toString()).toContain('id="body-name"');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("checks imported fragments strictly by default and exposes explicit warning and ignore policies", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-fragment-policy-"));
    try {
      await writeFile(join(root, "api.json"), JSON.stringify(document));
      for (const anchorUnmatched of [undefined, "error", "warn", "ignore"] as const) {
        const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("api.json"), reference: { split: "operations" }, anchorUnmatched, anchors: { "POST /items": { "old-field": "missing-field" }, "DELETE /gone": { "old-page": "request-body" } } }] } }, root);
        if (!anchorUnmatched || anchorUnmatched === "error") await expect(buildSourceySite({ config, generateOgImages: false })).rejects.toThrow(/unknown document/);
        else {
          const site = await buildSourceySite({ config, generateOgImages: false });
          expect(site.anchorDiagnostics).toHaveLength(anchorUnmatched === "warn" ? 2 : 0);
          expect(site.pages.find(page => page.identity.document === "POST /items")!.anchorAliases).toEqual({});
        }
      }
      for (const anchorUnmatched of ["warn", "ignore"] as const) for (const aliases of [{ "bad alias": "missing" }, { "request-body": "missing" }]) {
        const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("api.json"), reference: { split: "operations" }, anchorUnmatched, anchors: { "POST /items": aliases } }] } }, root);
        await expect(buildSourceySite({ config, generateOgImages: false })).rejects.toThrow(/Invalid fragment alias|conflicts with section/);
      }
      const strict = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("api.json"), reference: { split: "operations" }, anchors: { "POST /items": { "old-field": "missing-field" } } }] } }, root);
      await expect(buildSourceySite({ config: strict, generateOgImages: false })).rejects.toThrow(/has no target/);
      const invalid = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("api.json"), anchorUnmatched: "ignore", anchors: { "DELETE /gone": { "bad alias": "missing-field" } } }] } }, root);
      await expect(buildSourceySite({ config: invalid, generateOgImages: false })).rejects.toThrow(/Invalid fragment alias/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("lists a request's fields without the read-only ones and a response's without the write-only ones", () => {
    const spec = normalizeSpec({ source: "api.json", document: structuredClone(document) });
    const anchors = operationFieldAnchors(spec.operations[0]);
    const root = operationFieldRoot(spec.operations[0]);
    const body = referenceFieldPath(root, "request-body", "application/json", "properties");
    const response = referenceFieldPath(root, "responses", "200", "content", "application/json", "properties");
    expect(anchors).toEqual(expect.arrayContaining([`${body}/secret`, `${body}/audit`, `${body}/stamped/allOf/1/properties/note`, `${response}/id`, `${response}/audit/properties/createdBy`, `${response}/stamped/allOf/0/properties/at`]));
    for (const omitted of [`${body}/id`, `${body}/audit/properties/createdBy`, `${body}/stamped/allOf/0/properties/at`, `${response}/secret`]) expect(anchors).not.toContain(omitted);
    const model = referenceFieldPath(definitionFieldRoot("Fields"), "allOf", "0", "properties");
    expect(definitionAnchors("Fields", spec)).toEqual(expect.arrayContaining([`${model}/id`, `${model}/secret`, `${model}/audit/properties/createdBy`]));
  });

  it.each(["single", "split"] as const)("in %s mode, draws a type once inside itself and once in a schema too large to draw each time, linking its other rows there", async mode => {
    const leaf = { type: "object", properties: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, { type: "string" }])) };
    // Forty branches of a thirty-field leaf come to more rows than a schema draws in full.
    const branch = { type: "object", properties: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`leaf${index}`, { $ref: "#/components/schemas/Leaf" }])) };
    const trees = {
      openapi: "3.1.0", info: { title: "Plans", version: "fixture" },
      components: { schemas: {
        Leaf: leaf, Branch: branch,
        Node: { type: "object", properties: { label: { type: "string" }, children: { type: "array", items: { $ref: "#/components/schemas/Node" } }, parent: { $ref: "#/components/schemas/Node" } } },
        Forest: { type: "object", properties: { branch: { $ref: "#/components/schemas/Branch" }, leaf: { $ref: "#/components/schemas/Leaf" }, tree: { $ref: "#/components/schemas/Node" } } },
      } },
      paths: { "/forests": { post: { summary: "Plant a forest", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Forest" } } } }, responses: { "201": { description: "Planted", content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } } } } } },
    };
    const root = await mkdtemp(join(tmpdir(), "sourcey-schema-plans-"));
    try {
      await writeFile(join(root, "api.json"), JSON.stringify(trees));
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "API", source: openapi("api.json"), reference: mode === "split" ? { split: "operations" } : {} }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = site.pages.find(entry => entry.currentPage.kind === "spec" && (mode === "single" || entry.currentPage.view?.kind === "operation"))!;
      if (page.currentPage.kind !== "spec") throw new Error("no reference page");
      const operation = page.currentPage.spec.operations[0];
      const html = renderPage(page.currentPage.spec, createRenderOptions(page, site.site), projectNavigation(page.navigation ?? site.navigation, page.tabSlug, page.pageSlug), page.currentPage, site.site);
      const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match => match[1]);
      const expected = operationFieldAnchors(operation);
      for (const id of expected) expect(ids.filter(value => value === id), id).toHaveLength(1);
      // Every link to where a type is drawn lands on this page.
      const drawnAt = [...html.matchAll(/<p class="schema-drawn-at">[^<]*<a href="#([^"]+)"/g)].map(match => match[1]);
      expect(drawnAt.length).toBeGreaterThan(0);
      for (const target of drawnAt) expect(ids, target).toContain(target);
      const body = referenceFieldPath(operationFieldRoot(operation), "request-body", "application/json");
      const field = (...path: string[]) => referenceFieldPath(body, ...path.flatMap(name => ["properties", name]));
      // Leaf is drawn at forest.leaf, its shallowest place, and each branch links there.
      expect(expected).toContain(field("leaf", "field0"));
      expect(expected).toContain(field("branch", "leaf0"));
      expect(expected).not.toContain(field("branch", "leaf0", "field0"));
      expect(drawnAt).toContain(field("leaf"));
      // A node's children and parent link back to the node that holds them.
      expect(drawnAt).toContain(field("tree"));
      expect(expected).not.toContain(referenceFieldPath(field("tree", "children"), "items", "properties", "label"));
      // The response is a node: its own rows link to the schema itself, which marks where it starts.
      const response = referenceFieldPath(operationFieldRoot(operation), "responses", "201", "content", "application/json");
      expect(expected).toContain(response);
      expect(drawnAt).toContain(response);
      expect(html).not.toContain("Max depth reached");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("keeps semantic path segments distinct without lossy slugging", () => {
    const values = ["a/b", "a~002fb", "a b", "a-b", "Name", "name", "名字", "", "#", "\ud800", "\ud801"];
    expect(new Set(values.map(value => referenceFieldPath("root", value))).size).toBe(values.length);
    expect(referenceFieldPath("root", "a", "b")).not.toBe(referenceFieldPath("root", "a/b"));
    expect(values.map(value => referenceFieldPath("root", value)).join("")).not.toMatch(/[\s#]/);
  });

  it.each(["single", "split"] as const)("keeps %s MCP input and output fields in the same route and DOM inventory", async mode => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-mcp-fields-"));
    try {
      await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpSpec: "0.2.0", mcpVersion: "2025-11-25", server: { name: "fixture", version: "fixture" }, tools: [
        { name: "lookup", inputSchema: fields, outputSchema: fields },
        { name: "ping", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
      ], resources: [], resourceTemplates: [], prompts: [] }));
      const config = await resolveConfigFromRaw({ theme: { name: "api-first", fonts: { google: false } }, navigation: { tabs: [{ tab: "Tools", source: mcp("mcp.json"), reference: mode === "split" ? { split: "operations" } : {} }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      for (const page of site.pages) {
        if (page.currentPage.kind !== "spec" || page.currentPage.view?.kind === "overview") continue;
        const current = page.currentPage;
        const view = current.view;
        const operations = view?.kind === "operation" ? current.spec.operations.filter(operation => operationKey(operation) === view.id) : current.spec.operations;
        const expected = operations.flatMap(operationFieldAnchors);
        const html = renderPage(current.spec, createRenderOptions(page, site.site), projectNavigation(page.navigation ?? site.navigation, page.tabSlug, page.pageSlug), current, site.site);
        const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match => match[1]);
        const route = site.assembly.routes.byOutputPath.get(page.outputPath)!;
        for (const id of expected) {
          expect(ids.filter(value => value === id), id).toHaveLength(1);
          expect(route.anchors.has(id), id).toBe(true);
        }
        expect(ids.filter(id => id.startsWith("fields/")).length).toBe(expected.length);
        for (const id of route.anchors) expect(ids, id).toContain(id);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const theme of ["default", "minimal", "api-first", "reader"] as const) it.each(["single", "split"] as const)(`${theme}: every %s field destination and imported alias exists exactly once in HTML`, async mode => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-reference-fields-"));
    try {
      await writeFile(join(root, "api.json"), JSON.stringify(document));
      const normalized = normalizeSpec({ source: join(root, "api.json"), document });
      const operation = normalized.operations[0];
      const target = referenceFieldPath(operationFieldRoot(operation), "request-body", "application/json", "properties", "name");
      const config = await resolveConfigFromRaw({ theme: { name: theme, fonts: { google: false } }, baseUrl: "/docs", prettyUrls: "slash", navigation: { tabs: [{ tab: "API", source: openapi("api.json"), reference: mode === "split" ? { split: "operations" } : {}, anchors: { [mode === "split" ? "POST /items" : "introduction"]: { "body-name": target } } }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      for (const page of site.pages) {
        if (page.currentPage.kind !== "spec") continue;
        const { spec, view } = page.currentPage;
        const expected = view?.kind === "operation" ? operationFieldAnchors(spec.operations[0]) : view?.kind === "schema" ? definitionAnchors(view.name, spec).filter(id => id.startsWith("fields/")) : view?.kind === "overview" ? [] : [...operationFieldAnchors(spec.operations[0]), ...Object.keys(spec.schemas).flatMap(name => definitionAnchors(name, spec).filter(id => id.startsWith("fields/")))];
        const html = renderPage(spec, createRenderOptions(page, site.site), projectNavigation(page.navigation ?? site.navigation, page.tabSlug, page.pageSlug), page.currentPage, site.site);
        const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match => match[1]);
        const route = site.assembly.routes.byOutputPath.get(page.outputPath)!;
        for (const id of expected) {
          expect(ids.filter(value => value === id), id).toHaveLength(1);
          expect(route.anchors.has(id), id).toBe(true);
        }
        expect(ids.filter(id => id.startsWith("fields/")).length).toBe(expected.length);
        if (expected.includes(target)) {
          expect(html).toContain("Each mapped claim retains its description.");
          expect(ids.filter(id => id === "body-name")).toHaveLength(1);
          expect(route.anchors.has("body-name")).toBe(true);
          const incoming = new URL(`${route.publicPath}#body-name`, "https://docs.example.test");
          expect(site.assembly.routes.match(incoming.pathname)?.anchors.has(incoming.hash.slice(1))).toBe(true);
        }
        if (expected.includes(referenceFieldPath(definitionFieldRoot("MapValues"), "additionalProperties"))) expect(html).toContain("The map-only value stays documented.");
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
