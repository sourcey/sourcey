---
title: Migrating from Astro
description: Convert Starlight or custom Astro documentation to native Sourcey, mounted inside the same Astro site.
---

# Migrating from Astro

`sourcey migrate astro` keeps your Astro site and moves its documentation onto Sourcey. Host pages, forms, layouts and integrations stay Astro's. The documentation is mounted with `sourcey/astro` at the path it was served from, so `astro build` and `astro dev` keep working as before.

```bash
npx sourcey migrate astro --dry-run
```

Astro roots built by a package script with `--root` (for example a second, app-bundled docs build) are converted too.

## Starlight

| Starlight | Native Sourcey |
| --- | --- |
| `title`, `logo`, `favicon` | `name`, `logo`, `favicon` |
| `social` | `navbar.links` |
| `editLink.baseUrl` | `repo`, `editBranch`, `editBasePath` |
| `lastUpdated` | [`lastUpdated`](../configuration.md#last-updated) |
| `--sl-color-accent` in custom CSS | `theme.colors` (other Starlight styles are reported, not copied) |
| `sidebar`: groups, links, slugs, `collapsed`, `translations` | navigation groups with stable IDs and translated labels |
| `sidebar` `autogenerate` | explicit pages in Starlight's order (`sidebar.order`, then slug) |
| `locales`, `defaultLocale` | `i18n`, with the same locale directories and URLs |
| `starlight-openapi` | an API reference tab whose operations keep their URLs (`operations: "operations/{operation}"`), with the plugin's section anchors (`#parameters`, `#200`, ...) kept as aliases of the native sections |
| `:::note[Title]` and the other asides | unchanged; native Markdown reads them as written |
| `Aside`, `Card`, `CardGrid`, `LinkCard`, `Tabs`, `TabItem` | native callouts, `Card`, `CardGroup` and `Tabs` |
| frontmatter `sidebar.label`, `sidebar.hidden`, `slug`, `draft` | `navTitle`, `hideInMenu`, `slug`, `draft` |
| `template: splash` | `layout: page`, with the page's title as its heading, as Starlight drew it |

Content stays in `src/content/docs`. Pages keep their URLs: the configuration keeps file names as routes (`markdown({ slugs: "file" })`) when that matches most pages, and a page Starlight spelled differently, such as an uppercase file name it lowercased, gets an explicit `slug`. Heading anchors keep the spelling the project's Astro version gave them. The content configuration loses the Starlight collections, and the file goes when nothing else was in it. Build scripts that name a removed file are listed for you to update.

A page that Starlight published but no sidebar entry lists stays published, beside its nearest listed sibling and out of the menu.

Starlight serves a whole site's 404 page. When the documentation is mounted below the root, the report reminds you to give the host its own `src/pages/404`.

## Custom documentation

A site that renders documentation with its own pages, layouts and collections has its routing and navigation in code. Declare them once in the mapping file:

```ts
export default {
  astro: {
    roots: {
      ".": {
        name: "Example",
        documentation: [
          {
            source: "src/pages/documentation",
            kind: "pages",
            route: "/documentation",
            // Files leave the Astro route directory so the native mount owns these URLs.
            move: "documentation",
            // A project module, read statically: the fields holding each entry's label, link and children.
            navigation: { module: "./src/utils/navigation.ts", export: "menu", fields: { label: "text", link: "link", children: "subRoutes" } },
          },
        ],
      },
    },
  },
};
```

- `kind: "pages"` publishes each file at its path under `route`; `kind: "collection"` publishes each content entry by its ID (its `slug` frontmatter, or its path).
- `navigation` can also be a list of `{ label, link, children }`, or a function that receives the documents (file, path, route, frontmatter) and returns that list. A navigation entry with children becomes a group that lands on its own page.
- `landing` names a host page file that served `route` itself; it becomes the documentation's index page.
- `replaces` lists host files that only served the old documentation, such as a `[...slug].astro` route; they are removed.
- `assemble` declares files a build copies into a root before it runs (as a Dockerfile step does), so the converter sees what that build sees.

A page without a `title` takes it from its opening heading when that is the page's only heading at its level, as when a layout prints no title and `## Install` above `###` sections served as one. Every heading on the page rises by the same number of levels, so `## Install` becomes the `# Install` title and its `###` sections become `##`; their anchors stay the same. Any other untitled page takes its navigation label as its title.

Components your pages import are converted through `components` in the same file, by their module and export. A widget with behaviour becomes a native component you write once and register under `definitions`; generated content keeps its source (a native component can read remote JSON at build time) rather than becoming a pasted snapshot.

## Checking the result

Build the site as you normally would and compare a few pages with the old ones. The migration has already checked every route, heading anchor, image and block of text against a native build; the review notes in the report are the places worth a human look.
