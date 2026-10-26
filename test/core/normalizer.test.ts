import { describe, it, expect } from "vitest";
import { loadSpec } from "../../src/core/loader.js";
import { convertToOpenApi3 } from "../../src/core/converter.js";
import { parseSpec } from "../../src/core/parser.js";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { resolve } from "node:path";
import type { NormalizedSpec, ParsedSpec } from "../../src/core/types.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

async function loadAndNormalize(fixture: string): Promise<NormalizedSpec> {
  const loaded = await loadSpec(`${FIXTURES}/${fixture}`);
  const parsed = await parseSpec(loaded);
  const converted = await convertToOpenApi3(parsed);
  return normalizeSpec(converted);
}

describe("normalizeSpec", () => {
  it("normalizes a type once along every path it cannot recur on, names a component nothing references, and reads a boolean schema", () => {
    // Shared, as the parser shares one object for every use of a component.
    const meta = { type: "object", "x-ref-name": "ObjectMeta", properties: { name: { type: "string" } } };
    const spec = { type: "object", "x-ref-name": "AppSpec", properties: { meta } };
    const app = { type: "object", "x-ref-name": "App", properties: { meta, spec, extra: true } };
    const unused = { type: "object", properties: { id: { type: "string" } } };
    const normalized = normalizeSpec({
      source: "inline.json",
      document: { openapi: "3.1.0", info: { title: "Kinds", version: "1" }, paths: { "/apps": { get: { responses: { "200": { description: "OK", content: { "application/json": { schema: app } } } } } } }, components: { schemas: { App: app, AppSpec: spec, ObjectMeta: meta, Unused: unused } } },
    } as unknown as ParsedSpec);
    const body = normalized.operations[0].responses[0].content!["application/json"].schema!;
    // ObjectMeta under App and under App's AppSpec is the same normalized type.
    expect(body.properties!.meta).toBe(body.properties!.spec.properties!.meta);
    expect(normalized.schemas.Unused.refName).toBe("Unused");
    expect(body.properties!.extra).toBeDefined();
  });

  it("normalizes a component once wherever it is used the same way, and keeps a component named \"\" apart from an unnamed use", () => {
    // The parser shares one object for every use of a component.
    const owner = { type: "object", "x-ref-name": "Owner", properties: { name: { type: "string" } } };
    const blank = { type: "object", properties: { id: { type: "string" } } };
    const returns = (schema: object) => ({ responses: { "200": { description: "OK", content: { "application/json": { schema } } } } });
    const spec = normalizeSpec({
      source: "inline.json",
      document: { openapi: "3.0.3", info: { title: "Shared", version: "1" }, paths: { "/a": { get: returns(owner) }, "/b": { get: returns(owner) }, "/c": { get: returns(blank) } }, components: { schemas: { Owner: owner, "": blank } } },
    } as unknown as ParsedSpec);
    const body = (index: number) => spec.operations[index].responses[0].content!["application/json"].schema!;
    expect(body(0)).toBe(body(1));
    expect(body(0)).toMatchObject({ refName: "Owner", properties: { name: { type: "string" } } });
    expect(spec.schemas[""].name).toBe("");
    expect(body(2).name).toBeUndefined();
    expect(body(2).properties!.id.type).toBe("string");
  });

  it("takes an operation's own request examples from Sourcey's extension, else x-codeSamples or its older spelling", () => {
    const sample = (source: string) => [{ lang: "shell", label: "CLI", source }];
    const spec = normalizeSpec({
      source: "inline.json",
      document: { openapi: "3.0.3", info: { title: "Samples", version: "1" }, paths: {
        "/a": { get: { "x-sourcey-code-samples": sample("a"), "x-codeSamples": sample("ignored"), responses: {} } },
        "/b": { get: { "x-codeSamples": sample("b"), "x-code-samples": sample("ignored"), responses: {} } },
        "/c": { get: { "x-code-samples": sample("c"), responses: {} } },
        "/d": { get: { "x-codeSamples": [], responses: {} } },
      } },
    } as unknown as ParsedSpec);
    expect(spec.operations.map((op) => op.codeSamples?.[0]?.source)).toEqual(["a", "b", "c", undefined]);
    expect(spec.operations[1].codeSamples).toEqual([{ lang: "shell", label: "CLI", source: "b" }]);
  });

  it("names a reference left in place by its own pointer, whatever the resolver marked on it", () => {
    // A resolver leaves a component that recurs as its reference, and need mark it no other way.
    const task = { type: "object", properties: { title: { type: "string" }, subtasks: { type: "array", items: { $ref: "#/components/schemas/Task" } } } };
    const spec = normalizeSpec({
      source: "inline.json",
      document: { openapi: "3.0.3", info: { title: "Tasks", version: "1" }, paths: { "/tasks": { get: { responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } } } } } }, components: { schemas: { Task: task } } },
    } as unknown as ParsedSpec);
    const body = spec.operations[0].responses[0].content!["application/json"].schema!;
    expect(body.refName).toBe("Task");
    expect(body.properties!.subtasks.items).toMatchObject({ refName: "Task" });
  });

  it("expands a recursive component wherever it is used and links it where it would repeat", async () => {
    const spec = await loadAndNormalize("recursive-schema.yaml");
    const body = spec.operations[0].requestBody!.content["application/json"].schema!;
    expect(body.refName).toBe("Task");
    expect(Object.keys(body.properties!)).toEqual(["title", "owner", "subtasks"]);
    expect(body.properties!.owner.properties!.name.type).toBe("string");
    // The subtask is the same component again: a named link, not another level.
    expect(body.properties!.subtasks.items).toMatchObject({ refName: "Task" });
    expect(body.properties!.subtasks.items!.properties).toBeUndefined();
    expect(spec.operations[0].responses[0].content!["application/json"].schema!.properties!.title).toBeDefined();
    expect(spec.schemas.Task.properties!.subtasks.items!.properties).toBeUndefined();
  });

  describe("cheese.yml (Swagger 2.0 with external refs)", () => {
    let spec: NormalizedSpec;

    it("loads and normalizes without errors", async () => {
      spec = await loadAndNormalize("cheese.yml");
      expect(spec).toBeDefined();
    });

    it("extracts API info", () => {
      expect(spec.info.title).toBe("Cheese Store");
      expect(spec.info.version).toBeDefined();
      expect(spec.info.description).toBeDefined();
    });

    it("extracts operations from paths", () => {
      expect(spec.operations.length).toBeGreaterThan(0);
      for (const op of spec.operations) {
        expect(op.method).toBeDefined();
        expect(op.path).toBeDefined();
      }
    });

    it("assigns operations to tags", () => {
      expect(spec.tags.length).toBeGreaterThan(0);
      const tagWithOps = spec.tags.find((t) => t.operations.length > 0);
      expect(tagWithOps).toBeDefined();
    });

    it("creates implicit tags for unregistered tag names", () => {
      for (const op of spec.operations) {
        if (op.hidden) continue;
        const opTags = op.tags.length > 0 ? op.tags : ["default"];
        for (const tagName of opTags) {
          const tag = spec.tags.find((t) => t.name === tagName);
          expect(tag, `Tag "${tagName}" should exist`).toBeDefined();
          expect(tag!.operations).toContain(op);
        }
      }
    });

    it("extracts schemas/definitions", () => {
      expect(Object.keys(spec.schemas).length).toBeGreaterThan(0);
    });

    it("normalizes parameters with dedup", () => {
      for (const op of spec.operations) {
        const seen = new Set<string>();
        for (const p of op.parameters) {
          const key = `${p.in}:${p.name}`;
          expect(seen.has(key), `Duplicate param: ${key}`).toBe(false);
          seen.add(key);
        }
      }
    });

    it("normalizes responses", () => {
      const opWithResponses = spec.operations.find(
        (op) => op.responses.length > 0,
      );
      expect(opWithResponses).toBeDefined();
      for (const r of opWithResponses!.responses) {
        expect(r.statusCode).toBeDefined();
        expect(r.description).toBeDefined();
      }
    });
  });

  describe("petstore-openapi3.yaml (OpenAPI 3.0)", () => {
    let spec: NormalizedSpec;

    it("loads and normalizes without errors", async () => {
      spec = await loadAndNormalize("petstore-openapi3.yaml");
      expect(spec).toBeDefined();
    });

    it("extracts servers", () => {
      expect(spec.servers.length).toBe(2);
      expect(spec.servers[0].url).toContain("petstore.example.com");
    });

    it("extracts operations", () => {
      expect(spec.operations.length).toBe(5); // listPets, createPet, getPet, deletePet, getInventory
    });

    it("extracts request bodies", () => {
      const createPet = spec.operations.find((op) => op.operationId === "createPet");
      expect(createPet).toBeDefined();
      expect(createPet!.requestBody).toBeDefined();
      expect(createPet!.requestBody!.content["application/json"]).toBeDefined();
    });

    it("extracts security schemes", () => {
      expect(spec.securitySchemes.apiKey).toBeDefined();
      expect(spec.securitySchemes.apiKey.type).toBe("apiKey");
      expect(spec.securitySchemes.apiKey.in).toBe("header");
    });

    it("marks deprecated operations", () => {
      const deletePet = spec.operations.find((op) => op.operationId === "deletePet");
      expect(deletePet).toBeDefined();
      expect(deletePet!.deprecated).toBe(true);
    });

    it("merges path-level and operation-level parameters", () => {
      const getPet = spec.operations.find((op) => op.operationId === "getPet");
      expect(getPet).toBeDefined();
      // petId comes from path-level parameters
      const petIdParam = getPet!.parameters.find((p) => p.name === "petId");
      expect(petIdParam).toBeDefined();
      expect(petIdParam!.in).toBe("path");
      expect(petIdParam!.required).toBe(true);
    });

    it("normalizes schema types", () => {
      for (const [, schema] of Object.entries(spec.schemas)) {
        if (schema.type) {
          expect(
            typeof schema.type === "string" || Array.isArray(schema.type),
          ).toBe(true);
        }
      }
    });

    it("extracts tags with descriptions", () => {
      const petsTag = spec.tags.find((t) => t.name === "pets");
      expect(petsTag).toBeDefined();
      expect(petsTag!.description).toBe("Pet operations");
      expect(petsTag!.operations.length).toBe(4); // listPets, createPet, getPet, deletePet
    });
  });

  describe("nullable handling", () => {
    it("normalizes schemas with nullable flag", async () => {
      const spec = await loadAndNormalize("petstore-openapi3.yaml");
      for (const [, schema] of Object.entries(spec.schemas)) {
        expect(typeof schema.nullable).toBe("boolean");
      }
    });
  });

  describe("servers fallback", () => {
    it("provides default server when none specified", async () => {
      const spec = await loadAndNormalize("petstore-expanded.yml");
      expect(spec.servers.length).toBeGreaterThan(0);
    });
  });

  it("normalizes OpenAPI 3.2 query methods, response summaries, and device authorization flows", async () => {
    const spec = await loadAndNormalize("openapi-3.2.yaml");

    const queryOp = spec.operations.find((op) => op.operationId === "querySearch");
    expect(queryOp).toBeDefined();
    expect(queryOp!.method).toBe("query");

    const successResponse = queryOp!.responses.find((r) => r.statusCode === "200");
    expect(successResponse).toBeDefined();
    expect(successResponse!.summary).toBe("Search results");
    expect(successResponse!.description).toBe("Returns ranked matches.");

    const oauth = spec.securitySchemes.oauth;
    expect(oauth).toBeDefined();
    expect(oauth.type).toBe("oauth2");
    expect(oauth.flows?.deviceAuthorization).toBeDefined();
    expect(oauth.flows?.deviceAuthorization?.deviceAuthorizationUrl).toBe("https://example.com/oauth/device");
    expect(oauth.flows?.deviceAuthorization?.tokenUrl).toBe("https://example.com/oauth/token");
  });

  it("preserves rich OpenAPI 3.2 metadata for tags, encodings, path items, and security schemes", async () => {
    const spec = await loadAndNormalize("openapi-3.2-rich.yaml");

    expect(spec.info.summary).toBe("Search and indexing endpoints");

    const adminTag = spec.tags.find((tag) => tag.name === "admin");
    expect(adminTag).toBeDefined();
    expect(adminTag!.summary).toBe("Administration");
    expect(adminTag!.kind).toBe("audience");

    const childTag = spec.tags.find((tag) => tag.name === "admin-index");
    expect(childTag).toBeDefined();
    expect(childTag!.summary).toBe("Index Management");
    expect(childTag!.parent).toBe("admin");
    expect(childTag!.kind).toBe("nav");

    const queryOp = spec.operations.find((op) => op.operationId === "querySearch");
    expect(queryOp).toBeDefined();
    expect(queryOp!.method).toBe("query");

    const querystringParam = queryOp!.parameters.find((param) => param.in === "querystring");
    expect(querystringParam).toBeDefined();
    expect(querystringParam!.content?.["application/x-www-form-urlencoded"]).toBeDefined();
    expect(querystringParam!.content?.["application/x-www-form-urlencoded"]?.encoding?.facets?.explode).toBe(false);

    const createIndex = spec.operations.find((op) => op.operationId === "createIndex");
    expect(createIndex).toBeDefined();
    expect(createIndex!.requestBody?.content["application/x-www-form-urlencoded"]?.encoding?.filter?.contentType).toBe("application/json");
    expect(createIndex!.requestBody?.content["multipart/mixed"]?.prefixEncoding?.[0]?.headers?.["X-Part-Id"]?.required).toBe(true);
    expect(createIndex!.requestBody?.content["multipart/mixed"]?.itemEncoding?.contentType).toBe("text/plain");

    const oauth = spec.securitySchemes.oauth;
    expect(oauth).toBeDefined();
    expect(oauth.deprecated).toBe(true);
    expect(oauth.oauth2MetadataUrl).toBe("https://example.com/.well-known/oauth-authorization-server");
  });
});
