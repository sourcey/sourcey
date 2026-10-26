---
title: Deploying
description: Publish the built folder on any static host, at its root or beneath a path, or inside an Astro site.
---

`sourcey build` writes the whole site to a folder of static files. Hosting it needs no server, runtime or build step of its own: upload the folder.

```bash
npx sourcey build -o dist
```

## Settings a host needs

| Setting | Why |
| --- | --- |
| `siteUrl` | The public origin, such as `https://docs.example.com`. Canonical URLs, language alternates, social cards and `sitemap.xml` need it; without it the build writes no sitemap and says so |
| `baseUrl` | The path the site is served beneath, such as `/docs`, when it is not the origin's root. Every page links its styles, scripts and other pages from it, so a site built for the root does not work moved beneath a path |
| `prettyUrls` | How pages are written and linked: `false` writes and links `guide.html`; `"slash"` writes `guide/index.html` and links `/guide/`, which every host serves; `"strip"` writes `guide.html` and links `/guide`, for hosts that serve a page without its extension, as Cloudflare Pages, Netlify and GitHub Pages do, and Vercel does with `cleanUrls: true` |

## GitHub Pages

```yaml
name: Docs
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
        with:
          # The whole history, so lastUpdated dates each page by its last commit.
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: npm ci
      - run: npx sourcey build -o dist
        env:
          # Read by a GitHub navbar link with stats: true.
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v5
```

Set the repository's Pages source to GitHub Actions. A project site is served beneath the repository's name, so set `baseUrl: "/<repository>"` unless it has a domain of its own.

## Other hosts

:::code-group

```toml title="Netlify (netlify.toml)"
[build]
  command = "npx sourcey build"
  publish = "dist"
```

```json title="Vercel (vercel.json)"
{
  "buildCommand": "npx sourcey build",
  "outputDirectory": "dist",
  "cleanUrls": true
}
```

```bash title="Cloudflare Pages"
npx sourcey build
npx wrangler pages deploy dist --project-name docs
```

:::

On S3 or any other static file server, upload the folder; with CloudFront or a similar CDN in front, the files under `_assets/` and `_media/` are named by their content and can be cached for good.

## Redirects and headers

The [redirects](./configuration.md#redirects) a site declares are written twice: as an HTML page at each old address, which works on any host, and as `_redirects`, which Netlify and Cloudflare Pages read to answer with the redirect itself.

Markdown copies and discovery files need their own content types, such as `text/markdown` for a page's Markdown. `response-headers.json` lists the headers each needs by its public path, for a host or deployment step to apply; Sourcey's dev servers apply them already. See [Readable reference and discovery](./machine-readable.md).

## Inside an Astro site

Mount the same config in an Astro site with `sourcey/astro`; no separate docs build or committed `public/docs` folder is needed. Sourcey registers its compiled pages and assets before Astro packages the site, then checks the files Astro writes. The host's own pages keep their routes. With `prettyUrls: "strip"`, every page links the documentation's home by its public path, such as `/docs`, without a trailing slash. Set `landingPage: false` when an Astro page owns the mount's root, and Sourcey writes no copy of its first page there; an authored index is still a real route, so give it another slug if the host owns that address.

## Embedding

`--embed` writes each page without its `<html>`, `<head>` and `<body>`, for a page or frame of your own to hold. See [Embedding](./guides/embedding.md).
