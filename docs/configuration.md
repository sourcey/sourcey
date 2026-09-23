---
title: Configuration
description: Set up Sourcey with TypeScript config, page groups, and reference tabs.
---

# Configuration

Sourcey reads `sourcey.config.ts` from your project and keeps the structure explicit. Each tab has one `source`, usually created with `markdown()`, `mkdocs()`, `openapi()`, `mcp()`, `doxygen()`, `godoc()`, or `rustdoc()`.

```ts
import { defineConfig, doxygen, godoc, markdown, mcp, mkdocs, openapi, rustdoc } from "sourcey";

export default defineConfig({
  name: "My API",
  navigation: {
    tabs: [
      {
        tab: "Docs",
        slug: "",
        source: markdown({
          groups: [
            {
              group: "Getting Started",
              pages: ["introduction", "quickstart"],
            },
          ],
        }),
      },
      {
        tab: "MkDocs",
        source: mkdocs("./mkdocs.yml"),
      },
      {
        tab: "API Reference",
        slug: "api",
        source: openapi("./openapi.yaml"),
      },
      {
        tab: "MCP Reference",
        slug: "mcp",
        source: mcp("./mcp.json"),
      },
      {
        tab: "C++ Reference",
        slug: "cpp",
        source: doxygen({
          xml: "./build/doxygen/xml",
          language: "cpp",
          index: "rich",
          sourceUrl: [
            { prefix: "third_party/private/" },
            { prefix: "", url: "https://github.com/acme/project/blob/main/{fullPath}" },
          ],
        }),
      },
      {
        tab: "Rust API",
        slug: "rust-api",
        source: rustdoc({
          manifest: "../crates/Cargo.toml",
          crates: ["my-crate", "my-other-crate"],
          snapshot: "./snapshots/rustdoc.json",
          mode: "auto",
          features: { list: ["full"] },
          sourceBasePath: "crates",
          doctestsIndex: true,
        }),
      },
    ],
  },
});
```

## rustdoc()

Native Rust API documentation generated from nightly rustdoc JSON.

- `manifest` — path to `Cargo.toml` (file or directory).
- `crates` — array of crate names to document; defaults to the manifest's own package.
- `snapshot` — optional committed `RustdocSpec` v1 snapshot. Required for `mode: "snapshot"`.
- `mode` — `"auto"` (default), `"live"`, or `"snapshot"`. Auto uses nightly when available, otherwise reads the snapshot.
- `features` — `{ default?: boolean; list?: string[]; all?: boolean }`. Defaults to `{ default: true }`.
- `includePrivate` — include `pub(crate)` and private items. Default `false`.
- `includeHidden` — include `#[doc(hidden)]` items. Default `false`.
- `target` — target triple to build docs for.
- `toolchain` — rustup toolchain name. Default `"nightly"`.
- `sourceBasePath` — repository-relative base for Rust source links.
- `doctestsIndex` — render a workspace-wide doctests index page. Default `true`.

Snapshot mode lets CI build documentation on stable Rust toolchains. Commit
a generated `rustdoc.json` alongside your config and CI never needs nightly.
See the [rustdoc adapter guide](./adapters/rustdoc.md) for the full snapshot
lifecycle and rendering details.

`doxygen().sourceUrl` accepts a base URL string, a resolver function, or a
route map. Route maps use longest-prefix matching. `{path}` expands to the path
after the matched prefix, `{fullPath}` expands to the original Doxygen path,
and `{line}` expands to the source line. A route without `url` suppresses the
public link while generated pages still show `Defined in path:line`.

## Themes

Sourcey ships `default`, `minimal`, `api-first`, and `reader` themes. Select the complete renderer with `theme.name`; shared theme settings let you set brand colours, fonts, layout, and extra CSS without giving up a deterministic static build. The deprecated `theme.preset` key remains accepted through the 3.x line for compatibility.

### Reader

