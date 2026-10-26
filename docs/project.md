---
title: Project Structure
description: Where Sourcey finds its config and content, and what a build writes.
---

A Sourcey project is a folder holding `sourcey.config.ts` and the content it names. There is no required layout: every path in the config is read from the config's folder.

```text
docs/
  sourcey.config.ts      the site's config
  introduction.md        documentation pages
  quickstart.md
  guides/
    authentication.md
  openapi.yaml           a spec a tab reads
  components/            the site's own components (optional)
  pages/                 the site's own pages, with pages: "./pages" (optional)
  public/                files served as they are, with publicDir: "./public" (optional)
  brand/logo.svg
```

## The config

`sourcey build`, `sourcey dev` and `sourcey check` read `sourcey.config.ts` from the folder they run in, or the file or folder `--config` names. The config is TypeScript, read as a module, so it can import JSON and other modules, such as a navigation tree kept in a file of its own:

```ts
import { defineConfig, markdown, openapi } from "sourcey";

export default defineConfig({
  name: "Acme",
  logo: "./brand/logo.svg",
  navigation: {
    tabs: [
      { tab: "Guides", slug: "", source: markdown({ groups: [{ group: "Start", pages: ["introduction", "quickstart"] }] }) },
      { tab: "API", slug: "api", source: openapi("./openapi.yaml") },
    ],
  },
});
```

A spec can also be read from a URL, which the build fetches. The dev server reloads when the config, a file it imports, or any content it names changes. [Configuration](./configuration.md) lists every setting, and [Navigation](./navigation.md) how pages are named and ordered.

## What a build writes

`sourcey build` writes the site to `dist`, or the folder `--output` names:

```text
dist/
  index.html             the home page, or a redirect to the first page
  introduction.html      each page, and its Markdown beside it
  introduction.md
  guides/authentication.html
  api.html               a reference, one page or one per section or operation
  404.html
  _assets/<hash>/        the theme's stylesheet and scripts, named by their content
  _media/                images and files the pages use, named by their content
  _og/                   social cards
  _search/               the search index, in shards
  documents.json         the documentation index for agents
  llms.txt
  llms-full.txt
  sitemap.xml            with a siteUrl
  _redirects             redirect rules for hosts that read them
  response-headers.json  the headers each machine-readable file needs
```

With `prettyUrls: "slash"`, each page is written as `introduction/index.html` and linked as `/introduction/`. [Readable reference and discovery](./machine-readable.md) describes the exports, and [Deploying](./deploying.md) what a host needs.

The build stages every file and replaces the live output only when the whole site is ready, so a failed build leaves the last one in place. `.sourcey-output.json` records what it wrote: the next build into that folder removes what it no longer writes, and it will not overwrite a file it did not write. Build into an empty folder, or one a Sourcey build owns.
