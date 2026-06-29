import { describe, expect, it } from "vitest";
import { generateCodeSamples } from "../../src/utils/code-samples.js";
import type { NormalizedOperation } from "../../src/core/types.js";
import { loadSpec } from "../../src/core/loader.js";
import { parseSpec } from "../../src/core/parser.js";
import { convertToOpenApi3 } from "../../src/core/converter.js";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

function createOperation(overrides?: Partial<NormalizedOperation>): NormalizedOperation {
  return {
    method: "query",
    path: "/search",
    summary: "Query search index",
    tags: [],
    parameters: [],
    responses: [],
    security: [],
    deprecated: false,
    ...overrides,
  };
}

describe("generateCodeSamples", () => {
  it("falls back to generic request APIs for non-standard HTTP methods", () => {
    const samples = generateCodeSamples(createOperation(), "https://api.example.com", [
      "python",
      "ruby",
      "rust",
      "csharp",
    ]);

    expect(samples.find((sample) => sample.lang === "python")?.source).toContain(
      "requests.request('QUERY', 'https://api.example.com/search')",
    );
    expect(samples.find((sample) => sample.lang === "ruby")?.source).toContain(
      "Net::HTTPGenericRequest.new('QUERY'",
    );
    expect(samples.find((sample) => sample.lang === "rust")?.source).toContain(
      'client.request(reqwest::Method::from_bytes(b"QUERY").unwrap(), "https://api.example.com/search")',
    );
    expect(samples.find((sample) => sample.lang === "csharp")?.source).toContain(
      'new HttpMethod("QUERY")',
    );
  });

  it("escapes apostrophes in single-quoted request body samples", () => {
    const samples = generateCodeSamples(
      createOperation({
        method: "post",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { message: "it's ready" },
            },
          },
        },
      }),
      "https://api.example.com",
      ["curl", "ruby", "php"],
    );

    expect(samples.find((sample) => sample.label === "cURL")?.source).toContain("it'\\''s ready");
    expect(samples.find((sample) => sample.label === "Ruby")?.source).toContain("it\\'s ready");
    expect(samples.find((sample) => sample.label === "PHP")?.source).toContain("it\\'s ready");
  });

  it("keeps the request body in JavaScript samples for OpenAPI request bodies", async () => {
    const loaded = await loadSpec(`${FIXTURES}/petstore-openapi3.yaml`);
    const parsed = await parseSpec(loaded);
    const converted = await convertToOpenApi3(parsed);
    const spec = normalizeSpec(converted);
    const operation = spec.operations.find((op) => op.operationId === "createPet");

    expect(operation).toBeDefined();

    const [sample] = generateCodeSamples(operation!, spec.servers[0].url, ["javascript"]);

    expect(sample.source).toContain("method: 'POST'");
    expect(sample.source).toContain("body: JSON.stringify");
    expect(sample.source).toContain('"name": "string"');
    expect(() => new Function(`async function run() {\n${sample.source}\n}`)).not.toThrow();
  });
});
