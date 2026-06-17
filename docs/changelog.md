---
title: Changelog
description: Recent Sourcey releases.
---

# Changelog

## 3.6.3

Sourcey 3.6.3 renders author-provided OpenAPI examples. Named `examples` and a single `example` on responses and request bodies now take priority over the schema-generated shape, every media type is shown rather than only the first, and a switcher moves between multiple examples.

## 3.6.2

Sourcey 3.6.2 fixed Rust re-export (`use` item) rendering so re-exports show their real name and a `pub use` signature instead of an empty placeholder across the sidebar, page outline, and search, and bumped moxygen to 2.1.10 for cleaner ` - ` separators in C++ reference search snippets.

## 3.6.1

Sourcey 3.6.1 added the native rustdoc adapter with nightly live extraction, snapshot mode for stable CI hosts, rustdoc-style deep links, doctest extraction, and workspace-level Rust API pages.

## 3.6.0

Sourcey 3.6.0 made source adapters the primary tab configuration shape (`source: markdown(...)`, `mkdocs(...)`, `openapi(...)`, `mcp(...)`, `doxygen(...)`, and `godoc(...)`), added MkDocs import for existing `mkdocs.yml` sites, and upgraded generated C++ references with member search, route-mapped source links, examples, modern signatures, inherited members, and relationship sections.

## 3.5.0

Sourcey 3.5.0 shipped OpenAPI 3.2 support, `$self`-aware reference resolution for multi-document descriptions, and the new `prettyUrls` output modes for cleaner hosted paths. It also refreshed the generated OG image template for better readability in link previews.

## 3.4.x

The 3.4 release line added build-time OG image generation, Heroicons support, MCP documentation as a first-class input, sitemap and social metadata, and a long sequence of rendering and developer-experience fixes.

The root `CHANGELOG.md` remains the detailed record. This page is the short view for docs readers who want the shape of recent releases before diving into the full changelog.
