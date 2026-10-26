---
title: sourcey dev
description: Preview the site while you write, with each change drawn as you save it.
---

`sourcey dev` serves the site from its sources and redraws what a change touches as you save it.

```bash
sourcey dev [--port <number>] [--host <address>] [--config <path>]
```

| Flag | Alias | Default | Meaning |
| --- | --- | --- | --- |
| `--port` | `-p` | `4400` | The port to listen on |
| `--host` | | `localhost`, or `$HOST` | The address to listen on, such as `0.0.0.0` to reach it from another machine |
| `--config` | `-c` | `sourcey.config.ts` here | The config file, or the folder holding it |
| `--strictChangelog` | | `false` | Stop on changelog warnings |

The server watches the config and every file it imports, each page, spec, overlay and snapshot the config names, the components folder and the public folder. It reports the same problems a build does, broken links among them, as you work, and applies the headers each Markdown and discovery file needs.

The dev server is for writing. Publish with [`sourcey build`](./build.md).
