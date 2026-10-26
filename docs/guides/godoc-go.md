---
title: Go / godoc Docs
description: A Go module's reference from its package comments, exported symbols and examples.
---

A `godoc()` tab draws a Go module's documentation from its source: package comments, exported constants, variables, functions, types, methods and fields, and examples. It sits beside your guides and other references, and is searched and exported with them.

The [Scafld Go API](https://0state.com/scafld/docs/go-api) is one, built this way.

## When to use it

- Your Go reference lives only on `pkg.go.dev`, and you want it in your own documentation
- You want Go symbols in the site's search, `llms.txt` and `llms-full.txt`
- You want guides, a changelog, OpenAPI, MCP and Go reference in one static site

Go's own source, doc comments, examples and toolchain are the source of truth: there is no need to route Go through Doxygen.

## A Go tab

```ts
import { defineConfig, godoc, markdown } from "sourcey";

export default defineConfig({
  name: "My Go Project",
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({ groups: [{ group: "Getting Started", pages: ["introduction", "quickstart"] }] }),
      },
      {
        tab: "Go API",
        slug: "go",
        source: godoc({ module: ".", packages: ["./..."], includeTests: true }),
      },
    ],
  },
});
```

`module` is the module's folder, holding `go.mod`. `packages` takes the patterns `go list` does, so `./...` is every package beneath the module.

| Option | Default | Meaning |
| --- | --- | --- |
| `module` | The config's folder | The module's folder |
| `packages` | `["./..."]` | Package patterns |
| `mode` | `"auto"` | `"live"` runs Go when the site builds; `"snapshot"` reads a committed snapshot; `"auto"` runs Go where it is installed and reads the snapshot where it is not |
| `snapshot` | | The committed snapshot, for `"snapshot"` and `"auto"` |
| `includeTests` | `true` | Include examples from `*_test.go` files |
| `includeUnexported` | `false` | Include unexported symbols |
| `hideUndocumented` | `false` | Leave packages with no package comment out of the navigation |
| `exclude` | | Import path prefixes to leave out |
| `goEnv` | | `GOOS`, `GOARCH` and build tags to read the module with, the same on every machine |
| `sourceBasePath` | | The module's path within its repository, for source links |

For the common case, name the module alone: `godoc(".")` reads every package, examples included, in `"auto"` mode.

## Without Go on the build machine

Write a snapshot where Go is installed and commit it:

```bash
npx sourcey godoc --module . --packages './...' --out docs/godoc.json
```

```ts
source: godoc({ snapshot: "./godoc.json", mode: "snapshot" }),
```

A snapshot suits static hosts, sealed CI jobs and repositories that want the same output on every machine. See [sourcey godoc](../cli/godoc.md).

## Without Node

Go-only teams can build a site with `sourcey-godoc`, without installing Node:

```bash
go install github.com/sourcey/sourcey/go/sourcey-godoc/cmd/sourcey-godoc@latest
sourcey-godoc generate --out site
```

It is the small path for Go alone. The Sourcey site is the path for Go beside guides, specs, a changelog and agent-readable output.

## What it draws

- An overview of the module
- A page for each package, opening with its `// Package ...` comment
- Its exported constants, variables, functions, types, methods and fields
- Examples from `*_test.go` files, with `includeTests`
- Stable anchors for each symbol
- Entries in search, the sitemap, `llms.txt` and `llms-full.txt`

The result is static HTML, with no service behind it.
