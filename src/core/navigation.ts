import type { NormalizedSpec } from "./types.js";
import { tagNavigationLabel } from "./tag-utils.js";
import { pageOutputPath, tabIndexOutputPath } from "../config.js";
import type { ResolvedTab } from "../config.js";
import type { DocsPage } from "./markdown-loader.js";
import { htmlId } from "../utils/html-id.js";
import { toPublicPath, type PrettyUrls } from "../site-url.js";

/**
 * Convert a file output path (e.g. `concepts/index.html`) into the relative
 * href the nav should emit, honouring the `prettyUrls` mode. The Sidebar
 * prepends a `../` depth prefix at render time, so the value returned here
 * must be root-relative *without* a leading slash.
 */
function navHref(outputPath: string, prettyUrls: PrettyUrls): string {
  return toPublicPath(outputPath, "", prettyUrls).replace(/^\//, "");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteNavigation {
  tabs: SiteTab[];
  activeTabSlug: string;
  activePageSlug: string;
}

export interface SiteTab {
  label: string;
  slug: string;
  /** Relative URL to this tab's first page (from site root) */
  href: string;
  kind: "spec" | "docs";
  groups: SiteNavGroup[];
}

export interface SiteNavGroup {
  label: string;
  /** Optional section link for generated groups such as OpenAPI tag intros. */
  href?: string;
  /** Unique ID for section-level active-state matching. */
  id?: string;
  items: SiteNavItem[];
}

export interface SiteNavItem {
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

  // Tag groups with operations
  const tagsByName = new Map(spec.tags.map((tag) => [tag.name, tag]));
  for (const tag of spec.tags) {
    if (tag.hidden) continue;
    const tagId = `tag-${htmlId(tag.name)}`;
    const items: SiteNavItem[] = tag.operations.map((op) => ({
      label: op.summary ?? `${op.method.toUpperCase()} ${op.path}`,
      href: `${basePath}#operation-${htmlId(op.path)}-${htmlId(op.method)}`,
      id: `operation-${htmlId(op.path)}-${htmlId(op.method)}`,
      method: op.method,
    }));
    if (!items.length) continue;
    groups.push({
      label: tagNavigationLabel(tag, tagsByName),
      href: `${basePath}#${tagId}`,
      id: tagId,
      items,
    });
  }

  // Models group
  const schemaNames = Object.keys(spec.schemas);
  if (schemaNames.length > 0) {
    const items: SiteNavItem[] = schemaNames.map((name) => ({
      label: name,
      href: `${basePath}#definition-${htmlId(name)}`,
      id: `definition-${htmlId(name)}`,
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
  pagesByPath: Map<string, DocsPage>,
  prettyUrls: PrettyUrls = false,
): SiteTab {
  const navGroups: SiteNavGroup[] = [];

  const sourceGroups = tab.source.kind === "markdown" ? tab.source.groups : tab.groups;
  if (sourceGroups) {
    for (const group of sourceGroups) {
      const items: SiteNavItem[] = [];
      for (const rp of group.pages) {
        const page = pagesByPath.get(rp.slug);
        if (!page) continue;
        items.push({
          label: rp.label ?? page.title,
          href: navHref(pageOutputPath(tab.slug, page.slug, prettyUrls), prettyUrls),
          id: page.slug,
        });
      }
      navGroups.push({ label: group.label, items });
    }
  }

  const firstItem = navGroups[0]?.items[0];
  const href = firstItem?.href ?? (tab.slug ? `${tab.slug}/` : "");

  return {
    label: tab.label,
    slug: tab.slug,
    href,
    kind: "docs",
    groups: navGroups,
  };
}

/**
 * Assemble a SiteNavigation from a list of tabs.
 * Defaults to the first tab and first page as active.
 */
export function buildSiteNavigation(tabs: SiteTab[]): SiteNavigation {
  const firstTab = tabs[0];
  const firstItem = firstTab?.groups[0]?.items[0];

  return {
    tabs,
    activeTabSlug: firstTab?.slug ?? "",
    activePageSlug: firstItem?.id ?? "",
  };
}

/**
 * Create a copy of the navigation with a specific page marked as active.
 */
export function withActivePage(
  nav: SiteNavigation,
  tabSlug: string,
  pageSlug: string,
): SiteNavigation {
  return { ...nav, activeTabSlug: tabSlug, activePageSlug: pageSlug };
}
