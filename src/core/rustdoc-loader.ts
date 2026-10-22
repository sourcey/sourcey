import type { ResolvedRustdocConfig } from "../config.js";
import { tabPath } from "../site-url.js";
import { slugify } from "../utils/slug.js";
import type { MarkdownPage, PageHeading, PageSearchEntry } from "./markdown-loader.js";
import type { SiteTab, SiteNavGroup, SiteNavItem } from "./navigation.js";
import { runIntrospector, RustdocIntrospectorError } from "./rustdoc-introspector.js";
import { InputReader } from "./loader.js";
import type {
  CrateSpec,
  Doctest,
  ExternalCrateRef,
  Item,
  ModuleSpec,
  RustdocDiagnostic,
} from "./rustdoc-types.js";
import {
  itemAnchor,
  itemDisplayName,
  renderModulePage,
  renderModuleMarkdown,
  type RenderContext,
  type RustItemPage,
  rustItemPages,
  rustModuleSlug,
} from "./rustdoc-render.js";
import {
  extractFirstParagraph,
  renderCodeBlock,
  renderMarkdownInline,
  stripMarkdownLinks,
  DEFAULT_CALLOUTS,
  type CalloutRenderOptions,
} from "../utils/markdown.js";

export interface RustdocLoaderDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  crate?: string;
  file?: string;
  line?: number;
}

export interface RustdocLoaderResult {
  pages: Map<string, MarkdownPage>;
  navTab: SiteTab;
  diagnostics: RustdocLoaderDiagnostic[];
}

export interface RustdocSourceLinkOptions {
  repo?: string;
  editBranch?: string;
  editBasePath?: string;
}
const rendered = new WeakMap<import("./rustdoc-types.js").RustdocSpec, Map<string, RustdocLoaderResult>>();

/** Load a rustdoc tab from the configured manifest or snapshot. */
export async function loadRustdocTab(
  config: ResolvedRustdocConfig,
  tabSlug: string,
  tabLabel: string,
  sourceLinks: RustdocSourceLinkOptions = {},
  input = new InputReader(),
  callouts: CalloutRenderOptions = DEFAULT_CALLOUTS,
): Promise<RustdocLoaderResult> {
  let result;
  try {
    result = await runIntrospector({ config, input });
  } catch (err) {
    if (err instanceof RustdocIntrospectorError) {
      const pages = new Map<string, MarkdownPage>();
      pages.set(
        "index",
        emptyIndexPage(tabSlug, tabLabel, `Rustdoc introspection failed: ${err.message}`),
      );
      return {
        pages,
        navTab: emptyNavTab(tabSlug, tabLabel),
        diagnostics: [
          {
            severity: "error",
            code: err.code,
            message: err.message,
          },
        ],
      };
    }
    throw err;
  }

  const key = JSON.stringify([config, tabSlug, tabLabel, sourceLinks, callouts]);
  const entries = rendered.get(result.spec) ?? new Map<string, RustdocLoaderResult>();
  const cached = entries.get(key);
  if (cached) return { ...cached, navTab: structuredClone(cached.navTab) };

  const pages = new Map<string, MarkdownPage>();
  const navGroups: SiteNavGroup[] = [];
  const diagnostics: RustdocLoaderDiagnostic[] = result.diagnostics.map(toLoaderDiagnostic);

  const allDoctests: Array<{ crate: CrateSpec; item: Item; doctest: Doctest }> = [];

  for (const crate of result.spec.crates) {
    const crateItems = itemsAsMap(crate.items);
    const itemPages = rustItemPages(crate, crateItems);
    for (const module of crate.modules) {
      const renderDiagnostics: RustdocDiagnostic[] = [];
      const page = renderModulePageLoader(
        crate,
        module,
        crateItems,
        itemPages,
        tabSlug,
        sourceLinks,
        renderDiagnostics,
        callouts,
      );
      pages.set(page.slug, page);
      for (const d of renderDiagnostics) diagnostics.push(toLoaderDiagnostic(d));
    }

    const indexPage = renderCrateIndexPage(crate, tabSlug);
    pages.set(indexPage.slug, indexPage);

    for (const item of crateItems.values()) {
      for (const dt of item.doctests) {
        allDoctests.push({ crate, item, doctest: dt });
      }
    }

    navGroups.push(buildCrateNavGroup(crate));
  }

  if (config.doctestsIndex && allDoctests.length > 0) {
    const dtPage = renderDoctestsIndexPage(allDoctests);
    pages.set(dtPage.slug, dtPage);
    navGroups.unshift({
      label: "Examples",
      items: [
        {
          label: "Doctests",
          href: "",
          id: "doctests",
          documentId: dtPage.slug,
        } satisfies SiteNavItem,
      ],
    });
  }

  if (result.spec.crates.length === 0) {
    pages.set("index", emptyIndexPage(tabSlug, tabLabel, "No documented crates."));
  } else {
    pages.set("index", renderWorkspaceIndexPage(result.spec.crates, tabSlug, tabLabel));
  }

  const navTab: SiteTab = {
    label: tabLabel,
    slug: tabSlug,
    href: "",
    documentId: "index",
    kind: "docs",
    groups: navGroups,
  };

  const output = { pages, navTab, diagnostics };
  entries.set(key, output); rendered.set(result.spec, entries);
  if (entries.size > 32) entries.delete(entries.keys().next().value!);
  return { ...output, navTab: structuredClone(navTab) };
}

