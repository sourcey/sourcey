---
title: sourcey validate
description: Read an OpenAPI spec and report its errors, without building anything.
---

`sourcey validate` reads an OpenAPI or Swagger spec as a build does and reports whether it is sound.

```bash
sourcey validate <spec>
```

The spec is a path or a URL.

```text
  ✓ Valid: Acme API v1.0.0
  Operations: 24
  Schemas:    12
```

A spec Sourcey cannot read exits `1` with the reason, such as malformed YAML or JSON, a reference to nothing, or a version it does not support:

```text
  ✗ Invalid: Unable to detect spec version. Expected "swagger": "2.0" or "openapi": "3.x.x"
```

It reads the spec, converts Swagger 2.0, resolves every `$ref` and normalises the result, as a build does. To check a whole site, its pages and links as well as its specs, use [`sourcey check`](./check.md). An MCP snapshot is checked by [mcp-parser](../guides/mcp-snapshot.md): `npx mcp-parser validate ./mcp.json`.
