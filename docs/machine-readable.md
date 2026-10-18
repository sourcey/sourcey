---
title: Documentation for agents
description: Publish readable Markdown, API contracts and discovery files from the same sources as your website.
---

# Documentation for agents

Sourcey 3.7.1 writes a Markdown view of every page, individual API operation and schema documents, a documentation index, and the existing `llms.txt` and `llms-full.txt` files. Public API contracts and discovery manifests are configurable outputs from the same build.

An agent can follow the index to one operation, read its parameters and examples, and link back to the browser reference. A developer gets the same material in the theme they chose.

## Default outputs

```text
dist/
  introduction.html
  introduction.md
  api.html
  api.md
  api/operations/operation-cheeses-get.md
  api/schemas/...
  documents.json
  llms.txt
  llms-full.txt
  response-headers.json
```

The exact page paths follow your navigation and `prettyUrls` setting. A directory-style page such as `guide/index.html` has a `guide/index.md` companion. The HTML links to its Markdown view with `rel="alternate"`; `rel="describedby"` points to the documentation index.

Guides retain code fences, tab labels, numbered steps, callouts and accordion contents. Doxygen retains its generated Markdown. Go and Rust reference exports come from the native documentation data, including declarations and examples. Text exports do not run a browser or strip the finished website back into text.

`documents.json` is a versioned index of the emitted documents: IDs, titles, canonical browser URLs, Markdown URLs, relative file paths and library symbol locations. Operation documents include parameters, request and response content, declared authentication requirements and code examples. Schema documents include properties, required fields and constraints. References to named schemas remain references rather than expanding the same model indefinitely.

## Choose the outputs

```ts
export default defineConfig({
  // Your existing navigation and theme.
  exports: {
    markdown: true,
    llms: { index: true, full: true },
    openapi: false,
  },
});
```

Markdown and both context files are on by default. Set `exports: false` to disable them all, or switch off individual outputs. With Markdown disabled, `llms.txt` links to the browser pages instead. A large project can disable `llms.full` and keep the individual documents and index.

The full file contains each page once; individual operation and schema documents do not create a second copy of the reference inside it. The index stays useful without downloading that full file.

## Publish the API contract

Set `exports.openapi: true` to publish an `openapi.json` bundle for each OpenAPI tab. A tab named `api` writes `api/openapi.json`.

The bundle retains the source contract, including its specification version and extensions. Local references are bundled using Sourcey's existing constrained resolver. Sourcey does not manufacture an OpenAPI document by reversing its rendering model, and enabling this output does not enable additional network fetches.

This switch publishes the source definition. A presentation setting that hides an operation from the rendered reference is not a filter on that source download. Enable it for a contract you intend to distribute.

## Publish discovery files

```ts
export default defineConfig({
  siteUrl: "https://docs.example.com",
  exports: { openapi: true },
  discovery: {
    ard: true,
    apiCatalog: true,
    wellKnown: true,
  },
  // Your existing navigation and theme.
});
```

Discovery is off by default and requires `siteUrl`. With `wellKnown: true`, an origin-root build writes `/.well-known/ard.json` and, when applicable, `/.well-known/api-catalog`.

The [ARD proposal](https://github.com/ards-project/ard-spec/blob/main/spec/ard.md) describes agentic resources through typed entries. Sourcey's manifest points to the generated documentation and published contracts. It can also include explicitly configured services.

The API catalog uses the Linkset format from [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727.html). Its entries link the documented API servers to their published definitions and browser reference. Enable `exports.openapi` when enabling an API catalog for an OpenAPI source. A site without applicable API endpoints does not emit an empty catalog.

### Docs beneath an existing website

For `baseUrl: "/docs"`, leave `wellKnown` off. Sourcey writes `/docs/ard.json` and, where applicable, `/docs/api-catalog.json`, then links them from the documentation. The website owner can reference or compose those resources into its domain-level discovery files.

A mounted documentation build never writes outside its output directory or replaces the host's root manifest. This also lets several documentation projects share one website.

### Describe an existing MCP or A2A service

```ts
discovery: {
  ard: true,
  resources: [{
    identifier: "urn:air:example.com:mcp:orders",
    displayName: "Orders MCP server",
    type: "application/mcp-server-card+json",
    url: "https://api.example.com/.well-known/mcp/server-card.json",
    description: "Inspect orders through the Orders MCP server.",
    representativeQueries: ["look up an order", "find orders awaiting dispatch"],
  }],
}
```

Use the real descriptor URL. To carry an authored JSON descriptor inline, supply `data` instead of `url`; an entry must have exactly one. Additional resource media types, including A2A cards, are supported. Sourcey does not infer a running service, credentials or operational guarantees from a documentation snapshot.

## Serve the correct headers

Sourcey's CLI and Astro development servers apply the generated content types and discovery headers. Static hosting needs the same configuration at the host. `response-headers.json` maps public paths to their required response headers; the programmatic build exposes the same map as `SourceySiteArtifacts.responseHeaders`.

Markdown uses `text/markdown`. API catalogs use `application/linkset+json` with the RFC 9727 profile, including at the extensionless well-known path. Their `Link` header also identifies the catalog for `HEAD` requests. HTML pages advertise readable and discovery representations through link elements and the corresponding header map.

Apply those headers when deploying. The static generator cannot configure an arbitrary CDN. Direct `.md` URLs work without `Accept` negotiation or an edge renderer, and each URL can be cached independently.

## Query built docs over MCP

The optional `sourcey-docs-mcp` package serves a built directory over MCP stdio:

```sh
sourcey build
npx sourcey-docs-mcp ./dist
```

Configure an MCP client to run that command with an absolute build-directory path. It exposes `search_docs`, `read_document` and `lookup_symbol`, plus readable documentation resources. The server reads the built index once and opens document content when requested. It does not call the API described by the examples.

The MCP SDK is a dependency of this separate package. Generating or hosting static docs does not install a server, add browser JavaScript, or require an MCP connection.

## Check a build

Pick a real operation and compare the HTML, Markdown and source definition. Check required fields, nullability, examples and error responses. Follow its index link and confirm the canonical browser link reaches the right operation.

Build twice from the same inputs and compare the files. Remove a page or disable an export and rebuild into the same directory; obsolete files should disappear. For hosted output, check both `GET` and `HEAD`, including the catalog media type. For an agent integration, inspect the document the tool fetched as well as the answer it produced.
