---
title: sourcey check
description: Check a site's sources, routes and links without writing it.
---

`sourcey check` builds the site in memory and reports what a build would, without writing anything: a fast check for CI.

```bash
sourcey check [--config <path>]
```

| Flag | Alias | Default | Meaning |
| --- | --- | --- | --- |
| `--config` | `-c` | `sourcey.config.ts` here | The config file, or the folder holding it |

It reads every source, compiles the routes and redirects, resolves each navigation entry and operation link, checks imported reference anchors and output collisions, and lists the same warnings a build does, links to missing pages and anchors among them.

```text
Checked 214 pages, 12 redirects and 2306 output files.
```

It exits `1` on an error, such as a page or spec that cannot be read, a navigation entry with no target, or a broken link under `brokenLinks: "error"`.
