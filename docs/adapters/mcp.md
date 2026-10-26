---
title: MCP Integration
description: A reference for a Model Context Protocol server's tools, resources and prompts, from a snapshot of the server.
---

`mcp()` turns a snapshot of a [Model Context Protocol](https://modelcontextprotocol.io) server into a reference of its tools, resources, resource templates and prompts, drawn as an OpenAPI reference is: argument tables, expandable schemas, examples and search.

```ts
import { defineConfig, markdown, mcp } from "sourcey";

export default defineConfig({
  navigation: {
    tabs: [
      { tab: "Guides", slug: "", source: markdown({ groups: [{ group: "Start", pages: ["introduction"] }] }) },
      { tab: "MCP Reference", slug: "mcp", source: mcp("./mcp.json") },
    ],
  },
});
```

## The snapshot

`mcp.json` records what a server offers, as the protocol's own listings describe it: its tools, resources, resource templates and prompts, and how to connect to it. Commit it beside the config, so the reference builds without the server running. [mcp-parser](../guides/mcp-snapshot.md) writes one from a running server, and [mcp-schema](https://github.com/sourcey/mcp-schema) defines its format.

## The reference

| Entry | Shows |
| --- | --- |
| Tool | Its description, its arguments from `inputSchema`, what it returns from `outputSchema`, and its annotations |
| Resource | Its URI and description |
| Resource template | Its URI template, such as `weather://{city}/forecast`, with each placeholder as an argument |
| Prompt | Its description and arguments |

A tool's annotations are badges beside its name: `readOnlyHint` reads read-only, `destructiveHint` destructive, `idempotentHint` idempotent and `openWorldHint` open-world.

When the snapshot says how to reach the server, the reference opens with the configuration a client needs to connect to it, an HTTP server's header placeholders included (`Authorization: Bearer YOUR_TOKEN`), beside its protocol version, transport and capabilities.

Each entry shows how to call it as a JSON-RPC request and with the TypeScript and Python SDKs:

```ts
const result = await client.callTool({
  "name": "get_weather",
  "arguments": {
    "city": "San Francisco"
  }
});
```

## Sections

A server's reference is divided by kind, Tools, Resources and Prompts, unless its groups divide it as its authors do. Name each section with the tools, resources and prompts it lists, in order:

```ts
source: mcp({
  spec: "./mcp.json",
  groups: {
    Authentication: ["login", "logout"],
    Timer: ["timer_status", "start_timer", "stop_timer"],
  },
}),
reference: { split: "sections" },
```

The snapshot stays as captured, so it can be refreshed from the server without losing its sections. A name the server lacks, or one listed twice, fails the build. Anything no group names is listed by kind after the groups, and the build names it. An entry's kind shows beside it only in a section that mixes kinds.

Like an OpenAPI reference, an MCP reference is one page while that stays small and splits as it grows; see [Reference pages](../configuration.md#reference-pages). Link an entry from any page by name: `[Search](<operation:TOOL search>)`.
