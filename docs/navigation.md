---
title: Navigation
description: Tabs, sidebar groups, nested sections, section pages, links and the order readers move through them.
---

`navigation.tabs` lists the site's tabs in the order the header shows them. Each tab has one source. A Markdown tab's sidebar is the groups you write, in the order you write them: nothing is sorted or added for you, and a file no entry names is not published.

```ts
import { defineConfig, markdown, openapi } from "sourcey";

export default defineConfig({
  navigation: {
    tabs: [
      {
        tab: "Guides",
        id: "guides",
        slug: "",
        source: markdown({
          groups: [
            { group: "Start here", pages: ["introduction", "quickstart"] },
            {
              group: "Install",
              href: "install",
              collapsed: true,
              pages: [
                { page: "install/index", hidden: true },
                "install/linux",
                "install/macos",
                { group: "Containers", pages: ["install/docker", "install/kubernetes"] },
              ],
            },
            { group: "Recipes", pages: ["recipes/*"] },
            { group: "Help", pages: ["faq", { href: "https://status.example.com", label: "Service status" }] },
          ],
        }),
      },
      { tab: "API Reference", id: "rest", slug: "api", source: openapi("./openapi.yaml") },
    ],
  },
});
```

## Tabs

| Field | Meaning |
| --- | --- |
| `tab` | The name the header shows |
| `slug` | The tab's path under the site's base. It defaults to the name, slugified: "API Reference" publishes under `api-reference/`. `""` publishes at the base itself. Two tabs cannot share a slug, and a slug cannot start with `@` |
| `id` | The tab's stable name, for links into it from other tabs, versions and languages. It defaults to the slug, so name it when the slug is `""` or may change |
| `source` | Where the tab's pages come from: `markdown()`, `openapi()`, `mcp()`, `doxygen()`, `godoc()` or `rustdoc()` |

A header tab leads to its first page in reading order, a section's own page before the pages it holds; a reference tab leads to its overview. Older configurations that set `groups`, `openapi`, `mcp`, `doxygen`, `godoc` or `rustdoc` on the tab itself still build.

## Pages

A page is named by its path from `sourcey.config.ts`, without the extension: `"quickstart"` is `quickstart.md` or `quickstart.mdx`, and `"install"` can also be `install/index.md`. In a translated site the path is read from each language's content directory.

The sidebar labels a page with the entry's `label`, else its frontmatter `navTitle`, else its title:

```ts
pages: [
  "quickstart",
  { page: "reference/cli", label: "CLI" },
  { page: "legacy/upgrade", hidden: true },
]
```

`hidden: true` publishes the page at its address but leaves it out of the sidebar and of previous and next. Frontmatter `hideInMenu: true` does the same from the page itself, and `draft: true` leaves the page out of the build. A page can be listed in more than one group and keeps one address; its own previous and next are those beside its first listing.

A path with `*` lists every Markdown file it matches, sorted by path: `"recipes/*"` or `"api-*"`. A pattern that matches nothing fails the build, as does a page that does not exist. List pages by name where their order matters.

## Groups

A group is a heading over its pages. A group can hold groups of its own, to any depth, in among its pages:

```ts
{
  group: "Install",
  pages: ["install/linux", { group: "Containers", pages: ["install/docker"] }],
}
```

| Field | Meaning |
| --- | --- |
| `group` | The heading |
| `pages` | Its pages, links and groups, in order |
| `href` | The section's own page, by its address under the site's base (`install`) or from the root (`/docs/install`) |
| `collapsed` | `true` folds the group until a reader opens it; `false` lets it fold but starts it open. Unset, it is always open, with no control |
| `id` | The group's stable name. It defaults to its place: the tab's name, then each heading down to its own, joined by `/`, such as `Guides/Install/Containers` |

A heading with `href` links its section's own page. On that page the heading is current and the section opens, and on the pages it holds the breadcrumb leads to it. The page comes first in reading order, before the pages it holds. List the page `hidden` among the group's pages, as above, so it is published without a second entry beneath its own heading. A group with `href` and no pages is a link in the sidebar.

A folded group opens by itself on any page it holds. Two groups cannot share an `id`, so give one its own when the same heading sits twice under the same parent. A language's `messages.navigation` renames a group by its `id`, as it renames a page by its path; see [Languages](./languages.md).

## Links

`{ href, label }` lists a link wherever it stands: another site, a file, or an address of this site outside the tab's pages. A link is not a page to read through, so previous and next pass it by.

## Pages and operations from other tabs

An entry can name a page another tab publishes, `{ page: "installation", tab: "guides" }`, or an operation a reference publishes, `{ operation: "GET /keys", reference: "rest" }`. Both name the owning tab by its `id`, and the link leads to the page or operation where its own tab publishes it, in the reader's language and release. A reference tab can also be given its own authored tree in place of the groups its spec generates; see [Choose the reference order](./configuration.md#choose-the-reference-order).

## Reading order

Previous and next follow the sidebar from top to bottom within a tab: each section's own page, then the pages and groups it holds, depth first. Hidden pages and links are passed by, and a link to a place on a page already listed is not a page of its own.

## Large sidebars

A documentation tab's sidebar shows its whole tree, every section opening in place, up to 400 pages. Past that, and past 100 entries in a reference, each page carries only the branch around it in full, and every other section stays as a link to where it starts. A section of more than 80 entries without a page of its own gets a generated page that lists them, which its link leads to where it is folded.
