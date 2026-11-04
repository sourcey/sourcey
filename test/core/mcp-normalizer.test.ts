import { describe, expect, it } from "vitest";
import { normalizeMcpSpec } from "../../src/core/mcp-normalizer.js";
import type { McpSpec } from "mcp-parser";
import { formatSchemaType } from "../../src/core/schema.js";
import { schemaMarkdown } from "../../src/exports/documents.js";
import { referenceFieldPath, schemaPlan } from "../../src/core/reference-identity.js";

describe("normalizeMcpSpec", () => {
  it("renders nested tool inputs as a body instead of duplicate parameters", async () => {
    const { spec } = await normalizeMcpSpec(
      createSpec({
        tools: [
          {
            name: "search_contacts",
            description: "Search contacts.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search term" },
                filters: {
                  type: "object",
                  properties: {
                    country: { type: "string" },
                  },
                },
              },
              required: ["query"],
            },
          },
        ],
      }),
    );

    const op = spec.operations[0];
    expect(op.parameters).toEqual([]);
    expect(op.requestBody?.content["application/json"].schema?.properties?.query).toBeDefined();
    expect(op.requestBody?.content["application/json"].schema?.properties?.filters).toBeDefined();
  });

  it("keeps client configuration and callable JSON-RPC and SDK examples aligned with the snapshot", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({
      transport: { type: "stdio", command: "npx", args: ["--yes", "fixture-server"], env: { API_URL: "https://example.test", API_KEY: "your-api-key" } },
      tools: [{ name: "translate", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], examples: [{ text: "Hello" }] } }],
    }));
    const tool = spec.operations[0];
    expect(tool.mcpExtras?.connection?.transport?.env).toEqual({ API_URL: "https://example.test", API_KEY: "your-api-key" });
    const rpc = JSON.parse(tool.codeSamples!.find(sample => sample.label === "JSON-RPC")!.source);
    expect(rpc).toMatchObject({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "translate", arguments: { text: "Hello" } } });
    const typescript = tool.codeSamples!.find(sample => sample.lang === "typescript")!.source;
    const params = JSON.parse(typescript.slice(typescript.indexOf("(") + 1, typescript.lastIndexOf(")")));
    expect(params).toEqual(rpc.params);
  });

  it("keeps an HTTP transport's header placeholders for the client configuration", async () => {
    const transport = { type: "streamable-http", url: "https://tasks.example/api/v2/mcp", headers: { Authorization: "Bearer YOUR_TOKEN", Retries: 3 } };
    const { spec } = await normalizeMcpSpec(createSpec({ transport: transport as never, tools: [{ name: "tasks_list", inputSchema: { type: "object" } }] }));
    expect(spec.operations[0].mcpExtras?.connection?.transport).toEqual({ type: "streamable-http", url: transport.url, headers: { Authorization: "Bearer YOUR_TOKEN" } });
  });

  it("renders flat tool inputs as parameters", async () => {
    const { spec } = await normalizeMcpSpec(
      createSpec({
        tools: [
          {
            name: "get_contact",
            inputSchema: {
              type: "object",
              properties: {
                email: { type: "string" },
              },
              required: ["email"],
            },
          },
        ],
      }),
    );

    const op = spec.operations[0];
    expect(op.parameters.map((param) => param.name)).toEqual(["email"]);
    expect(op.requestBody).toBeUndefined();
  });

  it("sections the server by kind when it names no groups", async () => {
    const { spec, ungrouped } = await normalizeMcpSpec(createSpec({
      tools: [{ name: "start_timer", inputSchema: { type: "object" } }],
      resources: [{ name: "status", uri: "app://status" }] as never,
      prompts: [{ name: "summarise" }] as never,
    }));
    expect(spec.tags.map((tag) => [tag.name, tag.operations.map((op) => op.path)])).toEqual([["Tools", ["start_timer"]], ["Resources", ["app://status"]], ["Prompts", ["summarise"]]]);
    expect(ungrouped).toEqual([]);
  });

  it("sections the server by its groups in their order, then lists by kind what no group names", async () => {
    const { spec, ungrouped } = await normalizeMcpSpec(createSpec({
      tools: ["login", "logout", "start_timer", "stop_timer", "export"].map((name) => ({ name, inputSchema: { type: "object" } })),
      resources: [{ name: "timer", uri: "app://timer" }] as never,
    }), { Timer: ["stop_timer", "start_timer", "timer"], Authentication: ["login", "logout"] });
    expect(spec.tags.map((tag) => [tag.name, tag.operations.map((op) => op.path)])).toEqual([
      ["Timer", ["stop_timer", "start_timer", "app://timer"]],
      ["Authentication", ["login", "logout"]],
      ["Tools", ["export"]],
    ]);
    expect(spec.operations.find((op) => op.path === "app://timer")!.tags).toEqual(["Timer"]);
    expect(ungrouped).toEqual(["export"]);
  });

  it("refuses a group naming what the server lacks, or a name listed twice", async () => {
    const server = createSpec({ tools: [{ name: "login", inputSchema: { type: "object" } }] });
    await expect(normalizeMcpSpec(server, { Access: ["login", "logn"] })).rejects.toThrow('MCP group "Access" lists "logn", which the server does not have');
    await expect(normalizeMcpSpec(server, { Access: ["login"], Sessions: ["login"] })).rejects.toThrow('MCP groups list "login" twice');
  });

  it("resolves schema-local output definitions, keeping their names and fields", async () => {
    const input = createSpec({ tools: [{
      name: "get_thing", inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", $defs: {
        Thing: { type: "object", properties: { id: { type: "string" }, size: { type: "integer" } }, required: ["id", "size"] },
      }, properties: { thing: { $ref: "#/$defs/Thing" } }, required: ["thing"] },
    }] });
    const before = JSON.stringify(input);
    const { spec } = await normalizeMcpSpec(input);
    const output = spec.operations[0].mcpExtras!.outputSchema!;
    expect(output.required).toEqual(["thing"]);
    expect(output.properties!.thing).toMatchObject({ name: "Thing", type: "object", properties: { id: { type: "string" }, size: { type: "integer" } }, required: ["id", "size"] });
    expect(formatSchemaType(output.properties!.thing)).toBe("Thing");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("uses resolved inputs for argument rows, nested bodies and examples", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [
      { name: "flat", inputSchema: { type: "object", $defs: { Limit: { type: "integer", minimum: 1, default: 10 } }, properties: { limit: { $ref: "#/$defs/Limit", description: "Maximum results" } }, required: ["limit"] } },
      { name: "nested", inputSchema: { type: "object", $defs: { Filter: { type: "object", properties: { tag: { type: "string" } } } }, properties: { filter: { $ref: "#/$defs/Filter" } } } },
    ] }));
    expect(spec.operations[0].parameters[0]).toMatchObject({ name: "limit", required: true, description: "Maximum results", example: 10, schema: { type: "integer", name: "Limit", minimum: 1 } });
    expect(spec.operations[1].parameters).toEqual([]);
    expect(spec.operations[1].requestBody!.content["application/json"].schema!.properties!.filter.name).toBe("Filter");
    expect(JSON.parse(spec.operations[1].codeSamples![0].source).params.arguments).toEqual({ filter: { tag: "string" } });
  });

  it("isolates each tool's input and output definitions, while resolving shared definitions", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({
      $defs: { Shared: { type: "boolean" }, Value: { type: "number" } },
      tools: ["one", "two"].map(name => ({ name,
        inputSchema: { type: "object", $defs: { Value: { type: "string" } }, properties: { value: { $ref: "#/$defs/Value" }, shared: { $ref: "#/$defs/Shared" } } },
        outputSchema: { type: "object", $defs: { Value: { type: name === "one" ? "integer" : "boolean" } }, properties: { value: { $ref: "#/$defs/Value" } } },
      })),
    }));
    expect(spec.operations.map(op => op.parameters[0].schema.type)).toEqual(["string", "string"]);
    expect(spec.operations.map(op => op.parameters[1].schema.type)).toEqual(["boolean", "boolean"]);
    expect(spec.operations.map(op => op.mcpExtras!.outputSchema!.properties!.value.type)).toEqual(["integer", "boolean"]);
    expect(spec.schemas.Value.type).toBe("number");
  });

  it("keeps references in unions, arrays and maps, including escaped definition names", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [{ name: "choose", inputSchema: { type: "object" }, outputSchema: {
      type: "object", $defs: { "Foo/Bar~ space": { type: "string" }, Other: { type: "integer" } }, properties: {
        choice: { anyOf: [{ $ref: "#/$defs/Foo~1Bar~0%20space" }, { $ref: "#/$defs/Other" }] },
        list: { type: "array", items: { $ref: "#/$defs/Other" } },
        map: { type: "object", additionalProperties: { $ref: "#/$defs/Other" } },
      },
    } }] }));
    const fields = spec.operations[0].mcpExtras!.outputSchema!.properties!;
    expect(formatSchemaType(fields.choice)).toBe("string | integer");
    expect(fields.list.items).toMatchObject({ type: "integer", name: "Other" });
    expect(fields.map.additionalProperties).toMatchObject({ type: "integer", name: "Other" });
  });

  it("terminates recursive definitions and shares repeated converted types", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [{ name: "tree", inputSchema: { type: "object" }, outputSchema: {
      type: "object", $defs: { Node: { type: "object", properties: { id: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/Node" } } } } },
      properties: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`node${i}`, { $ref: "#/$defs/Node" }])),
    } }] }));
    const output = spec.operations[0].mcpExtras!.outputSchema!;
    const first = output.properties!.node0;
    expect(first).toMatchObject({ name: "Node", type: "object", properties: { id: { type: "string" }, children: { items: { name: "Node", type: "object" } } } });
    expect(first.properties!.children.items!.properties).toBeUndefined();
    expect(output.properties!.node99.properties).toBe(first.properties);
    expect(() => JSON.stringify(output)).not.toThrow();
  });

  it("refuses missing or external references instead of silently rendering an unknown type", async () => {
    for (const ref of ["#/$defs/Missing", "https://example.test/schema.json", "file:///not-a-schema.json"]) {
      await expect(normalizeMcpSpec(createSpec({ tools: [{ name: "bad", inputSchema: { type: "object", properties: { value: { $ref: ref } } } }] }))).rejects.toThrow();
    }
  });

  it("terminates root and mutually recursive references without inventing property type names", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [
      { name: "root", inputSchema: { type: "object", properties: { self: { $ref: "#" }, ordinary: { type: "string" } } } },
      { name: "mutual", inputSchema: { type: "object" }, outputSchema: { type: "object", $defs: {
        A: { type: "object", properties: { b: { $ref: "#/$defs/B" } } },
        B: { type: "object", properties: { a: { $ref: "#/$defs/A" } } },
      }, properties: { a: { $ref: "#/$defs/A" }, b: { $ref: "#/$defs/B" } } } },
    ] }));
    const root = spec.operations[0].requestBody!.content["application/json"].schema!;
    expect(root.name).toBe("root");
    expect(root.properties!.self.name).toBe("root");
    expect(formatSchemaType(root.properties!.ordinary)).toBe("string");
    expect(spec.operations[1].mcpExtras!.outputSchema!.properties!.a.properties!.b.properties!.a.name).toBe("A");
    const plan = schemaPlan(spec.operations[1].mcpExtras!.outputSchema!);
    expect(plan.links.get(referenceFieldPath("", "properties", "b", "properties", "a"))?.at).toBe(referenceFieldPath("", "properties", "a"));
    expect(() => JSON.stringify(spec)).not.toThrow();
  });

  it("exports a shared local type once instead of expanding a reference graph exponentially", async () => {
    const definitions = Object.fromEntries(Array.from({ length: 13 }, (_, level) => [`Level${level}`, {
      type: "object", properties: level === 12 ? { leaf: { type: "string" } } : {
        left: { $ref: `#/$defs/Level${level + 1}` }, right: { $ref: `#/$defs/Level${level + 1}` },
      },
    }]));
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [{ name: "graph", inputSchema: { type: "object" }, outputSchema: {
      $defs: definitions, $ref: "#/$defs/Level0",
    } }] }));
    const markdown = schemaMarkdown(spec.operations[0].mcpExtras!.outputSchema!);
    expect(markdown.match(/`leaf`/g)).toHaveLength(1);
    expect(markdown).toContain("Type: Level12");
    expect(markdown.length).toBeLessThan(20_000);
  });

  it("does not invent type names for references to fields or array positions", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [{ name: "reuse", inputSchema: {
      type: "object", properties: {
        from: { type: "string" }, to: { $ref: "#/properties/from" },
        choice: { anyOf: [{ type: "integer" }, { type: "boolean" }] }, number: { $ref: "#/properties/choice/anyOf/0" },
      },
    } }] }));
    const fields = spec.operations[0].requestBody!.content["application/json"].schema!.properties!;
    expect([fields.from, fields.to, fields.number].map(schema => formatSchemaType(schema))).toEqual(["string", "string", "integer"]);
    expect(fields.from.name).toBeUndefined();
  });

  it("keeps references inside shared models in their original scope", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({
      $defs: {
        Page: { type: "object", properties: { cursor: { $ref: "#/$defs/Cursor" } } },
        Cursor: { type: "object", properties: { shared: { type: "string" } } },
      },
      tools: [{ name: "list", inputSchema: { type: "object", $defs: {
        Cursor: { type: "object", properties: { local: { type: "integer" } } },
      }, properties: { page: { $ref: "#/$defs/Page" }, cursor: { $ref: "#/$defs/Cursor" } } } }],
    }));
    const fields = spec.operations[0].requestBody!.content["application/json"].schema!.properties!;
    expect(fields.page.properties!.cursor).toMatchObject({ name: "Cursor", properties: { shared: { type: "string" } } });
    expect(fields.cursor).toMatchObject({ name: "list.input.Cursor", properties: { local: { type: "integer" } } });
    expect(spec.schemas.Page.properties!.cursor.properties!.shared.type).toBe("string");
  });

  it("distinguishes legacy definitions from same-named local and shared definitions", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({
      $defs: { Cursor: { type: "object", properties: { shared: { type: "string" } } } },
      tools: [{ name: "list", inputSchema: { type: "object" }, outputSchema: {
        type: "object",
        $defs: { Cursor: { type: "object", properties: { local: { type: "integer" } } } },
        definitions: { Cursor: { type: "object", properties: { legacy: { type: "boolean" } } } },
        properties: { current: { $ref: "#/$defs/Cursor" }, legacy: { $ref: "#/definitions/Cursor" } },
      } }, { name: "shared", inputSchema: { type: "object", definitions: {
        Cursor: { type: "object", properties: { legacy: { type: "boolean" } } },
      }, properties: { current: { $ref: "#/$defs/Cursor" }, legacy: { $ref: "#/definitions/Cursor" } } } }],
    }));
    const local = spec.operations[0].mcpExtras!.outputSchema!.properties!;
    expect(local.current).toMatchObject({ name: "list.output.$defs.Cursor", properties: { local: { type: "integer" } } });
    expect(local.legacy).toMatchObject({ name: "list.output.definitions.Cursor", properties: { legacy: { type: "boolean" } } });
    const shared = spec.operations[1].requestBody!.content["application/json"].schema!.properties!;
    expect(shared.current).toMatchObject({ name: "Cursor", properties: { shared: { type: "string" } } });
    expect(shared.legacy).toMatchObject({ name: "shared.input.Cursor", properties: { legacy: { type: "boolean" } } });
  });

  it("accepts boolean subschemas and preserves the difference between unconstrained and impossible", async () => {
    const { spec } = await normalizeMcpSpec(createSpec({ tools: [{ name: "booleans", inputSchema: { type: "object" }, outputSchema: {
      type: "object", properties: {
        any: true as never, impossible: false as never,
        list: { type: "array", items: false as never },
        negated: { not: true as never }, either: { anyOf: [true as never, { type: "string" }] },
      },
    } }] }));
    const fields = spec.operations[0].mcpExtras!.outputSchema!.properties!;
    expect(formatSchemaType(fields.any)).toBe("any");
    expect(formatSchemaType(fields.impossible)).toBe("never");
    expect(formatSchemaType(fields.list)).toBe("Array<never>");
    expect(formatSchemaType(fields.negated)).toBe("never");
  });
});

function createSpec(overrides: Partial<McpSpec>): McpSpec {
  return {
    mcpSpec: "0.2.0",
    mcpVersion: "2025-11-25",
    server: { name: "test", version: "1.0.0" },
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    ...overrides,
  } as unknown as McpSpec;
}
