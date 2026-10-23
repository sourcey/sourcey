# Changelog

## Unreleased

### Added

- `reference.split: "sections"` publishes an OpenAPI or MCP reference as a page for each section, an OpenAPI tag or an MCP group, holding its operations in full, and a page for each model, beside an overview that lists them. Each operation's own address (`reference.operations`) leads to it on its section's page, and previous and next lead from section to section. A reference with one section to split by stays one page, and the build says so.
- `mcp({ spec, groups })` sections an MCP reference as the server's authors divide it: each group names its tools, resources and prompts, in the order the reference lists them, and the snapshot stays as captured. A name the server lacks, or one listed twice, fails the build; anything no group names is listed by kind after the groups, and the build names it. The undocumented `x-sourcey-group` field a snapshot could carry on an entry, which renamed its tag but left it listed under its kind, is no longer read.
- The build warns when a reference on one page holds more than 100 operations, which are slow to open and to search, and names the splits that serve it better.

### Changed

- An MCP entry's kind (TOOL, RESOURCE or PROMPT) shows only beside entries of another kind, in a reference's lists, its sidebar and the line under an entry's title: a section named "Tools" already says what its entries are. That line shows a tool's or prompt's name only where its title is not already the name, and a resource's address; with neither to show, there is no line. HTTP methods show as before.
- A split reference's overview lists its introduction's headings under "On this page", rather than its sections, authentication and models again beside the sidebar that lists them.
- `sourcey migrate docusaurus` leaves out footer links to the docs' own pages, which the sidebar lists, and links the navbar has, such as its repository, and names them. `sourcey migrate mkdocs` no longer repeats the header's repository link among Material's social links.

### Fixed

