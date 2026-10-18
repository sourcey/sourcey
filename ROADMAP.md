# Roadmap

What's coming for Sourcey. Last updated: June 2026.

## Shipped

- **MCP server documentation**: tools, resources, prompts rendered as browsable reference with code samples
- **C++ and Doxygen**: feed Doxygen XML, get modern searchable API docs via moxygen
- **Go and Rust API docs**: native godoc and rustdoc adapters with live and snapshot modes
- **Built-in components in markdown**: fixed JSX-style components and directive syntax in `.md` / `.mdx` files
- **Directive components**: `:::note`, `:::warning`, `:::code-group`, `:::steps`, `:::tabs`, `::video`, `::iframe` in plain markdown
- **Changelog standardisation**: normalise `CHANGELOG.md`, render structured version cards, emit Atom/RSS feeds, include changelog pages in llms.txt
- **llms.txt generation**: auto-generate llms.txt and llms-full.txt alongside HTML output
- **Readable documentation and discovery**: per-page, operation and schema Markdown, a document index, public OpenAPI bundles, scoped ARD/API catalogs and an optional docs MCP server
- **Dark mode**: semantic design tokens, light/dark logo variants
- **Client-side search**: fuzzy search across all pages and API operations
- **Theme presets**: default, minimal, api-first layouts
- **Docker and Nix**: Dockerfile and Nix flake for reproducible builds

## Planned

### Documentation experience

- **Version switcher**: multiple doc versions with dropdown selector
- **Incremental builds**: only re-render changed pages
- **i18n**: multi-language documentation support

### API reference

- **API playground**: try-it-live requests with parameter inputs, auth, cURL export

### Agent surface

- **Hosted docs MCP transport**: the separate docs MCP package currently serves local builds over stdio; an authenticated hosted transport can build on the same generated files

### Ecosystem

- **VS Code extension**: live preview of sourcey docs while editing
- **Theme packages**: publishable themes as npm packages