function renderModulePageLoader(
  crate: CrateSpec,
  module: ModuleSpec,
  itemsById: Map<string, Item>,
  itemPages: ReadonlyMap<string, RustItemPage>,
  tabSlug: string,
  sourceLinks: RustdocSourceLinkOptions,
  diagnostics: RustdocDiagnostic[],
  callouts: CalloutRenderOptions,
): MarkdownPage {
  const slug = rustModuleSlug(crate.name, module.path);
  const title = module.path.length === 0 ? crate.name : module.path.join("::");
  const description = moduleSummary(module.docs_markdown);
  const items: Item[] = module.item_ids
    .map((id) => itemsById.get(id))
    .filter((i): i is Item => Boolean(i));

  const headings = collectHeadings(items);
  const searchEntries = collectSearchEntries(items, title);
  const ctx = buildRenderContext(crate, itemsById, itemPages, tabSlug, sourceLinks, diagnostics, callouts);
  const rendered = renderModulePage(module, items, ctx);
  const html = rendered.html;

  return {
    kind: "markdown",
    title,
    description,
    // The body renders the module's docs in full, so the summary is a repeat.
    hideLede: Boolean(description),
    slug,
    html,
    markdown: renderModuleMarkdown(module, items, ctx),
    headings,
    sourcePath: `rustdoc/${slug}.md`,
    editPath: module.source ? module.source.file : null,
    editBasePath: sourceLinks.editBasePath ?? "",
    searchEntries,
  };
}

function renderWorkspaceIndexPage(
  crates: CrateSpec[],
  tabSlug: string,
  tabLabel: string,
): MarkdownPage {
  const headings: PageHeading[] = [];
  const searchEntries: PageSearchEntry[] = [];
  const cards = crates.map((c) => {
    const href = pageHref(tabSlug, crateIndexSlug(c.name));
    const items = Object.keys(c.items).length;
    const modules = c.modules.length;
    const summary = `${items} item${items === 1 ? "" : "s"} across ${modules} module${modules === 1 ? "" : "s"}.`;
    const version = c.version
      ? `<p class="card-item-meta">v${escapeHtml(c.version)}</p>`
      : "";
    headings.push({ id: crateIndexSlug(c.name), text: c.name, level: 2 });
    searchEntries.push({
      title: c.name,
      content: summary,
      anchor: crateIndexSlug(c.name),
      category: "rust crate",
      qualifiedName: c.name,
    });
    return (
      `<a class="card-item" href="${escapeHtml(href)}" id="${crateIndexSlug(c.name)}">` +
      `<div class="card-item-inner">` +
      `<h2 class="card-item-title">${escapeHtml(c.name)}</h2>` +
      `<div class="card-item-content"><p>${escapeHtml(summary)}</p>${version}</div>` +
      `</div></a>`
    );
  });
  const cols = cards.length <= 2 ? "2" : "3";
  return {
    kind: "markdown",
    title: tabLabel,
    description: `Rust API across ${crates.length} crate${crates.length === 1 ? "" : "s"}.`,
    slug: "index",
    html: `<div class="card-group not-prose" data-cols="${cols}">\n${cards.join("\n")}\n</div>`,
    markdown: crates
      .map(
        (crate) =>
          `- [${crate.name}](${pageHref(tabSlug, crateIndexSlug(crate.name))})${crate.version ? ` (${crate.version})` : ""}`,
      )
      .join("\n"),
    headings,
    sourcePath: `rustdoc/index.md`,
    searchEntries,
  };
}

