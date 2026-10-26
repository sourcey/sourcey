---
title: Introduction
description: Sourcey builds a static documentation site from your product's own sources, specs, code and guides, with Markdown and context files for agents.
---

Sourcey builds a static documentation site from the source of your product: API specs, MCP servers, C, C++, Go and Rust code, guides, changelogs and examples. One config file and one build command write a folder of HTML you can host anywhere.

Developers read the site. Agents can fetch any guide, operation or schema as Markdown, follow `llms.txt`, or read the whole export. API contracts and discovery manifests come from the same sources. The project keeps its source; there is no account, and no vendor to move away from later.

## What you get

:::card-group{cols="2"}
::card{title="API reference" icon="book-open" href="./adapters/openapi.md"}
An OpenAPI 3.2, 3.1 or 3.0 spec, or Swagger 2.0, becomes a searchable reference with request examples and a console to send requests from the page.
::
::card{title="MCP servers" icon="cpu-chip" href="./adapters/mcp.md"}
A server's tools, resources and prompts, from a snapshot of it, with examples in JSON-RPC, TypeScript and Python.
::
::card{title="Code reference" icon="code-bracket" href="./adapters/rustdoc.md"}
C and C++ from Doxygen, Go from godoc and Rust from rustdoc, built live or from a committed snapshot.
::
::card{title="Guides" icon="document" href="./pages.md"}
Markdown with frontmatter, and steps, tabs, cards, callouts, diagrams and your own components, written as directives or tags.
::
::card{title="Static output" icon="cube" href="./deploying.md"}
Plain HTML, one stylesheet and small scripts for search, navigation and appearance. Host it anywhere.
::
::card{title="Readable reference and discovery" icon="document" href="./machine-readable.md"}
Each page, operation and schema as Markdown with its examples intact, OpenAPI downloads, ARD manifests and API catalogs.
::
:::

## How it works

A `sourcey.config.ts` names the site's tabs and where each one's pages come from. Markdown files sit beside it; a spec can be a file or a URL.

```bash
sourcey build
```

```text
Sourcey: building documentation site

  Pages:  14
  Output: /home/me/acme/docs/dist
  Time:   1.2s
```

`dist/` holds the whole site. Serve it with any static file server.

## Start in a minute

```bash
npx sourcey init
npm install
npx sourcey dev
```

[`init`](./cli/init.md) asks for a name and a theme and picks up any OpenAPI spec or Doxyfile beside it. The [quickstart](./quickstart.md) walks through the rest.

:::tip
Have an OpenAPI spec already? `sourcey build api.yaml` builds its reference with no config at all.
:::

## See it working

The [Cheese Store demo](https://sourcey.com/cheesestore) is a whole Sourcey site: Markdown guides, an OpenAPI reference, an MCP reference, a changelog, five tabs, its own branding and every component. [Its source is on GitHub](https://github.com/cheesestore/docs): clone it, run `npx sourcey dev`, and build from there.
