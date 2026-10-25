---
title: Migrating from MkDocs
description: Convert mkdocs.yml and its Markdown to a native Sourcey project, keeping every URL and anchor.
---

# Migrating from MkDocs

`sourcey migrate mkdocs` reads `mkdocs.yml` and `docs_dir` and writes a standalone Sourcey project next to them. Your Markdown stays where it is; only the syntax that needs a native form changes.

```bash
npx sourcey migrate mkdocs --dry-run
```

## Configuration

| MkDocs | Native Sourcey |
| --- | --- |
| `site_name`, `site_url` | `name`, `siteUrl` and, for a site below a path, `baseUrl` |
| `site_url: !ENV READTHEDOCS_CANONICAL_URL` (any `!ENV`) | the same variable, read when the native site builds |
| `repo_url`, `edit_uri` | `repo`, `editBranch`, `editBasePath`, and the repository link in `navbar.links` |
| `nav`, or the default navigation without one | navigation groups, nested sections and external links |
| Material `features: [navigation.tabs]` | a tab per top-level section |
| Material's collapsed sidebar sections (`navigation.sections`, `navigation.expand`) | `collapsed` groups, which open on the page they hold |
| Material frontmatter `hide: [navigation]`, or a page's own `template` | `layout: page`, the site's header and footer around the page; what has no native form (`hide: toc` alone, `feedback`, the template's HTML) is listed in the report |
| `use_directory_urls` | `prettyUrls` |
| `theme.logo`, `theme.favicon`, Material `palette.primary`, `font` | `logo`, `favicon`, `theme.colors`, `theme.fonts` |
| `copyright` | `footer.text` |
| Material `extra.social` | `footer.links`, where Material shows them; a link without a network's icon shows its `name`, or its host |
| `site_author`; Material `extra.analytics` with Google's `property`, or `provider: custom` and its `partials/integrations/analytics/custom.html` override | `components/Head.html`, which every page's head ends with: the author's `<meta>`, Google's tag, or the partial as written |
| `extra_javascript` | `components/BodyEnd.html`, where Material loads them, at the end of every page; a local script moves to `public/` and keeps its address |
| `mkdocs-redirects` `redirect_maps` | `redirects` |

Pages keep their URLs, including file names with capitals or underscores (`markdown({ slugs: "file" })`), and a `README.md` stays its directory's index. Where MkDocs built two files to one URL, the one it built last stays published and the report names the other. Pages that `nav` leaves out stay published, beside their nearest listed sibling and out of the menu. Heading anchors keep MkDocs's spelling. A page with no title or heading keeps the title MkDocs gave it from its nav label or file name. A `CHANGELOG.md` stays an ordinary page; remove `changelog: false` from the configuration to get native changelog pages and feeds.

With Material's navigation tabs, each top-level section becomes a native tab that publishes the folder its first page is in, so its pages keep their URLs; top-level pages are a tab at the docs root, which also keeps pages in no section's folder. A section that lists a page from another tab's folder links to it there, and the report names the page. When two sections start in the same folder, or no section starts at the root to keep the pages outside the others' folders, the sections stay top-level groups of one sidebar and the report says why.

MkDocs copies every other file in `docs_dir` to the site. Images and downloads a page uses are published with it. An HTML file is a page of its own, so it moves to `public/`, which native copies to the site root, and keeps its URL.

## Markdown extensions

Each conversion applies only when the extension is enabled in `mkdocs.yml`.

| Extension | Native form |
| --- | --- |
| `admonition` | `:::note[Title]` and the other callouts |
| `pymdownx.details` | `:::accordion[Title]` |
| `pymdownx.tabbed` | `:::tabs` with a `:::tab[Label]` per tab |
| GitHub alerts (`gh-admonitions`) | unchanged; native Markdown reads `> [!NOTE]` as written, and an indented alert becomes a callout |
| `pymdownx.snippets`, `markdown_include` | `<Include src>`; a fence holding only a snippet becomes a code include |
| `attr_list` | heading IDs as `{#id}`; classes and other attributes are reported and removed |
| `md_in_html` | the `markdown` attribute goes and the content is separated by blank lines |
| `pymdownx.emoji` icons, `pymdownx.inlinehilite` markers | removed and reported |
| `pymdownx.highlight` line options | native code fence metadata |

MkDocs leaves raw HTML alone and copies `docs_dir` to the site, so `<img src>` paths in HTML are relative to the page URL and `/images/...` paths reach the copied files. The migration points each of those at its file, so native output publishes it.

Python-Markdown and CommonMark read a few things differently. A line opening with `#` is a heading to MkDocs even without a space after the hashes; the migration adds the space. A non-web address in angle brackets, such as `hash<nlohmann::basic_json\>`, is text to MkDocs; the migration escapes it so it stays text.

Custom `extra_css` is listed in the report rather than copied, since Material's stylesheet variables have no native meaning. So are the theme's other template overrides in `custom_dir`: a [page part](../components.md#page-parts) in `components/`, or `pages/404.md` for the not-found page, draws their place. A `.readthedocs.yaml` that builds with MkDocs is named too: switch its build to `sourcey build`.

## What stops a migration

Plugins that generate content (`macros`, `awesome-pages`, `mkdocstrings`, `i18n`, `blog` and similar), a custom `toc` slugify, maths, and frontmatter that is not valid YAML stop the migration with the file and line. Fix or decide those once, then run it again.
