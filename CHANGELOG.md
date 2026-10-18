# Changelog

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
