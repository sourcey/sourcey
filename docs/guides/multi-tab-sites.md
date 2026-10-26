---
title: Multi-tab sites
description: Guides, API references and code references side by side in one site.
---

A site can have several tabs, each with its own source: Markdown guides, an OpenAPI spec, an MCP snapshot, Doxygen XML, a Go module or Rust crates. Tabs sit in the header, and each publishes beneath its own path.

## Sources

| Source | Function | For |
| --- | --- | --- |
| Markdown | `markdown({ groups })` | Guides, tutorials, concepts |
| OpenAPI | `openapi("./openapi.yaml")` | An HTTP API's reference |
| MCP | `mcp("./mcp.json")` | An MCP server's tools, resources and prompts |
| Doxygen | `doxygen({ xml: "./xml" })` | A C or C++ library's reference |
| Go | `godoc(".")` | A Go module's packages and symbols |
| Rust | `rustdoc({ manifest: "./Cargo.toml" })` | A Rust crate's reference |

## A five-tab site

```ts
import { defineConfig, godoc, markdown, openapi } from "sourcey";

export default defineConfig({
  name: "My Platform",
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          groups: [
            { group: "Getting Started", pages: ["introduction", "quickstart"] },
            { group: "Concepts", pages: ["architecture", "authentication"] },
          ],
        }),
      },
      {
        tab: "Guides",
        source: markdown({
          groups: [{ group: "Tutorials", pages: ["guide-setup", "guide-deployment"] }],
        }),
      },
      { tab: "API Reference", slug: "api", source: openapi("./openapi.yaml") },
      { tab: "Go API", slug: "go", source: godoc({ module: ".", packages: ["./..."] }) },
      {
        tab: "Changelog",
        source: markdown({ groups: [{ group: "Releases", pages: ["CHANGELOG"] }] }),
      },
    ],
  },
});
```

A page named `CHANGELOG.md` is read as a changelog, each release with its own anchor and its own entry in search.

## Paths

Each tab publishes beneath its slug:

:::tabs
::tab{title="At the root"}

```ts
{ tab: "Documentation", slug: "" }
```

Its pages sit at the site's root: `/introduction`, `/quickstart`. Give the main tab this slug to keep its addresses short.
::
::tab{title="By name"}

```ts
{ tab: "Guides" }
```

Without a slug, the tab's name is slugified: `/guides/guide-setup`.
::
::tab{title="Your own"}

```ts
{ tab: "API Reference", slug: "api" }
```

A slug of your own, `/api/` rather than `/api-reference/`.
::
:::

Groups head the sidebar's sections, in the order you list them, and each lists its pages in order. See [Navigation](../navigation.md) for nested groups, section pages, links and links between tabs.

## In the wild

The [Cheese Store demo](https://github.com/cheesestore/docs) has guides, an OpenAPI reference, an MCP reference and a changelog. The [Scafld Go API](https://0state.com/scafld/docs/go-api) is a Go tab built from package comments and exported symbols.