function renderCrateIndexPage(crate: CrateSpec, tabSlug: string): MarkdownPage {
  const slug = crateIndexSlug(crate.name);
  const moduleCount = crate.modules.length;
  const itemCount = Object.keys(crate.items).length;
  const description = `Rust API for ${crate.name} (${itemCount} items across ${moduleCount} modules).`;
  const headings: PageHeading[] = [];
  const cards = [...crate.modules]
    .sort((a, b) => a.path.join("::").localeCompare(b.path.join("::")))
    .map((m) => {
      const mSlug = rustModuleSlug(crate.name, m.path);
      const href = pageHref(tabSlug, mSlug);
      const label = m.path.length === 0 ? `${crate.name} (root)` : m.path.join("::");
      const count = m.item_ids.length;
      const lead = moduleSummary(m.docs_markdown);
      const meta = `<p class="card-item-meta">${count} item${count === 1 ? "" : "s"}</p>`;
      headings.push({ id: mSlug, text: label, level: 2 });
      return (
        `<a class="card-item" href="${escapeHtml(href)}" id="${mSlug}">` +
        `<div class="card-item-inner">` +
        `<h2 class="card-item-title">${escapeHtml(label)}</h2>` +
        `<div class="card-item-content">${lead ? `<p>${renderMarkdownInline(lead)}</p>` : ""}${meta}</div>` +
        `</div></a>`
      );
    });
  const html =
    cards.length === 0
      ? `<p>${escapeHtml(description)}</p>`
      : `<div class="card-group not-prose" data-cols="${cards.length <= 2 ? "2" : "3"}">\n${cards.join("\n")}\n</div>`;
  return {
    kind: "markdown",
    title: crate.name,
    description,
    slug,
    html,
    headings,
    sourcePath: `rustdoc/${slug}.md`,
    markdown: crate.modules
      .map(
        (module) =>
          `- [${module.path.join("::") || crate.name}](${pageHref(tabSlug, rustModuleSlug(crate.name, module.path))})`,
      )
      .join("\n"),
  };
}

function renderDoctestsIndexPage(
  doctests: Array<{ crate: CrateSpec; item: Item; doctest: Doctest }>,
): MarkdownPage {
  const headings: PageHeading[] = [];
  const searchEntries: PageSearchEntry[] = [];
  const parts: string[] = [];
  parts.push(`<section class="rust-doctests-index">`);
  parts.push(`<p>${doctests.length} runnable example${doctests.length === 1 ? "" : "s"}.</p>`);
  for (const { crate, item, doctest } of doctests) {
    const parentPath = item.path.join("::");
    const anchor = `doctest-${itemAnchor(item)}-${doctest.ordinal}`;
    headings.push({ id: anchor, text: parentPath, level: 2 });
    searchEntries.push({
      title: `Doctest: ${parentPath}`,
      content: doctest.display_code.slice(0, 200),
      anchor,
      category: "rust doctest",
      ownerKind: itemKindLabel(item),
      owner: parentPath,
      namespace: crate.name,
    });
    parts.push(
      `<section class="rust-doctest" id="${anchor}"><h2>${escapeHtml(parentPath)}</h2>` +
        renderDoctestBadges(doctest) +
        renderCodeBlock(doctest.display_code, "rust") +
        `</section>`,
    );
  }
  parts.push(`</section>`);
  return {
    kind: "markdown",
    title: "Doctests",
    description: `Aggregated doctests across the workspace.`,
    slug: "doctests",
    html: parts.join("\n"),
    markdown: doctests
      .map(
        ({ item, doctest }) =>
          `## ${item.path.join("::")}\n\n\`\`\`rust\n${doctest.display_code}\n\`\`\``,
      )
      .join("\n\n"),
    headings,
    sourcePath: `rustdoc/doctests.md`,
    searchEntries,
  };
}

