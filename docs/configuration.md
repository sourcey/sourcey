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

## Remote OpenAPI Specs

`openapi()` accepts URLs as well as local files. This creates a reference tab
from Xquik's public OpenAPI 3.1 document:

```ts
import { defineConfig, openapi } from "sourcey";

export default defineConfig({
  name: "Xquik API",
  navigation: {
    tabs: [
      {
        tab: "API Reference",
        slug: "api",
        source: openapi("https://xquik.com/openapi.json"),
      },
    ],
  },
});
```

## rustdoc()

Native Rust API documentation generated from nightly rustdoc JSON.

- `manifest` - path to `Cargo.toml` (file or directory).
- `crates` - array of crate names to document; defaults to the manifest's own package.
- `snapshot` - optional committed `RustdocSpec` v1 snapshot. Required for `mode: "snapshot"`.
- `mode` - `"auto"` (default), `"live"`, or `"snapshot"`. Auto uses nightly when available, otherwise reads the snapshot.
- `features` - `{ default?: boolean; list?: string[]; all?: boolean }`. Defaults to `{ default: true }`.
- `includePrivate` - include `pub(crate)` and private items. Default `false`.
- `includeHidden` - include `#[doc(hidden)]` items. Default `false`.
- `target` - target triple to build docs for.
- `toolchain` - rustup toolchain name. Default `"nightly"`.
- `sourceBasePath` - repository-relative base for Rust source links.
- `doctestsIndex` - render a workspace-wide doctests index page. Default `true`.

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

Sourcey ships `default`, `minimal`, and `api-first` presets. Theme settings let you set brand colours, fonts, layout, and extra CSS without giving up a deterministic static build.

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
