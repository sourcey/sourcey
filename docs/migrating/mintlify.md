---
title: Migrating from Mintlify
description: Convert a Mintlify docs.json project to a native Sourcey project, keeping every page URL and most components as written.
---

# Migrating from Mintlify

`sourcey migrate mintlify` reads `docs.json` and your pages and writes a standalone Sourcey project beside them. Most Mintlify components are Sourcey components already, so most pages convert without a change.

```bash
npx sourcey migrate mintlify --dry-run
```

A project still on `mint.json` upgrades it to `docs.json` with Mintlify's own CLI first.

## Configuration

| Mintlify | Native Sourcey |
| --- | --- |
| `name`, `colors`, `appearance` | `name`, `theme.colors`, `theme.appearance` |
| `logo`, `favicon` | `logo`, `favicon` |
| `icons.library: "lucide"` | `theme.icons: "lucide"` (install `lucide-static`); Font Awesome has no native set, so pages draw Heroicons. Brand icons (`iconType="brands"`) become brand marks (`brand:aws`; install `@fortawesome/fontawesome-free`) |
| `navbar.links`, `navbar.primary` | `navbar.links`, `navbar.primary` |
| `footer.socials`, `footer.links` | `footer.links` |
| `redirects` | `redirects` |
| page `mode: custom` or `center` | `layout: page`; `wide` and `frame` pages stay documentation, listed in the report |

Mintlify keeps the address your docs are served at in its dashboard. If they are served below a site's root (for example `/docs`), set `siteUrl` and `baseUrl`.

## Pages and navigation

Every `.md` and `.mdx` page keeps its URL, its file path, whether or not `docs.json` lists it; pages it does not list stay out of the menu. A page with a `url` becomes a link in the navigation. `sidebarTitle` becomes `navTitle` (or the title, when the page has none) and `hidden` keeps the page out of the menu.

Groups and nested groups keep their order. Tabs, menus, anchors and dropdowns become sections of one sidebar, and every page keeps its URL.

## API pages

Mintlify's API pages, each an MDX file naming one operation (`openapi: "GET /keys"`), become a native API reference generated from the OpenAPI document in `api.openapi`. Each operation keeps what its page gave it, and native reads it from the place it owns that fact:

| Mintlify | Native Sourcey |
| --- | --- |
| The page's `title` and its notes (`<Note>`, `<Warning>`, Markdown) | The operation's summary, and its notes ahead of its description, in an [OpenAPI Overlay](../adapters/openapi.md#overlays) (`api.overlay.yaml`); callouts become GitHub alerts, which render as native callouts |
| The page's URL | A page per operation at the same URL (`reference: { split: "operations" }`, with `api.routes.json`) |
| The page's place in the navigation | The reference's navigation (`api.navigation.json`), groups and order as Mintlify had them; guides in the same section stay guides, linked from it |
| Links to a parameter, field or the credentials on the page (`#parameter-secret-name`, `#body-permissions-items-one-of-0-subject`, `#authorization-authorization`) | Fragment aliases of the native field or authentication section (`api.anchors.json`), so a link opens the field, inside its parent's disclosure |
| Operations with no page | Removed in the overlay, so the reference publishes what Mintlify did |

The report names what needs a decision or a later update: pages whose operation the OpenAPI document no longer has stay pages with their title and notes; two pages for one operation keep the first as its page and redirect the other to it, keeping a different title as its navigation label; an operation's description in the overlay includes the OpenAPI document's own description as it was when converted; a fragment Mintlify gave two fields (`id` and `_id` are both `-id`) stays with the first on the page, as a browser opened it; and fragments of fields the native reference does not show open the operation's page. Mintlify shows the first alternative of each union, and fragments of the others exist only once a reader picks one, so no link to them is kept. The overlay, routes, navigation and aliases are ordinary files to review and edit; the generated tab uses `anchorUnmatched: "warn"`, so an alias whose field leaves the OpenAPI document is reported and omitted while the other links keep working. Set it to `"error"` to make missing destinations fail the build, or `"ignore"` to omit them silently. Invalid aliases and collisions always fail.

## Components

`Note`, `Warning`, `Info`, `Tip`, `Danger`, `Steps` and `Step`, `Tabs` and `Tab`, `CardGroup` and `Card`, `AccordionGroup` and `Accordion`, `Expandable` and `CodeGroup` stay as written. `Check` becomes a `Tip`. Snippets imported from `/snippets/` and `<Snippet>` become `<Include>`, and the snippets are converted like pages. `ParamField` and `ResponseField` become native [fields](../components.md#fields) with the anchors Mintlify gave them (`#param-secret-name`), so links to a field keep working; an `Expandable` inside a field keeps its title as the group of child fields. Each `Accordion` keeps the anchor Mintlify gave it, its `id` or its title (`#why-rotate-keys`), unless a heading or an earlier accordion on the page already has it, which the report names. `Columns` of cards become a `CardGroup`, a captioned `Frame` around one image becomes a `Figure`, each `View` becomes a titled section the reader opens (native has no page-wide view switcher), `<Visibility for="agents">` becomes [`ForAgents`](../components.md#content-for-agents), and `for="humans"` content shows on the page. Card icons that are images stay images, at the page's own path to them, and `Icon` becomes a native [inline icon](../components.md#icons); the report suggests a `label` for each, since Mintlify gives none. Attributes that only style a component, and card icons the project's icon set lacks, are listed in the report.

A code block's title, the words after its language (` ```bash Install `), becomes `title="Install"`, which a `CodeGroup` shows as the tab's name. Line highlights carry over; `wrap`, `lines` and `expandable` have no native equivalent and are listed in the report.

## What stops a migration

Several OpenAPI documents, a navigation entry that generates every operation's page (`openapi` on a group), versions and languages, an inline `Icon` the project's icon set lacks, components without a native form yet, and your own components from `/snippets/*.jsx` (until you convert them in the `--mapping` file) stop the migration with the file and line.
