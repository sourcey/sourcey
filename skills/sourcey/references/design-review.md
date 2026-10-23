# Reviewing a Sourcey site

A reader decides in seconds whether docs are cared for. One careless element (a repeated label, a lit sidebar item that is not where they are, a cut-off logo) costs their trust in the rest. Review the site as a reader before anyone else sees it. Passing builds, routes and status codes is necessary and never sufficient.

## What to look at

Run `npx sourcey dev` (or serve the built `dist`) and open every kind of page a reader can reach:

- the home page and a typical guide
- a long guide with many headings, and a short one with one or none
- each reference tab's overview, a section or operation page, and a model page
- an MCP reference's overview and a tool
- search, opened and with a query
- an address that does not exist (the 404 page)

For each, look at 1440 px and 390 px wide, in light and in dark. Where the site replaces an older one, put each page beside its original.

## What to check

**Every element says something.**
- Labels: a kind label (TOOL, RESOURCE) on every row of a section named for that kind, or the same word on every row of any list, is noise.
- Repetition: a line under a title that restates the title; "On this page" listing what the sidebar beside it lists; a footer link to a page in the sidebar or a link already in the header.
- Lone navigation: a sidebar group with only the current page, a contents list with one entry, a tab with one page that the header already reaches.

**One thing is current.** Click sidebar entries, section links within a page, and tabs. After each click exactly one sidebar entry should be lit: the place being read, or the page when the reader is at its top.

**Structure matches the project.** Sections and their order are the project's own. A large reference reads in the groups its authors use. Nothing is cut short without saying so.

**Names and assets.**
- The header shows the product's name, not a site title with a tagline.
- The logo is whole in light and dark: capture it at 3x and check the right edge of its word. A web font inside an SVG image falls back to another face, which may be wider.
- Favicons, social cards and images belong to the project.

**Alignment and fit.**
- Logo, tabs, sidebar and page title share one left edge.
- Text lines keep a reading width whether or not the page has "On this page".
- Nothing scrolls sideways at 390 px; long identifiers wrap inside the word rather than widening the page.
- Code blocks scroll within themselves.

**The page's end.** "Edit this page" sits at the end of the content, then previous and next, then the footer: identity on the left, outward links on the right, social icons together.

## Measuring rather than eyeballing

Use the browser's own geometry. For example, with a headless browser, compare `getBoundingClientRect()` of the logo, the tab row, the sidebar's first entry and the `h1`; read `document.documentElement.scrollWidth` at 390 px against the viewport width; read which `#nav a.active` entries exist after each click. A difference of a few pixels is visible; measure it.

## Before showing anyone

Fix what the review finds where it lives: content and config in the project, rendering defaults in Sourcey itself (open an issue or a pull request), never by patching built output. Then review again from the start, because a fix in one place can move another.
