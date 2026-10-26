---
title: sourcey migrate
description: Convert an Astro, MkDocs, Docusaurus or Mintlify project to native Sourcey, once.
---

`sourcey migrate` converts an existing documentation project to native Sourcey files once, checks the result against the original, and writes it only when every check passes.

```bash
sourcey migrate <framework> [root] [--dry-run] [--mapping <file>]
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `framework` | | `astro`, `mkdocs`, `docusaurus` or `mintlify` |
| `root` | `.` | The project's folder |
| `--dry-run` | `false` | Print the report and the full diff, and write nothing |
| `--mapping` | | A module stating what the converter cannot infer, such as your own components |

It prints each file it changes with the reason, the files left as they were, review notes and the packages the project now needs. It exits `1` when a check fails, naming the file and line. See [Migrating to Sourcey](../migrating.md).
