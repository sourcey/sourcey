/**
 * Convert an McpSpec (from mcp-parser) into a NormalizedSpec for rendering.
 *
 * This is the bridge between the MCP snapshot format and sourcey's
 * format-agnostic rendering pipeline. Everything downstream (components,
 * search, navigation, themes) works unchanged.
 */

import type {
  McpSpec,
  McpTool,
  McpResource,
  McpResourceTemplate,
  McpPrompt,
  JsonSchema,
} from "mcp-parser";
import type {
  NormalizedSpec,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedTag,
  NormalizedSchema,
  NormalizedRequestBody,
  McpConnectionInfo,
  CodeSample,
  HttpMethod,
} from "./types.js";
import { generateExample } from "../utils/example-generator.js";

// ── Public API ────────────────────────────────────────────────────────

export function normalizeMcpSpec(spec: McpSpec): NormalizedSpec {
  const connectionInfo: McpConnectionInfo = {
    transport: spec.transport
      ? {
          type: spec.transport.type,
          command: spec.transport.command,
          args: spec.transport.args,
          env: spec.transport.env,
          url: spec.transport.url,
          headers: transportHeaders(spec.transport),
        }
      : undefined,
    serverName: spec.server.name,
    mcpVersion: spec.mcpVersion,
    capabilities: spec.capabilities as Record<string, unknown> | undefined,
  };

  const toolOps = (spec.tools ?? []).map((t: McpTool) => toolToOperation(t, connectionInfo));
  const resourceOps = (spec.resources ?? []).map((r: McpResource) =>
    resourceToOperation(r, connectionInfo),
  );
  const templateOps = (spec.resourceTemplates ?? []).map((t: McpResourceTemplate) =>
    resourceTemplateToOperation(t, connectionInfo),
  );
  const promptOps = (spec.prompts ?? []).map((p: McpPrompt) =>
    promptToOperation(p, connectionInfo),
  );

  const allOps = [...toolOps, ...resourceOps, ...templateOps, ...promptOps];

  // Build tags — only for non-empty groups
  const tags: NormalizedTag[] = [];
  if (toolOps.length) tags.push({ name: "Tools", operations: toolOps });
  if (resourceOps.length || templateOps.length)
    tags.push({ name: "Resources", operations: [...resourceOps, ...templateOps] });
  if (promptOps.length) tags.push({ name: "Prompts", operations: promptOps });

  // Shared schema definitions from $defs
  const schemas: Record<string, NormalizedSchema> = {};
  if (spec.$defs) {
    for (const [name, schema] of Object.entries(spec.$defs)) {
      schemas[name] = convertSchema(schema, name);
    }
  }

  return {
    info: {
      title: spec.server.name,
      version: spec.server.version,
      description: spec.description,
    },
    servers: spec.transport?.url ? [{ url: spec.transport.url }] : [],
    tags,
    operations: allOps,
    schemas,
    securitySchemes: {},
    webhooks: [],
  };
}

// ── Tool → Operation ──────────────────────────────────────────────────

function toolToOperation(tool: McpTool, connection: McpConnectionInfo): NormalizedOperation {
  const group = (tool as unknown as Record<string, unknown>)["x-sourcey-group"] as
    | string
    | undefined;
  const inputSchema = convertSchema(tool.inputSchema);
  const outputSchema = tool.outputSchema ? convertSchema(tool.outputSchema) : undefined;

  const emitsRequestBody = hasNestedProperties(tool.inputSchema);
  const parameters = emitsRequestBody ? [] : flattenInputSchema(tool.inputSchema);
  const requestBody = emitsRequestBody
    ? ({
        required: true,
        content: { "application/json": { schema: inputSchema } },
      } satisfies NormalizedRequestBody)
    : undefined;

  return {
    operationId: tool.name,
    summary: tool.title ?? tool.name,
    description: tool.description,
    method: "tool" as HttpMethod,
    path: tool.name,
    tags: [group ?? "Tools"],
    parameters,
    requestBody,
    responses: [],
    security: [],
    deprecated: false,
    codeSamples: generateToolSamples(tool, inputSchema),
    mcpExtras: {
      type: "tool",
      annotations: tool.annotations
        ? {
            readOnlyHint: tool.annotations.readOnlyHint,
            destructiveHint: tool.annotations.destructiveHint,
            idempotentHint: tool.annotations.idempotentHint,
            openWorldHint: tool.annotations.openWorldHint,
          }
        : undefined,
      outputSchema,
      connection,
    },
  };
}

// ── Resource → Operation ──────────────────────────────────────────────