function buildRenderContext(
  crate: CrateSpec,
  itemsById: Map<string, Item>,
  itemPages: ReadonlyMap<string, RustItemPage>,
  tabSlug: string,
  sourceLinks: RustdocSourceLinkOptions,
  diagnostics: RustdocDiagnostic[] = [],
  callouts: CalloutRenderOptions = DEFAULT_CALLOUTS,
): RenderContext {
  const externalCrates = new Map<number, ExternalCrateRef>();
  for (const ec of crate.external_crates) externalCrates.set(ec.crate_id, ec);
  return {
    crate,
    itemsById,
    externalCrates,
    tabSlug,
    itemPages,
    callouts,
    sourceLinks: {
      repo: sourceLinks.repo,
      editBranch: sourceLinks.editBranch,
      editBasePath: sourceLinks.editBasePath,
    },
    diagnostics,
  };
}

function signatureForItem(item: Item): string | null {
  switch (item.inner.kind) {
    case "function":
      return item.inner.signature.display;
    case "struct":
      return `struct ${item.path.join("::")}`;
    case "enum":
      return `enum ${item.path.join("::")}`;
    case "trait":
      return `trait ${item.path.join("::")}`;
    case "type_alias":
      return `type ${item.path.join("::")} = ${item.inner.aliased_type.display}`;
    case "constant":
      return `const ${item.path.join("::")}: ${item.inner.type_display}`;
    case "static":
      return `static ${item.path.join("::")}: ${item.inner.type_display}`;
    case "macro":
      return `macro_rules! ${item.name ?? ""}`;
    case "proc_macro":
      return `#[${item.inner.macro_kind === "derive" ? "derive" : "proc_macro"}] ${item.name ?? ""}`;
    case "use":
      return item.inner.is_glob
        ? `pub use ${item.inner.source}::*;`
        : `pub use ${item.inner.source};`;
    default:
      return item.name ? item.path.join("::") : null;
  }
}

function itemKindLabel(item: Item): string {
  switch (item.inner.kind) {
    case "function":
      return "rust function";
    case "struct":
      return "rust struct";
    case "enum":
      return "rust enum";
    case "variant":
      return "rust variant";
    case "union":
      return "rust union";
    case "trait":
      return "rust trait";
    case "trait_alias":
      return "rust trait alias";
    case "impl":
      return "rust impl";
    case "type_alias":
      return "rust type alias";
    case "constant":
      return "rust constant";
    case "static":
      return "rust static";
    case "macro":
      return "rust macro";
    case "proc_macro":
      return "rust proc-macro";
    case "assoc_type":
      return "rust associated type";
    case "assoc_const":
      return "rust associated constant";
    case "module":
      return "rust module";
    case "use":
      return "rust re-export";
    case "struct_field":
      return "rust struct field";
    case "primitive":
      return "rust primitive";
    case "extern_type":
      return "rust extern type";
  }
}

function collectHeadings(items: Item[]): PageHeading[] {
  return items
    .map((i) => ({
      id: itemAnchor(i),
      text: itemDisplayName(i),
      level: 3 as const,
    }))
    .filter((heading) => heading.text);
}

function collectSearchEntries(items: Item[], moduleTitle: string): PageSearchEntry[] {
  const out: PageSearchEntry[] = [];
  for (const item of items) {
    const name = itemDisplayName(item);
    if (!name) continue;
    const sig = signatureForItem(item) ?? name;
    const docs = item.docs_markdown ?? "";
    const anchor = itemAnchor(item);
    out.push({
      title: `${itemKindLabel(item).replace("rust ", "")} ${name}`,
      content: `${sig}\n${docs}`.slice(0, 500),
      anchor,
      category: itemKindLabel(item),
      symbolKind: item.inner.kind,
      qualifiedName: item.path.join("::"),
      namespace: moduleTitle,
    });
    for (const alias of item.doc_aliases) {
      out.push({
        title: alias,
        content: `Alias for ${item.path.join("::")}`,
        anchor,
        category: itemKindLabel(item),
        symbolKind: item.inner.kind,
        qualifiedName: item.path.join("::"),
        namespace: moduleTitle,
      });
    }
  }
  return out;
}

