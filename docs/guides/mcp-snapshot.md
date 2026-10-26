---
title: Generating mcp.json
description: Snapshot a running MCP server, or write the snapshot by hand.
---

`mcp.json` records an MCP server's tools, resources and prompts in a file you can commit. Sourcey builds its [MCP reference](../adapters/mcp.md) from it.

## From a running server

[mcp-parser](https://github.com/sourcey/mcp-parser) connects to a server, asks what it offers, and writes the answer:

```bash
npm install mcp-parser
```

### stdio

```bash
npx mcp-parser snapshot --stdio "node my-server.js" -o mcp.json
```

### SSE

```bash
npx mcp-parser snapshot --sse http://localhost:3000/sse -o mcp.json
```

### Streamable HTTP

```bash
npx mcp-parser snapshot --http http://localhost:3000/mcp -o mcp.json
```

### Authentication

Pass headers for a server that needs them:

```bash
npx mcp-parser snapshot --http https://api.example.com/mcp \
  --header "Authorization:Bearer your-token" \
  -o mcp.json
```

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
npx mcp-parser validate ./mcp.json
```

```text
Valid: no issues found.
```

Validation checks required fields, duplicate names, missing descriptions and invalid schemas.

## Markdown and context files

mcp-parser can also write a Markdown reference, or an [llms.txt](https://llmstxt.org) index or full export, from the snapshot alone:

```bash
npx mcp-parser generate ./mcp.json -o mcp.md
npx mcp-parser generate ./mcp.json --format llms-txt -o llms.txt
npx mcp-parser generate ./mcp.json --format llms-full-txt -o llms-full.txt
```

:::note
`sourcey build` writes `llms.txt`, `llms-full.txt` and each page's Markdown as part of the site. mcp-parser is for those files without a site.
:::