function resourceToOperation(
  resource: McpResource,
  connection: McpConnectionInfo,
): NormalizedOperation {
  const group = (resource as unknown as Record<string, unknown>)["x-sourcey-group"] as
    | string
    | undefined;

  return {
    operationId: resourceOperationId(resource.name),
    summary: resource.name,
    description: resource.description,
    method: "resource" as HttpMethod,
    path: resource.uri,
    tags: [group ?? "Resources"],
    parameters: [],
    responses: [],
    security: [],
    deprecated: false,
    codeSamples: generateResourceSamples(resource),
    mcpExtras: {
      type: "resource",
      connection,
    },
  };
}

// ── Resource Template → Operation ─────────────────────────────────────

function resourceTemplateToOperation(
  template: McpResourceTemplate,
  connection: McpConnectionInfo,
): NormalizedOperation {
  const group = (template as unknown as Record<string, unknown>)["x-sourcey-group"] as
    | string
    | undefined;

  return {
    operationId: resourceOperationId(template.name),
    summary: template.name,
    description: template.description,
    method: "resource" as HttpMethod,
    path: template.uriTemplate,
    tags: [group ?? "Resources"],
    parameters: extractUriTemplateParams(template.uriTemplate),
    responses: [],
    security: [],
    deprecated: false,
    codeSamples: generateResourceSamples({ uri: template.uriTemplate, name: template.name }),
    mcpExtras: {
      type: "resource",
      connection,
    },
  };
}

// ── Prompt → Operation ────────────────────────────────────────────────

function promptToOperation(prompt: McpPrompt, connection: McpConnectionInfo): NormalizedOperation {
  const group = (prompt as unknown as Record<string, unknown>)["x-sourcey-group"] as
    | string
    | undefined;

  const parameters: NormalizedParameter[] = (prompt.arguments ?? []).map((arg) => ({
    name: arg.name,
    in: "argument" as const,
    description: arg.description,
    required: arg.required ?? false,
    deprecated: false,
    schema: { type: "string" },
  }));

  return {
    operationId: prompt.name,
    summary: prompt.name,
    description: prompt.description,
    method: "prompt" as HttpMethod,
    path: prompt.name,
    tags: [group ?? "Prompts"],
    parameters,
    responses: [],
    security: [],
    deprecated: false,
    codeSamples: generatePromptSamples(prompt),
    mcpExtras: {
      type: "prompt",
      connection,
    },
  };
}

// ── Schema conversion ─────────────────────────────────────────────────

function convertSchema(schema: JsonSchema, name?: string): NormalizedSchema {
  const result: NormalizedSchema = {};

  if (name) result.name = name;
  if (schema.type) result.type = schema.type as string | string[];
  if (schema.format) result.format = schema.format;
  if (schema.title) result.title = schema.title;
  if (schema.description) result.description = schema.description;
  if (schema.default !== undefined) result.default = schema.default;
  if (schema.enum) result.enum = schema.enum;
  if (schema.const !== undefined) result.const = schema.const;

  // Object
  if (schema.properties) {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = convertSchema(prop, key);
    }
  }
  if (schema.additionalProperties !== undefined) {
    result.additionalProperties =
      typeof schema.additionalProperties === "boolean"
        ? schema.additionalProperties
        : convertSchema(schema.additionalProperties);
  }
  if (schema.required) result.required = schema.required;

  // Array — handle JsonSchema.items being JsonSchema | JsonSchema[]
  if (schema.items) {
    if (Array.isArray(schema.items)) {
      result.items =
        schema.items.length === 1
          ? convertSchema(schema.items[0])
          : { oneOf: schema.items.map((s) => convertSchema(s)) };
    } else {
      result.items = convertSchema(schema.items);
    }
  }
  if (schema.minItems !== undefined) result.minItems = schema.minItems;
  if (schema.maxItems !== undefined) result.maxItems = schema.maxItems;
  if (schema.uniqueItems !== undefined) result.uniqueItems = schema.uniqueItems;

  // Numeric
  if (schema.minimum !== undefined) result.minimum = schema.minimum;
  if (schema.maximum !== undefined) result.maximum = schema.maximum;
  if (schema.exclusiveMinimum !== undefined) result.exclusiveMinimum = schema.exclusiveMinimum;
  if (schema.exclusiveMaximum !== undefined) result.exclusiveMaximum = schema.exclusiveMaximum;
  if (schema.multipleOf !== undefined) result.multipleOf = schema.multipleOf;

  // String
  if (schema.minLength !== undefined) result.minLength = schema.minLength;
  if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
  if (schema.pattern) result.pattern = schema.pattern;

  // Composition
  if (schema.allOf) result.allOf = schema.allOf.map((s: JsonSchema) => convertSchema(s));
  if (schema.anyOf) result.anyOf = schema.anyOf.map((s: JsonSchema) => convertSchema(s));
  if (schema.oneOf) result.oneOf = schema.oneOf.map((s: JsonSchema) => convertSchema(s));
  if (schema.not) result.not = convertSchema(schema.not);

  // Examples
  if (schema.examples) result.examples = schema.examples;

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * The header placeholders an HTTP transport expects (mcp-schema's
 * `transport.headers`, which its schema accepts ahead of the published
 * type), with only string values kept.
 */
