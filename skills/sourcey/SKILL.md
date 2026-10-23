---
name: sourcey
description: Build, migrate and review documentation sites with Sourcey, the open-source static docs generator for Markdown guides, OpenAPI and MCP references, Doxygen, Go and Rust. Use when creating a docs site, moving one from Docusaurus, MkDocs, Mintlify or Astro (Starlight), adding an API or MCP reference, editing sourcey.config.ts, or checking a Sourcey site before it ships.
---

# Sourcey

Sourcey turns a project's own sources into a static documentation site: Markdown guides, OpenAPI 2.0 to 3.2 specs, MCP server snapshots, Doxygen XML, Go packages and Rust crates. The build runs locally and the output is plain HTML that any static host serves.

The standard to hold: documentation the project's maintainers would stand behind, built from their own material, that reads as if someone who cares designed it. A site that builds is where the work starts. Before calling a site done, review it as a reader would ([references/design-review.md](references/design-review.md)).

## Pick the path

| Situation | Start with |
| --- | --- |
| A project with no docs site | `npx sourcey init` |
| A Docusaurus, MkDocs, Mintlify or Astro site | `npx sourcey migrate <framework> --dry-run` |
| One OpenAPI spec, to see it rendered | `npx sourcey build openapi.yaml` |
| An existing Sourcey project | edit `sourcey.config.ts`, run `npx sourcey dev` |

Sourcey needs Node 20 or later. Install it in the project (`npm install sourcey`) so CI builds the same version, or use `npx sourcey` for one-off runs. Homebrew (`brew install sourcey/tap/sourcey`), Docker (`sourcey/sourcey`) and Nix are also supported.

## Commands

| Command | Does |
| --- | --- |
| `sourcey init` | Asks for a docs directory, name and theme, finds OpenAPI specs and a Doxyfile, and writes a starter project |
| `sourcey migrate <astro\|mkdocs\|docusaurus\|mintlify> [root]` | Converts a docs project to native Sourcey once. `--dry-run` prints the report and diff and writes nothing; `--mapping <file>` supplies decisions the converter cannot infer |
| `sourcey dev` | Live preview on port 4400 (`-p`), reloading on config and content edits; `--host 0.0.0.0` inside a container |
| `sourcey build [spec]` | Writes the site to `dist` (`-o`). With a spec path it builds that spec alone, without a config. `-c` names the config file or its directory |
| `sourcey check` | Compiles the inputs and checks routes, reference fragments and output collisions without writing a site |
| `sourcey validate <spec>` | Validates an OpenAPI spec |
| `sourcey godoc` | Snapshots a Go module's documentation to `godoc.json`, for hosts without Go |

Build warnings print to stderr. Read every one: each names a page or reference that a reader will meet in a worse state than it should be.

## Starting a new project

`sourcey init` writes `sourcey.config.ts` and a few pages. Then shape it:

```ts
import { defineConfig, markdown, openapi, mcp } from "sourcey";

export default defineConfig({
  name: "Acme",                                   // the product's name, as the header shows it
  siteUrl: "https://docs.acme.dev",               // canonical links, sitemap, social cards
  logo: { light: "./brand/logo.svg", dark: "./brand/logo-dark.svg" },
  favicon: "./brand/favicon.svg",
  repo: "https://github.com/acme/acme",           // with editBranch, gives each page "Edit this page"
  editBranch: "main",
  prettyUrls: "slash",
  theme: { colors: { primary: "#4f46e5" } },
  navbar: { links: [{ type: "github", href: "https://github.com/acme/acme" }] },
  footer: { text: "© Acme Ltd.", links: [{ type: "discord", href: "https://discord.gg/acme" }] },
  navigation: {
    tabs: [
      { tab: "Docs", slug: "", source: markdown({ groups: [
        { group: "Get started", pages: ["index", "quickstart", "authentication"] },
        { group: "Guides", pages: ["guides/webhooks", "guides/errors"] },
      ] }) },
      { tab: "API Reference", slug: "api", source: openapi("./openapi.yaml") },
      { tab: "MCP Reference", slug: "mcp", source: mcp("./mcp.json") },
    ],
  },
});
```

Pages are Markdown resolved from the config's folder (`"quickstart"` is `quickstart.md`), with `title` and `description` frontmatter. Callouts (`:::note[Title]`), tabs, steps, cards, accordions, fields, includes, figures and Mermaid diagrams are built in ([components](https://github.com/sourcey/sourcey/blob/main/docs/components.md)). Card and inline icons are names from the site's icon set, Heroicons by default (`book-open`, `rocket-launch`, `key`); a name the set lacks stops the build, so use the set's exact names.

Themes: `default`, `api-first` (full width, operations in two columns), `minimal` and `reader` (editorial, for specifications). Set `theme.name`, `theme.colors.primary`, and `theme.fonts` (a Google Fonts family, or `"system"`).

## Migrating an existing site

`sourcey migrate` reads the old configuration and content as source, never running the old build, proposes the native config and the content edits, builds the result in a temporary copy, and writes only if every route the old site published is still published, every heading anchor resolves, all prose and code are present and every local image resolves. It never installs packages and never commits.

1. Run it with `--dry-run` and read the whole report. Errors name the file and line and the decision that resolves them; review notes are changes worth a look.
2. Resolve errors in the source, or once in a `--mapping` file (custom components, custom documentation routes, pages to retire). Run again.
3. Run it for real, then `npx sourcey dev`, and compare the new site with the old one page type by page type.
4. Keep the converter's output as written in `sourcey.config.ts`. Where a project needs more, import the converted config into your own and add to it rather than editing generated tables by hand.

