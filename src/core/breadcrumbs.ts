import { isNavGroup, type SiteNavigation, type SiteNavGroup } from "./navigation.js";
import { isAbsoluteHttpUrl, joinHref } from "../site-url.js";

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
  function ancestors(groups: SiteNavGroup[]): SiteNavGroup[] | undefined {
    for (const group of groups) for (const item of group.items) {
      if (isNavGroup(item)) {
        const nested = ancestors([item]);
        if (nested) return [group, ...nested];
      } else if (item.id === navigation.activePageSlug) return [group];
    }
  }
  const trail: { name: string; item: string }[] = [];
  function add(name: string, href?: string) {
    if (!name || href === undefined) return;
    const destination = new URL(joinHref(baseUrl || "/", href), canonical);
    if (destination.origin !== new URL(canonical!).origin || !/^https?:$/.test(destination.protocol)) return;
    if (destination.href === canonical || trail.some(item => item.item === destination.href)) return;
    trail.push({ name, item: destination.href });
  }
  add(tab.label, tab.href);
  for (const group of ancestors(tab.groups) ?? []) add(group.label, group.href);
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
