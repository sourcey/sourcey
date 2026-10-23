import { describe, expect, it } from "vitest";
import { metadataSummary, pageMetadata } from "../../src/core/page-metadata.js";
import type { NormalizedOperation, NormalizedSpec } from "../../src/core/types.js";

const site = { name: "Cheesestore", titleSeparator: " - " };

const operation: NormalizedOperation = {
  method: "get", path: "/cheeses", summary: "List cheeses", tags: [], parameters: [], responses: [], security: [], deprecated: false,
  description: "Lists every **cheese** in [the store](/store/), aged or fresh.\n\nPaginated.",
};

const spec: NormalizedSpec = {
  info: { title: "Cheese API", version: "1.0.0", description: "The whole API: `cheeses`, orders &amp; more." },
  servers: [], tags: [], operations: [operation], webhooks: [], securitySchemes: {},
  schemas: {
    Cheese: { type: "object", description: "One cheese, with its <em>origin</em>." },
    Plain: { type: "object" },
    Rind: { type: "object", properties: { id: { type: "string" }, texture: { type: "string" }, edible: { type: "boolean" } } },
    Aging: { type: "string", enum: ["fresh", "aged"] },
  },
};

describe("page metadata", () => {
  it("summarises in plain text: no Markdown or HTML syntax, entities decoded", () => {
    expect(metadataSummary("Use [the API](/api/) with `curl` &amp; **care**.<br>Then <script>x()</script>stop.")).toBe("Use the API with curl & care. Then stop.");
    expect(metadataSummary("See also:\n\n- [Guide](/guide/)\n\nThe real summary.")).toBe("The real summary.");
  });

  it("describes an operation from its description, and a model from its own description", () => {
    const op = pageMetadata({ kind: "spec", spec, view: { kind: "operation", id: "GET /cheeses" } }, site);
    expect(op).toMatchObject({ title: "List cheeses", browserTitle: "List cheeses - Cheesestore", description: "Lists every cheese in the store, aged or fresh." });
    expect(pageMetadata({ kind: "spec", spec, view: { kind: "schema", name: "Cheese" } }, site).description).toBe("One cheese, with its origin.");
  });

  it("describes an operation whose summary only repeats its title by what it takes and returns", () => {
    const cheese = { type: "object", refName: "Cheese" } as const;
    const create: NormalizedOperation = {
      method: "post", path: "/cheeses", summary: "Create a cheese", tags: [], parameters: [], security: [], deprecated: false,
      requestBody: { required: true, content: { "application/json": { schema: cheese } } },
      responses: [{ statusCode: "201", description: "Created", content: { "application/json": { schema: cheese } } }],
    };
    const metadata = pageMetadata({ kind: "spec", spec: { ...spec, operations: [create] }, view: { kind: "operation", id: "POST /cheeses" } }, site);
    expect(metadata).toMatchObject({ title: "Create a cheese", description: "POST /cheeses: takes Cheese, returns Cheese." });
  });

  it("describes a model without a description by what it holds", () => {
    const rind = pageMetadata({ kind: "spec", spec, view: { kind: "schema", name: "Rind" } }, site);
    expect(rind).toMatchObject({ summary: "", description: "Fields: id, texture and edible." });
    expect(pageMetadata({ kind: "spec", spec, view: { kind: "schema", name: "Aging" } }, site).description).toBe("One of: fresh and aged.");
  });

  it("falls back to the title, never to another page's text, when a source has no summary", () => {
    const model = pageMetadata({ kind: "spec", spec, view: { kind: "schema", name: "Plain" } }, site);
    expect(model).toMatchObject({ summary: "", description: "Plain" });
  });

  it("leaves the site's name off a title that opens with it", () => {
    const titled = (title: string, name: string) => pageMetadata({ kind: "markdown", markdown: { title } } as Parameters<typeof pageMetadata>[0], { name, titleSeparator: " - " }).browserTitle;
    expect(titled("Firefly III documentation", "Firefly III")).toBe("Firefly III documentation");
    expect(titled("Ever® Gauzy™ Platform", "Ever Gauzy™ Platform")).toBe("Ever® Gauzy™ Platform");
    expect(titled("Cheesestore", "cheesestore")).toBe("Cheesestore");
    // A word that only starts with it is another name.
    expect(titled("Cheesestores near you", "Cheesestore")).toBe("Cheesestores near you - Cheesestore");
    expect(titled("Getting started", "Cheesestore")).toBe("Getting started - Cheesestore");
  });

  it("titles a reference overview by the site and the reference it is", () => {
    const overview = pageMetadata({ kind: "spec", spec }, site);
    expect(overview).toMatchObject({ title: "Cheese API", browserTitle: "Cheesestore - API Reference", description: "The whole API: cheeses, orders & more." });
    expect(pageMetadata({ kind: "spec", spec }, site, "REST API").browserTitle).toBe("Cheesestore - REST API");
  });
});
