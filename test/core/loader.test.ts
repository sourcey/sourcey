import { describe, it, expect } from "vitest";
import { loadSpec } from "../../src/core/loader.js";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

describe("loadSpec", () => {
  it("loads a YAML spec file", async () => {
    const result = await loadSpec(`${FIXTURES}/cheese.yml`);
    expect(result.format).toBe("yaml");
    expect(result.version).toBe("openapi-3.1");
    expect(result.raw.openapi).toBe("3.1.0");
    expect((result.raw.info as Record<string, unknown>).title).toBe("Cheese Store");
  });

  it("loads a JSON spec file", async () => {
    const result = await loadSpec(`${FIXTURES}/petstore.json`);
    expect(result.format).toBe("json");
    expect(result.version).toBe("swagger-2.0");
  });

  it("detects OpenAPI 3.0 version", async () => {
    const result = await loadSpec(`${FIXTURES}/petstore-openapi3.yaml`);
    expect(result.version).toBe("openapi-3.0");
    expect(result.raw.openapi).toBe("3.0.3");
  });

  it("detects OpenAPI 3.2 version", async () => {
    const result = await loadSpec(`${FIXTURES}/openapi-3.2.yaml`);
    expect(result.version).toBe("openapi-3.2");
    expect(result.raw.openapi).toBe("3.2.0");
  });

  it("throws on missing file", async () => {
    await expect(loadSpec("/nonexistent/spec.yml")).rejects.toThrow("File not found: /nonexistent/spec.yml");
  });

  it("throws on unrecognized spec version", async () => {
    await expect(loadSpec(`${FIXTURES}/document.json`)).rejects.toThrow(
      "Unable to detect spec version",
    );
  });

  it("resolves absolute path in source", async () => {
    const result = await loadSpec(`${FIXTURES}/cheese.yml`);
    expect(result.source).toBe(resolve(`${FIXTURES}/cheese.yml`));
  });
});
