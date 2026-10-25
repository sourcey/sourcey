# Changelog

## Unreleased

### Changed

- An author's HTML keeps more of its inline style, on any element: type (size, weight, style, family, line height, spacing, alignment, case, decoration), margins and padding, borders and radii, shadows, flex and grid tracks, overflow, object fit, and placement within the content with `position: relative` or `absolute` and offsets, which the content holds as its containing block. Colours can be `rgb()`, `hsl()`, `color-mix()`, gradients and theme variables (`var(--name)`) as well as hex. A style that is fixed to the window, raises an element above the page's layers, pulls it back with a negative margin or offset, or loads anything (`url()`, `image-set()`) is still removed. A responsive video, a padded box holding an absolutely placed iframe, had shown as a small frame of the browser's default size.
- A component or directive written in a list item's text, indented up to three spaces, stays in the list item, with what follows it there, as CommonMark and MDX read it. It had ended the list, and the item's later lines could read as code.
- Mermaid diagrams are read by Mermaid's own parser and laid out as Mermaid lays them out, by `@sourcey/beautiful-mermaid`: flowcharts, state, class, ER, sequence, Gantt, pie and mindmap diagrams. A page carries one drawing for both themes, in the page's colours and set in Inter, and a drawing wider than the column shrinks to fit down to 80% of its size, then scrolls.
- Sourcey runs on Node.js 22.22.2 or later, 24.15 or later, or 26, as the DOM its diagrams are read in (jsdom 30) does. It had run on 22.19. Its dependencies are current, among them Mermaid 12, Preact 11 and satori 0.63.

### Added

