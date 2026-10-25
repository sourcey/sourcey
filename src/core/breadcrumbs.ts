import { isNavGroup, type SiteNavigation, type SiteNavGroup } from "./navigation.js";
import { isAbsoluteHttpUrl, joinHref } from "../site-url.js";

/** A step on the way to a page: a section, with its address where it has a page of its own. */
export interface Crumb {
  label: string;
  href?: string;
}

/** The sections around the current page, outermost first. */
function ancestors(groups: SiteNavGroup[], page: string): SiteNavGroup[] | undefined {
  for (const group of groups) for (const item of group.items) {
    if (isNavGroup(item)) {
      const nested = ancestors([item], page);
      if (nested) return [group, ...nested];
    } else if (item.id === page) return [group];
  }
}

/**
 * The way to the current page through its navigation: its tab, where the site
 * has several, then each named section it sits in. A section that is the page
 * itself is not a step, and the page is not one: its title follows.
 */
export function pageTrail(navigation: SiteNavigation): Crumb[] {
  const tab = navigation.tabs.find(candidate => candidate.slug === navigation.activeTabSlug);
  if (!tab) return [];
  const crumbs: Crumb[] = navigation.tabs.length > 1 ? [{ label: tab.label, href: tab.href }] : [];
  for (const group of ancestors(tab.groups, navigation.activePageSlug) ?? []) {
    if (!group.label || group.page === navigation.activePageSlug) continue;
    crumbs.push(group.href ? { label: group.label, href: group.href } : { label: group.label });
  }
  return crumbs;
}

/** Project the authored browsing trail. An unlinked category is not a new page. */
export function breadcrumbList(
  navigation: SiteNavigation,
  title: string,
  canonical: string | undefined,
  baseUrl: string,
): object | undefined {
  if (!canonical || !isAbsoluteHttpUrl(canonical)) return;
  const tab = navigation.tabs.find(candidate => candidate.slug === navigation.activeTabSlug);
  if (!tab) return;
  const trail: { name: string; item: string }[] = [];
  function add(name: string, href?: string) {
    if (!name || href === undefined) return;
    const destination = new URL(joinHref(baseUrl || "/", href), canonical);
    if (destination.origin !== new URL(canonical!).origin || !/^https?:$/.test(destination.protocol)) return;
    if (destination.href === canonical || trail.some(item => item.item === destination.href)) return;
    trail.push({ name, item: destination.href });
  }
  add(tab.label, tab.href);
  for (const group of ancestors(tab.groups, navigation.activePageSlug) ?? []) add(group.label, group.href);
  trail.push({ name: title, item: canonical });
  if (trail.length < 2) return;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({ "@type": "ListItem", position: index + 1, ...item })),
  };
}

/** JSON is embedded as script data, never executable HTML. */
export function structuredDataJson(value: object): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
