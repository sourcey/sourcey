---
title: Quickstart
description: From nothing to a running documentation site, with guides and an API reference, in a few minutes.
---

This walks through a site with Markdown guides and an API reference, running on your machine.

## Before you start

- Node.js 22.22.2 or later, 24.15 or later, or 26
- An OpenAPI spec or an MCP server snapshot, if you have one; a site can start with Markdown alone

## Create the project

:::tabs
::tab{title="With init"}

```bash
npx sourcey init
npm install
npx sourcey dev
```

`init` asks for the project's name and a theme, and offers an API reference from any OpenAPI spec or Doxyfile it finds. It writes `sourcey.config.ts`, example pages, a `package.json` with `dev` and `build` scripts, and a `.gitignore`. Inside an existing project it suggests a `docs/` folder, so the docs live beside the code. See [sourcey init](./cli/init.md).

::
::tab{title="Other installs"}

Sourcey also ships through Homebrew (`brew tap sourcey/tap && brew install sourcey`), Docker (`sourcey/sourcey` on Docker Hub) and Nix (`nix run github:sourcey/sourcey`). See [Install](./install.md). The rest of this guide runs `npx sourcey`; use your install's command in its place.

::
:::

## The config

`sourcey.config.ts` names the site's tabs and the pages each holds. `init` wrote one; this one adds an API reference:

```ts
import { defineConfig, markdown, openapi } from "sourcey";

export default defineConfig({
  name: "My Project",
  theme: {
    colors: { primary: "#0066cc" },
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          groups: [{ group: "Getting Started", pages: ["introduction", "quickstart"] }],
        }),
      },
      {
        tab: "API Reference",
        slug: "api",
        source: openapi("./openapi.yaml"),
      },
    ],
  },
});
```

Paths in the config are read from its own folder. See [Navigation](./navigation.md) for tabs, groups and pages.

## Write a page

Each page the config lists is a Markdown file of that name: `"introduction"` is `introduction.md`.

```markdown
---
title: Introduction
description: Welcome to our documentation.
---

This is the first page. Write Markdown here.

## Features

- An API reference from the spec
- Guides with components
- Search
- Light and dark appearances
```

See [Writing pages](./pages.md) for frontmatter and [Components](./components.md) for what pages can use beyond Markdown.

## Preview it

```bash
npx sourcey dev
```

The site serves at `http://localhost:4400` and redraws what you change as you save it.

## Build it

```bash
npx sourcey build
```

```text
Sourcey: building documentation site

  Pages:  4
  Output: /home/me/my-project/dist
  Time:   0.8s
```

`dist/` holds the whole site as static files, with no framework sent to the browser. Publish it on GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3 or any static host; see [Deploying](./deploying.md).

:::tip
Have an OpenAPI spec already? `sourcey build api.yaml` builds its reference with no config at all.
:::

## Next

:::card-group{cols="3"}
::card{title="Project structure" href="./project.md" icon="cube"}
Where Sourcey finds its config and pages, and what a build writes.
::
::card{title="Components" href="./components.md" icon="book-open"}
Steps, tabs, cards, callouts, diagrams and more.
::
::card{title="Cheese Store demo" icon="rocket-launch" href="https://github.com/cheesestore/docs"}
A whole site with guides, an OpenAPI and an MCP reference and every component. Clone it and run `npx sourcey dev`.
::
:::
