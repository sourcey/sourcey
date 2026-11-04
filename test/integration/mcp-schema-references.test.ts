import { it, expect } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { mcp } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, writeSourceySite } from "../../src/site.js";

it("publishes schema-local MCP types and their fields in HTML and readable exports", async () => {
  const root = await mkdtemp(join(tmpdir(), "sourcey-mcp-local-refs-"));
  try {
    await writeFile(join(root, "mcp.json"), JSON.stringify({
      mcpSpec: "0.2.0", mcpVersion: "2025-11-25", server: { name: "Things", version: "1.0.0" },
      $defs: { Thing: { type: "string", description: "A different snapshot-wide type." } },
      tools: [{ name: "get_thing", description: "Returns a thing.", inputSchema: { type: "object", properties: {} }, outputSchema: {
        type: "object", $defs: {
          Thing: { type: "object", properties: { id: { type: "string" }, size: { type: "integer" } }, required: ["id", "size"] },
          Other: { type: "object", properties: { label: { type: "string" } } },
        },
        properties: { thing: { $ref: "#/$defs/Thing" }, choice: { anyOf: [{ $ref: "#/$defs/Thing" }, { $ref: "#/$defs/Other" }] } },
        required: ["thing"],
      } }],
    }));
    const config = await resolveConfigFromRaw({
      name: "Things", siteUrl: "https://docs.example.test", theme: { fonts: { google: false } },
      navigation: { tabs: [{ tab: "Tools", slug: "", source: mcp("mcp.json") }] },
    }, root);
    const site = await buildSourceySite({ config, outputDir: join(root, "dist"), generateOgImages: false });
    await writeSourceySite(site);
    const html = await readFile(join(root, "dist", site.pages[0].outputPath), "utf8");
    const document = new JSDOM(html).window.document;
    const fields = [...document.querySelectorAll(".param-header")];
    const thing = fields.find(field => field.querySelector(".param-name")?.textContent === "thing")!;
    expect(thing.querySelector(".json-property-type")?.textContent).toBe("get_thing.output.Thing");
    expect(thing.querySelector("a.json-property-reference")).toBeNull();
    expect(fields.some(field => field.querySelector(".param-name")?.textContent === "id" && field.querySelector(".json-property-type")?.textContent === "string")).toBe(true);
    expect(fields.some(field => field.querySelector(".param-name")?.textContent === "size" && field.querySelector(".json-property-type")?.textContent === "integer")).toBe(true);
    expect([...document.querySelectorAll("[data-schema-picker] option")].map(option => option.textContent)).toEqual(["get_thing.output.Thing", "Other"]);
    const readable = await readFile(join(root, "dist", "llms-full.txt"), "utf8");
    expect(readable).toContain("Type: get_thing.output.Thing");
    expect(readable).toContain("`id` (required)");
    expect(readable).toContain("`size` (required)");
    expect(readable).toContain("Type: integer");
    expect(readable).not.toContain("Type: unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
