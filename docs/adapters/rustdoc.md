---
title: Rustdoc adapter
description: Generate Rust API documentation from nightly rustdoc JSON. Doctests as a first-class extracted view. Snapshot mode for CI on stable Rust.
---

> Rust crates: [`sourcey`](https://crates.io/crates/sourcey) (library entrypoint) · [`sourcey-rustdoc`](https://crates.io/crates/sourcey-rustdoc) (snapshot pipeline). The snapshot schema is identical to the one this adapter consumes; the crates exist for tools that want to drive the same pipeline from Rust.

`rustdoc()` is sourcey's native source for Rust API documentation. It consumes
nightly rustdoc JSON, ships a bundled Rust helper that converts it into a
stable v1 `RustdocSpec` snapshot, and renders pages that match the conventions
of doc.rust-lang.org so deep-links from a docs.rs URL work against sourcey
output.

Doctests are a first-class feature: every code fence inside a `///` or `//!`
doc comment is extracted with hidden-line stripping, fence-attribute badges,
a Rust Playground deep-link, and a copy button. A dedicated `Doctests` index
page aggregates every runnable example across the workspace.

## Install prerequisites

Live mode requires a nightly Rust toolchain. By default the adapter uses
`nightly`; set `toolchain` in config when you need a dated pin.

```sh
rustup toolchain install nightly
```

Snapshot mode requires no Rust toolchain at all. Commit a generated
`rustdoc.json` and CI can build docs on stable Rust or even on hosts that
have no Rust installed.

## Quick start

```ts
import { defineConfig, rustdoc } from "sourcey";

export default defineConfig({
  name: "My Crate",
  navigation: {
    tabs: [
      {
        tab: "Rust API",
        slug: "rust-api",
        source: rustdoc({
          manifest: "../Cargo.toml",
          mode: "auto",
          doctestsIndex: true,
        }),
      },
    ],
  },
});
```

## Options

- `manifest`: the path to `Cargo.toml`, or the folder holding it.
- `crates`: the crates to document; defaults to the manifest's own package.
- `snapshot`: a committed `RustdocSpec` v1 snapshot. Required for `mode: "snapshot"`.
- `mode`: `"auto"` (the default), `"live"` or `"snapshot"`, described below.
- `features`: `{ default?: boolean; list?: string[]; all?: boolean }`. Defaults to `{ default: true }`.
- `includePrivate`: include `pub(crate)` and private items. Default `false`.
- `includeHidden`: include `#[doc(hidden)]` items. Default `false`.
- `target`: the target triple to build docs for.
- `toolchain`: the rustup toolchain name. Default `"nightly"`.
- `sourceBasePath`: the repository-relative base for Rust source links.
- `doctestsIndex`: render a workspace-wide doctests index page. Default `true`.

## Modes

Three modes control how the snapshot is produced:

- `auto` (default): probe `rustup toolchain list` for nightly. If present,
  invoke the bundled helper. Otherwise read the snapshot.
- `live`: always invoke the bundled helper. Fails if nightly is missing.
- `snapshot`: always read the committed snapshot. Fails if no snapshot path
  is configured.

When `auto` falls back to snapshot it emits a `RUSTDOC_AUTO_FELL_BACK_TO_SNAPSHOT`
info diagnostic. When neither mode is viable it emits `RUSTDOC_NO_VIABLE_MODE`
with the exact `rustup toolchain install` and snapshot-config commands.

## Snapshot lifecycle

Generate a snapshot from your workspace by running the helper directly, as
this script does:

```js
// scripts/snapshot-rustdoc.mjs
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "cargo",
  [
    "run",
    "--release",
    "--quiet",
    "--manifest-path",
    "./node_modules/sourcey/dist/core/sourcey-rustdoc/Cargo.toml",
    "--",
    "--manifest",
    "./Cargo.toml",
    "--toolchain",
    "nightly",
    "--output",
    "./snapshots/rustdoc.json",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
```

When you upgrade sourcey, regenerate the snapshot using the same pinned
nightly. The adapter's snapshot validator emits
`RUSTDOC_FORMAT_VERSION_MISMATCH` with a remedy when the rustdoc JSON format
moves.

## Doctest rendering

Every doctest is rendered with:

- Hidden `# `-prefixed source lines stripped from the display copy and kept
  in a "Show hidden lines" toggle, including the executable form.
- Fence-attribute badges for `ignore`, `no_run`, `should_panic`,
  `compile_fail`, and any `editionYYYY` marker, each with a tooltip
  explaining what the attribute does.
- A `Run` button that deep-links to the Rust Playground with the executable
  code and the right edition.
- A `Copy` button.

The dedicated `Doctests` index page lists every doctest across the workspace
grouped by parent item. Each entry links back to its source line.

## Anchor algorithm

Anchor IDs are deterministic so deep-links remain stable. The algorithm:

- Per-item: `<kind>.<name>`, e.g. `fn.greet`, `struct.Widget`,
  `trait.Iterator`, `associatedtype.Item`, `tymethod.next`.
- Parametric impls: `impl-<TraitName>-for-<TypeName>` with rustdoc's
  URL-encoded generic form: `%3C` for `<`, `%3E` for `>`, `,+` between
  generic args. Example:
  `impl-Clone-for-HashMap%3CK,+V,+S,+A%3E`.
- Duplicates within a page get a numeric suffix in source order: `-1`,
  `-2`, ...
- Doctests: `doctest-<parent-anchor>-<n>` where n is the doctest's
  source-order ordinal.

The algorithm is part of the sourcey rustdoc contract. Changes require a
minor version bump.

## Intra-doc links

Intra-doc links resolve through rustdoc's per-item `links` map. Each label
rustdoc resolved becomes a Markdown reference definition, so the links
render wherever CommonMark finds a reference link: `` [`Foo`] ``, `[Foo]`,
`[text][Foo]`, and a path written as a destination, `[text](crate::Foo)`.
Code blocks, code spans and the docs' own reference links render as written.

- Items in the current workspace resolve to internal sourcey URLs.
- Items in `std`, `core`, `alloc`, or `proc_macro` resolve to
  `doc.rust-lang.org/stable/...`.
- Items in other external crates resolve to
  `external_crates[crate_id].html_root_url` when present, or to
  `docs.rs/<crate>/latest/...` as a fallback.
- External links name the item's rustdoc page from its kind, such as
  `core/error/trait.Error.html`. Snapshots made before 3.7 carry no kind and
  keep the bare path.
- A label rustdoc could not resolve keeps its brackets, as rustdoc renders
  it. A label whose target this site does not render shows as text and emits
  a `RUSTDOC_INTRA_DOC_LINK_UNRESOLVED` info diagnostic.

## First-run compile cost

The bundled Rust helper compiles on first invocation in live mode. Cold
compile is 30-60 seconds on a fast workstation including `rustdoc-types`,
`rustdoc-json`, `serde`, `clap`, and `pulldown-cmark` dependencies.
Subsequent invocations are near-instant. Snapshot mode skips this entirely.

## Diagnostics

| Code | Severity | Meaning |
|---|---|---|
| `RUSTDOC_FORMAT_VERSION_MISMATCH` | error | Snapshot or live output uses a different rustdoc JSON format version than the pinned `rustdoc-types`. Reinstall the pinned nightly and regenerate. |
| `RUSTDOC_INVALID_SNAPSHOT_SCHEMA` | error | Snapshot is missing the `version` field or fails to parse. |
| `RUSTDOC_NO_VIABLE_MODE` | error | Auto mode found neither nightly nor a configured snapshot. |
| `RUSTDOC_HELPER_MISSING` | error | The bundled `sourcey-rustdoc` source is not in the sourcey install. Run `npm rebuild sourcey`. |
| `RUSTDOC_HELPER_FAILED` | error | The helper exited non-zero. The diagnostic message includes stderr. |
| `RUSTDOC_AUTO_FELL_BACK_TO_SNAPSHOT` | info | Auto mode used the snapshot because nightly was missing. |
| `RUSTDOC_INTRA_DOC_LINK_UNRESOLVED` | info | An intra-doc link resolves to an item this site does not render. |
| `RUSTDOC_MISSING_HTML_ROOT_URL` | info | An external-crate reference lacks an `html_root_url`. Link falls back to docs.rs. |
