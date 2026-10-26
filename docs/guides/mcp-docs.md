---
title: "Tutorial: Document Your MCP Server"
description: Snapshot an MCP server, build its reference, and add guides beside it, in a few minutes.
---

This snapshots a running MCP server, configures Sourcey, and builds a reference site for it.

## Before you start

- Node.js 22.22.2 or later, 24.15 or later, or 26
- A running MCP server, or an `mcp.json` [written by hand](./mcp-snapshot.md#by-hand)

## 1. Snapshot the server

[mcp-parser](https://github.com/sourcey/mcp-parser) asks a running server what it offers and writes the answer to `mcp.json`:

```bash
npx mcp-parser snapshot --stdio "node my-server.js" -o mcp.json
```

A server on SSE or streamable HTTP:

```bash
npx mcp-parser snapshot --sse http://localhost:3000/sse -o mcp.json
npx mcp-parser snapshot --http http://localhost:3000/mcp -o mcp.json
```

## 2. Check the snapshot

```bash
npx mcp-parser validate ./mcp.json
```

```text
Valid: no issues found.
```

## 3. Configure Sourcey

```bash
npm install sourcey
```

Create `sourcey.config.ts`:

```ts
import { defineConfig, mcp } from "sourcey";

export default defineConfig({
  name: "My MCP Server",
  navigation: {
    tabs: [{ tab: "MCP Reference", slug: "", source: mcp("./mcp.json") }],
  },
});
```

## 4. Preview it

```bash
npx sourcey dev
```

Open `http://localhost:4400`: the server's tools, resources and prompts are in the sidebar, each marked with its kind, and each opens with its arguments and examples.

## 5. Add guides

Write an `introduction.md` beside the config:

```markdown
---
title: Introduction
description: Getting started with the MCP server.
---

What the server does, and how to connect to it.
```

and give the guides a tab of their own:

```ts
import { defineConfig, markdown, mcp } from "sourcey";

export default defineConfig({
  navigation: {
    tabs: [
      {
        tab: "Guides",
        slug: "",
        source: markdown({ groups: [{ group: "Getting Started", pages: ["introduction"] }] }),
      },
      { tab: "MCP Reference", slug: "mcp", source: mcp("./mcp.json") },
    ],
  },
});
```

## 6. Build and deploy

```bash
npx sourcey build
```

`dist/` holds the site, with each page's Markdown, `documents.json`, `llms.txt` and `llms-full.txt` for agents; see [Readable reference and discovery](../machine-readable.md). Publish it on any static host; see [Deploying](../deploying.md).

## An example

The [Cheese Store MCP tab](https://sourcey.com/cheesestore/mcp) has tools, resources, resource templates and prompts. Its [source](https://github.com/cheesestore/docs) holds the config and `mcp.json`. See [MCP](../adapters/mcp.md) for sections, connection details and links to tools from other pages.
