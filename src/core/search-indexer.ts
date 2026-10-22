import type { MediaTypeContent, NormalizedOperation, NormalizedParameter, NormalizedSchema, NormalizedSpec } from "./types.js";
import type { ChangelogPage, DocsPage, MarkdownPage } from "./markdown-loader.js";
import { isMainChangelogPage, type SitePage } from "./site-model.js";
import { readingOrder, type SiteNavigation } from "./navigation.js";
import type { PrettyUrls } from "../site-url.js";
import { toPublicPath } from "../site-url.js";
import { tabIndexOutputPath } from "../config.js";
import { operationAnchor, definitionAnchor } from "./reference-identity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchEntry {
  /** Display title */
  title: string;
  searchText?: string;
  /** Plain text excerpt for display in results */
  content: string;
  /** Relative URL to the page (+ optional anchor) */
  url: string;
  /** HTTP method for API operations */
  method?: string;
  /** API path for operations */
  path?: string;
  /** Tab this entry belongs to */
  tab: string;
  /** Category for grouping results */
  category: string;
  /** Its place among the rows search opens on, before anything is typed. */
  start?: number;
  /** Source adapter symbol kind, e.g. C++ function, enumvalue, typedef */
  symbolKind?: string;
  /** Owning symbol, e.g. icy::Application */
  owner?: string;
  /** Owning symbol kind, e.g. class, struct, enum */
  ownerKind?: string;
  /** Namespace for source languages that expose one */
  namespace?: string;
  /** Fully qualified symbol name */
  qualifiedName?: string;
}