function buildCrateNavGroup(crate: CrateSpec): SiteNavGroup {
  const items: SiteNavItem[] = [];
  items.push({
    label: "Overview",
    href: "",
    id: crateIndexSlug(crate.name),
    documentId: crateIndexSlug(crate.name),
  });
  for (const module of [...crate.modules].sort((a, b) =>
    a.path.join("::").localeCompare(b.path.join("::")),
  )) {
    const slug = rustModuleSlug(crate.name, module.path);
    items.push({
      label: module.path.length === 0 ? crate.name : module.path.join("::"),
      href: "",
      id: slug,
      documentId: slug,
    });
  }
  return {
    label: crate.name,
    items,
  };
}

function toLoaderDiagnostic(d: RustdocDiagnostic): RustdocLoaderDiagnostic {
  return {
    severity: d.severity,
    code: d.code,
    message: d.message,
    crate: d.crate_name ?? undefined,
    file: d.file ?? undefined,
    line: d.line ?? undefined,
  };
}

function emptyIndexPage(slug: string, title: string, message: string): MarkdownPage {
  return {
    kind: "markdown",
    title,
    description: message,
    slug: "index",
    html: `<section class="rust-empty"><p>${escapeHtml(message)}</p></section>`,
    markdown: message,
    headings: [],
    sourcePath: `rustdoc/${slug}.md`,
  };
}

function emptyNavTab(tabSlug: string, tabLabel: string): SiteTab {
  return {
    label: tabLabel,
    slug: tabSlug,
    href: "",
    documentId: "index",
    kind: "docs",
    groups: [],
  };
}

function crateIndexSlug(crateName: string): string {
  return `pkg-${slugify(crateName)}`;
}

/**
 * A page's link in the tab, tab-relative like every generated page link: the site's link
 * pass gives it the address the page is written to.
 */
function pageHref(tabSlug: string, slug: string): string {
  return tabPath(tabSlug, `${slug}.html`);
}

/**
 * A module's summary: its first paragraph of prose, without badges or images.
 * The summary renders away from the module's intra-doc links, so their
 * brackets drop and the label stays.
 */
function moduleSummary(markdown: string | null | undefined): string {
  return stripMarkdownLinks(extractFirstParagraph(markdown ?? "")).replace(
    /\[([^[\]\n]+)\](?:\[[^[\]\n]*\])?(?![(:])/g,
    "$1",
  );
}

function itemsAsMap(items: Record<string, Item> | Item[]): Map<string, Item> {
  const map = new Map<string, Item>();
  if (Array.isArray(items)) {
    for (const item of items) map.set(item.id, item);
  } else {
    for (const [id, item] of Object.entries(items)) map.set(id, item);
  }
  return map;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDoctestBadges(dt: Doctest): string {
  if (dt.fence_attributes.length === 0) return "";
  const badges = dt.fence_attributes
    .map((a) => `<span class="rust-doctest-badge">${escapeHtml(a)}</span>`)
    .join(" ");
  return `<div class="rust-doctest-badges">${badges}</div>`;
}

// Search-category sentinel constants so ac2_5 can grep for "rust function"
// and friends even before Phase 3 rendering lands. These are the same string
// values used by `itemKindLabel`. Kept here so future search-indexer changes
// have a single reference point.
export const RUST_SEARCH_CATEGORIES = [
  "rust function",
  "rust method",
  "rust struct",
  "rust enum",
  "rust trait",
  "rust trait alias",
  "rust type alias",
  "rust constant",
  "rust static",
  "rust macro",
  "rust proc-macro",
  "rust associated type",
  "rust associated constant",
  "rust module",
  "rust doctest",
  "rust re-export",
  "rust variant",
  "rust struct field",
  "rust union",
  "rust impl",
  "rust primitive",
  "rust extern type",
] as const;
