# Sourcey llms.txt delivery report

- Built the documentation site with the official Sourcey CLI 3.6.5 from the pinned `sourcey/sourcey` commit `7b84dc2b672f97b286be5eab8d4f9f095b9c4d76`.
- Reused the project's committed `docs/sourcey.config.ts` and five real Markdown pages; no generated HTML or indexes were written into the authored source tree.
- The build emitted `llms.txt`, `llms-full.txt`, five HTML documentation pages, a search index, a sitemap, CSS, and JavaScript.
- The generated `llms.txt` is fetchable as plain text from the canonical upstream PR-head ref at `https://raw.githubusercontent.com/sourcey/sourcey/refs/pull/261/head/docs/llms.txt`; this is the exact file proposed in `sourcey/sourcey#261`.
- The upstream pull request [sourcey/sourcey#261](https://github.com/sourcey/sourcey/pull/261) adds `docs/llms.txt` to the project's own repository with a maintainer-facing rationale; it is open and mergeable by the project maintainers.
- Five entries were audited against the pinned repository: Introduction, Install, Configuration, Roadmap, and Changelog each resolve to a real source page.
- The generated file is content-addressed in `evidence.json` so a reviewer can compare the live artifact with the recorded build output.
- A governed runx 0.8.2 signing run sealed the validation run. The receipt is `runx:receipt:sha256:ca1f8bc8fdc457c4033e9509c245aa76463038abf9a13487056cdce02d1d13cb`; `runx verify` returned `valid=true`, with valid digest, content address, and signature and no findings.
