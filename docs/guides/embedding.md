---
title: Embedding in an existing site
description: Serve the documentation beneath a path of an existing website, inside Astro or beside any other framework.
---

A Sourcey site can live beneath a path of an existing website, such as `/docs`. An Astro site mounts it with the integration; any other site serves the built folder.

## In Astro

Install Sourcey and add the integration to `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import sourcey from "sourcey/astro";

export default defineConfig({
  site: "https://example.com",
  integrations: [
    sourcey({
      config: "./docs/sourcey.config.ts",
      routeBase: "/docs",
    }),
  ],
});
```

`astro dev` serves the documentation through Vite and redraws it as its config, pages and specs change. `astro build` writes it into Astro's output beneath `/docs`, with the site's address from Astro's `site`. Set `landingPage: false` when an Astro page of your own owns `/docs` itself. See [Deploying](../deploying.md#inside-an-astro-site).

## Beside another framework

Build the site into the folder your framework serves as static files, and tell it the path it is served beneath:

```ts
export default defineConfig({
  siteUrl: "https://example.com",
  baseUrl: "/docs",
  // ...
});
```

```bash
sourcey build -o ../public/docs
```

Every page links its styles, scripts and other pages from `baseUrl`, so the site works only beneath the path it was built for. It brings its own stylesheet, scripts and search index, and touches nothing of the host's. Build into a folder of its own: Sourcey will not overwrite files it did not write.

```json
{
  "scripts": {
    "build:docs": "cd docs && npx sourcey build -o ../public/docs"
  }
}
```

## Embeddable pages

`--embed` writes each page without its `<html>`, `<head>` and `<body>`, for a page or frame of your own to hold:

```bash
sourcey build --embed -o ./public/docs
```

An embedded page is its body alone, with no stylesheet or script of its own: the page that holds it loads the theme's, which the build writes under `_assets/`, beside the media, search index and exports the pages use.

## This site

These docs are built this way. The sourcey.com site mounts the documentation's config with `sourcey/astro` at `/docs`, with `landingPage: false`, so the site's own page owns `/docs` and the documentation starts at `/docs/introduction`. The product site and the documentation are styled independently, and share an address and nothing else.
