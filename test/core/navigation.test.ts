import { describe, expect, it } from "vitest";
import { buildNavFromSpec } from "../../src/core/navigation.js";
import type { NormalizedOperation, NormalizedSpec } from "../../src/core/types.js";

const operation: NormalizedOperation = {
  method: "get",
  path: "/cheeses",
  tags: ["Cheese"],
  summary: "List cheeses",
  parameters: [],
  responses: [{ statusCode: "200", description: "OK" }],
  security: [],
  deprecated: false,
};

const spec: NormalizedSpec = {
  info: { title: "Cheese Store", version: "1.0.0" },
  servers: [],
  tags: [
    {
      name: "Cheese",
      description: "Cheese endpoints explain the catalog before the operations.",
      operations: [operation],
    },
  ],
  operations: [operation],
  schemas: {},
  securitySchemes: {},
  webhooks: [],
};

describe("buildNavFromSpec", () => {
  it("links OpenAPI tag groups to their rendered intro sections", () => {
    const nav = buildNavFromSpec(spec, "api");
    const tagGroup = nav.groups.find((group) => group.label === "Cheese");

    expect(tagGroup).toMatchObject({
      id: "tag-cheese",
      href: "api.html#tag-cheese",
      items: [
        {
          id: "operation-cheeses-get",
          href: "api.html#operation-cheeses-get",
          label: "List cheeses",
          method: "get",
        },
      ],
    });
  });
});
