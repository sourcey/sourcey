---
title: sourcey init
description: Start a Sourcey project, with the specs and Doxygen setup it finds beside it.
---

`sourcey init` asks a few questions and writes a project you can run straight away.

```bash
npx sourcey init
npm install
npx sourcey dev
```

It asks for:

1. **A folder**, when run inside an existing project (one with a `package.json`, `.git` or `src`): `docs`, or `documentation` if `docs` is taken.
2. **The project's name**, which defaults to the folder's.
3. **A theme**: `default`, `minimal`, `api-first` or `reader`. See [Themes](../themes.md).
4. **An API reference** from an OpenAPI spec it finds in the folder, and **a Doxygen reference** from a `Doxyfile` it finds there, each if you want it.
5. **Example content**, a quickstart page, when it found neither.

It writes `sourcey.config.ts`, `introduction.md` (and `quickstart.md` with example content), a `package.json` with `dev` and `build` scripts and Sourcey as a dependency, and a `.gitignore` for `node_modules` and `dist`. An existing `package.json` or `.gitignore` is left alone, and a folder that already has a `sourcey.config.ts` is refused.
