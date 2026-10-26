---
title: sourcey godoc
description: Snapshot a Go module's documentation into a JSON file, so the site builds without Go.
---

`sourcey godoc` reads a Go module's documentation and writes it to `godoc.json`. Commit the file, and a `godoc()` tab builds from it on any machine, without a Go toolchain.

```bash
sourcey godoc [--module <dir>] [--packages <patterns>] [--out <file>]
```

| Flag | Alias | Default | Meaning |
| --- | --- | --- | --- |
| `--module` | `-m` | `.` | The module's folder, holding `go.mod` |
| `--packages` | `-p` | `./...` | Package patterns, separated by commas |
| `--exclude` | | | Import path prefixes to leave out, separated by commas |
| `--out` | `-o` | `godoc.json` | The file to write |
| `--includeTests` | | `true` | Include examples from `*_test.go` files; `--no-includeTests` leaves them out |
| `--includeUnexported` | | `false` | Include unexported symbols |
| `--quiet` | `-q` | `false` | Print nothing but errors |

It runs the Go toolchain, so Go must be on the `PATH`:

```bash
sourcey godoc --module . --packages './...' --out docs/godoc.json
```

```text
Sourcey: wrote godoc snapshot for github.com/acme/widgets
  Packages:    12
  Output:      /home/me/acme/docs/godoc.json
```

Warnings and errors from reading the module are listed under the summary, and an error exits `1`.

## Using the snapshot

```ts
import { defineConfig, godoc } from "sourcey";

export default defineConfig({
  navigation: {
    tabs: [
      { tab: "Go API", slug: "go", source: godoc({ snapshot: "./godoc.json", mode: "snapshot" }) },
    ],
  },
});
```

With `mode: "auto"`, the default, the tab reads the module live where Go is installed and the snapshot where it is not. Regenerate the snapshot when the API changes; a CI step that runs `sourcey godoc` and fails on a changed file keeps it current.

Go-only teams can write the same snapshot without Node:

```bash
go install github.com/sourcey/sourcey/go/sourcey-godoc/cmd/sourcey-godoc@latest
sourcey-godoc snapshot --out godoc.json
```

See the [Go guide](../guides/godoc-go.md) for the tab's options.
