---
title: Writing Pages
description: Markdown files with frontmatter, how a page is titled and summarised, and the Markdown every page can use.
---

Each documentation page is a Markdown file, `.md` or `.mdx`, listed in the [navigation](./navigation.md). Sourcey highlights its code, anchors its headings, lists them under "On this page", and publishes the page as HTML and as Markdown for agents.

```markdown
---
title: Getting started
description: Install the CLI and make your first request.
---

Page content starts here.
```

## Frontmatter

Every field is optional.

| Field | Meaning |
| --- | --- |
| `title` | The page's heading, its title in the browser and search, and its sidebar label. Without one, the page's first level-one heading is its title, then its navigation label, then its file name |
| `description` | The summary search, social cards and metadata show. Without one, the page's first paragraph is its summary |
| `navTitle` | A shorter sidebar label than the title |
| `slug` | The page's address within its tab, in place of its file's path |
| `id` | The page's stable document ID, so a translation with another file name, or a link from another tab, finds it |
| `hideInMenu` | `true` publishes the page but leaves it out of the sidebar and of previous and next |
| `draft` | `true` leaves the page out of the build |
| `layout` | `doc`, the documentation frame and the default; `page`, the site's header and footer around the page's own body; or `blank`, the body alone. See [Page layouts](./configuration.md#page-layouts) |
| `css` | Stylesheets beside the page, such as `css: ./home.css`, for that page alone |
| `editUrl` | Where "Edit this page" leads for this page, an `https://` address, or `false` for no link |
| `feedback` | `false` leaves the site's "Was this page helpful?" off this page |

A page that opens with a level-one heading matching its title shows it once: the frame draws the title, and the heading's anchor still lands. An opening paragraph that is the page's summary is drawn as the page's lede, under the title.

## Headings

Level-two and level-three headings are listed under "On this page"; deeper ones are drawn but not listed. Each heading has an anchor from its text, so `## Rate limits` is `#rate-limits`. A heading can name its own with `## Rate limits {#limits}`, as Markdown's attribute lists do.

## Code

Fenced code blocks are highlighted at build time, with no highlighter sent to the browser. Name the language after the opening fence:

````markdown
```ts
export default defineConfig({ name: "Acme" });
```
````

A fence can carry a title and mark lines as highlighted, focused, added or removed; see [Code annotations](./components.md#code-annotations). The same example in several languages is a [code group](./components.md#directives).

## Markdown

Pages are GitHub-flavoured Markdown: emphasis, links, lists, task lists, tables, block quotes, images, inline code and [footnotes](./components.md#footnotes). A link to another page can name its file, `[Install](./install.md)`, and leads to that page's address; one to a section of a page names its anchor, `./install.md#homebrew`. A link to a file beside the page, such as a YAML manifest or a script, publishes the file with the page. Each build reports a link to a page or anchor the site does not have.

Beyond Markdown, pages can use callouts, tabs, steps, cards, accordions, fields, diagrams, figures, video and your own components, written as directives or as tags. See [Components](./components.md).