Framework specifics, what each converts and what stops it: [references/migrating.md](references/migrating.md).

## API and MCP references

An OpenAPI or MCP tab publishes in one of three shapes. Leave `reference.split` unset and Sourcey chooses by size, printing which it chose:

| Shape | `reference.split` | Chosen when |
| --- | --- | --- |
| One page | `false` | The reference holds at most 50 operations and 1,000 field rows |
| A page per section (an OpenAPI tag, an MCP group) | `"sections"` | It has several sections and each fits those limits |
| A page per operation | `"operations"` | Otherwise: large APIs, or operations carrying large schemas |

Set `reference.split` only to override the choice. Split references also get a page per model and an overview listing the sections, or every operation when split by operation. `reference.operations: "{operationId}"` gives each operation a permanent address that follows it whatever the shape. The build warns when one page is forced to hold more than 100 operations, and when a split by section has only one section.

**MCP.** Capture the server's tools, resources and prompts with `npx mcp-parser snapshot --stdio "node server.js" -o mcp.json` (or `--http <url>`, `--sse <url>`), and commit the snapshot. Add a `description` to it for the overview and a `transport` the reader's client can run. Without groups, sections are the kinds: Tools, Resources, Prompts. A server of more than a handful of tools deserves the groups its authors use, which usually mirror how its source registers them:

```ts
source: mcp({
  spec: "./mcp.json",
  groups: {
    Authentication: ["login", "logout"],
    Invoices: ["get_invoices", "create_invoice", "update_invoice"],
  },
}),
```

Never invent groups from name patterns: if the source has no grouping, leave the kinds.

**OpenAPI.** Sections are the spec's tags, in its order. Keep editorial copy (summaries, descriptions, tag text) in an OpenAPI Overlay beside a generated spec rather than editing the spec: `openapi({ spec: "./openapi.json", overlays: ["./reference.overlay.yaml"] })`. Give every operation a `summary`: it is the operation's name in the sidebar, its page and search.

## Writing the content

- Build every page from the project's evidence: its README, existing docs, specs and code. Keep its terms, voice and priorities.
- Fewer pages with substance beat many generic ones. Each page should make a real task easier: install, evaluate, integrate, operate, contribute.
- Never frame the docs as generated, migrated, a preview or a demo, unless the project itself does.
- Where the evidence is too thin for a page, say what is missing rather than writing confident filler.
- Do not hand-write API reference pages when a spec or snapshot exists; render it, and put guidance in guides that link to operations (`[List keys](<operation:GET /keys>)`).

## Making it look right

Every element must tell the reader something. Before shipping, hold the site to these:

- **Nothing said twice.** A label on every row that the section heading already states, a line under a title that repeats the title, a footer link to a page the sidebar lists: remove them. Sourcey's defaults follow this; config you write can still break it.
- **No navigation that says nothing.** No sidebar group holding only the current page, no list of one section, no tab that leads nowhere new.
- **Names fit their place.** `name` is what the header shows beside the logo: the product's name ("Argo CD"), never a site title with a tagline. A logo set as a wordmark should not also carry the name (`logo.mark: true` only for a mark without the name).
- **Structure from the source.** Navigation follows the project's own structure. Do not reorder or regroup what the project already arranged.
- **The footer is for identity and outward links:** a copyright line, then places the header and sidebar do not already lead to (community, website, demo). Social networks are typed links (`github`, `discord`, `twitter`, `mastodon`, `bluesky`, ...) and draw as icons.
- **Assets render as their owner designed them.** An SVG logo that sets its text in a web font cannot load that font as an image and falls back to another face, which can cut the word off. Check the logo at 3x in light and dark; if it does, draw the text as outlines in its own font.

The full review procedure, with what to capture and measure: [references/design-review.md](references/design-review.md).

## Ship it

- Keep source and output apart: authored pages, config and assets are committed; the built site (`dist`) is not. Gitignore it.
- CI or the host runs `npx sourcey build` from committed source. Never author or revise content at deploy time.
- Any static host works. Cloudflare Pages and Netlify read the generated `_redirects`; elsewhere, the HTML fallback pages redirect. Configure the host to serve `404.html` with status 404.
- In an Astro site, mount the docs with the integration instead of a prebuild step:

```ts
import { defineConfig } from "astro/config";
import sourcey from "sourcey/astro";

export default defineConfig({
  site: "https://example.com",
  integrations: [sourcey({ config: "./docs/sourcey.config.ts", routeBase: "/docs" })],
});
```

- Publish under a durable home the project owns, never a throwaway or personal domain.

## Build warnings

A line naming each reference's chosen shape is information, not a warning.

| Warning | Means | Fix |
| --- | --- | --- |
| `long-page` | `reference.split: false` holds more than 100 operations on one page | Remove it and let Sourcey choose, or name a split |
| `one-section` | A split by section with one section | Group the MCP server, tag the API, or split by operation |
| `mcp-ungrouped` | Entries no MCP group lists, shown by kind after the groups | Add them to their groups |
| `missing-description` | Pages with no summary of their own | Add `description` frontmatter, or a spec `description` |
| `broken-fragment` | A link to an anchor the target page lacks | Fix the link or the heading |
| `anchor-unmatched` | An imported fragment alias names nothing | Remove the alias, or set `anchorUnmatched` deliberately |

Reference: [configuration](https://github.com/sourcey/sourcey/blob/main/docs/configuration.md), [components](https://github.com/sourcey/sourcey/blob/main/docs/components.md), [migrating](https://github.com/sourcey/sourcey/blob/main/docs/migrating.md), [machine-readable exports](https://github.com/sourcey/sourcey/blob/main/docs/machine-readable.md).