/** A document and the URL assigned by the compiled route inventory. */
export interface SearchDocument {
  page: DocsPage;
  url: string;
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

/** Searchable pages by the tab that owns them; a site page's owner is its language's site pages. */
export function searchDocuments(pages: Iterable<SitePage>): Map<string, SearchDocument[]> {
  const documents = new Map<string, SearchDocument[]>();
  for (const page of pages) {
    if (page.status === 404 || !isSearchablePage(page)) continue;
    const tabPages = documents.get(page.tabSlug) ?? [];
    tabPages.push({ page: page.currentPage.kind === "markdown" ? page.currentPage.markdown : page.currentPage.changelog, url: page.publicPath! });
    documents.set(page.tabSlug, tabPages);
  }
  return documents;
}

/** A page searched as a document: one drawn from Markdown, or a changelog's own page. */
function isSearchablePage(page: SitePage): page is SitePage & { currentPage: { kind: "markdown"; markdown: MarkdownPage } | { kind: "changelog"; changelog: ChangelogPage } } {
  return page.currentPage.kind === "markdown" || isMainChangelogPage(page);
}

/**
 * Build a search index from specs and markdown pages.
 * Keep semantic rows typed until the output boundary serializes them.
 */
export function buildSearchIndex(
  specs: Map<string, NormalizedSpec>,
  pages: Map<string, SearchDocument[]>,
  navigation: SiteNavigation,
  assetBase = "/",
  featuredSlugs: string[] = [],
  prettyUrls: PrettyUrls = false,
  targets?: Map<string, import("./site-model.js").ReferenceTargets>,
): SearchEntry[] {
  const base = assetBase.endsWith("/") ? assetBase : assetBase + "/";
  const featuredSet = new Set(featuredSlugs);
  const entries: SearchEntry[] = [];
  const owners = new Map<SearchEntry, string>();
  const featured: SearchEntry[] = [];
  function add(tabSlug: string, entry: SearchEntry): void {
    entries.push(entry);
    owners.set(entry, tabSlug);
  }

  // Index OpenAPI specs
  for (const [tabSlug, spec] of specs) {
    const tab = navigation.tabs.find((t) => t.slug === tabSlug);
    const tabLabel = tab?.label ?? tabSlug;
    const tabBase = toPublicPath(tabIndexOutputPath(tabSlug, prettyUrls), base, prettyUrls);

    // The reference's own page, titled as it is: an MCP server's by its tab.
    const mcp = spec.operations.some((op) => op.mcpExtras?.connection);
    add(tabSlug, {
      title: mcp ? tabLabel : spec.info.title,
      content: (spec.info.summary ?? spec.info.description ?? "").slice(0, 200),
      searchText: [spec.info.title, spec.info.summary, spec.info.description].filter(Boolean).join(" "),
      url: targets?.get(tabSlug)?.overview.href ?? tabBase,
      tab: tabLabel,
      category: "Pages",
    });

    // Operations
    for (const op of spec.operations) {
      if (op.hidden) continue;
      add(tabSlug, {
        title: op.summary ?? `${op.method.toUpperCase()} ${op.path}`,
        content: op.description?.slice(0, 200) ?? "",
        searchText: referenceSearchText(op),
        url: targets?.get(tabSlug)?.operations[`${op.method.toUpperCase()} ${op.path}`]?.href ?? `${tabBase}#${operationAnchor(op, spec)}`,
        method: op.method,
        path: op.path,
        tab: tabLabel,
        category: op.mcpExtras
          ? ({ tool: "Tools", resource: "Resources", prompt: "Prompts" } as const)[op.mcpExtras.type]
          : "Endpoints",
      });
    }

    // Schemas
    for (const name of Object.keys(spec.schemas)) {
      add(tabSlug, {
        title: name,
        content: spec.schemas[name].description?.slice(0, 200) ?? "",
        searchText: referenceSearchText(spec.schemas[name]),
        url: targets?.get(tabSlug)?.schemas[name]?.href ?? `${tabBase}#${definitionAnchor(name, spec)}`,
        tab: tabLabel,
        category: "Models",
      });
    }
  }

  // Index markdown pages; a site page belongs to no tab.
  for (const [tabSlug, tabPages] of pages) {
    const tab = navigation.tabs.find((t) => t.slug === tabSlug);
    const tabLabel = tab?.label ?? "";

    for (const { page, url: href } of tabPages) {
      const entry: SearchEntry = {
        title: page.title,
        searchText: page.kind === "markdown" ? page.readerMarkdown ?? page.markdown : summarizeChangelog(page),
        content: page.kind === "markdown"
          ? page.description || stripHtml(page.html).slice(0, 200)
          : page.description || summarizeChangelog(page).slice(0, 200),
        url: href,
        tab: tabLabel,
        category: "Pages",
      };
      add(tabSlug, entry);
      if (featuredSet.has(page.slug)) featured.push(entry);

      if (page.kind === "markdown") {
        for (const heading of page.headings) {
          add(tabSlug, {
            title: heading.text,
            content: `${page.title} - ${heading.text}`,
            url: `${href}#${heading.id}`,
            tab: tabLabel,
            category: "Sections",
          });
        }
        for (const entry of page.searchEntries ?? []) {
          add(tabSlug, {
            title: entry.title,
            content: entry.content.slice(0, 500),
            url: entry.anchor ? `${href}#${entry.anchor}` : href,
            tab: tabLabel,
            category: entry.category,
            ...(entry.symbolKind && { symbolKind: entry.symbolKind }),
            ...(entry.owner && { owner: entry.owner }),
            ...(entry.ownerKind && { ownerKind: entry.ownerKind }),
            ...(entry.namespace && { namespace: entry.namespace }),
            ...(entry.qualifiedName && { qualifiedName: entry.qualifiedName }),
          });
        }
      } else {
        for (const version of page.changelog.versions) {
          add(tabSlug, {
            title: version.version ?? "Unreleased",
            content: summarizeVersion(version).slice(0, 200),
            url: `${href}#${version.id}`,
            tab: tabLabel,
            category: "Releases",
          });
        }
      }
    }
  }

  markOpenings(entries, owners, featured, navigation);
  return entries;
}

/** The rows each section of the site opens search with, after its featured pages. */
const OPENINGS_PER_TAB = 5;

/**
 * Number the rows search opens on, before anything is typed: featured pages,
 * then for each tab, in turn across its sections, the first page or operation
 * of each, so a reader sees where every part of the site starts. A reference
 * starts at its overview; models are left to search.
 */
function markOpenings(entries: SearchEntry[], owners: Map<SearchEntry, string>, featured: SearchEntry[], navigation: SiteNavigation): void {
  const byUrl = new Map<string, SearchEntry>();
  for (const entry of entries) if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  let rank = 0;
  const mark = (entry: SearchEntry) => { entry.start ??= rank++; };
  // A site page belongs to no tab, so a featured one leads.
  for (const entry of featured) if (!navigation.tabs.some((tab) => tab.slug === owners.get(entry))) mark(entry);
  for (const tab of navigation.tabs) {
    for (const entry of featured) if (owners.get(entry) === tab.slug) mark(entry);
    // A row that would only repeat the tab's name, under that name, is left to search.
    const opening = (href: string) => {
      const entry = byUrl.get(href);
      return entry && owners.get(entry) === tab.slug && entry.category !== "Models" && entry.title !== tab.label ? [entry] : [];
    };
    const sections = tab.groups.map((group) => [...readingOrder([group])].flatMap(opening));
    // The page the tab leads to comes first, when no section lists it.
    const [landing] = opening(tab.href);
    if (landing && !sections.some((section) => section.includes(landing))) sections.unshift([landing]);
    let opened = 0;
    for (let found = true; found && opened < OPENINGS_PER_TAB;) {
      found = false;
      for (const section of sections) {
        if (opened === OPENINGS_PER_TAB) break;
        const entry = section.find((candidate) => candidate.start === undefined);
        if (!entry) continue;
        mark(entry);
        opened++;
        found = true;
      }
    }
  }
}

/**
 * Strip HTML tags from a string to get plain text.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summarizeChangelog(page: Extract<DocsPage, { kind: "changelog" }>): string {
  return page.changelog.versions
    .slice(0, 3)
    .map(summarizeVersion)
    .join(" ");
}

function summarizeVersion(
  version: Extract<DocsPage, { kind: "changelog" }>["changelog"]["versions"][number],
): string {
  if (version.summary) return version.summary;

  const entries = version.sections.flatMap((section) => section.entries.map((entry) => entry.text));
  return entries.slice(0, 3).join(" ");
}

const referenceText = new WeakMap<object, string>();
/**
 * The words a reader finds an operation or schema by, once per immutable
 * normalized value: its names, path, tags and descriptions, and the names,
 * titles, descriptions and values of every field it takes and returns. A named
 * type's fields are read once, as the reference draws them once, so a type
 * nested many times over adds its words once rather than at every level.
 */
export function referenceSearchText(value: NormalizedOperation | NormalizedSchema): string {
  const cached = referenceText.get(value);
  if (cached !== undefined) return cached;
  const words: string[] = [];
  const named = new Set<string>();
  const seen = new WeakSet<object>();
  const add = (...parts: unknown[]) => {
    for (const part of parts) if (typeof part === "string" ? part : typeof part === "number") words.push(String(part));
  };
  const schema = (node: NormalizedSchema | undefined): void => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const name = node.refName ?? node.name;
    if (name) {
      if (named.has(name)) return;
      named.add(name);
    }
    add(name, node.title, node.description, node.const, ...node.enum ?? [], ...node.enumNames ?? [], ...node.enumDescriptions ?? []);
    for (const [field, child] of Object.entries(node.properties ?? {})) {
      add(field);
      schema(child);
    }
    if (typeof node.additionalProperties === "object") schema(node.additionalProperties);
    schema(node.items);
    schema(node.not);
    for (const child of [...node.allOf ?? [], ...node.anyOf ?? [], ...node.oneOf ?? []]) schema(child);
  };
  const media = (content: Record<string, MediaTypeContent> | undefined) => {
    for (const entry of Object.values(content ?? {})) schema(entry.schema);
  };
  const parameter = (entry: NormalizedParameter) => {
    add(entry.name, entry.description);
    schema(entry.schema);
    media(entry.content);
  };
  const operation = (op: NormalizedOperation): void => {
    add(op.operationId, op.summary, op.description, op.method, op.path, ...op.tags);
    op.parameters.forEach(parameter);
    if (op.requestBody) {
      add(op.requestBody.description);
      media(op.requestBody.content);
    }
    for (const response of op.responses) {
      add(response.statusCode, response.summary, response.description);
      media(response.content);
      Object.values(response.headers ?? {}).forEach(parameter);
    }
    schema(op.mcpExtras?.outputSchema);
    for (const callback of Object.values(op.callbacks ?? {})) {
      add(callback.expression);
      callback.operations.forEach(operation);
    }
  };
  if ("method" in value && "path" in value) operation(value);
  else schema(value);
  const result = words.join(" ");
  referenceText.set(value, result);
  return result;
}

/** The words a reference's overview is found by: its title and descriptions, servers, tags and security schemes. */
export function referenceOverviewSearchText(spec: NormalizedSpec): string {
  return [
    spec.info.title, spec.info.summary, spec.info.description,
    ...spec.servers.flatMap(server => [server.url, server.description]),
    ...spec.tags.flatMap(tag => [tag.name, tag.summary, tag.description]),
    ...Object.entries(spec.securitySchemes).flatMap(([name, scheme]) => [name, scheme.name, scheme.description]),
  ].filter(Boolean).join(" ");
}