- A schema no longer opens a type inside itself, or draws a very large type out to the depth limit. A field of the type it sits in reads "Same fields as" and links up to where that type is drawn. A schema that would draw more than 500 field rows, as large Kubernetes custom resources do, draws each named type once, at its shallowest place, and links its other fields there: one such operation was 21 MB of HTML that stopped 1,026 times at "Max depth reached", and is now 1 MB with every field reachable. Generated examples leave out a property that would repeat its own type, rather than printing `"[circular]"`, and an example longer than 400 lines shows each named object type once. Schemas below that size draw as before.
- A reference's version is prefixed with "v" only where it is a number, so a version named `latest` no longer reads "vlatest".
- Pages fit a phone's screen where they name long identifiers. A type, a model's name, a page title, a link in prose, a description in a reference's list, or the name in a previous or next link that has a word too long for its column wraps inside that word, rather than widening the page; a model's type moves below its name where the two cannot share a line. Pages whose words fit draw as before.
- A snake_case name, such as an MCP tool's, breaks after an underscore in the navigation, a reference's lists and its page heading, rather than inside a word.
- A site name longer than the header has room for, as on a phone, stays on one line and ends in an ellipsis, rather than wrapping to three lines that crowd the header's controls.
- The footer's links wrap onto a second line where there are more than a phone's width holds, and an enum value, default or range in a deeply nested field, or a reference's tag heading, wraps inside its word where it is wider than its column, rather than widening the page.
- `sourcey migrate mkdocs` says that Material's analytics (`extra.analytics`) are not carried over, as the Docusaurus converter says of its analytics plugins, rather than leaving them out without a word.
- A Mermaid flowchart draws its subgraphs: each a titled container around its members, nested ones inside the one around them, coloured as Mermaid's own light and dark themes colour them. They were laid out flat and left out. A `<br>` in a node's label is a line break, drawn in the middle of the node rather than at the top of the diagram, and in a message, note, edge or title, which the renderer draws on one line, it reads as a space rather than as `<br>`.
- `sourcey migrate docusaurus` titles a page that opens with its own heading by that heading, as Docusaurus shows it, keeping its frontmatter title as its navigation label, rather than showing both titles.
- `sourcey migrate docusaurus` keeps a navbar link to a page of the site (`to`), as it keeps one to another site (`href`), rather than dropping it without a word.
- Social images are drawn off the main thread, as many at once as the build's image budget allows, rather than one or two at a time on it, and each takes a third of the time: the card's background glow is drawn as one gradient rather than the masked pattern satori made of it, which took resvg three times as long as the rest of the card. One worker lays the cards out and native threads rasterise and encode them, and the worker ends with the last card, as the diagram renderer now ends once the pages are loaded, rather than each holding its memory until the build exits. Images look as before, at two thirds of the bytes. A cold build of an 838-page site went from 32 s to 14 s, and its peak memory from 2.5 GB to 1.5 GB.
- An operation or schema is searched by its own words and its fields' names, titles, descriptions and values, each named type's once, as the reference draws it, rather than by a dump of the whole normalized document. The dump repeated a type nested many times over at every level and listed the document's own keys, so "type", "format" and "properties" matched every operation; on a Kubernetes API one operation's search text was 5.9 MB and `documents.json` was 61 MB. It is now 6.5 MB, and builds take less time and memory.
- A Swagger 2.0 document converts without being written out as YAML first. The converter kept that text only for validators' messages, and writing a large dereferenced document took over a second.
- `sourcey build` writes the site as it renders it: each page, and the social image drawn just before it, goes to disk and is let go, rather than the whole site's HTML and images being held until the last page renders. The output directory still changes all at once, when every file is ready, and is rolled back on a failure as before. `SourceySiteArtifacts` no longer carries `ogImages`: the images are among the files `writeSourceySite` writes and the in-memory artifacts a host renders.
- Code is highlighted by Oniguruma, the regex engine its grammars are written for, rather than by Shiki's JavaScript translation of them, which read some patterns differently: SQL's `SUM(` and other functions written against an opening bracket are coloured as functions now. Highlighting takes half the time and a fifth of the memory it did.
- An API reference normalizes each schema once for every place it is used the same way, and shares the result, rather than copying a component into every operation that returns it. A 1,781-operation API held a third of the schema memory it did. References render as before.
- A site's `llms.txt` and `llms-full.txt` are generated once, rather than once for the file and again for the build's result, and machine exports are held as the UTF-8 bytes they are written as, rather than as text the script heap held at two bytes a character once one curly quote appeared.
- `sourcey build` copies files it publishes unchanged, such as images, stylesheets' assets and a public directory's files, from their source as it writes the site, hashing each as a stream, rather than holding every one in memory from the start of the build. A site whose public directory held 143 MB of reports no longer held them all. A file that changes while the site builds fails the build rather than being published unlike its hash. The dev server and Astro, which serve the site from memory, read files as before.
- The build cache identifies the packages that draw diagrams, images and assets by each package's manifest and its files' sizes and modification times, rather than by reading every byte of every file they depend on: Mermaid's dependencies alone cost each build a quarter of a second and 150 MB of memory to hash. A patched or relinked package still counts as changed.
- Diagrams and social images are drawn in processes of their own, which end when their work does and give all their memory back. A worker thread's ending gave back almost none: one Mermaid diagram left the build holding 330 MB, for its DOM and the Mermaid library, until it finished.
- `sourcey build` collects its garbage sooner: a build renders each page once and keeps little, so it no longer lets the script heap grow well past what it holds before collecting. On an 838-page site its peak went from 1.24 GB to 0.84 GB, for 7% more time.
- A schema nested along many paths, as a Kubernetes type is, normalizes once wherever it cannot meet itself again, rather than once for every path to it, and a component that nothing references is named by itself, as a referenced one is: its Markdown reads `Type: Order` rather than `Type: unknown`.
- A Swagger 2.0 document converts to OpenAPI 3 before its references are resolved, as the converter is written to, so a type it uses in many places stays one type rather than a copy at every use: a 0.2 MB Kubernetes API had grown to 25 MB on the way, and its build now takes a second and 150 MB less. A reference to a type inside itself now links to that type where it read `any`. As Swagger 2.0 specifies, keywords written beside a `$ref` are ignored.
- Markdown keeps what it draws through sanitizing: an ordered list's starting number, a task list's checkboxes and `~~strikethrough~~`. The sanitizer had removed them on every page, so a list numbered from 3 read from 1 and a checklist lost its boxes.
- A page's Markdown is sanitized only where its author wrote HTML. The build's own HTML, its headings, highlighted code and built-in components, joins the page as itself, rather than being written into the page's Markdown, read again as Markdown and sanitized: every page went through the sanitizer whole, highlighted code and all. A component a site defines is still sanitized, as are images and frames from anywhere but the web or the site. An 838-page site builds in 7.5 s, from 9.2 s.
- A page's Markdown is read once for the local files and HTML it names. Markdown that names neither, as most does, is kept as written, rather than read twice more to rewrite nothing, and a link's label is rewritten from what was read with the link rather than read again.
- `sourcey build` loads a library only for a site that uses it: the HTML sanitizer with the first HTML an author wrote, JSONPath with the first overlay, the Doxygen converter with a Doxygen tab and the reference resolver with the first API document. The highlighter loads Shiki's core and its Oniguruma engine, rather than the bundle that lists every language and theme.
- Sourcey's own scripts and styles ship built in the package, and a site's build reads them rather than bundling them with Vite and Tailwind whenever its cache is empty: a cold build of a 493-page site takes 0.7 s less CPU time and 30 MB less memory. The published scripts no longer name the machine that bundled them. Rolldown had headed each module's code with its path, so a site's `sourcey-search.js` carried the builder's home or temporary directory; a site's own components are bundled without those paths too.
- A build finds the links its broken-fragment check follows by reading each page's anchors from the HTML it wrote, rather than parsing every page again: on a 493-page site that check took a tenth of a second.
- A page's Markdown is lexed once where it used to be lexed twice: the title and summary its frontmatter leaves out are read from one lexing of the page, and its headings from the same lexing that finds its local files.
- The build cache reads the packages a diagram or social image is drawn with all at once, rather than one directory and one file at a time, so a build with a diagram waits a tenth of a second less before drawing it, cached or not. What it checks is unchanged.
- `sourcey build` clones a file it publishes unchanged into the output where the file system can, as APFS, Btrfs and XFS can, and copies it in one call elsewhere, rather than streaming its bytes through the build and hashing them a second time: a public directory of 143 MB is published without being read again or taking its size again on disk. A file that changes after it was hashed still fails the build, now found by its inode, size and change time, which every write moves; a file written while it is being hashed fails too.
- Code is highlighted in both code themes from one tokenizing, rather than tokenized again for each theme as Shiki's two-theme rendering does, and written without its intermediate syntax tree: highlighting takes half the time. A run of characters in one colour is one span, and text in each theme's own colour is left as text, so a code block's HTML is about 30% smaller. Every character shows the colours it did.
- Search reads only what a query needs. The build scores each word in each result once, as MiniSearch scored an exact match of it, and publishes the words in sorted chunks, each result's title and address in small fragments, and the vocabulary in blocks; a query reads the chunks its words fall in and the fragments of the results it shows, ten at a time as the list scrolls. A first search on an 838-page site reads 10 KB where it read 190 KB before any result showed, and the search worker is 5 KB rather than 25 KB. Results rank as MiniSearch ranked them, with one difference: a typo is an edit after a word's first two letters, as Elasticsearch's `prefix_length` 2 reads one, so `rule` no longer matches `mule`; a query that finds nothing as written is read again with typos anywhere. Building the index no longer builds MiniSearch's in memory: a 493-page site's build holds 170 MB less at its peak. `sourcey/documents` searches with the same engine, and MiniSearch is no longer a dependency.
- A diagram is read and laid out once and drawn in the light and dark themes from that layout, rather than read and laid out again for each theme. Diagrams are drawn as before.
- A page's Markdown export is written once the site's routes are known, from its content, rather than written as the page was drawn and lexed whole again to rewrite its links. Loading a page marks the blocks and headings that hold a link the site resolves, 1 to 3% of a site's blocks, and only those are read again, with the page's reference definitions, so a `[text][name]` link resolves wherever its definition is. Exports are as before.
- The API console's data for an operation holds what the console reads, how to call it, rather than the whole operation with its responses and prose, and writes a type it uses in many places once. Argo CD's console data went from 20.9 MB to 0.9 MB, and its largest operation's, which a reader downloads on opening the console, from 4.4 MB to 96 KB; Gauzy's from 54 MB to 4 MB. The console draws as before.
- The title and summary a page's frontmatter leaves out are read from its blocks, lexing the inline text only of the paragraphs it reads until one has prose, rather than lexing all of the page's prose to find them. Titles and descriptions are as before.
- Every site's stylesheet leaves out seven utility classes no page used (`filter`, `grid`, `italic` and others), which Tailwind had read from the engine's own code rather than its markup. Tailwind now reads the components and client scripts, which write its utilities; the engine's other markup is styled by the theme's classes, as before.
- A Go, Doxygen or Rust tab's navigation leads to the pages the site writes, in every `prettyUrls` mode and wherever a tab's `routes` move a page. Go and Doxygen named their pages by one file layout of their own: by default, without pretty URLs, the Overview linked `go-api/index.html` where the site wrote `go-api.html`, and with `prettyUrls: "slash"` every package or class linked a `.html` file the site writes as a directory (#298). Each tab's navigation now names its pages and the site gives each its address, as it does for authored navigation, and navigation that names a page the site does not publish fails the build rather than linking nowhere. Without pretty URLs, the tab, and the logo where it is the first tab, now lead to the overview rather than to the page after it, and in every mode search opens on these tabs' pages before anything is typed, which it had passed over.
- The highlighter reads a language's grammar the first time a block in that language is drawn, rather than all 23 grammars and those they embed whenever Sourcey is imported. A compiled grammar holds megabytes, so a site holds only the grammars of the languages it shows: importing Sourcey takes 25 MB less memory, and code is highlighted exactly as before, in every language and whatever order the languages are met in.
- A page written in Markdown is drawn once, after the site's routes and navigation are compiled, with its links resolved as it is drawn, rather than drawn before the routes existed, drawn again where a page list changed, and kept twice over, as drawn and as linked. Routes read a page's headings and anchors from its content. The build holds one copy of each page, and a site's rebuild keeps one cache of drawn pages rather than two. `resolveInternalLinks`, an internal step that took the build's own page records, is no longer exported.
- Vite loads only to read a config file, or to bundle a site's own components, rather than whenever Sourcey is imported: a host that passes Sourcey a resolved config, such as Astro's integration, never loads it, and importing Sourcey takes 61 MB where it took 110.
- A page's sidebar draws once each section that holds neither the page nor a link to it, and reuses it on every other page, rather than drawing the whole navigation again for every page: a section looks the same on each page but around the current one. Pages are drawn as before, and a 458-page site builds with 5% less CPU time.
- A site that defines a component named `Include` has its own drawn where a page writes `<Include>`, as a site's component named after any other built-in is, rather than Sourcey reading the file the tag names and passing over the site's component. A directive that opens no component fails the build naming the directive, whatever it is called: `:::constructor` had failed naming an internal function instead.
- An MCP tab whose spec is a web address builds. The spec is read once, through the build's reader, as an OpenAPI spec is, rather than read a second time by the MCP parser, which took the address for a file name and failed. A file the build reads and cannot find fails naming it, as `File not found: <path>`.
- A logo, favicon or social image whose path starts with `http`, such as `httpdocs/card.png`, is read from the config's folder, as any other path is, rather than taken for a web address and looked for in the working directory. A site's own social image is read as its logo and favicon are, through the build's reader, and `sourcey build` copies it from its source rather than holding it in memory.
- A component a site defines is given the language and version its page is read in, as `context.context`, and its type says so: it no longer types that context as possibly missing, which it never was in a build.
- A page declares the language its content is in by that language's tag, as its `hreflang` links name it: where a site sets `lang: "pt-BR"` for `pt`, a Portuguese page is `<html lang="pt-BR">`, where it was `lang="pt"`, and a page that falls back to the default language's content declares the default language's tag. A site that sets no `lang` draws as before.
- A flowchart's subgraphs run as Mermaid runs them. A subgraph no link crosses is laid out on its own, in the direction it declares (`direction LR`), or else across the chart's, so a top-to-bottom chart lists each layer's members down its side; one a link crosses keeps the chart's direction. Members no link joins keep the order they are written in. Every subgraph had run in the chart's direction, so a top-to-bottom architecture chart spread each layer across the page, wider than its column, where Mermaid stacks it.
- A diagram's labels read as Mermaid shows them: an entity such as `&lt;` is the character it names, an `&` in a label with a line break reads `&` rather than `&amp;`, and other markup, such as `<b>`, is left out rather than shown as written.

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

## 3.6.13 - 2026-10-12

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

## 3.6.9 - 2026-09-25

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

## 3.6.4 - 2026-06-24

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

- Bumped `mcp-parser` to `^0.4.0`, bringing the current `mcp-schema` dependency and markdown-first standalone generation docs into Sourcey's MCP tooling stack.

### Fixed

- Desktop sidebar scroll position now survives sidebar-initiated page navigation, so long generated docs sidebars no longer jump back to the top after selecting deep items in Doxygen/moxygen, OpenAPI, MCP, godoc, Markdown, or changelog tabs.
- Direct, search-result, and external deep links now reveal the active sidebar item without reusing stale sidebar state.

## 3.5.9 - 2026-05-06

### Added

- Native Go documentation as a fifth tab source (`godoc`). Sourcey extracts package docs directly from Go source via the toolchain (`go list` + `go/parser` + `go/doc`); no Doxygen pipeline. Supports live mode (runs Go at build time) and snapshot mode (reads a committed `godoc.json`); `mode: "auto"` (default) picks live when Go is available and snapshot otherwise. Renders consts, vars, functions, types (struct, interface, alias, defined), fields with tags, methods, and examples from `*_test.go`.
- `sourcey godoc --module . --packages './...' --out godoc.json` CLI command to snapshot a Go module's documentation into a portable JSON artifact for JS-only docs hosts.
- Standalone `sourcey-godoc` Go module and CLI at `github.com/sourcey/sourcey/go/sourcey-godoc/cmd/sourcey-godoc`, with `generate` for static Go docs sites, `snapshot` for portable JSON, and cross-platform GitHub release binaries on `go/sourcey-godoc/v*` tags.
- `goEnv` option (`GOOS`/`GOARCH`/`tags`) for pinning the live-mode Go build environment so docs reproduce across hosts.
- `includeTests`, `includeUnexported`, `hideUndocumented`, and `exclude` options on `godoc` tabs.
- godoc package and symbol entries flow through the existing search index, `llms.txt`, `llms-full.txt`, and `sitemap.xml` pipelines.

### Changed

- Changelog page descriptions now render inline markdown so links and inline code resolve, with a constrained reading width and primary-tinted underlined links.
- Unreleased version cards drop the dashed border for a primary-tinted left accent and soft tint, with a "Next release" pill in place of the empty meta row.

### Fixed

- Changelog parser no longer leaks bullet/paragraph tokens from non-SemVer headings into the page description, so trailing historical sections stop polluting the lead paragraph.

## 3.5.8 - 2026-05-06

### Added

- `sourcey dev --host <address>` flag (and `HOST` env var fallback) to control the Vite dev-server bind address. Defaults to `127.0.0.1`. Use `--host 0.0.0.0` (or `-e HOST=0.0.0.0` in Docker) to expose the dev server outside the host so the official `sourcey/sourcey` image's `dev` command works end-to-end.

## 3.5.6 - 2026-05-05

### Fixed

- Output-relative `.html` links between generated pages now resolve through the active `prettyUrls` mode, cleaning Doxygen body links such as `icy.html#anchor` when `prettyUrls: "strip"` is enabled.

## 3.5.5 - 2026-05-05

### Fixed

- Generated Doxygen page descriptions now render as plain text, preventing stale `.html` cross-reference links from appearing in page headers and metadata when `prettyUrls: "strip"` is enabled.

## 3.5.4 - 2026-05-05

### Fixed

- Generated Godoc and Doxygen tab navigation now normalizes through the active `prettyUrls` mode, so `prettyUrls: "strip"` builds do not emit stale `.html` or `index.html` navigation links.

## 3.5.3 - 2026-05-05

### Fixed

- `prettyUrls: "strip"` now emits `foo.html` files and public `/foo` links, without generated `_redirects`, so extensionless hosts do not loop between slashless and trailing-slash paths.
- Internal markdown links that still point at `.html` pages are rewritten to the active pretty URL form when they resolve to a generated page.

## 3.5.1 - 2026-05-04

### Fixed

- Sidebar nav and OpenAPI tab anchor base now honour `prettyUrls` ("slash" / "strip"). Previously hrefs were hard-coded to `slug.html` / `tab/index.html`, which 404 on hosts that don't auto-rewrite (e.g. GitHub Pages). Production `sourcey.com` masked the issue with its `/foo.html → /foo/` 308 redirect.

## 3.5.0 - 2026-04-24

### Added

- OpenAPI 3.2 parsing and rendering for `QUERY` operations, response summaries, `deviceAuthorization` OAuth flows, hierarchical tags, `querystring` parameters, and media-type encoding metadata
- `$self`-aware reference resolution for canonical multi-document OpenAPI descriptions
- `prettyUrls` config option for clean URLs (`"slash"` emits `foo/index.html` and links as `/foo/`; `"strip"` links as `/foo` and emits a `_redirects` file for static hosts that support redirect rules)

### Changed

- OG image template redesigned for legibility at Slack/Discord preview sizes: larger bold wordmark, vertical accent bar in theme primary, tighter type, single-grey description, no duplicate site-name footer

### Fixed

- Lint configuration for browser-side client scripts and generated MCP test artifacts

## 3.4.12 - 2026-04-16

### Added

- Automatic per-page OG image generation at build time using Satori and resvg
- `ogImage` config option for overriding with a static image URL
- Heroicons in navigation and UI components

### Changed

- Inter loaded as the default sans-serif; layout rhythm refined for tighter vertical spacing

### Fixed

- Tab path deduplication when multiple tabs share a slug
- Inline code styling inside TOC items
- TOC nested-item border alignment

## 3.4.5 — 2026-04-07

### Added

- Nested directives (e.g. tabs inside `:::code-group`)
- Doxygen link rewriting for cross-referenced symbols in prose

### Fixed

- Inline code protection during markdown directive preprocessing

## 3.4.4 — 2026-04-06

### Fixed

- OAuth security section rendering
- Footer logo restored after layout refactor
- Fenced markdown examples preserved through directive preprocessing

## 3.4.3 — 2026-04-05

### Added

- `::iframe` directive for embedding arbitrary https URLs in markdown

### Fixed

- Doxygen page summaries now reuse resolved cross-links in page headers instead of exposing raw `{#ref ... #}` placeholders
- Rich Doxygen index cards strip inline markdown link syntax from summaries
- `sourcey init` now scaffolds projects against the latest published version again
- Minimal-theme callout borders and responsive page description sizing
- TOC sub-item margin alignment
- Search featured pages, inline dialog, display font, and sidebar dot markers
- Lighthouse baseline polish for generated docs

## 3.4.0 — 2026-04-02

### Added

- MCP server documentation as a first-class input format alongside OpenAPI, Markdown, and Doxygen
- `mcp` tab config option for rendering tools, resources, and prompts from an `mcp.json` snapshot
- Auto-generated code samples in JSON-RPC, TypeScript SDK, and Python SDK for all MCP operations
- Connection config card showing how to add the server to Claude, Cursor, or any MCP client
- Annotation badges for tool hints (read-only, destructive, idempotent, open-world)
- Colour-coded sidebar method pills (purple TOOL, green RES, blue PRMT)
- Hot-reload for mcp.json files in the dev server
- `::video` directive for embedding YouTube, Vimeo, or raw video files in markdown
- Sitemap generation
- OpenGraph and Twitter Card meta tags
- Dockerfile for Docker Hub
- Nix flake support

### Changed

- Sidebar active state uses pill-style background instead of left border
- Table of contents uses a continuous grey track with primary colour active marker
- Clicking the first sidebar item scrolls to the top of the page

### Fixed

- Dev server `fs.allow` now includes the sourcey root for npm link compatibility
- Double-wrapped accordion groups from `<AccordionGroup>` component syntax

## 3.3.10 — 2026-03-30

### Changed

- Package metadata moved to sourcey.com and sourcey/sourcey org

### Fixed

- Node 24 JSON import compatibility

## 3.3.9 — 2026-03-28

### Fixed

- Page slugs preserve directory structure to avoid nav collisions

## 3.3.8 — 2026-03-28

### Fixed

- `slugFromPath` preserves directory structure

## 3.3.7 — 2026-03-27

### Added

- Relative source links in markdown rewrite to repo URLs at build time

## 3.3.6 — 2026-03-27

### Added

- Doxygen index page generation

### Fixed

- Doxygen index content links

## 3.3.5 — 2026-03-26

### Fixed

- CLI help output reports the actual package version
- `sourcey init` scaffolds new projects with the latest published version

## 3.3.4 — 2026-03-26

### Changed

- First page renders directly instead of meta-refresh redirect

## 3.3.2 — 2026-03-25

### Added

- `sourcey init` auto-detects project type and offers directory selection
- Init reads Doxygen `XML_OUTPUT` for proper path resolution

## 3.3.1 — 2026-03-25

### Fixed

- Use jiti for TypeScript config loading
- Resolve moxygen from npm registry

## 3.3.0 — 2026-03-25

### Added

- `sourcey init` command for scaffolding new projects
- Scroll tracker `?target` query parameter for deep linking
- Node 24 in CI test matrix

## 3.2.1 — 2026-03-24

### Fixed

- Dev server asset path resolution for npm installs

## 3.2.0 — 2026-03-23

### Added

- Internal link resolution between markdown pages
- `editBasePath` config option for repos with docs in a subdirectory
- Previous/next page navigation at the bottom of markdown pages
- Brand icons (GitHub, npm, etc.) in navbar and footer

## 3.1.0 — 2026-03-22

### Added

- Mobile navigation drawer with breadcrumbs
- Configurable tab slugs
- Collapsible schemas in API reference
- "Edit this page" links on markdown pages
- Auto Google Fonts loading from theme config

### Changed

- Stone-palette code surfaces
- TOC nesting improvements

### Fixed

- Responsive layout at small breakpoints
- Code indent rendering
- Dev server error recovery
- Sidebar active state on prose pages
- Duplicate h1 headings
- Logo paths resolve relative to config directory

## 3.0.2 — 2026-03-21

### Added

- Geist Mono as default monospace font

### Changed

- Config changes hot-reload in dev server

### Fixed

- Scroll offset calculation

## 3.0.1 — 2026-03-21

### Added

- Doxygen C++ documentation via Moxygen integration
- Command palette search (Cmd+K)
- Google Fonts loading and font stack configuration

### Fixed

- Moxygen resolved from npm registry
- TOC scroll tracking
- Heading scroll offset

## 3.0.0 — 2026-03-20

### Added

- Redesigned theme with new layout, typography, and colour system
- Theme presets (default, minimal, api-first) with custom colours, fonts, and layout
- EndpointBar component with colour-coded method badges
- CopyButton and SocialIcon UI components
- Demo site with markdown guides
- Unified Vite plugin for dev server

### Changed

- Renamed from `spectacle-docs` to `sourcey`
- License changed from MIT to AGPL-3.0-only
- Complete redesign of Header, Sidebar, Page, TableOfContents, CodeSamples, Responses, and Security components

### Removed

- Legacy Handlebars/Foundation/SCSS theme
- TabBar and old CodeBlock components

## 2.1.0 — 2026-03-19

### Added

- Multi-page sites with tabbed navigation and sidebar groups
- Markdown pages with rich components (Steps, Cards, Accordions)
- Vite dev server with SSR hot reload
- Header with navbar links and CTA button
- Table of contents with scroll tracking
- Footer with social links
- Cross-page navigation link resolution

### Changed

- Dark example panel hidden on prose-only pages

## 2.0.2 — 2026-03-19

### Added

- Vite dev server with header, TOC, and layout system

## 2.0.0 — 2026-03-10

Complete rewrite from Handlebars/Grunt to TypeScript/Preact SSG.

### Added

- TypeScript codebase with Preact SSR
- `sourcey.config.ts` with `defineConfig()` and full type safety
- OpenAPI 3.x support (auto-converts Swagger 2.0)
- Shiki syntax highlighting
- Dark mode with localStorage persistence
- Client-side search with keyboard navigation (Cmd+K)
- Auto-generated code samples in 10 languages
- Custom colour theming with hex-to-RGB token system
- Stone-palette code blocks with language dropdown and response tabs
- Copy button on code blocks
- Scroll-tracked sidebar navigation
- Enum pills and array item type display
- Logo support with light/dark variants
- Static HTML output with no framework runtime
- GitHub Actions CI

### Removed

- Handlebars template engine
- Grunt build system
- highlight.js

## 1.1.0 — 2020-03-10

### Fixed

- Example rendering
- Dependency vulnerabilities (handlebars, js-yaml, lodash, marked, fstream)

## 1.0.7 — 2019-01-30

### Added

- YAML example support

### Fixed

- Href with colon characters
- Href with multiple dots
- Code block overflow

## 1.0.6 — 2018-09-20

### Changed

- Licence update

## 1.0.5 — 2018-07-02

### Changed

- Updated Grunt dependencies

## 1.0.4 — 2018-07-01

### Fixed

- grunt-sass 3.0 compatibility
- grunt-sass dependency resolution

## 1.0.3 — 2018-04-15

### Added

- Nested objects and arrays in definitions
- Resource embedding support
- Enum definition descriptions
- `$ref` support in parameters and responses
- Development mode with live reload
- Schema syntax error reporting in dev mode
- `x-nullable` support

## 1.0.2 — 2018-03-22

### Changed

- Security partial rendering

## 1.0.1 — 2018-03-21

### Fixed

- Markdown rendering (#122, #126)
- Schema description rendering and linking

## 1.0.0 — 2018-03-20

First stable release. Requires Node.js >= 8.

### Added

- Quiet output option

### Fixed

- Remote file reference rendering

## 0.9.12 — 2017-11-13

### Added

- Response header display

### Fixed

- Null node error in reference resolution

## 0.9.11 — 2017-10-13

### Fixed

- Null check in reference replacement

## 0.9.10 — 2017-09-27

### Fixed

- Remote reference tests

## 0.9.9 — 2017-09-27

### Added

- Min/max range display for parameters
- maxLength and minLength display for strings
- Better rendering of arrays of objects

## 0.9.8 — 2017-09-01

### Fixed

- Rendering on large screens with indents

## 0.7.0 — 2017-02-01

### Added

- Programmatic API with promise return

## 0.6.9 — 2017-01-16

### Added

- Remote schema support
- Temporary directory per build run

## 0.6.8 — 2017-01-13

### Fixed

- Code highlighting
- HTTPS for jQuery reference

## 0.5.0 — 2016-12-31

### Added

- OpenAPI 2.0 (Swagger) rendering
- Foundation 6 responsive layout with drawer navigation
- Custom logo support
- Docker support
- Recursive example parsing
- Definition rendering with JSON examples
- Custom CSS scoping
- Handlebars template engine
