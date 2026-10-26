# Roadmap

What's coming for Sourcey. Last updated: October 2026.

## Shipped

- **MCP server documentation**: tools, resources, prompts rendered as browsable reference with code samples
- **C++ and Doxygen**: feed Doxygen XML, get modern searchable API docs via moxygen
- **Go and Rust API docs**: native godoc and rustdoc adapters with live and snapshot modes
- **Built-in components in markdown**: fixed JSX-style components and directive syntax in `.md` / `.mdx` files
- **Directive components**: `:::note`, `:::warning`, `:::code-group`, `:::steps`, `:::tabs`, `::video`, `::iframe` in plain markdown
- **Changelog standardisation**: normalise `CHANGELOG.md`, render structured version cards, emit Atom/RSS feeds, include changelog pages in llms.txt
- **llms.txt generation**: auto-generate llms.txt and llms-full.txt alongside HTML output
- **Readable documentation and discovery**: per-page, operation and schema Markdown, a document index, public OpenAPI bundles, scoped ARD/API catalogs and an optional docs MCP server
- **Light and dark**: semantic design tokens, light and dark logo variants
- **Search in the browser**: typo-tolerant full-text search across all pages and API operations, loading only the index shards a query needs
- **Themes**: default, minimal, api-first and reader layouts
- **Versions and languages**: documentation versions and translations with route-aware selectors, shared page identities, and scoped search and exports
- **API playground**: a Try it console on every operation, with editable parameters and bodies, authentication, file uploads and live responses
- **Site pages**: home and product pages outside the documentation, in the docs frame, inside the site's header and footer, or on their own
- **Migrations**: one-time converters from Astro, Docusaurus, Mintlify and MkDocs, with route, fragment, content and media checks
- **Site components**: the site's own HTML and Preact components, page parts for analytics and the like, and replacements for the theme's header and footer
- **Page furniture**: page feedback, last-updated dates from git, breadcrumbs, and release and star counts on a GitHub link
- **Diagrams**: Mermaid diagrams and git graphs drawn at build time for both appearances
- **Publishing checks**: broken links and anchors reported on every build, with an option to stop on them
- **Docker and Nix**: Dockerfile and Nix flake for reproducible builds

## Planned

### Documentation experience

- **Incremental builds**: only re-render changed pages

### Agent surface

- **Hosted docs MCP transport**: the separate docs MCP package currently serves local builds over stdio; an authenticated hosted transport can build on the same generated files

### Ecosystem

- **VS Code extension**: live preview of sourcey docs while editing
- **Theme packages**: publishable themes as npm packages
