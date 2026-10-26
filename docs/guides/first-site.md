---
title: Your First Docs Site
description: Build a documentation site from scratch, with Markdown guides and an API reference.
---

This builds the documentation for a made-up "Tasks API": two Markdown pages and a reference generated from its OpenAPI spec, with navigation, search and light and dark appearances.

## What we're building

A site with two tabs:

- **Documentation**: an introduction and a quickstart
- **API Reference**: generated from an OpenAPI spec

:::note
This takes about fifteen minutes. The [quickstart](../quickstart.md) covers the essentials in less.
:::

## Setup

:::steps

1. Create the project

   ```bash
   mkdir tasks-docs && cd tasks-docs
   npm init -y
   npm install sourcey
   ```

2. Write the config
   Create `sourcey.config.ts`:

   ```ts
   import { defineConfig, markdown, openapi } from "sourcey";

   export default defineConfig({
     name: "Tasks API",
     theme: {
       colors: { primary: "#6366f1" },
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
     navbar: {
       links: [{ type: "github", href: "https://github.com/your-org/tasks-api" }],
     },
   });
   ```

3. Write the introduction
   Create `introduction.md`:

   ```markdown
   ---
   title: Introduction
   description: The Tasks API lets you create, manage and track tasks.
   ---

   The Tasks API is a REST API for task management. Authenticate with an API key, make requests, get JSON back.

   ## Features

   :::card-group{cols="2"}
   ::card{title="Task management" icon="book-open"}
   Create, update, delete and list tasks, with priorities, due dates and labels.
   ::
   ::card{title="Webhooks" icon="bell"}
   Hear when a task is created, completed or overdue.
   ::
   :::
   ```

4. Write the quickstart
   Create `quickstart.md`:

   ````markdown
   ---
   title: Quickstart
   description: Make your first request in a minute.
   ---

   :::steps

   1. Get an API key
      Sign up in the dashboard and copy your key.
   2. Create a task
      ```bash
      curl -X POST https://api.tasks.dev/v1/tasks \
        -H "Authorization: Bearer YOUR_KEY" \
        -H "Content-Type: application/json" \
        -d '{"title": "Ship the docs", "priority": "high"}'
      ```
   3. Check it worked
      ```bash
      curl https://api.tasks.dev/v1/tasks \
        -H "Authorization: Bearer YOUR_KEY"
      ```

   :::
   ````

5. Add the spec
   Save the API's spec as `openapi.yaml`. Any valid OpenAPI 3 or Swagger 2.0 file will do to try it.

6. Preview it

   ```bash
   npx sourcey dev
   ```

   Open `http://localhost:4400`: the pages are in the sidebar, each page's headings under "On this page", and search finds both the guides and the API.

7. Build it
   ```bash
   npx sourcey build
   ```
   `dist/` holds the whole site, ready to [deploy](../deploying.md).

:::

## Next

- Add pages by writing Markdown files and listing them in the config; see [Navigation](../navigation.md)
- Give the site your colours, fonts and logo; see [Custom branding](./custom-branding.md)
- Set `repo` and `editBranch` to add "Edit this page" links; see [Configuration](../configuration.md)
- Set `codeSamples` to choose the API reference's example languages; see [Code samples](../adapters/openapi.md#code-samples)

:::tip
For a fuller example, the [Cheese Store demo](https://github.com/cheesestore/docs) is a whole Sourcey site with five tabs, guides, an OpenAPI and an MCP reference, its own branding and every component. Clone it to start from: `git clone https://github.com/cheesestore/docs && cd docs && npm install && npx sourcey dev`.
:::
