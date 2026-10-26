---
title: OpenAPI
description: An API reference from an OpenAPI or Swagger spec, with request examples, a request console and editorial overlays.
---

`openapi()` turns a spec into an API reference: every operation, parameter, request body, response and schema, with request examples in the languages you choose and a [console](../try-it.md) to send requests from the page.

```ts
import { defineConfig, openapi } from "sourcey";

export default defineConfig({
  navigation: {
    tabs: [
      { tab: "API Reference", slug: "api", source: openapi("./openapi.yaml") },
    ],
  },
});
```

The spec is a path from `sourcey.config.ts` or a URL, which the build fetches, in YAML or JSON.

| Format | Support |
| --- | --- |
| OpenAPI 3.2 | Read as written, including `QUERY` operations, response summaries, tag hierarchy, device authorization flows, `querystring` parameters, media type encodings and `$self` references |
| OpenAPI 3.1 and 3.0 | Read as written |
| Swagger 2.0 | Converted to OpenAPI 3 as it is read |

To see a spec without writing a config, build it on its own: `sourcey build ./openapi.yaml` writes its reference to `dist` with the default theme. [`sourcey validate`](../cli/validate.md) reads a spec and reports its errors without building.

## The reference

Each tag is a section of the reference, in the spec's order, named by its `summary` or its name, and opens with the tag's description. A tag with a `parent` (OpenAPI 3.2) sits inside its parent's section. The API's own description and its authentication schemes open the reference.

A reference is one page while that stays small, and is split by section or by operation as it grows; `reference.split` chooses for you, and `reference.operations` gives every operation a permanent address. A tab's `navigation` orders the reference by hand. See [Reference pages](../configuration.md#reference-pages).

`x-sourcey-hide: true` on an operation or a tag leaves it out of the reference.

## Code samples

Each operation shows how to call it in cURL, JavaScript and Python. `codeSamples` chooses the languages, in the order its picker shows them:

```ts
export default defineConfig({
  codeSamples: ["curl", "python", "go", "typescript"],
  // ...
});
```

The languages are `curl`, `javascript`, `typescript`, `python`, `go`, `ruby`, `java`, `php`, `rust` and `csharp`. Each example is written at build time from the operation's method, server, path, parameters, headers, authentication and request body, with the language's usual client: `fetch` in JavaScript and TypeScript, `requests` in Python, `net/http` in Go and Ruby, `HttpClient` in Java and C#, cURL in PHP and `reqwest` in Rust.

An operation's own examples take the place of the generated ones: Sourcey reads `x-sourcey-code-samples`, else Redoc's `x-codeSamples` or `x-code-samples`, each a list of `{ lang, label, source }`.

## Overlays

Keep editorial titles and explanations in a separate file when your OpenAPI spec is generated from code:

```ts
source: openapi({
  spec: "./openapi.json",
  overlays: ["./reference.overlay.yaml"],
}),
```

```yaml
overlay: 1.0.0
info:
  title: Reference copy
  version: "initial"
actions:
  - target: $.paths['/keys'].get
    update:
      summary: List your keys
      description: Returns the keys you can access in this workspace.
  - target: $.paths['/internal/diagnostics']
    remove: true
```

Sourcey applies the files in order before resolving `$ref`s. The resulting spec supplies the reference, search, readable documents, exported OpenAPI and request console. The original input files stay untouched. Local paths are relative to `sourcey.config.ts`; spec and overlay inputs can also be URLs. Relative `$ref`s keep the original spec as their base.

The supported standard is [OpenAPI Overlay 1.0](https://spec.openapis.org/overlay/v1.0.0.html), with [RFC 9535 JSONPath](https://www.rfc-editor.org/rfc/rfc9535.html). Target the containing object to replace a string such as `description`. In this version, an array target appends one entry; an object update can replace an array-valued property. Unsupported Overlay feature sets fail with a version error.

An action that matches nothing fails Sourcey's drift check by default. For an intentionally optional action, set `overlayUnmatched: "warn"` or `"ignore"` on the source. The underlying standard treats an empty match as a successful no-op. Local overlay edits participate in development reloads, including when the spec itself is remote.
