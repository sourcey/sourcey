import { describe, it, expect } from "vitest";
import { buildExampleVariants, variantFromSchema } from "../../src/utils/example-variants.js";
import type { MediaTypeContent } from "../../src/core/types.js";

function content(map: Record<string, MediaTypeContent>) {
  return map;
}

describe("buildExampleVariants", () => {
  it("renders provided named examples, one variant each", () => {
    const variants = buildExampleVariants(content({
      "application/json": {
        schema: { type: "array" },
        examples: {
          "two-clients": { summary: "Two clients", value: [{ firstName: "Bruce" }] },
          "empty": { summary: "No clients", value: [] },
        },
      },
    }));

    expect(variants).toHaveLength(2);
    expect(variants[0].label).toBe("Two clients");
    expect(variants[0].raw).toContain("Bruce");
    expect(variants[1].label).toBe("No clients");
    expect(variants[1].raw).toBe("[]");
  });

  it("prefers the provided single example over the schema", () => {
    const variants = buildExampleVariants(content({
      "application/json": {
        schema: { type: "object", properties: { token: { type: "string" } } },
        example: { token: "a-real-token" },
      },
    }));

    expect(variants).toHaveLength(1);
    expect(variants[0].raw).toContain("a-real-token");
    expect(variants[0].label).toBe("Example");
  });

  it("falls back to a schema-generated example when none is provided", () => {
    const variants = buildExampleVariants(content({
      "application/json": {
        schema: { type: "object", properties: { id: { type: "string", example: "x1" } } },
      },
    }));

    expect(variants).toHaveLength(1);
    expect(variants[0].raw).toContain("x1");
  });

  it("emits a variant per media type, labelled by content type", () => {
    const variants = buildExampleVariants(content({
      "application/json": { example: { ok: true } },
      "application/xml": { example: "<ok/>" },
    }));

    expect(variants.map((v) => v.label)).toEqual(["application/json", "application/xml"]);
    expect(variants[1].mediaType).toBe("application/xml");
  });

  it("represents an external example as a link, not inline code", () => {
    const variants = buildExampleVariants(content({
      "application/json": {
        examples: { ext: { externalValue: "https://example.com/sample.json" } },
      },
    }));

    expect(variants).toHaveLength(1);
    expect(variants[0].externalValue).toBe("https://example.com/sample.json");
    expect(variants[0].html).toBe("");
  });

  it("returns nothing for empty content", () => {
    expect(buildExampleVariants(undefined)).toEqual([]);
    expect(buildExampleVariants({})).toEqual([]);
  });
});

describe("variantFromSchema", () => {
  it("uses the schema example and labels the variant", () => {
    const variant = variantFromSchema({ type: "string", example: "hi" }, "Response");
    expect(variant?.label).toBe("Response");
    expect(variant?.raw).toBe('"hi"');
  });

  it("returns null when no example can be produced", () => {
    expect(variantFromSchema({})).toBeNull();
  });
});