`reader` is a light, three-column editorial theme for specifications and long-form documentation. It has a dark masthead, grouped chapter navigation, a page table of contents, previous/next links, and a compact chapter selector on mobile. Its configuration contains project content; the theme contains no project names or protocol assumptions.

```ts
export default defineConfig({
  name: "Example standards",
  theme: {
    name: "reader",
    fonts: { sans: "Your Local Font", google: false },
    css: ["./fonts.css", "./brand.css"],
    reader: {
      logoMark: true,
      document: {
        label: "Protocol",
        title: "Interaction specification",
        version: "Draft",
        status: "Working draft",
        badge: "Draft",
        updated: "22 September 2026",
      },
      sidebar: {
        links: [{ label: "Examples", href: "/examples/", icon: "code" }],
        note: "A shared interaction contract.",
      },
      aside: {
        links: [
          {
            label: "Try the example",
            description: "See the interaction in action.",
            href: "/examples/",
            icon: "code",
          },
        ],
      },
      pagination: {
        after: { label: "Contribute", href: "/contribute/" },
      },
      footer: {
        text: "Example standards",
        links: [{ label: "Edit this specification", href: "/contribute/" }],
      },
      searchHref: "/search/",
    },
  },
  navigation: {
    tabs: [
      {
        tab: "Specification",
        slug: "",
        groups: [{ group: "Start", pages: ["index", "authorization"] }],
      },
    ],
  },
});
```

All `reader` settings are optional. `logoMark` displays the configured site name next to a mark-only logo; leave it off for a full wordmark. `document.updated` is authored publication metadata, never the build date. `sidebar.links`, `sidebar.note`, `aside.links`, and `footer.links` are host-authored arrays; the theme does not supply project content for those areas. `pagination.before` and `pagination.after` provide destinations at the beginning and end of a chapter sequence. Omit `searchHref` to use Sourcey's built-in search. The reader footer includes Sourcey's standard “Docs by Sourcey” attribution. Without JavaScript, ordinary chapter and site links remain available.

Set `navTitle` in Markdown frontmatter when the sidebar needs a shorter label than the article title. This works with every theme. Use `index.md` for the landing page and `prettyUrls: "slash"` for directory URLs.

With `fonts.google: false`, define your own `@font-face` in the configured CSS and serve the font files with your host. Reader layout widths use `theme.layout.sidebar`, `toc`, and `content`; brand CSS can adjust `--ink`, `--paper`, `--lime`, `--blue`, `--blue-ink`, and `--font`. Reader brand CSS loads after theme styles. Existing themes retain their styling and cascade.

The CLI, development server and `sourcey/astro` select assets through the same built-in theme registry. Theme layouts share Sourcey's Markdown, navigation, content widgets, search index and URL logic. Reader's own browser entry supplies its navigation and copy controls; it does not load the default theme's dark-mode or drawer behaviour.

For Astro, mount the same config using `sourcey/astro`; no separate docs prebuild or committed `public/docs` directory is needed. Cloudflare adapter builds write the generated documentation into Astro's client assets directory, including the Astro base prefix. The no-slash alias preserves that prefix in its CSS, JavaScript, search and chapter URLs.

## Code Samples

OpenAPI tabs generate cURL, JavaScript, and Python examples by default. Set `codeSamples` when you want a different picker order or more languages:

```ts
export default defineConfig({
  codeSamples: [
    "curl",
    "go",
    "javascript",
    "typescript",
    "python",
    "ruby",
    "java",
    "php",
    "rust",
    "csharp",
  ],
  navigation: {
    tabs: [{ tab: "API Reference", source: openapi("./openapi.yaml") }],
  },
});
```

Supported values are `curl`, `javascript`, `typescript`, `python`, `go`, `ruby`, `java`, `php`, `rust`, and `csharp`.

## Build flow

```bash
sourcey build
sourcey dev
```

`build` produces the static site. `dev` runs the Vite-backed preview server with config and content reloads.
