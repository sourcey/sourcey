import type { NormalizedSpec } from "./types.js";
import { tagDisplayName } from "./tag-utils.js";
import type { ResolvedTab, ResolvedGroup, GroupConfig, NavigationTarget } from "../config.js";
import { slugFromPath } from "./markdown-loader.js";
import type { NavigationDocument } from "./markdown-loader.js";
import { operationAnchor, definitionAnchor, tagAnchor } from "./reference-identity.js";
import { pageOutputPath, tabIndexOutputPath, toPrettyLink, toPublicPath, type LinkStyle, type PrettyUrls } from "../site-url.js";

/**
 * Convert a file output path (e.g. `concepts/index.html`) into the relative
 * href the nav should emit, honouring the `prettyUrls` mode. The Sidebar
 * prepends a `../` depth prefix at render time, so the value returned here
 * must be root-relative *without* a leading slash.
 */
/** A page's link from its output path, in the site's pretty-URL form. */
export function navHref(outputPath: string, prettyUrls: PrettyUrls): string {
  return toPublicPath(outputPath, "", prettyUrls).replace(/^\//, "");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteNavigation {
  adjacentPages?: { previous?: Pick<SiteNavItem, "href" | "label">; next?: Pick<SiteNavItem, "href" | "label"> };
  tabs: SiteTab[];
  activeTabSlug: string;
  activePageSlug: string;
}

export interface SiteTab {
  label: string;
  slug: string;
  /** Relative URL to this tab's first page (from site root) */
  href: string;
  /** The page the tab leads to when it is not the first its navigation lists, by document ID. */
  documentId?: string;
  kind: "spec" | "docs";
  groups: SiteNavGroup[];
  sectionIndex?: { href: string; label: string };
}

export interface SiteNavGroup {
  collapsed?: boolean;
  label: string;
  /** Optional section link for generated groups such as OpenAPI tag intros. */
  href?: string;
  /** Unique ID for section-level active-state matching. */
  id?: string;
  /** The page of this tab its link leads to: the section's own page, current when that page is. */
  page?: string;
  items: (SiteNavItem | SiteNavGroup)[];
}

export interface SiteNavItem {
  /** Build-scoped semantic target, resolved by the compiled route inventory. */
  target?: NavigationTarget;
  /** The page of this tab the item leads to; its href is then the address the routes give that page. */
  documentId?: string;
  label: string;
  /** Relative URL to this item (from site root) */
  href: string;
  /** Unique ID for active-state matching */
  id: string;
  /** HTTP method for OpenAPI operations (colored dot in sidebar) */
  method?: string;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a navigation tab from an OpenAPI spec.
 * Extracts the same structure currently hardcoded in Sidebar.tsx:
 * Introduction + Authentication → tag groups with operations → Models.
 * All hrefs are #anchor links (single-page spec rendering).
 */
export function buildNavFromSpec(
  spec: NormalizedSpec,
  tabSlug: string,
  prettyUrls: PrettyUrls = false,
): SiteTab {
  const basePath = navHref(tabIndexOutputPath(tabSlug, prettyUrls), prettyUrls);
  const groups: SiteNavGroup[] = [];

  // Intro group
  const introItems: SiteNavItem[] = [
    { label: "Introduction", href: `${basePath}#introduction`, id: "introduction" },
  ];
  if (Object.keys(spec.securitySchemes).length > 0) {
    introItems.push({
      label: "Authentication",
      href: `${basePath}#authentication`,
      id: "authentication",
    });
  }
  groups.push({ label: "", items: introItems });

  // A group per tag; a tag with a parent (OpenAPI 3.2) nests in its parent's
  // group, after the parent's own operations. Tags arrive parents first.
  const tagGroups = new Map<string, SiteNavGroup>();
  const roots: SiteNavGroup[] = [];
  for (const tag of spec.tags) {
    if (tag.hidden) continue;
    const tagId = tagAnchor(tag.name, spec);
    const group: SiteNavGroup = {
      label: tagDisplayName(tag),
      href: `${basePath}#${tagId}`,
      id: tagId,
      items: tag.operations.map((op) => ({
        label: op.summary ?? `${op.method.toUpperCase()} ${op.path}`,
        href: `${basePath}#${operationAnchor(op, spec)}`,
        id: operationAnchor(op, spec),
        method: op.method,
      })),
    };
    tagGroups.set(tag.name, group);
    (tag.parent ? tagGroups.get(tag.parent)?.items ?? roots : roots).push(group);
  }
  // A tag with no operations of its own or beneath it lists nothing.
  const listed = <T extends SiteNavItem | SiteNavGroup>(items: T[]): T[] =>
    items.filter((item) => !isNavGroup(item) || (item.items = listed(item.items)).length > 0);
  groups.push(...listed(roots));

  // Models group
  const schemaNames = Object.keys(spec.schemas);
  if (schemaNames.length > 0) {
    const items: SiteNavItem[] = schemaNames.map((name) => ({
      label: name,
      href: `${basePath}#${definitionAnchor(name, spec)}`,
      id: definitionAnchor(name, spec),
    }));
    groups.push({ label: "Models", items });
  }

  return {
    label: tabSlug,
    slug: tabSlug,
    href: basePath,
    kind: "spec",
    groups,
  };
}

/**
 * Build a navigation tab from markdown pages.
 * Groups come from the config; items come from loaded page data.
 */
export function buildNavFromPages(
  tab: ResolvedTab,
  pagesByPath: Map<string, NavigationDocument>,
  prettyUrls: PrettyUrls = false,
  hrefFor?: (page: NavigationDocument, reference: string) => string,
  labels: Record<string, string> = {},
): SiteTab {
  const slugs = tab.source.kind === "markdown" ? tab.source.slugs : "normalized";
  function group(input: ResolvedGroup): SiteNavGroup {
    const items: (SiteNavItem | SiteNavGroup)[] = [];
    for (const entry of input.items) {
      if (entry.kind === "group") { items.push(group(entry)); continue; }
      if (entry.kind === "link") { items.push({ label: entry.label, href: entry.href, id: entry.href }); continue; }
      if (entry.kind === "target") { items.push(targetItem(entry.target)); continue; }
      const page = pagesByPath.get(entry.slug);
      if (!page || entry.hidden || page.kind === "markdown" && page.hideInMenu) continue;
      items.push({ label: labels[entry.slug] ?? labels[page.id ?? ""] ?? entry.label ?? (page.kind === "markdown" ? page.navTitle : undefined) ?? page.title,
        href: hrefFor?.(page, entry.slug) ?? navHref(pageOutputPath(tab.slug, page.slug, prettyUrls), prettyUrls), documentId: page.kind === "markdown" ? page.id ?? slugFromPath(entry.slug, slugs) : slugFromPath(entry.slug, slugs), id: page.slug });
    }
    return { label: labels[input.id] ?? input.label, id: input.id, href: input.href, collapsed: input.collapsed, items };
  }
  const navGroups = tab.source.kind === "markdown" ? tab.source.groups.map(group) : [];
  const groupIds = new Set<string>();
  for (const entry of walkNavGroups(navGroups)) if (entry.id) {
    if (groupIds.has(entry.id)) throw new Error(`Duplicate navigation group ID: ${entry.id}`);
    groupIds.add(entry.id);
  }
  const firstItem = [...walkNavItems(navGroups)][0];
  const href = firstItem?.href ?? (tab.slug ? `${tab.slug}/` : "");

  return {
    label: tab.label,
    slug: tab.slug,
    href,
    kind: "docs",
    groups: navGroups,
  };
}

function targetItem(target: NavigationTarget): SiteNavItem {
  const name = "operation" in target ? target.operation : target.page;
  return { target, label: target.label ?? name, href: "", id: JSON.stringify(target) };
}

/** Authored browsing order does not load sources or assign document URLs. */
export function buildAuthoredNavigation(tab: ResolvedTab, input: GroupConfig[]): SiteTab {
  function group(value: GroupConfig, parent: string): SiteNavGroup {
    const id = value.id ?? [parent, value.group].filter(Boolean).join("/");
    return { label: value.group, id, collapsed: value.collapsed, href: value.href, items: value.pages.flatMap<SiteNavItem | SiteNavGroup>(entry => {
      if (typeof entry === "object" && "group" in entry) return [group(entry, id)];
      if (typeof entry === "object" && "href" in entry) return [{ label: entry.label, href: entry.href, id: entry.href }];
      if (typeof entry === "object" && "hidden" in entry && entry.hidden) return [];
      return [targetItem(typeof entry === "string" ? { page: entry } : entry)];
    }) };
  }
  const groups = input.map(value => group(value, tab.id));
  const ids = new Set<string>();
  for (const group of walkNavGroups(groups)) if (group.id) {
    if (ids.has(group.id)) throw new Error(`Duplicate navigation group ID: ${group.id}`);
    ids.add(group.id);
  }
  return { label: tab.label, slug: tab.slug, href: "", kind: tab.source.kind === "openapi" || tab.source.kind === "mcp" ? "spec" : "docs", groups };
}

/**
 * Assemble a SiteNavigation from a list of tabs.
 * Defaults to the first tab and first page as active.
 */
export function buildSiteNavigation(tabs: SiteTab[]): SiteNavigation {
  const firstTab = tabs[0];
  const firstItem = firstTab ? [...walkNavItems(firstTab.groups)][0] : undefined;

  return withActivePage({
    tabs,
    activeTabSlug: firstTab?.slug ?? "",
    activePageSlug: firstItem?.id ?? "",
  }, firstTab?.slug ?? "", firstItem?.id ?? "");
}

/**
 * Create a copy of the navigation with a specific page marked as active.
 */
export function withActivePage(
  nav: SiteNavigation,
  tabSlug: string,
  pageSlug: string,
): SiteNavigation {
  const tab = nav.tabs.find(tab => tab.slug === tabSlug);
  return { ...nav, activeTabSlug: tabSlug, activePageSlug: pageSlug, adjacentPages: tab ? navigationIndex(tab).adjacent.get(pageSlug) : undefined };
}

export function isNavGroup(node: SiteNavItem | SiteNavGroup): node is SiteNavGroup {
  return "items" in node;
}
/** The active tab, and the innermost section listing the active page. */
export function activeSection(nav: SiteNavigation): { tab?: SiteTab; group?: SiteNavGroup } {
  const tab = nav.tabs.find((candidate) => candidate.slug === nav.activeTabSlug);
  const group = (tab ? [...walkNavGroups(tab.groups)].reverse() : []).find((candidate) =>
    [...walkNavItems([candidate])].some((item) => item.id === nav.activePageSlug));
  return { tab, group };
}
export function* walkNavGroups(groups: readonly SiteNavGroup[]): Generator<SiteNavGroup> {
  for (const group of groups) {
    yield group;
    for (const node of group.items) if (isNavGroup(node)) yield* walkNavGroups([node]);
  }
}
export function* walkNavItems(groups: readonly SiteNavGroup[]): Generator<SiteNavItem> {
  for (const group of groups) for (const node of group.items) {
    if (isNavGroup(node)) yield* walkNavItems([node]);
    else yield node;
  }
}
/** Every link a navigation tree leads to, in reading order: a section's own page before its contents. */
export function* readingOrder(groups: readonly SiteNavGroup[]): Generator<string> {
  for (const group of groups) {
    if (group.href) yield group.href;
    for (const item of group.items) {
      if (isNavGroup(item)) yield* readingOrder([item]);
      else yield item.href;
    }
  }
}
interface NavigationIndex {
  adjacent: Map<string, NonNullable<SiteNavigation["adjacentPages"]>>;
  count: number;
  /** The pages its entries lead to. */
  pages: number;
  ancestors: Map<string, Set<SiteNavGroup>>;
  positions: Map<SiteNavGroup, Map<string, number>>;
}
const navigationIndexes = new WeakMap<SiteTab, NavigationIndex>();
function navigationIndex(tab: SiteTab): NavigationIndex {
  let index = navigationIndexes.get(tab);
  if (index) return index;
  index = { count: 0, pages: 0, ancestors: new Map(), positions: new Map(), adjacent: new Map() };
  const sections = new Map<string, SiteNavGroup>();
  function visit(groups: readonly SiteNavGroup[], parents: SiteNavGroup[] = []) {
    for (const group of groups) {
      const ancestors = [...parents, group], positions = new Map<string, number>();
      index!.positions.set(group, positions);
      // A section's own page lies inside the section.
      if (group.page) index!.ancestors.set(group.page, new Set([...index!.ancestors.get(group.page) ?? [], ...ancestors]));
      group.items.forEach((item, position) => {
        if (isNavGroup(item)) visit([item], ancestors);
        else {
          index!.count++; positions.set(item.id, position);
          if (!sections.has(item.id)) sections.set(item.id, group);
          const existing = index!.ancestors.get(item.id) ?? new Set<SiteNavGroup>();
          for (const ancestor of ancestors) existing.add(ancestor);
          index!.ancestors.set(item.id, existing);
        }
      });
    }
  }
  visit(tab.groups);
  // Previous and next lead to other pages: a link to a section of a page already listed is not one.
  const seen = new Set<string>(), pages = new Set<string>();
  const ordered = [...walkNavItems(tab.groups)].filter(item => {
    const page = item.href.split("#")[0] || item.id;
    if (seen.has(item.id) || pages.has(page)) return false;
    seen.add(item.id); pages.add(page); return true;
  });
  index.pages = pages.size;
  // Away from its section, a label the tab repeats, such as each module's "Overview", names the
  // section the page opens.
  const repeats = new Map<string, number>();
  for (const item of ordered) repeats.set(item.label, (repeats.get(item.label) ?? 0) + 1);
  const neighbour = (item: SiteNavItem | undefined) => {
    const section = item && sections.get(item.id);
    return item && section?.label && section.items[0] === item && repeats.get(item.label)! > 1 ? { ...item, label: section.label } : item;
  };
  for (const [position, item] of ordered.entries()) index.adjacent.set(item.id, { previous: neighbour(ordered[position - 1]), next: neighbour(ordered[position + 1]) });
  navigationIndexes.set(tab, index); return index;
}

/** Keep unrelated sections at their destinations; the active branch stays expanded. */
export function projectNavigation(nav: SiteNavigation, tabSlug: string, pageSlug: string): SiteNavigation {
  const active = nav.tabs.find(t => t.slug === tabSlug);
  if (!active) return withActivePage(nav, tabSlug, pageSlug);
  const index = navigationIndex(active);
  // Every page carries its tab's sidebar. A reference's runs to thousands of operations, so past
  // a hundred only the branch around the page keeps its contents; an authored tree is shown
  // whole, as readers expect, until it is several times that. A tab of one page, such as a
  // single-page reference, has no other page to carry it, and is shown whole.
  if (index.pages <= 1 || index.count <= (active.kind === "spec" ? 100 : 400)) return withActivePage(nav, tabSlug, pageSlug);
  function branch(group: SiteNavGroup): SiteNavGroup {
    const contains = index.ancestors.get(pageSlug)?.has(group);
    if (contains) {
      const position = index.positions.get(group)?.get(pageSlug) ?? -1;
      const items = group.href && position >= 0 && group.items.length > 40
        ? group.items.slice(Math.max(0, position - 12), position + 13) : group.items;
      return { ...group, items: items.map(item => isNavGroup(item) ? branch(item) : item) };
    }
    // A group without a heading is a run of entries, not a section with a name to stand for it.
    if (!group.label) return group;
    // A branch away from the page keeps its own sections as links, so its shape still shows. A group
    // keeps its own link; one without (a heading) is reached through its sections, or, keeping
    // none, links to its start.
    const collapse = (value: SiteNavGroup, depth: number): SiteNavGroup => {
      const sections = depth > 0 ? [] : value.items.filter(isNavGroup).map(section => collapse(section, depth + 1));
      return { ...value, href: value.href ?? (sections.length ? undefined : [...walkNavItems([value])][0]?.href), items: sections };
    };
    return collapse(group, 0);
  }
  let groups = active.groups;
  if (active.sectionIndex && groups.length > 20) {
    const position = Math.max(0, groups.findIndex(group => index.ancestors.get(pageSlug)?.has(group)));
    groups = groups.slice(Math.max(0, position - 6), position + 7);
  }
  const projected = groups.map(branch);
  if (active.sectionIndex) projected.unshift({ label: active.sectionIndex.label, href: active.sectionIndex.href, items: [] });
  return { ...nav, activeTabSlug: tabSlug, activePageSlug: pageSlug,
    adjacentPages: index.adjacent.get(pageSlug),
    tabs: nav.tabs.map(tab => tab === active ? { ...tab, groups: projected } : { ...tab, groups: [] }) };
}

/** Write every link of a navigation in the site's pretty-URL form. */
export function prettyNavigationHrefs(tabs: readonly SiteTab[], links: LinkStyle): void {
  for (const tab of tabs) {
    tab.href = toPrettyLink(tab.href, links);
    for (const item of walkNavItems(tab.groups)) item.href = toPrettyLink(item.href, links);
  }
}