- A code block names its fence's language on its element, as `data-language`, so a site's stylesheet can label each block by its language.
- `sourcey migrate docusaurus` makes each of a docs instance's several sidebars a section of its navigation, named by the navbar's link into it (a dropdown's included), else by another sidebar's link to it, and open while the reader is in it, as Docusaurus shows one sidebar at a time. The sidebar the tab is named for leads as written. A sidebar's HTML item that is a heading, such as `<span>API</span>`, heads the items after it, where it had been left out, and the tab takes its name from a link in a navbar dropdown too. Several sidebars had run together with no names between them.
- A page's frontmatter `editUrl` names its own edit address, for a page edited somewhere other than the site's repository, and `editUrl: false` leaves the link off. `sourcey migrate docusaurus` writes a page's `custom_edit_url` as it.
- `navbar.links` takes a menu, `{ type: "menu", label, links }`: links under one label that open below it in the header, one menu at a time, and stand under the label in the mobile drawer. `NavbarLink`, `NavbarMenu` and `NavbarEntry` are exported for configurations written in parts.
- `sourcey migrate docusaurus` carries a navbar dropdown as a menu, and a `doc` item as a link to its document in the default version, where both had been left out.
- A migration writes a list a page draws with `.map()` over static data, written in the page or imported from the project (through Docusaurus's `@site/`, and from a module that exports an import again), as the elements it draws, each with the values it reads and without its `key`. A page's own components (`export const Badge = () => <span>…</span>`) are written as the JSX they return where the page shows them, conditional JSX (`{premium && <Badge />}`) as the branch it takes, and calls to the page's own helpers (`style={pill("var(--accent)")}`) and to pure string and array methods as the values they return. The helpers' exports are left out once nothing passes them on as a value. A list inside an item's JSX, such as each item's own points, is written item by item too, and an expression that names none of a list's parameters, such as an imported icon, stays as written for the rest of the conversion to read. Anything that reads something else stays as written and stops the migration as before.
- A migration reads a page's `export const` of a static value where the page uses it, and leaves the export out, as page data native Markdown has no need to export. An export the framework reads from a page, such as Docusaurus's `toc`, and one that is code still stop the migration.
- `sourcey migrate docusaurus` reads each document through the site's own `markdown.preprocessor`, as Docusaurus does before anything else, and names a finding's line as the file is written.
- `sourcey migrate docusaurus` converts `@theme/CodeBlock` to a fenced code block. Its language comes from `language` or its `language-` class, its title from `title` or the metastring, and its code is what Docusaurus shows: the string it is given, or the text written inside it, read as MDX reads it. A code block written on its own line within a paragraph converts too, as the block Docusaurus shows there. Verification reads the block's text as code, so a conversion that changes it stops. `showLineNumbers` is named in the report, since native code blocks do not number their lines.
- `sourcey migrate docusaurus` converts `@theme/ThemedImage` to a native figure with its light and dark pictures, read from the site's static directories.
- `sourcey migrate docusaurus` evaluates `useBaseUrl()` with static arguments as Docusaurus's `addBaseUrl` does, so an attribute or image source written with it keeps its address.

### Fixed

- A component written inside an author's HTML block, such as an icon in a `<div>`, renders there. It had shown as a stray number where it stood.
- Previous and next lead to a page listed again in another section from the pages beside that listing, as a reader of that section expects; the page's own previous and next stay those of its first listing. The page after the second listing had led past it, to the end of the section before.
- A site's component draws the nodes its `resolve` returned, as `renderHtml` arranges them. The build had split each of its Markdown nodes into blocks, so a component that drew some of its nodes by their place drew the wrong ones: text written for readers alone showed on the page, and what the page wrote inside it was left out. A component's Markdown now stays whole between the headings it names, which still become nodes of their own.
- A migration draws a link to a project's Discourse forum, on its `discourse.` subdomain, with Discourse's icon, as it draws GitHub's and Discord's.
- `sourcey migrate docusaurus` titles a page by the level-one heading it shows under a component, such as a product's header component, as Docusaurus does: the heading is the native title and leaves the body, and the frontmatter title names the page in navigation. Native had shown the frontmatter title above the page and the heading again below the component. A migration's check of each page counts its title as prose a reader sees.
- Two tabs that share a label, each with its own slug, stay two tabs. The header had shown the first tab twice, and the second tab's pages had no sidebar.
- A migration from MDX takes off indentation MDX reads past and native would count, as MDX has no indented code: a list or a fenced block four columns in at the top of a page converts as the block MDX read, where native had read it as code, and a closing fence four columns past its opening, which MDX takes as the fence's end, closes the block there in native too.
- A migration keeps hashes followed by a no-break space, such as `#### ` before a word, as the text the source framework shows, where CommonMark reads no heading and native would. The line converts as `\####`.
- A migration's check of each page reads an HTML element that is not inline, such as a table cell, apart from its neighbours, and a line break (`<br />`) as a space, as a reader sees them. A table row written on one line had read as its cells run together, and stopped the migration as prose not preserved.
- A migration ends an HTML element's raw lines before each block of Markdown MDX reads inside it, such as a heading or a fenced code block right after `<details>` and its `<summary>`, with the blank line CommonMark needs. Native had printed the heading or the code as raw text inside the element. Inline Markdown is written as HTML on every line native reads as raw, including the lines a later tag in the element opens.
- A migration keeps a paragraph written as `<p>` at the column its element stands at. Inside a component indented four spaces, such as a tab, the paragraph had moved to the margin, so native read the code blocks and text beside it as indented code.
- `sourcey migrate docusaurus` leads a client redirect to its page as the site spells addresses, applying `trailingSlash` as Docusaurus does. A redirect written to `/start` on a site whose pages end in a slash had stopped the native build at a target that does not exist.
- `sourcey migrate docusaurus` names a navbar link that has no label by its title, as the only name Docusaurus gives an item it draws as an icon. It had become a link without a name.
- `sourcey migrate docusaurus` names the pages each sidebar lists before its first category by their place in the one navigation its sidebars make. With several sidebars that each opened with such pages, the native build had stopped at a duplicate group ID.
- A migration closes an HTML element that JSX closed with `/>`, such as `<iframe ... />`, with its end tag, as HTML closes only a void element at its start tag. The browser had read the rest of the page as the iframe's fallback text and shown none of it. SVG and MathML keep `/>`, which they read as JSX does.
- A migration writes a JSX style object's numbers as React does, in pixels unless the property is unitless, such as `lineHeight`, or the number is 0. `fontSize: 12.5` had become `font-size: 12.5`, which a browser ignores. A custom property keeps its value as written, and `msTransform` is written `-ms-transform`.
- `sourcey migrate docusaurus` writes a `Link` inside an HTML element, or one with an anchor's attributes (`className`, `style`, `target`, `rel`, `title`, `id`), as the anchor Docusaurus draws, which opens another site in a new tab. Inside an HTML element it had become a Markdown link, which native shows there as text, and an anchor's attributes had stopped the migration.
- A migration writes a frontmatter flag or number, such as `hideInMenu: true` for an unlisted page, as YAML reads it back; it had written `"true"`, which native read as text, so such pages stayed in the menu.
- An author's HTML table scrolls in place on a narrow screen, as a Markdown table does, where it had widened the page past the screen.
- Previous and next read a section's own page, such as a category's index, before the pages it holds, and give it a previous and next of its own, as Docusaurus pages through them. It had had neither, and the section's first page had led back past it.
- The sidebar opens every section on the way to a section's own page, such as a category's index, where it had opened only that section and left the way to it closed.
- Text read from Markdown, for search, descriptions, changelog entries and exports, holds the characters a reader sees. 3.9.0 wrote quotes and ampersands in a changelog's text as `&#39;`, `&quot;` and `&amp;`, and indexed a page without a description by the first 200 characters of its HTML, cut mid-word, with entities and the copy button's label among its search words. Text is read from the tokens its Markdown was rendered from, in the same lexing, and a page's search content is its description.
- A release's Markdown export carries its entries as written, with their inline code and links, rather than as plain text.
- A field of the type it sits in, which the reference resolver leaves as a reference, is named by that reference and links to its type, whatever the resolver marks on it. With json-schema-ref-parser 16.0.5, which a fresh install resolves, such a field read `any`.
- `sourcey migrate docusaurus` reads a heading's `{#id}` in MDX as Docusaurus reads it, where it had stopped at it as an expression it could not parse, and reads each of Docusaurus's `markdown.mdx1Compat` settings as the site sets them.
- `sourcey migrate docusaurus` titles a tab from its tabs' `values`, `[{ label, value }]`, as Docusaurus does, and stops where `values` lists the tabs in another order than they are written.
- A migration numbers sibling navigation groups whose labels make the same ID, such as "C++" and "C#", where the native build had stopped at the duplicate.
- A migration's check of each page's prose reads an image's alternative text and a title in HTML, as it reads them on a component: an `<img alt>` kept as written had read as lost.
- `sourcey migrate docusaurus` keeps a navbar logo or favicon given as a web address.
- `sourcey migrate docusaurus` writes the client redirects plugin's paths below the site's base URL, where Docusaurus publishes them. On a site with a base URL other than `/`, the native build had stopped at a redirect outside it.
- `sourcey migrate docusaurus` orders by a `sidebar_position` or category `position` written as a string, such as `"10"`, as Docusaurus validates it into a number, where it had ordered those pages by name.
- `sourcey migrate docusaurus` reads a heading's escaped `\{#id}` as its id, as Docusaurus does, where the native page had shown it as text.
- A migration writes inline Markdown inside an HTML block, which native reads as raw HTML, as the HTML MDX made of it: code spans, emphasis, links and backslash escapes. Its check of each page reads HTML text as a reader does, straight through inline tags and with character references as their characters.
- A migration writes a table row indented four columns past its table at the table's indentation, where native had ended the table there and read the row as code.
- A migration keeps GitHub alert syntax that the source framework shows as text, such as `> [!NOTE]` in a Docusaurus page, as text, where the native build had read it as a callout. Its check of each page reads an alert from the text as written, where an escaped `\[!NOTE]` is text.
- A migration's check of each page's fragments passes over a heading with no text, which has no fragment to link to, where it had stopped at it.
- A migration keeps a site's own `llms.txt` or `llms-full.txt` from its public files as written, and turns off the native build's generation of that index, where the native build had stopped at the two colliding.
- A migration finds where an element's opening tag ends from the attributes the parser placed, where an apostrophe in JSX inside an attribute, such as `title={<span>It's quick</span>}`, had stopped it with an internal error.
- A migration reads an MDX import or export written inside an element, which MDX hoists to the module, where it had stopped at the components it imports as not imported.
- `sourcey migrate docusaurus` names the line a finding is on as the file is written. After an `mdx-code-block` fence, which Docusaurus unwraps before reading a document, a finding had named a line two earlier for each fence above it.
- `sourcey migrate docusaurus` names a plugin or custom CSS file the configuration gives with `require.resolve` by its path in the project, where the report had printed its absolute path on the machine that ran the migration.
- A social card sets its text with the font's kerning, as a browser does, and wraps a name too wide for a line between its words, `AccountingTemplatePreviewRequestDTO` after `Preview`. Such a name had been cut off at the card's edge, mid-letter.

## 3.9.0 - 2026-10-23

### Added

- A reference publishes in the shape its size calls for unless `reference.split` names one: one page while it holds at most 50 operations and 1,000 field rows, a page per section where every section fits within that, and otherwise a page per operation. The build says which it chose. `split: false` keeps one page, and the new `"sections"` publishes a page for each OpenAPI tag or MCP group beside an overview that lists them. Each operation's address (`reference.operations`) and anchor still lands, whatever the shape.
- `mcp({ spec, groups })` sections an MCP reference as the server's authors divide it. Each group names its tools, resources and prompts in order; a name the server lacks, or one listed twice, fails the build, and entries no group names are listed by kind after the groups.
- The build warns when a reference kept on one page (`reference.split: false`) holds more than 100 operations, and names the splits that serve it better.
- The Sourcey skill (`skills/sourcey`) ships in the npm package and as the `sourcey-docs` plugin for Claude Code, Gemini CLI, Cursor, Grok Build and ChatGPT/Codex. It teaches an agent the CLI, the migrations, how to shape a reference and how to review a site before it ships.

### Changed

- A reference without `reference.split` that holds more than 50 operations or 1,000 field rows now publishes split, by the rule above. Its links still land, its operations' anchors on the overview included.
- An MCP entry's kind (TOOL, RESOURCE or PROMPT) shows only where kinds mix: a section named "Tools" already says what its entries are. The line under an entry's title shows a name only where the title differs from it, and a resource's address.
- An operation's method is drawn the same wherever it appears, in the sidebar, a reference's lists, an operation's heading and search, as a tint of the method's hue. A theme styles it once, as `.method-badge`.
- The sidebar shows the section around the page whole, rather than the 25 entries nearest it, and a one-section reference whole on every page. A tab of more than 20 top-level sections lists every one, rather than 13 beneath an "All sections" link.
- One sidebar entry reads as current: as the page scrolls, the page's own entry gives way to the place being read.
- "On this page" appears only where it lists two places or more. In the default theme a page without it keeps the column empty, so its text lines up with every other page's.
- A split reference's overview lists its introduction's headings under "On this page", rather than the sections the sidebar already lists.
- The footer sets the site's words before its social icons. "Edit this page" ends the page, above previous and next, and a site's own pages, such as its home, no longer show it.
- `sourcey migrate docusaurus` leaves out footer links the sidebar or navbar already show, and names them. `sourcey migrate mkdocs` no longer repeats the repository link among the social links.

### Performance

- Sites build in a sixth of the time and under a third of the memory. A site of 874 pages, with a page for each operation of a 106-operation Kubernetes API, an MCP reference and a social image for every page, builds cold in 6 s where 3.8.3 took 37 s, peaks at 0.9 GB across its processes where 3.8.3 reached 3.2 GB, and publishes 321 MB where 3.8.3 published 531 MB.
- Social images are drawn off the main thread, several at once, each in a third of the time: the background glow is one gradient rather than a masked pattern. They look as before at two thirds of the bytes.
- Diagrams and social images are drawn in helper processes that end with their work and give their memory back. One Mermaid diagram had left the build holding 330 MB until it finished.
- `sourcey build` writes each page and its social image as it renders them, rather than holding the whole site until the last page, and collects garbage sooner: an 838-page site's peak went from 1.24 GB to 0.84 GB, for 7% more time. The output directory still changes all at once and rolls back on a failure.
- Search reads only what a query needs: the build publishes scored words in sorted chunks, results in small fragments and the vocabulary in blocks, and a query loads the ones it touches, ten results at a time. A first search on an 838-page site reads 10 KB where it read 190 KB, and the search worker is 5 KB rather than 25 KB. Results rank as before, except that a typo counts only after a word's first two letters, so `rule` no longer matches `mule`; a query that finds nothing is retried with typos anywhere.
- A reference is searched by its operations' and fields' own words rather than a dump of the whole document, which made "type" and "properties" match everything. A Kubernetes API's `documents.json` went from 61 MB to 6.5 MB.
- Code is highlighted by Oniguruma, the regex engine its grammars are written for, in half the time and a fifth of the memory of Shiki's JavaScript translation, and from one tokenizing for both code themes, which halves it again and makes a code block's HTML about 30% smaller. SQL functions written against a bracket are now coloured as functions. A language's grammar loads the first time a block in it is drawn.
- Markdown is drawn once, after the site's routes are known, with its links resolved as it is drawn. A page is lexed once and only as far as its title and summary need, sanitized only where its author wrote HTML, and its export rewrites only the blocks that hold links.
- The sidebar draws each section that holds neither the page nor a link to it once, and reuses it on every page: 5% less CPU time on a 458-page site.
- An API schema is normalized once for each way it is used and shared, rather than copied into every operation: a 1,781-operation API holds a third of the schema memory. Swagger 2.0 converts to OpenAPI 3 before its references are resolved, and without being written out as YAML, so a type used in many places stays one type: a 0.2 MB Kubernetes API had grown to 25 MB on the way, and now builds in a second less and 150 MB less memory.
- The API console's data for an operation holds only what the console reads, with each shared type once. A 106-operation Kubernetes API's went from 20.9 MB to 0.9 MB, and its largest operation's, downloaded on opening the console, from 4.4 MB to 96 KB; a 1,781-operation API's went from 54 MB to 4 MB.
- Files published unchanged, such as images and a public directory, are cloned or copied from their source as the site is written, rather than held in memory and hashed twice: a public directory of 143 MB is no longer read again or, where the file system can clone, stored twice. A file that changes during the build fails it.
- Vite, the HTML sanitizer, JSONPath, the Doxygen converter and the reference resolver load only when a site uses them, and Sourcey's own scripts and styles ship prebuilt. Importing Sourcey takes 61 MB where it took 110, and a cold build of a 493-page site 0.7 s less CPU time.
- The build cache identifies the packages that draw diagrams and images by their manifests and file stats, read concurrently, rather than hashing every byte: Mermaid's dependencies had cost each build a quarter of a second and 150 MB. A diagram is laid out once for both themes, `llms.txt` and `llms-full.txt` are generated once, and the broken-fragment check reads anchors from the HTML the build wrote.

### Removed

- `resolveInternalLinks`, an internal step that took the build's own page records, is no longer exported.
- `SourceySiteArtifacts` no longer carries `ogImages`: social images are among the files `writeSourceySite` writes.
- MiniSearch is no longer a dependency; `sourcey/documents` searches with the site's own engine.
- The undocumented `x-sourcey-group` field on an MCP snapshot entry is no longer read; `mcp({ groups })` replaces it.
- The generated "All sections" page is no longer written.

### Fixed

- Canonical URLs, language alternates and the sitemap use absolute URLs only. A site without `siteUrl` publishes none of them, rather than relative ones search engines and Lighthouse reject, and the build's warning says so. A page in one language no longer names itself as its alternate.
- A site without a `favicon` shows its logo where that is a mark, or else a square of its primary colour, rather than every page requesting a missing `/favicon.ico`.
- A site's published scripts no longer carry the path of the machine that built them, which Rolldown had written above each module.
- The header's rows run the window's full width, so a coloured top bar, as a Material site has, reaches both edges past 1,472 px. Its contents keep to the page's frame.
- A page title that opens with the site's name is no longer followed by the name again: "Acme Core" rather than "Acme Core - Acme". Names compare as words, ignoring ® and ™.
- A schema no longer opens a type inside itself or draws a very large type out to the depth limit. A field of its own type reads "Same fields as" and links to it, and a schema of more than 500 field rows draws each named type once and links its other uses: one Kubernetes custom resource's operation went from 21 MB of HTML that stopped 1,026 times at "Max depth reached" to 1 MB with every field reachable. Generated examples no longer print `"[circular]"`.
- A long name wraps rather than widening a phone's page: a field, parameter or property name breaks after an underscore, a snake_case name in the navigation and headings likewise, and a type, model name, title, link, enum value or footer link too long for its column breaks inside the word. A site name too long for the header ends in an ellipsis on one line.
- A Go, Doxygen or Rust tab's navigation leads to the pages the site writes, in every `prettyUrls` mode and wherever `routes` move a page (#298): it had linked `go-api/index.html` where the site wrote `go-api.html`, and `.html` files where `prettyUrls: "slash"` writes directories. The tab, and the logo where it is the first tab, lead to its overview; navigation naming a page the site does not publish fails the build; and search lists these pages before anything is typed.
- A Mermaid flowchart draws its subgraphs as Mermaid does, as titled, nested containers laid out in their declared direction, where they had been laid out flat and left out. Labels read as Mermaid shows them: `<br>` breaks a node's line, an entity such as `&lt;` is its character, and other markup is left out rather than shown.
- Markdown keeps an ordered list's starting number, a task list's checkboxes and `~~strikethrough~~`, which sanitizing had removed on every page.
- An MCP tab whose spec is a web address builds, and a file the build cannot find fails as `File not found: <path>`.
- A logo, favicon or social image whose path starts with `http`, such as `httpdocs/card.png`, is read from the config's folder rather than taken for a web address.
- A site's own component named `Include` is drawn where a page writes `<Include>`, as any built-in can be replaced, and a directive that opens no component fails naming the directive.
- A page's `<html lang>` is its language's tag, as its `hreflang` links name it: a site that sets `lang: "pt-BR"` for `pt` now writes `lang="pt-BR"` where it wrote `lang="pt"`.
- A component a site defines receives its page's language and version as `context.context`, typed as always present.
- A reference's version is prefixed with "v" only where it is a number, so `latest` no longer reads "vlatest".
- Every site's stylesheet leaves out seven utility classes no page used (`filter`, `grid`, `italic` and others), which Tailwind had read from the engine's own code.
- `sourcey migrate docusaurus` titles a page that opens with its own heading by that heading, keeping its frontmatter title as the navigation label, and keeps navbar links to the site's own pages (`to`). `sourcey migrate mkdocs` says that Material's analytics are not carried over.

## 3.8.3 - 2026-10-21

### Fixed

- A not-found page no longer names a Markdown view that is never written: its alternate link and `Link` header pointed every 3.8 site at a missing `404.md`. A page names a Markdown view only where one is written.
- Social images draw the site's logo as its header does. A logo named by URL is fetched once and embedded, so an SVG served as `image/svg+xml; charset=utf-8` is no longer dropped from every image; one that cannot be loaded leaves the coloured mark, with one warning. The logo keeps its own proportions rather than a 48px square, the image draws the logo the site shows in dark mode, as the image is dark, and the site's name stands beside a mark (`logo.mark`) and never beside a wordmark. A title or summary too long for the image ends at a whole word with an ellipsis, rather than inside one.
- A Go reference index is summarised by what it covers, "Go API for example.com/module across 12 packages." or, for the standard library, which has no module, "Go API across 12 packages.", and a Doxygen index by its modules, types or namespaces, rather than by a bare module path or nothing, which `sourcey build` then reported as a missing or one-word summary.
- A Doxygen page whose summary links a symbol Moxygen cannot resolve is summarised by its first paragraph of prose, never by the "Defined in" source location above it.
- A Doxygen, Go or Rust reference's header tab leads to the reference's overview, rather than to the first module, package or crate page it builds, or to its doctests.
- The previous and next links at the foot of a page name a page by its section where the tab repeats the label that opens it, so a C++ module's or Rust crate's first page reads "AV module" rather than "Overview".
- A Doxygen reference documents global scope. A class, struct or union outside every namespace has a page of its own, and the functions, variables and macros no group claims share a Globals page beside the overview, so a C library documented without groups no longer builds an empty tab. A namespace that only wraps others has no page of its own, a namespace page lists the namespaces in it, and a union is listed with its namespace's types. This comes with Moxygen 2.2.2.
- A Doxygen tab whose XML documents nothing fails the build and says so, rather than publishing a header tab that leads to no page.
- `doxygen().language` is checked: `"cpp"`, for C and C++, or `"java"`, the languages Moxygen has templates for. Another value fails with that list rather than with a missing Moxygen template folder.
- Building into a directory that a Sourcey release before 3.8 wrote says how to move on: those releases kept no record of their files, so delete such a directory once. Sourcey 3.8 writes only into a directory it owns, which 3.8.0 did not note.

## 3.8.2 - 2026-10-21

### Fixed

- Under Astro, a page search engines are not to index, such as the documentation's missing-page page, is written into the output as a file rather than registered as an Astro page, so a host sitemap no longer lists it.
- `sourcey build` and `sourcey check` count the anchors a Rust, Go or C++ reference page draws, so their section links are no longer reported as missing fragments, and a section page composed from navigation is not reported for lacking a summary of its own.
- `sourcey dev` serves the code-language icons stylesheet that reference pages link, so code-sample tabs show their language icons in development as they do in a build.
- Reference pages meet WCAG AA text contrast in every theme, light and dark: required, deprecated and MCP annotation badges, field ranges and defaults, example labels, secondary text, method names in reference listings and search results, the search dialog's labels and hints, and the missing-page page.
- Headings keep their order: on an operation's own page its sections, Try it's included, sit one level below its title; a card is titled one level below the heading it sits under; Rust, Go and C++ reference pages nest items, implementations and members in order; and "On this page" and a Go package's index label their navigation rather than heading the page. The Rust doctests page carries its title once.
- A site that sets only `colors.primary` gets text that reads in both schemes: an unset `light` or `dark` is the primary where it reads at 4.5:1, and otherwise the nearest shade of its hue that does. Shades a site sets are used as given.
- The site header is a banner landmark, and every navigation is named in the site's language, with built-in French, Spanish and Italian names. A navbar with no links no longer leaves an empty navigation behind, the reader theme's chapters are a landmark of their own, and a callout is a note within the page rather than a landmark beside it.
- The header search button is named by the placeholder it shows, a scrolling table, field example or request preview can be reached from the keyboard, the code-language and example menus are named, and an endpoint's path parameters are 24px targets.
- Rust reference pages show their signature, source-link, stability and doctest colours, and the code-language menu has its background in dark mode. A generated reference index's counts and import paths read as text rather than at half opacity.
- A version or language with a home page builds with `.html` URLs (the default) and `prettyUrls: "strip"`. Its home's Markdown view is written inside its directory, as `archive/index.md` beside `archive.html`, so that version's own `documents.json` and `llms.txt` list it; each version's API reference builds the same way. A versioned or translated page's `describedby` link now names its own version's and language's `llms.txt` rather than the default version's.
- Request samples read as code again. A JSON body is pretty-printed and declared before the request in the language's own multi-line form: a single-quoted block in cURL, a template literal in JavaScript, `'''` in Python, raw strings in Go and Rust, a text block in Java, a nowdoc in PHP, a heredoc in Ruby and a raw string in C#. JavaScript headers and a Python call's arguments sit one to a line. Samples and Try it still send the same bytes: Try it sends the JSON body as the samples show it.
- On a narrow screen, the live request URL that Try it shows in the endpoint's place wraps between its host, path segments and parameters rather than inside a word.
- C++ reference links lead to the page that documents each symbol, including a type declared in a namespace that several groups share and an enum's values, and a symbol named in inline code is a linked name rather than its Markdown printed as code. A link to something no page documents reads as its name. This comes with Moxygen 2.2.1.
- A Markdown table's empty top-left cell is a plain cell rather than a header with no name, and the reader theme keeps its header band across it.
- A version's notice, and the notice that a page is not yet translated, stand over the page wherever no sidebar rail carries them: in the minimal theme and on pages drawn by their author at every width, and in the default and API-first themes on a phone, where the sidebar is a drawer. Readers there saw neither. Desktop pages in those two themes keep the notice at the top of the sidebar.

## 3.8.1 - 2026-10-20

### Fixed

- A page without code samples no longer waits on the code-language icons before it paints. They are a stylesheet of their own, linked by the reference pages that draw them, so a guide's render-blocking stylesheet is 20 KB rather than 28 KB.

## 3.8.0 - 2026-10-20

### Added

- Select the complete platform font stacks with `theme.fonts.sans: "system"` and `mono: "system"`, without third-party font requests.
- OpenAPI Overlay 1.0 inputs keep editorial copy separate from generated specs. Ordered JSON/YAML actions use RFC 9535 JSONPath and share the effective spec across rendered, searchable and exported references, with configurable unmatched-target diagnostics.
- Native documentation versions and locales share stable document IDs, route-aware selectors, canonical metadata, full-text search and scoped machine-readable outputs. Sources can version independently.
- Nested navigation preserves authored ordering, labels and collapsed groups. Authored trees can link to canonical operations and pages across sources, with version and locale checks. Large trees use real section pages and one responsive sidebar.
- Redirects share route and fragment checks across standalone builds, dev and Astro. Standalone output includes HTML fallbacks and host rules. `sourcey check` runs the native checks without writing a site.
- Native components support build-time data, includes, responsive light/dark figures, static diagrams, page lists and optional client widgets. Generated headings and readable content feed HTML, search and Markdown.
- Authored field lists reuse the reference's parameter and schema presentation. Reference fields have stable destinations across layouts, with checked aliases for existing incoming links. Schema alternatives have a native picker that reveals addressed fields and keeps every branch in static HTML and readable exports.
- `<ForAgents>` keeps instructions in Markdown and agent exports while leaving the visible page, human search and page metadata unchanged. Heroicons remain the default; sites can select optional Lucide icons.
- One-time Astro, Docusaurus, Mintlify and MkDocs migrations produce reviewable native configuration and content edits, with route, fragment, content and media checks and reports for unsupported content.
- OpenAPI operations have a lazy-loaded Try it console in every theme, with editable parameters and bodies, authentication, local drafts, file uploads, cancellation, and live response inspection. Shared form styles expose global CSS overrides.
- Reader supports light and dark reading modes, using the same saved preference and pre-paint theme script as the other themes. Its masthead toggle sits after search.
- `footer.text` adds a line of inline Markdown to the foot of every page, such as a copyright or licence notice.
- `markdown.smartypants` sets prose with curly quotes, em dashes and ellipses, leaving code, titles, anchors and Markdown exports as written. `sourcey migrate astro` turns it on, as Astro sets Markdown unless told not to.
- Pages carry their place in the navigation as schema.org `BreadcrumbList` structured data when the site has a public origin.
- `sourcey build` and `sourcey check` report what publishing needs: a missing `siteUrl`, pages without a summary of their own, canonical and language links to no page, and links to missing fragments, each kind once with the pages it affects.
- `pages` names a folder of the site's own pages, outside the documentation: a home page, product pages, a page of its own design. Each publishes at the address its path names, in no tab or version, and is searched, exported, translated and linked like any page. `pages/404.md` is the site's not-found page.
- A page's frontmatter `layout` says how it is drawn: `doc` (the documentation frame), `page` (the site's header and footer around the page's own body, the default for site pages) or `blank` (the body alone), beside `changelog`. Every theme draws each. A page can bring its own stylesheets with frontmatter `css`, published with their fonts and images and linked from that page alone.
- Link an operation from any page by name, `[List keys](<operation:GET /keys>)` or `operation:TOOL search`, in prose, cards and changelogs. The link lands wherever the operation is published and follows the reference when it splits or joins; an operation no reference publishes, or two publish without naming one, fails the build.

### Changed

- API introductions list what each placeholder of a templated server URL takes: its default, allowed values and description.
- OpenAPI `externalDocs` links show beneath the API's, a tag's or an operation's description, and in the operation's readable Markdown.
- Engine styles and scripts are published under `_assets/<hash>/`, named by their content, so hosts can cache them indefinitely. The whole stylesheet, component, theme and code-language icon styles included, is minified once, with no separate language-icon request.
- A large search index is split into shards of its postings: a search downloads the document list and only the shards its words can match, ranked with whole-index statistics. Search waits for a pause in typing. `search-index.json`, which no reader downloaded, is no longer written.
- HTML metadata, social cards and `documents.json` describe a page from one shared summary: plain text, without Markdown or HTML, from the page's own source. A model page is described by its own description rather than the API's, or, without one, by its fields; an operation whose summary only repeats its title, by its method, path and what it takes and returns.
- Callouts read as GitHub alerts (`> [!TIP]`) in readable Markdown and agent exports, a title of their own leading them; a page that opens with a callout is no longer summarised by its label ("Tip").
- Reference field lists render with fewer elements: badges take shared classes, and nested schemas no longer add a wrapper per level.
- A composed schema (`allOf`) lists its parts' fields as one list, dividers included, each field keeping its link. A field required by the composition is marked required in whichever part declares it.
- A request body offered in several media types with one schema (JSON and a form) lists its fields once, labelled with each type; links to either type's fields still land. The Body heading names the media type only when there is one.
- On a narrow screen an operation's endpoint wraps between path segments, as does the console's request URL, instead of scrolling out of sight.
- Search ranks a page whose title is the query, singular or plural, first: "webhook" finds the Webhooks guide ahead of every webhook endpoint.
- An OpenAPI or MCP reference is one page unless `reference: { split: "operations" }` gives each operation and model its own. `reference.operations` (and `routes`) give every operation a permanent address: its page when split, a redirect to its section on a single page. A split reference's overview keeps each operation's and model's single-page anchor on its entry, so links from before the split still land.
- Each theme frames a split reference's pages as it frames a guide: the section listing an operation or model over its title (Default's and Minimal's eyebrow, api-first's trail, Reader's breadcrumb), previous and next in navigation order, and Reader's own footer and outline. The overview reads at a guide's width with "On this page" listing its headings, authentication, tags and models, and an MCP overview shows how to connect straight after its introduction. Previous and next lead to other pages, never to a section of one already listed.
- Where an operation's examples cannot sit beside its copy, on a phone and in Minimal and Reader, they follow its description rather than its last field. Operations and models take two columns by the width of their own column, not the window's, so Reader's model pages no longer squeeze their fields beside the example.
- A link to a place on a documentation page lands it where the page's content starts, the theme's own gap below the header, whether it scrolls the page or opens another, from the sidebar, "On this page" or an address. Same-page links had landed flush against the header, and some headings a header's height lower. Each theme's gap is one value, `--sourcey-content-gap`, that also sets where its documentation pages start. A page drawn by its author keeps its own spacing, its links clearing only the header, and a blank page no longer leaves room for a header it does not have.
- Every page names its stylesheets, scripts, media and links from the site's base (`/docs/_assets/…`, `/docs/install/`), as navigation already did, rather than relative to its own address. A page renders whole at any address it answers at, such as `/docs` without its trailing slash on a host that serves it there; pretty URLs are unchanged.
- An operation's endpoint names the address its requests go to as its samples do: its own servers before the API's, each server variable at its default, and no origin where the host has none (a self-hosted instance's). It no longer shows a server template such as `{scheme}://{host}`. Path parameters are drawn as parameters, each linked to its entry.
- Search stands at the exact centre of the header. A page's frame keeps one line on each side and one at the top: the logo, the section tabs and the sidebar's text start on the left line; the header's last icon, the section row's language and release menus, "On this page" and a reference's examples end on the right one; and the sidebar starts on the page's first line beside the content and "On this page". In Default the right line mirrors the left inside the frame, a reading column ending on it until "On this page" stands there; in api-first it is the content's right edge, and past its widest the page stands at the centre of the space beside the sidebar.
- A large reference's sidebar, kept to the branch around the page, keeps a group without a heading (such as Introduction and Authentication) as its entries, rather than an empty link with no name.
- Search opens on where each part of the site starts, grouped under each tab's name: featured pages, then each tab's sections in turn, a reference's overview and the first operation of each tag, rather than the index's first thirty rows. A reference's overview is searchable by its title and introduction.
- A standalone site whose root no page publishes redirects it to the first section's first page, rather than serving a copy of that page there. A page at the root is the home page, and the logo leads to it.
- A header tab leads to its first destination in reading order, a section's own page before the pages it holds, and a reference's tab to its overview, whatever its navigation lists first.
- A documentation tab's sidebar shows its whole tree, every section opening in place, up to 400 pages; only past that, and past 100 entries in a reference, does it keep just the branch around the page. A section whose heading links its own page opens, current, on that page. A section's pages sit one step in from its row.
- Converters carry each framework's own page layouts: Starlight's `template: splash` (with its title as the page's heading), Material's `hide: [navigation]` and page templates, and Mintlify's `custom` and `center` modes become `layout: page`. Docusaurus Markdown pages in `src/pages` become site pages, wherever the docs are published.
- The sidebar draws an API tag whose operations are on other pages as a link, its child tags nested beneath it, rather than as a heading over an empty list; a heading stays a heading. A section that opens in place is a row of its list, its chevron at the end and its label on its siblings' edge, and only a headed list is set apart.
- Theme stylesheets can use a site's own fonts and images: a relative `url()` resolves from the stylesheet's folder, and the file is published as shared media.
- Responsive figures tell the browser their display width (`sizes`), so a 1x screen no longer downloads the 2x image. Without a `quality`, each format uses its encoder's default (AVIF 50, WebP 80, lossless PNG) rather than 90 for all, a third of the AVIF bytes.
- MCP references show an HTTP server's header placeholders (`transport.headers`, such as `Authorization: Bearer YOUR_TOKEN`) in the client configuration.
- OpenAPI 3.2 tag hierarchy nests in reference navigation: a child tag's group sits inside its parent's, after the parent's own operations, instead of a flat "Parent / Child" label.
- Retain finished HTML bytes in the render cache. Reuse unaffected operation pages after a spec edit.
- Changelogs keep version and date above their notes in a capped reading column. A dedicated changelog tab uses the left rail for releases; a changelog inside a larger docs tree keeps that tree and a compact release index on the right. Smaller screens provide a native jump menu.
- Linked content cards have a directional arrow and keyboard focus treatment. Static cards no longer show a pointer cursor or link hover state.

### Performance

- Markdown exports, link rewriting and lexing are linear in a document's length: directive and alert scans stop at the paragraph, tokens are walked without marked's per-token array growth, and code and link replacements take one pass. A 160-operation reference with long field lists built in 6.8 s instead of 102 s.

### Fixed

- Request field lists, examples, samples and Try it drafts leave out `readOnly` properties, and response field lists and examples leave out `writeOnly` ones, at every depth; model pages keep both, marked. A field whose child fields are all left out no longer opens onto an empty list.
- A model's own page is headed by its name in an `h1`, as an operation's page is, without the divider above it; it had no `h1`.
- The section tabs start where the logo and the sidebar do: both header rows share one gutter in every theme. The default theme's tabs sat 28px to the left of them.
- Search and the Try it console keep working in a page left open across a deploy: when the assets it names are gone, they read the page's current names once and load those. Loading, no results and a failure read as one styled line, the failure with a "Try again" button.
- On a narrow screen a base URL keeps its description beneath it rather than breaking the URL mid-hostname.
- The not-found page names its stylesheets, scripts and links from the site root, since the host serves it at any address; at a nested address it lost its styles. Its menu button opens the navigation drawer on a phone, and the phone header names a page the navigation does not list. The drawer's logo carries the site's name beside a mark, as the header's does, rather than "Docs".
- A page whose title has an apostrophe, quote or ampersand no longer shows its title twice: the opening heading that repeats the title is recognised by its text.
- Expand a recursive schema (a task with subtasks that are tasks) wherever an operation uses it, with its fields, examples and request samples; it becomes a named link only where it would repeat. Bodies and responses of such schemas showed just the schema's name.
- Keep authored SVG paint (`fill`, `fill-rule`, `opacity` in `style`) and inline layout (`display: flex`, `gap`, alignment, sizes) through HTML sanitization; values stay keywords, hex colours and lengths, never `url()`.
- Configured header, drawer, footer and call-to-action links open in place when they stay on the site (relative, or the site's own origin) and in a new tab only when they lead elsewhere. Header link labels no longer wrap.
- Keep a heading that comes before a page's first top-level section in its table of contents. Keep an image in a table cell inline beside its text, as in a paragraph. A heading that is a link keeps the heading's weight.
- Keep an opening paragraph with links, code or emphasis in the page, rather than promoting it to the plain-text lede without them. A paragraph ending in a colon ("See also:") introduces what follows it, so a page's summary comes from the next one.
- Code samples fill a templated server URL from its variables' defaults. An origin placeholder without a default (a self-hosted host) becomes the samples' `BASE_URL` fill-in instead of resolving against the documentation site.
- Load every named Google Fonts family at the weights the themes use. Static families such as Poppins and Lato, and variable families with a narrower axis such as Roboto Mono, no longer fall back to the platform font.
- Generate social cards with bundled fonts and reuse verified images when their visual inputs are unchanged. Amortize automatic artifact-cache pruning across small files.
- Publish local logos and favicons as shared content-addressed assets rather than repeat image bytes in every page. Track edits through native and Astro reload, and preserve those frozen bytes in generated social images.
- Package prepared pages, gzipped, in Astro's module graph for isolated prerenderers, including Cloudflare; every other file joins the client output after Astro generates its pages and before adapters package it, so images never travel the host bundle as strings. Preserve native widgets' data and accessibility attributes through HTML rendering.
- Load a tab's pages concurrently, so one page's images and diagrams encode while another's do, within a shared budget of half the machine's parallelism. A documentation build with 116 screenshots in six variants each went from 47 s to 17 s cold.
- Preserve Swagger form-field schemas, required flags and examples through conversion. Render response-field descriptions and authored schema examples alongside their types. Relative-server samples use the real origin or an explicit fill-in variable.
- Keep changelog permalink link rewrites separate from the main page. Internal client bundles do not copy a host’s public files.
- Keep media links after unmatched inline backticks, preserve dotted Markdown references, and retain GitHub alert titles without dropping trailing quote text.
- Keep the source of an unsupported diagram on its page and report a build warning. Deduplicate repeated type names in schema summaries while retaining every branch and constraint in the detailed reference.
- Load large imported JSON configuration tables as data while retaining dependency tracking and live reload. Index reference aliases once per page and offer an explicit warning policy for removed fields in imported link history.
- Render typed map values and nested map/array fields with the same descriptions, constraints and destinations as named properties. A format that only repeats its type (`format: string`) is no longer shown as `string<string>`.
- Load browser search in a worker when it opens, with retry after failed index loads. Reuse verified image, diagram and engine-bundle output across builds; corrupt cache entries rebuild automatically.
- Retain matching sections when switching language or documentation version. Keep historical edit links tied to the selected revision and standalone canonical links tied to the compiled route.
- Generate static and interactive request samples from one serializer, preserving parameter encoding, repeated values, declared authentication, headers, and body media types.
- Index guide bodies and semantic API facts in `documents.json`, so keyword retrieval finds instructions and constraints beyond page titles and summaries. Prefer individual operations and schemas over an aggregate page when search scores tie. The optional MCP adapter consumes this index without a separate corpus or eager document reads.

All notable changes to Sourcey. Format based on [Keep a Changelog](https://keepachangelog.com/).

## 3.7.1 - 2026-10-18

### Added

- Publish a Markdown view of every page, with individual documents for API operations and schemas. `documents.json` links each document to its browser reference and records library symbol locations.
- Configure static outputs with `exports`. Markdown and the existing context files are enabled by default; public OpenAPI bundles require `exports.openapi: true`.
- Publish ARD resource manifests and RFC 9727 API catalogs with `discovery`. Support scoped docs, explicitly owned root well-known paths, and authored MCP/A2A descriptor entries.
- Emit `response-headers.json` for static hosting. CLI and Astro development apply the same content types and discovery headers, including the extensionless API catalog.
- Add the optional `sourcey-docs-mcp` package for searching and reading a built documentation directory over MCP, including library symbol lookup.

### Fixed

- Preserve readable source content in context exports: code fences, rich guide labels, Go declarations and examples, and native Rust reference. Individual documents and the full export use the same content.
- Serve generated context and discovery files from the CLI's current development snapshot and invalidate them after source edits.

## 3.7.0 - 2026-10-18

### Changed

- The `api-first` theme is now full width. The header and tab row run edge to edge on a tinted band, and the sidebar is pinned to the left edge. Guide pages share both edges with API pages: the reading column starts beside the sidebar and "On this page" sits on the right edge. Each API and MCP operation splits into a content column and an examples column, with the request sample on a dark card. The neutral greys, header band and code card are shaded from the site's primary colour and stay overridable from custom CSS; widths come from `theme.layout`. Sites already on `api-first` will see their layout widen.
- Inline code renders as a chip in every theme instead of showing literal backticks.

### Fixed

- Generated links no longer carry `rel="noreferrer"`, so the sites your docs link to, including the “Docs by Sourcey” attribution, can see the visit came from your docs. Links that open in a new tab keep `rel="noopener"`.
- C++ reference pages read cleanly in every theme. Class and group pages no longer repeat their title and summary in the body. The `#include` and the declaration share one code card. "Inherits" and "Subclassed by" render as a relations list, "Defined in" as a muted metadata line, and qualifiers such as `virtual` and `const` as quiet labels instead of code chips.
- "On this page" shows a heading's text without the backticks of a code span inside it, and rich index cards render inline code in descriptions.
- C++ "Reimplements", "Reimplemented by", "References" and "Referenced by" name the class that declares the related member, `TCPClient::start` rather than `start`, through moxygen 2.2.0.
- A page's fallback title comes from its first level-one heading, never from a `#` comment inside a fenced code block. A page with no title and no heading takes its MkDocs nav label before its slug (#259).
- A page summary skips images and inline HTML, and paragraphs that hold only links, so a logo's alt text, a row of badges or a navigation row no longer becomes the page or site description (#260).
- A description taken from the body no longer repeats under the title. When the paragraph opens the page it becomes the lede; otherwise the page shows no lede.
- MkDocs pages read as MkDocs renders them. Code inside fences and code spans stays as written, where `std::vector<int>` used to show as `std::vector&lt;int&gt;`. `attr_list` blocks such as `{ role="img" }` no longer print as text (#260), Markdown inside a `markdown` HTML block renders, as in Material's grids and cards, and Material icon shortcodes drop out. `mkdocs.yml` files with any Python or environment tag load, including `!!python/object/apply:`.
- "On this page" shows headings with inline HTML or entities as readers see them, `std::hash<json>` rather than its markup. Heading ids are unchanged.
- Rust intra-doc links resolve as Markdown reference links, so code blocks, code spans and a crate's own reference links render as written. `#[derive(Debug)]` in a doctest, `[dependencies]` in a TOML block, and `[![github]][github]` badges were rewritten as broken link markup. Paths written as a destination, `[text](crate::Item)`, now link. A label rustdoc could not resolve keeps its brackets, as rustdoc renders it, and the build reports only links whose target the site does not render.
- Links to other crates' Rust docs open the item's page. They lacked rustdoc's kind prefix, `core/error/Error` for `core/error/trait.Error.html`, and returned 404 on doc.rust-lang.org and docs.rs. Standard library links in signatures now use the stable docs, as doc links already did.
- Go method headings show their receiver, `func (mx *Mux) Get(...)`. The receiver was dropped and left `func  Get(...)`.
- Go doc comments render with `go/doc/comment`, the parser behind `go doc` and pkg.go.dev. Doc links such as `[NewRouter]` or `[http.Handler]` link to the symbol on the page or on pkg.go.dev, headings and lists keep their meaning, and prose such as `*Mux` or `snake_case` no longer turns into emphasis. Snapshots made before this release render as before.
- Go pages are readable in dark mode. Symbol headings, doc text, fields, examples and the index used light-mode colours on the dark page.
- A Go doc comment's paired backticks, `name`, render as code, and its indented examples are highlighted as Go.
- Rust and Go package pages no longer repeat their opening sentence as a lede, and a Rust crate's summary skips its badge row. Rust crate cards show the same summary.
- An image inside a paragraph stays inline, so a row of badges sits on one line instead of stacking.
- The reader theme names a tab once in its breadcrumb when no `reader.document.label` is set.
- `sourcey dev` no longer warns that it cannot resolve `preact` under pnpm and other package managers that do not hoist dependencies. An installed Sourcey renders from compiled JavaScript and skips Preact's dev preset. Dev asset URLs are also well formed on Windows (#275).

## 3.6.14 - 2026-10-17

### Fixed

- Render Rust documentation tests once, in their original position between the surrounding paragraphs. Keep hidden setup behind the working Show hidden lines control.
- Scope Rust documentation headings to their item and preserve the page's heading hierarchy.
- Run the CLI image on Node.js 24, matching Sourcey's supported Node.js range.

## 3.6.13 - 2026-10-11

### Fixed

- Link every Rust API symbol to the page and anchor that renders it. Symbol links left the crate's root module out of the page name and pointed impl and trait members at anchors their pages do not render, so they resolved under a doubled `rust-api/` directory and failed.
- Link a Rust API tab's landing page by the path the site writes it to, in every `prettyUrls` mode.
- Resolve a JSON Schema's `$id`-relative `$ref` to the local schema that declares that `$id`, without fetching it, so specs whose schemas carry `$id` keep building with `json-schema-ref-parser` 16.

### Changed

- Apply the saved theme from an external `sourcey-theme.js` in `<head>` instead of an inline script, so a Content-Security-Policy without `'unsafe-inline'` no longer blocks it.
- Update dependencies, including `@apidevtools/json-schema-ref-parser` 16. Sourcey now requires Node.js 22.19 or newer.

## 3.6.12 - 2026-09-30

### Added

- Add `landingPage: false` to `sourcey/astro`, so an Astro page can own the mount root while Sourcey writes every page beneath it.

### Changed

- Point the “Docs by Sourcey” attribution in every theme to the docs engine's home, `sourcey.com/docs`.

## 3.6.11 - 2026-09-27

### Changed

- Point the “Docs by Sourcey” attribution in every theme to the open-source overview.

## 3.6.10 - 2026-09-26

### Fixed

- Restore inline code and fenced blocks exactly when they contain a dollar sign, so code such as `` `$` `` no longer repeats the preceding page content.

## 3.6.9 - 2026-09-24

### Fixed

- Link the landing page of a `prettyUrls: "strip"` site under a base path by its public path, so no page or alias links it with a trailing slash.
- Navigate the reader chapter menu through its chapter links, so hosts that re-base those links, including the Astro no-slash alias, keep chapter selection working.

## 3.6.8 - 2026-09-24

### Fixed

- Make the complete “Docs by Sourcey” attribution one link with normal word spacing in every theme.

## 3.6.7 - 2026-09-24

### Fixed

- Align the reader masthead, sidebar and document frame to one responsive horizontal grid.
- Update YAML and HTML parsing dependencies to patched releases.

## 3.6.6 - 2026-09-23

### Added

- Reader theme for long-form documentation and specifications, with configurable document identity, chapter navigation, status metadata, table of contents, pagination and a responsive masthead.
- Local-font configuration and Markdown `navTitle` labels, shared by theme consumers.

### Changed

- `theme.name` now selects the complete renderer. The deprecated `theme.preset` key remains a compatibility alias through the 3.x line.
- Generator attribution reads “Docs by Sourcey” across all themes, with only “Sourcey” linked.

### Fixed

- Restore the standard Sourcey attribution in every theme footer.
- Astro development serves generated HTML with the document content type.
- Astro documentation aliases retain the host's base prefix in asset and navigation URLs, including Cloudflare client output.
- Theme assets preserve their directory structure in clean, dist-only packages. Development and production use the same theme asset registry.

## 3.6.5 - 2026-07-12

### Added

- Astro integration, exported from `sourcey/astro`. An Astro site can mount Sourcey directly instead of running a separate docs build: the integration reads the same `sourcey.config.ts`, derives `siteUrl` and `baseUrl` from Astro's `site`/`base` plus `routeBase`, serves docs in Astro dev, and writes docs into Astro's build output.

### Changed

- OpenAPI tag headings render at the operation title size instead of a step below it, so a tag's section heading is no longer smaller than the operations nested under it.
- C++ reference output picks up moxygen 2.1.12: `@retval`, `@throws`, and `@tparam` documentation renders as tables, and headings nest relative to the page they are embedded in rather than at a fixed level.

## 3.6.4 - 2026-06-23

### Fixed

- OpenAPI sidebar tag headings now link to their tag introduction section, so long `tags[].description` guidance is directly reachable from navigation.
- OpenAPI operation descriptions now fill the content column instead of the default prose measure, so the text no longer re-confines to ~65 characters when an operation's example/code panel is present.

## 3.6.3 - 2026-06-17

### Added

- OpenAPI operations now render author-provided examples. Named `examples` and a single `example` on responses and request bodies take priority over the schema-generated shape, every media type contributes instead of only the first, and a switcher moves between multiple examples when an operation has more than one. External examples (`externalValue`) render as a link.

## 3.6.2 - 2026-06-05

### Changed

- Bumped `moxygen` to 2.1.10, so C++ reference search snippets render the page title and matched text with a cleaner `-` separator.

### Fixed

- Rust re-exports (`use` items) now render with their real name and a `pub use` signature instead of an empty `reexport.` placeholder, and appear correctly in the sidebar, page outline, and search.

## 3.6.1 - 2026-05-31

### Added

- `rustdoc()` source adapter for native Rust API documentation. Consumes nightly rustdoc JSON via a bundled Rust helper crate, emits a stable v1 `RustdocSpec` snapshot, and renders sourcey-native pages consistent with the openapi, mcp, godoc, and doxygen adapters; inbound docs.rs-style deep-link anchors still resolve. Supports `auto`, `live`, and `snapshot` modes; snapshot mode requires no Rust toolchain so CI can build docs on stable.
- Sourcey-native rustdoc rendering: workspace and crate indexes use the shared card grid, items render inline as sections, signatures keep clickable cross-references, doctests flow through the shared syntax-highlighting pipeline, and trait implementations collapse behind a single styled disclosure while auto/marker traits stay a quiet list.
- First-class rustdoc doctest extraction with hidden-line stripping, fence-attribute badges (`ignore`, `no_run`, `should_panic`, `compile_fail`, `editionYYYY`), Rust Playground deep-links, and a workspace-wide doctests index page that aggregates every runnable example.
- runx Rust API as the live showcase of the rustdoc adapter, alongside icey (doxygen) and scafld (godoc).

## 3.6.0 - 2026-05-15

### Added

- Source adapters as the primary tab configuration shape: `source: markdown(...)`, `mkdocs(...)`, `openapi(...)`, `mcp(...)`, `doxygen(...)`, and `godoc(...)`.
- `mkdocs()` source adapter for importing existing `mkdocs.yml` / `mkdocs.yaml` sites. Sourcey reads `docs_dir`, `nav`, and legacy `pages`, preserves explicit page labels, flattens nested MkDocs sections into Sourcey sidebar groups, expands snippets, normalizes admonitions/tabs, and carries static assets into the build.
- C++ Doxygen references now carry member-level search metadata, route-mapped source links, and richer moxygen output for class templates, default arguments, typedef aliases, modern qualifiers, source locations, examples, inherited members, all-member indexes, and relationship sections.

### Changed

- `sourcey init`, first-party docs, examples, and 0state docs configs now use the adapter form. Legacy direct tab fields remain supported for existing projects.
- Search ranking now prefers exact symbol and `Class::member` matches over page prose, making large generated C++ references easier to navigate from the keyboard.

## 3.5.10 - 2026-05-10

### Changed

- `mcp-parser` is at `^0.4.0`, with the current `mcp-schema`.

### Fixed

- The desktop sidebar keeps its scroll position when a sidebar link opens another page, so a long generated sidebar no longer jumps back to the top after a deep entry is chosen.
- A direct, search or external link to a deep page reveals its entry in the sidebar, rather than reusing stale sidebar state.

## 3.5.9 - 2026-05-05

### Changed

- A changelog page's descriptions render inline Markdown, so links and inline code resolve, at a constrained reading width.
- An unreleased version's card has a tinted accent and a "Next release" label, in place of a dashed border and an empty date row.

### Fixed

- The changelog no longer carries text from a heading that is not a version into the page's description.

## 3.5.8 - 2026-05-05

### Added

- `sourcey dev --host <address>`, or `HOST`, sets the dev server's bind address, `127.0.0.1` by default. `--host 0.0.0.0` serves it outside a container, so the Docker image's `dev` command works.

### Fixed

- With `prettyUrls: "strip"` and a base path, the site's root links as the base path without a trailing slash.

## 3.5.7 - 2026-05-05

### Fixed

- A cross-reference Doxygen leaves unresolved, which reached the page as an empty link around Markdown, shows as code.

## 3.5.6 - 2026-05-05

### Fixed

- A link between generated pages written as a relative `.html` path follows the `prettyUrls` mode, so a Doxygen link such as `icy.html#anchor` is clean under `prettyUrls: "strip"`.

## 3.5.5 - 2026-05-05

### Fixed

- A Doxygen page's description renders as plain text, so stale `.html` cross-reference links no longer appear in its header and metadata under `prettyUrls: "strip"`.

## 3.5.4 - 2026-05-05

### Fixed

- Go and Doxygen tab navigation follows the `prettyUrls` mode, so `prettyUrls: "strip"` no longer links `.html` or `index.html` pages.

## 3.5.3 - 2026-05-05

### Fixed

- `prettyUrls: "strip"` writes `foo.html` files and links them as `/foo`, without a `_redirects` file, so hosts that serve extensionless paths no longer loop between `/foo` and `/foo/`.
- A Markdown link to a `.html` page the site generates is rewritten to the page's pretty URL.

## 3.5.2 - 2026-05-05

### Added

- Go documentation as a tab source (`godoc`), read from Go source by the Go toolchain rather than through Doxygen. It documents constants, variables, functions, types, struct fields with their tags, methods, and examples from `*_test.go`, each linked to its source. `mode: "live"` runs Go at build time, `"snapshot"` reads a committed `godoc.json`, and `"auto"`, the default, uses Go where it is installed.
- `sourcey godoc --module . --packages './...' --out godoc.json` snapshots a module's documentation for hosts without Go.
- The standalone `sourcey-godoc` Go module and CLI (`github.com/sourcey/sourcey/go/sourcey-godoc/cmd/sourcey-godoc`) generates a static Go documentation site (`generate`) or a snapshot (`snapshot`), with release binaries for each platform.
- `goEnv` (`GOOS`, `GOARCH`, `tags`) pins the build a live `godoc` tab reads, and `includeTests`, `includeUnexported`, `hideUndocumented` and `exclude` choose what it documents.
- Go packages and symbols are searchable, and listed in `llms.txt`, `llms-full.txt` and the sitemap.

### Fixed

- A Go reference page's edit link uses its own base path, apart from the site's Markdown pages.

## 3.5.1 - 2026-05-04

### Fixed

- Sidebar links and an OpenAPI tab's anchors follow `prettyUrls` ("slash" or "strip"). They had linked `slug.html` and `tab/index.html`, which return 404 on hosts that do not rewrite them, such as GitHub Pages.

## 3.5.0 - 2026-04-24

### Added

- OpenAPI 3.2: `QUERY` operations, response summaries, the `deviceAuthorization` OAuth flow, hierarchical tags, `querystring` parameters and media-type encoding.
- `$self`-aware reference resolution for OpenAPI descriptions split across documents.
- Every page gets its own social image, drawn at build time with Satori and resvg; `ogImage` names a static image instead.
- A changelog tab publishes a project's `CHANGELOG.md` as release pages.
- `siteUrl` names the public origin for feeds, social metadata and canonical URLs, and `baseUrl` the path a site is served under.
- `prettyUrls` writes clean URLs: `"slash"` writes `foo/index.html` and links `/foo/`, and `"strip"` links `/foo` and writes a `_redirects` file for hosts that support redirect rules.

### Changed

- The social image reads at Slack and Discord preview sizes: a larger wordmark, an accent bar in the theme's primary colour and tighter type.

### Fixed

- Vite is updated past the advisories reported against it.

## 3.4.11 - 2026-04-08

### Fixed

- Code inside a directive nested in another keeps its fenced blocks and inline code.
- The contents list's nested entries align with its track.

## 3.4.10 - 2026-04-08

### Fixed

- A nested schema's description is no longer repeated beneath the field that already shows it.

## 3.4.9 - 2026-04-08

### Added

- An OpenAPI tab's spec can be a web address.

## 3.4.8 - 2026-04-08

### Fixed

- Parameter descriptions in the API reference are spaced evenly.

## 3.4.7 - 2026-04-08

### Changed

- Inter is the default sans-serif font, and the layout's spacing is tightened: narrower page gutters, more room between sidebar groups, and the contents list's top entries in medium weight.

### Fixed

- Inline code inside a component's content stays code.

## 3.4.6 - 2026-04-08

### Added

- Directives nest, such as tabs inside a `:::code-group`.
- Doxygen cross-references in prose link to the pages of the symbols they name.
- Every Heroicons outline icon, 324 of them, can be named for cards, navigation and other components.

### Fixed

- Inline code is protected while directives are read, so directive syntax written as code shows as code.
- A Doxygen include path is shown from the project's `include` or `src` folder, rather than as the generating machine's absolute path.
- A page whose path already starts with its tab's slug is no longer given the slug twice.
- Inline code outside prose, such as in the contents list, is styled as it is in prose.
- The output directory is emptied before a build writes it, so a page removed from the site no longer lingers.
- Previous and next links resolve under the site's asset base.

## 3.4.4 - 2026-04-05

### Fixed

- An OAuth security scheme's section renders.
- The footer shows the logo again.
- A fenced example of Markdown is kept as written while directives are read.

## 3.4.3 - 2026-04-04

### Added

- `::iframe` embeds an `https` page in Markdown.

### Fixed

- A Doxygen page's summary resolves its cross-links, rather than showing raw `{#ref ... #}` placeholders in the page header, and a Doxygen index card's summary drops Markdown link syntax.
- `sourcey init` scaffolds a project against the latest published version.
- The minimal theme's callout borders, the page description's size on small screens, the contents list's nested margins, and the issues Lighthouse found on generated pages.

## 3.4.1 - 2026-04-02

### Added

- `llms.txt` and `llms-full.txt` are generated with the site, for language models to read.
- `search.featured` names the pages search offers before anything is typed.

### Changed

- The search dialog opens over the search button, in place.
- A page's description is set in a display font.
- MCP tools, resources and prompts are marked in the sidebar by coloured dots; HTTP methods keep their labels.

## 3.4.0 - 2026-04-02

### Added

- MCP server documentation, from an `mcp.json` snapshot, as an input beside OpenAPI, Markdown and Doxygen: tools, resources and prompts, with code samples in JSON-RPC and the TypeScript and Python SDKs.
- A connection card showing how to add the server to Claude, Cursor or any MCP client, and badges for a tool's hints (read-only, destructive, idempotent, open-world).
- Colour-coded sidebar labels for MCP entries: purple TOOL, green RES and blue PRMT.
- The dev server reloads when `mcp.json` changes.
- `::video` embeds YouTube, Vimeo or a video file in Markdown.
- A sitemap, OpenGraph and Twitter Card tags.
- A Docker image and a Nix flake.

### Changed

- The sidebar marks the current page with a pill rather than a left border, and the contents list with a marker on a continuous track.
- Clicking the first sidebar entry scrolls to the top of the page.

### Fixed

- The dev server serves Sourcey's own files when Sourcey is linked with `npm link`.
- `<AccordionGroup>` no longer wraps its accordions twice.

## 3.3.10 - 2026-03-30

### Fixed

- A Doxygen index page's links lead to its symbols' pages.
- Sourcey's JSON files load under Node 24.

## 3.3.9 - 2026-03-30

### Fixed

- Navigation identifies a page by its path with its folders, so pages with the same file name in different folders each keep their own sidebar entry.

## 3.3.8 - 2026-03-30

### Fixed

- A page's slug keeps its folders, so `guides/setup.md` and `api/setup.md` no longer share one.

## 3.3.7 - 2026-03-29

### Added

- A relative link from Markdown to a file in the repository is rewritten to the file's address on the repository host.

## 3.3.6 - 2026-03-26

### Added

- A Doxygen tab generates an index page of its groups and classes.

## 3.3.5 - 2026-03-26

### Fixed

- `sourcey --help` reports the installed version, and `sourcey init` scaffolds a project against the latest published version.

## 3.3.4 - 2026-03-26

### Changed

- The site's first page is written at its address, rather than as a page that redirects to it.

## 3.3.2 - 2026-03-25

### Added

- `sourcey init` detects a project's type and offers a choice of docs folder, and reads Doxygen's `XML_OUTPUT` to find its XML.

## 3.3.1 - 2026-03-25

### Fixed

- A TypeScript config file loads through jiti, and Moxygen resolves from the npm registry.

## 3.3.0 - 2026-03-25

### Added

- `sourcey init` scaffolds a new project.
- A `?target=` query parameter scrolls a page to that section on load.
- Sourcey is tested on Node 24.

## 3.2.1 - 2026-03-24

### Added

- Links between Markdown pages resolve to the pages' addresses.
- `editBasePath` points edit links into a docs folder inside the repository.
- Previous and next links end each Markdown page.
- Brand icons for GitHub, npm and other networks in the header and footer.

### Fixed

- The dev server finds its assets when Sourcey is installed from npm.

## 3.1.0 - 2026-03-23

### Added

- A navigation drawer with breadcrumbs on phones.
- Configurable tab slugs.

### Changed

- Code blocks sit on stone-coloured surfaces, and the contents list nests subheadings under their headings.

### Fixed

- The layout at small widths, the indentation of code, and a logo's path, which is read from the config's folder.

## 3.0.2 - 2026-03-23

### Added

- Geist Mono is the default monospace font, and fonts the theme names load from Google Fonts.
- A schema's nested properties collapse and expand.
- "Edit this page" links on Markdown pages, to the branch `editBranch` names.

### Changed

- The dev server reloads when the config changes, and recovers from a page that fails to render rather than stopping.

### Fixed

- The sidebar marks the current Markdown page, a page's first heading is no longer shown twice where it repeats the title, consecutive accordions group together, and headings scroll clear of the header.

## 3.0.1 - 2026-03-20

### Fixed

- Moxygen installs from the npm registry: 3.0.0 named a local path for it, so it did not install.

## 3.0.0 - 2026-03-20

### Added

- A redesigned theme, with presets (`default`, `minimal`, `api-first`) and the site's own colours, fonts and layout.
- C++ documentation from Doxygen XML, through Moxygen.
- Markdown pages chosen by glob patterns, and titled from their first heading.
- Search in a command palette (Cmd+K), and a contents list that follows the heading being read.
- An endpoint bar with colour-coded method badges, and copy buttons on code.

### Changed

- The header, sidebar, page, contents, code sample, response and security components are redesigned.

## 2.1.0 - 2026-03-19

### Changed

- Licensed under AGPL-3.0, where it had been MIT.

## 2.0.2 - 2026-03-19

A rewrite in TypeScript, rendering static HTML with Preact.

### Added

- `sourcey.config.ts`, typed through `defineConfig()`.
- Sites of many pages: tabs, sidebar groups, Markdown pages with components (Steps, Cards, Accordions), a header with links and a call to action, a footer with social links, a contents list that follows the reader, and links between pages.
- OpenAPI 3.x, with Swagger 2.0 converted to it.
- Highlighting by Shiki, code samples in 10 languages, and code blocks with a language menu, response tabs and a copy button.
- Search with keyboard navigation (Cmd+K).
- A dark mode that remembers the reader's choice, a primary colour the theme derives its shades from, and a logo for light and dark.
- Enum values shown as pills, an array's items included.
- A dev server on Vite that renders again on every change.
- Static HTML output with no framework runtime.

### Removed

- The Handlebars templates, the Grunt build and highlight.js.

## 1.1.0 - 2020-03-10

### Added

- Circular `$ref` references (#141).

### Fixed

- Reference resolution no longer caches files, which change while docs are developed.
- Response examples render.
- Dependencies with security advisories are updated: handlebars, js-yaml, lodash, lodash.mergewith, marked and fstream.

## 1.0.7 - 2019-01-30

### Added

- YAML examples.

### Fixed

- Links to anchors with dots or colons in them; a colon becomes a hyphen.
- Code blocks no longer overflow their column.
- The generator finds its app folder wherever it is installed (#165).
- Sass's deprecated `$header-sizes` warning.

## 1.0.6 - 2018-09-19

### Changed

- The code adapted from bootprint-openapi and bootprint-json-schema carries their copyright and MIT licence notices, in each file and in the licence.

## 1.0.5 - 2018-07-02

### Changed

- The Grunt build tools are updated.

## 1.0.4 - 2018-07-01

### Added

- A topic can carry examples.

### Changed

- A request parameter's type follows its name on one line (`name: type`), rather than below it.

### Fixed

- Builds with grunt-sass 3 (#156), and the Docker image builds on its new base image.

## 1.0.3 - 2018-04-15

### Added

- `-1, --one-file` embeds the CSS and JavaScript in the HTML file.
- `-D, --development-mode-live` serves the docs with live reload, on the port `-P` names; `-d` serves them with the file watcher alone. Development mode reports syntax errors in the spec.
- `x-nullable`, `$ref` in parameters and responses, descriptions on enum definitions, and nested objects and arrays in definitions.

## 1.0.2 - 2018-03-22

### Fixed

- A spec file outside the current folder builds on Windows.
- The security section renders as intended.

## 1.0.1 - 2018-03-21

### Fixed

- Markdown rendering (#122, #126), and schema descriptions render and link to their definitions.

## 1.0.0 - 2018-03-20

### Added

- `-q, --quiet` silences the generator's output.

### Changed

- Node.js 8 or later is required.

## 0.9.15 - 2018-03-20

### Fixed

- References to remote files render.

## 0.9.14 - 2018-03-20

### Added

- Topics: articles written in the spec under a vendor extension appear in the navigation and the content.
- A vendor extension hides the security definitions section.
- Enum values in responses (#69), and fuller parameters, collection formats included.

### Changed

- Tables are easier to read, and log messages clearer.

### Fixed

- The generator runs on Windows, and builds without being installed globally.

## 0.9.13 - 2017-12-04

### Fixed

- A default value prints even when it is 0 or empty (#103).

## 0.9.12 - 2017-11-13

### Added

- Response headers are shown again.

### Fixed

- Reference resolution passes over a `null` value rather than failing.

## 0.9.11 - 2017-10-13

### Fixed

- Reference replacement checks for null values.

## 0.9.10 - 2017-09-27

### Fixed

- Remote reference resolution.

## 0.9.9 - 2017-09-27

### Added

- Ranges read "min ≤ x ≤ max", `maxLength` is shown (#53), equal minimum and maximum lengths read as one, and arrays of objects render in full (#77).

## 0.9.8 - 2017-09-01

### Fixed

- Pages no longer render indented on large screens (#86).

## 0.9.7 - 2017-08-08

### Changed

- Remote references are fetched with sync-request, in place of request-sync (#84).

## 0.9.6 - 2017-08-05

### Changed

- The bundled Foundation is updated.

## 0.9.5 - 2017-08-04

### Changed

- Styles are refreshed and Foundation updated.

### Fixed

- Recursive references no longer throw (#51).

## 0.9.4 - 2017-08-01

### Added

- An operation shows its own `produces` and `consumes` where it defines them (#64).

## 0.9.3 - 2017-08-01

### Fixed

- Code blocks in descriptions are highlighted (#76), and `allOf` definitions without a `type` parse (#65).

## 0.9.2 - 2017-08-01

### Added

- References resolve across files and URLs, local references inside remote files included, with errors that name the reference (#68). Paths can be loaded from external files.
- A Dockerfile (#50).

### Fixed

- Request examples leave out `readOnly` properties, and examples keep falsy values.
- Tags are listed in the spec's order, and code is highlighted again.

## 0.8.2 - 2017-04-02

### Fixed

- An example given beside a `$ref` is used in place of the referenced schema's, and a response without a schema renders.

## 0.8.1 - 2017-04-02

### Fixed

- Recursive examples tolerate errors in the spec.

## 0.8.0 - 2017-04-01

### Added

- Examples render recursively, from definitions' example fields (#40, #47).

### Changed

- Paths are listed in the spec's order (#17).

## 0.7.5 - 2017-03-15

### Changed

- A definition is inserted once and referenced, rather than copied for each reference.

### Fixed

- A `schema.$ref` in a response block parses (#46).

## 0.7.4 - 2017-03-10

### Added

- Security definitions' descriptions render as Markdown.
- Examples are printed from definitions' example fields.

### Fixed

- Local references that point to other references resolve.

## 0.7.2 - 2017-03-01

### Fixed

- An example whose `schema` has a `type` is shown (#37).

## 0.7.1 - 2017-03-01

### Added

- An MIT licence file (#36).

### Fixed

- Request examples use the schema's examples, POST bodies no longer render as `undefined` (#38), and request, response and definition descriptions are laid out more clearly.

## 0.7.0 - 2017-02-01

### Added

- The generator can be called from JavaScript, and returns a promise that settles when the docs are written.

## 0.6.9 - 2017-01-16

### Fixed

- Builds use the temporary directory's path; 0.6.8 had passed the directory itself.

## 0.6.8 - 2017-01-13

### Changed

- Each build runs in its own temporary directory, removed on exit, rather than a shared cache.

### Fixed

- Code samples are highlighted.

## 0.6.7 - 2017-01-09

### Fixed

- jQuery loads over HTTPS.

## 0.6.6 - 2017-01-06

### Changed

- Text is slightly larger on large screens.

## 0.6.5 - 2017-01-06

### Fixed

- A definition's custom JSON example is shown (#25).

## 0.6.2 - 2016-12-19

### Changed

- The README documents usage in full.

## 0.6.1 - 2016-12-13

### Changed

- The generated HTML is formatted for reading.

### Fixed

- Parameter descriptions are parsed (#22).
- Stylesheets, images and the logo are linked relatively, so docs work under any path.
- Security definitions show their scopes.

## 0.6.0 - 2016-12-12

### Fixed

- Sidebar links to anchors with dots in them work (#15).
- An operation's summary renders inline beside its name.

## 0.5.9 - 2016-12-11

### Fixed

- Development mode reads the spec again and regenerates the page when the spec file changes (#16).

## 0.5.8 - 2016-12-03

### Changed

- The layout uses the window's full width.

### Fixed

- Foundation's CSS is minified.

## 0.5.7 - 2016-11-24

### Fixed

- Response examples parse schema types (#12).

## 0.5.5 - 2016-11-24

No changes from 0.5.4.

## 0.5.4 - 2016-11-24

No changes from 0.5.3.

## 0.5.3 - 2016-11-24

No changes from 0.5.2.

## 0.5.2 - 2016-11-24

### Fixed

- The stylesheet is no longer empty (#13): Foundation is bundled at the version the styles are written for.

## 0.5.1 - 2016-11-24

### Added

- An `index.js` entry point, so the generator can be required as a module.

### Fixed

- Relative spec paths resolve (#10).

## 0.5.0 - 2016-11-20

### Added

- JSON Schema references in enums.

### Changed

- Styles compile with libsass rather than Compass (#3, #9), and Foundation is updated to 6.2.4 (#1).

### Fixed

- Definitions parse (#4, #8), a schema's nested objects are handled recursively, and rendering no longer modifies the spec's own objects.

## 0.4.2 - 2016-06-04

### Fixed

- Docs generated without the layout, for embedding in another page, include the navigation drawer.

## 0.4.1 - 2016-06-04

### Fixed

- A spec file loads relative to the working directory, and a build without a logo no longer fails.

## 0.4.0 - 2016-02-07

### Changed

- The generator works installed globally: the output goes to `public` in the working directory, and copied files replace those already there.

## 0.3.4 - 2016-02-07

### Changed

- Dependencies are pinned to versions.

## 0.3.3 - 2016-02-07

### Fixed

- Tags are indexed with lodash 4, which an unpinned install had brought in.

## 0.3.2 - 2016-02-07

### Added

- `-l, --logo-file` adds a custom logo, copied into the docs.

## 0.3.1 - 2016-01-18

### Changed

- The README is updated.

## 0.3.0 - 2016-01-18

### Added

- A responsive layout whose navigation becomes a drawer on small screens, with Foundation's CSS in its own file.
- The Cheese Store sample API.

### Fixed

- A request body section appears only for operations that take a body, and other rendering fixes.

## 0.2.5 - 2016-01-17

### Added

- A `config.js` can override the build's configuration.
- `-C, --disable-css` and `-J, --disable-js` leave out the CSS or JavaScript, in place of `--skip-assets`.

### Changed

- Styles are scoped under one root element, so docs embedded in another page leave its styles alone, and every SCSS variable can be overridden.

## 0.2.4 - 2016-01-15

### Added

- `-f, --target-file` names the HTML file to write, and `-c, --cache-dir` the build's working folder.

### Fixed

- A spec without a `host`, or a tag without a description, builds.

## 0.2.3 - 2016-01-13

### Fixed

- The CLI shows its help only when no spec is given.

## 0.2.2 - 2016-01-12

### Fixed

- The CLI shows its help when run without arguments, and installing the package installs everything a build needs.

## 0.2.0 - 2016-01-12

The first release.

### Added

- Static HTML documentation generated from an OpenAPI (Swagger) 2.0 spec.
- A responsive layout, built from Handlebars templates and SCSS styles that can be extended.
- `-d, --development-mode` serves the docs and regenerates them as the spec changes, with live reload; `-s, --start-server` serves them alone.
- `-e, --embeddable` generates the documentation content without the page around it, for embedding in another site, and `-A, --skip-assets` leaves out the CSS and JavaScript.
