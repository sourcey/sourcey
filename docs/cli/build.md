---
title: sourcey build
description: Build the site as static files, or a single spec's reference without a config.
---

`sourcey build` writes the site to a folder of static files, ready for any host.

```bash
# The site sourcey.config.ts describes
sourcey build [--output <dir>] [--config <path>] [--embed] [--quiet]

# One OpenAPI spec, without a config
sourcey build <spec> [--output <dir>] [--embed] [--quiet]
```

| Flag | Alias | Default | Meaning |
| --- | --- | --- | --- |
| `--output` | `-o` | `dist` | The folder to write |
| `--config` | `-c` | `sourcey.config.ts` here | The config file, or the folder holding it |
| `--embed` | `-e` | `false` | Write each page without its `<html>`, `<head>` and `<body>`, for a page of your own to hold |
| `--quiet` | `-q` | `false` | Print nothing but errors |
| `--strictChangelog` | | `false` | Stop on changelog warnings |

```text
Sourcey: building documentation site

  Pages:  14
  Output: /home/me/acme/docs/dist
  Time:   1.2s
```

Before the summary, the build lists what publishing needs, such as a missing `siteUrl` or pages without a summary, and each link to a page or anchor the site does not have; `brokenLinks: "error"` stops the build on one instead. A build that fails leaves the last site in place. [Project structure](../project.md#what-a-build-writes) lists what it writes, and [Deploying](../deploying.md) what a host needs.

## One spec

Given a spec, a path or a URL, `sourcey build` writes its API reference with the default theme and no config:

```bash
sourcey build ./openapi.yaml
```

```text
Sourcey: generating docs from ./openapi.yaml

  Spec:       Acme API v1.0.0
  Operations: 24
  Schemas:    12
  Time:       0.9s
```

This reads OpenAPI and Swagger specs. An MCP server, guides or any other setting needs a [config](../configuration.md).