function transportHeaders(transport: NonNullable<McpSpec["transport"]>): Record<string, string> | undefined {
  const headers = (transport as { headers?: unknown }).headers;
  if (!headers || typeof headers !== "object") return undefined;
  const entries = Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function flattenInputSchema(schema: JsonSchema & { type: "object" }): NormalizedParameter[] {
  if (!schema.properties) return [];
  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties).map(([name, prop]: [string, JsonSchema]) => ({
    name,
    in: "argument" as const,
    description: prop.description,
    required: required.has(name),
    deprecated: false,
    schema: convertSchema(prop),
    example: prop.default,
  }));
}

function hasNestedProperties(schema: JsonSchema): boolean {
  if (!schema.properties) return false;
  return Object.values(schema.properties).some((prop: JsonSchema) => {
    if (prop.type === "object" && prop.properties) return true;
    if (
      prop.type === "array" &&
      prop.items &&
      !Array.isArray(prop.items) &&
      (prop.items as JsonSchema).type === "object"
    )
      return true;
    if (prop.allOf || prop.anyOf || prop.oneOf) return true;
    return false;
  });
}

function extractUriTemplateParams(uriTemplate: string): NormalizedParameter[] {
  const matches = uriTemplate.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map((m) => ({
    name: m.slice(1, -1),
    in: "path" as const,
    required: true,
    deprecated: false,
    schema: { type: "string" },
  }));
}

/**
 * A resource's operation id: its name in lowercase, each run of anything but
 * letters and digits one hyphen, kept at either end, as published operation
 * ids have always been written.
 */
function resourceOperationId(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

// ── Code sample generation ────────────────────────────────────────────

function generateToolSamples(tool: McpTool, inputSchema: NormalizedSchema): CodeSample[] {
  const example = inputSchema.properties ? generateExample(inputSchema, "request") : {};
  const exampleJson = JSON.stringify(example, null, 2);
  const indented = exampleJson
    .split("\n")
    .map((line, i) => (i === 0 ? line : "      " + line))
    .join("\n");

  return [
    {
      lang: "json",
      label: "JSON-RPC",
      source: `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "${tool.name}",
    "arguments": ${indented}
  }
}`,
    },
    {
      lang: "typescript",
      label: "TypeScript",
      source: `const result = await client.callTool(${JSON.stringify({ name: tool.name, arguments: example }, null, 2)});`,
    },
    {
      lang: "python",
      label: "Python",
      source: `result = await session.call_tool("${tool.name}", arguments=${exampleJson})`,
    },
  ];
}

function generateResourceSamples(resource: { uri: string; name: string }): CodeSample[] {
  return [
    {
      lang: "json",
      label: "JSON-RPC",
      source: `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/read",
  "params": {
    "uri": "${resource.uri}"
  }
}`,
    },
    {
      lang: "typescript",
      label: "TypeScript",
      source: `const result = await client.readResource(${JSON.stringify({ uri: resource.uri }, null, 2)});`,
    },
    {
      lang: "python",
      label: "Python",
      source: `result = await session.read_resource("${resource.uri}")`,
    },
  ];
}

function generatePromptSamples(prompt: McpPrompt): CodeSample[] {
  const args = prompt.arguments ?? [];
  const exampleArgs = Object.fromEntries(
    args.map((a: { name: string }) => [a.name, `<${a.name}>`]),
  );
  const argsJson = JSON.stringify(exampleArgs, null, 2);
  const indented = argsJson
    .split("\n")
    .map((line, i) => (i === 0 ? line : "      " + line))
    .join("\n");

  const pyArgs = args.map((a: { name: string }) => `    "${a.name}": "<${a.name}>",`).join("\n");

  return [
    {
      lang: "json",
      label: "JSON-RPC",
      source: `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "prompts/get",
  "params": {
    "name": "${prompt.name}",
    "arguments": ${indented}
  }
}`,
    },
    {
      lang: "typescript",
      label: "TypeScript",
      source: `const result = await client.getPrompt(${JSON.stringify({ name: prompt.name, ...(args.length ? { arguments: exampleArgs } : {}) }, null, 2)});`,
    },
    {
      lang: "python",
      label: "Python",
      source: args.length
        ? `result = await session.get_prompt("${prompt.name}", arguments={\n${pyArgs}\n})`
        : `result = await session.get_prompt("${prompt.name}")`,
    },
  ];
}
