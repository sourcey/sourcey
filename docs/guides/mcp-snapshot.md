---
title: Generating an MCP snapshot
description: Snapshot a running MCP server, or write the snapshot by hand.
---

`server.snapshot.json` records an MCP server's tools, resources and prompts in a file you can commit. Sourcey builds its [MCP reference](../adapters/mcp.md) from it.

[Agent Plugins](https://agent-plugins.org/specification) uses `mcp.json` at the
plugin root for connection configuration: a `$schema` identifier and an
`mcpServers` map. The snapshot holds the tools and their schemas. Keep the two
files separate, and pass the snapshot to Sourcey's `mcp()` adapter.

## From a running server

[mcp-parser](https://github.com/sourcey/mcp-parser) connects to a server, asks what it offers, and writes the answer:

```bash
npm install mcp-parser
```

### stdio

```bash
npx mcp-parser snapshot --stdio "node my-server.js" -o server.snapshot.json
```

### SSE

```bash
npx mcp-parser snapshot --sse http://localhost:3000/sse -o server.snapshot.json
```

### Streamable HTTP

```bash
npx mcp-parser snapshot --http http://localhost:3000/mcp -o server.snapshot.json
```

### Authentication

Pass headers for a server that needs them:

```bash
npx mcp-parser snapshot --http https://api.example.com/mcp \
  --header "Authorization:Bearer your-token" \
  -o server.snapshot.json
```

## From an Agent Plugin

Use mcp-parser 0.4.3 or later to validate the plugin's connection configuration
and snapshot a server by its name in `mcpServers`:

```bash
npx mcp-parser validate-config ./plugin/mcp.json
npx mcp-parser snapshot --config ./plugin/mcp.json --server api \
  -o server.snapshot.json
```

For a stdio entry, supply a persistent directory for that installed plugin's
data. mcp-parser creates it if needed, provides `PLUGIN_ROOT` and `PLUGIN_DATA`,
and expands those placeholders in `args`, `env` values and `cwd`:

```bash
npx mcp-parser snapshot --config ./plugin/mcp.json --server local \
  --plugin-data ./plugin-data/example -o server.snapshot.json
```

The plugin root defaults to the configuration file's directory. Config snapshots
use `mcp.snapshot.json` when no output filename is given; the commands here name
the file explicitly so the Sourcey config can use `mcp("./server.snapshot.json")`.

## By hand

The format follows the protocol's own definitions. A minimal snapshot:

```json
{
  "mcpSpec": "0.3.2",
  "server": { "name": "my-server", "version": "1.0.0" },
  "description": "What this server does.",
  "tools": [
    {
      "name": "my_tool",
      "description": "What this tool does.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

`mcpSpec` names the version of the format the file follows. [mcp-schema](https://github.com/sourcey/mcp-schema) holds its full definitions and JSON Schema.

## Checking it

```bash
npx mcp-parser validate ./server.snapshot.json
```

```text
Valid: no issues found.
```

Validation checks required fields, duplicate names, missing descriptions and invalid schemas.

## Markdown and context files

mcp-parser can also write a Markdown reference, or an [llms.txt](https://llmstxt.org) index or full export, from the snapshot alone:

```bash
npx mcp-parser generate ./server.snapshot.json -o mcp.md
npx mcp-parser generate ./server.snapshot.json --format llms-txt -o llms.txt
npx mcp-parser generate ./server.snapshot.json --format llms-full-txt -o llms-full.txt
```

:::note
`sourcey build` writes `llms.txt`, `llms-full.txt` and each page's Markdown as part of the site. mcp-parser is for those files without a site.
:::

## Plugin connection configuration

If the snapshot includes transport hints, mcp-parser can write an Agent Plugins
`mcp.json` from them:

```bash
npx mcp-parser generate ./server.snapshot.json --format agent-plugin \
  --server api -o ./plugin/mcp.json
```

Generation uses the explicit transport fields in the snapshot. It fails when
required fields are missing or the hints do not satisfy the plugin format.
Snapshots omit environment values and HTTP headers; author any required public
settings in the plugin configuration and keep credentials out of it.
