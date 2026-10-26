---
title: Introduction
description: Sourcey tells the whole product story. Specs, code, rich guides, changelog, roadmap pages, examples, and portable context files from your project as static HTML.
---

Sourcey builds a static docs site from the source of your product: specs, code, rich guides, changelog, roadmap pages, examples, and portable context files.

One config file, one build command. Developers get the browser site. Agents can fetch an individual guide, operation or schema as Markdown, follow `llms.txt`, or read the full export. Public API contracts and discovery manifests are configurable outputs from the same sources. The project keeps the source.

Most documentation tools are either hosted platforms that own your content, or bloated frameworks that ship megabytes of JavaScript to render a paragraph. Sourcey does neither. It reads your specs, code, and markdown, then writes HTML files to a directory. The output is yours. Put it on GitHub Pages, Cloudflare Pages, Netlify, S3, your own server. No account required, no vendor to migrate away from later.

## What you get

:::card-group{cols="2"}
::card{title="API Reference" icon="book-open" href="./adapters/openapi.md"}
Point Sourcey at an OpenAPI 3.2, 3.1, or 3.0 spec (or Swagger 2.0; it converts automatically). `QUERY` operations, hierarchical tags, response summaries, every schema and code sample rendered and searchable.
::
::card{title="MCP Server Docs" icon="cpu-chip" href="./adapters/mcp.md"}
Document MCP servers with tools, resources, and prompts rendered as browsable reference. Code samples in JSON-RPC, TypeScript, and Python.
::
::card{title="Rich Guides" icon="document" href="./pages.md"}
Write guides in markdown with frontmatter. Rich components (steps, tabs, cards, callouts) via directive syntax. No JSX imports.
::
::card{title="Static Output" icon="cube" href="./deploying.md"}
Zero JavaScript framework shipped to the browser. The output is plain HTML, one CSS file, and small scripts for search, navigation and dark mode. Deploy it anywhere.
::
::card{title="Readable Reference and Discovery" icon="document" href="./machine-readable.md"}
Page, operation and schema Markdown with their examples intact. Configure OpenAPI downloads, ARD manifests and API catalogs, or query a built directory over MCP.
::
:::

## How it works

You create a `sourcey.config.ts` that declares your tabs, groups, and pages. Markdown files sit alongside it. An OpenAPI spec can be a local file or a URL.

```bash
sourcey build
```

```text
Sourcey: building documentation site

  Pages:  14
  Output: /home/me/acme/docs/dist
  Time:   1.2s
```

The `dist/` directory contains your complete documentation site. Serve it with any static file server.

## Get started in 60 seconds

```bash
npx sourcey init
npm install
npx sourcey dev
```

`init` is interactive; it prompts for a project name, picks a theme, and auto-detects any OpenAPI specs or Doxyfiles in your directory. It creates your config, example pages, and package.json. See the [Quick Start](./quickstart.md) for the full walkthrough.

:::tip
Already have an OpenAPI spec? Skip the config entirely: `sourcey build api.yaml` generates a complete API reference from a single file.
:::

## See it in action

The [Cheese Store demo](https://sourcey.com/cheesestore) is a full Sourcey site with markdown guides, an OpenAPI-generated API reference, an [MCP tools tab](https://sourcey.com/cheesestore/mcp), five navigation tabs, custom branding, and every component type. The [source is on GitHub](https://github.com/cheesestore/docs); clone it, run `sourcey dev`, and you have a working reference project to build from.
