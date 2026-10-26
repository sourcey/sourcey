import type { NavigationTarget, ResolvedConfig, ResolvedTab } from "../config.js";
import type { NormalizedSpec } from "./types.js";
import type { ReferenceTargets, ResolvedSiteContext, RouteRecord, RouteTable } from "./site-model.js";
import { definitionAnchor, operationAnchor, referenceOperation } from "./reference-identity.js";
import { isNavGroup, readingOrder, walkNavGroups, walkNavItems, type SiteNavGroup, type SiteNavItem, type SiteTab } from "./navigation.js";
import { markdownPages } from "../adapters/shared.js";
import { referenceTag, tagDisplayName } from "./tag-utils.js";
import { toPublicPath } from "../site-url.js";

/** Resolve authored browsing edges against the one completed document graph. */
export function navigationResolver(config: ResolvedConfig, routes: RouteTable, references: ReadonlyMap<string, NormalizedSpec>, targets: ReadonlyMap<string, ReferenceTargets>) {
  const byOwner = new Map<string, RouteRecord[]>();
  const names = new Map<string, Map<string, Set<RouteRecord>>>();
  for (const route of routes.byKey.values()) {
    if (route.page.status === 404) continue;
    const owner = route.page.tabSlug;
    const group = byOwner.get(owner) ?? []; group.push(route); byOwner.set(owner, group);
  }
  function named(tab: ResolvedTab): Map<string, Set<RouteRecord>> {
    let result = names.get(tab.slug);
    if (result) return result;
    result = new Map();
    function add(name: string, route: RouteRecord) {
      const values = result!.get(name) ?? new Set(); values.add(route); result!.set(name, values);
    }
    const files = new Map<string, RouteRecord>();
    for (const route of byOwner.get(tab.slug) ?? []) {
      const { currentPage } = route.page;
      add(route.page.identity.document, route);
      if (currentPage.kind === "markdown") add(currentPage.markdown.slug, route);
      else if (currentPage.kind === "changelog") add(currentPage.changelog.slug, route);
      if (route.page.source) files.set(route.page.source, route);
    }
    if (tab.source.kind === "markdown") for (const page of markdownPages(tab.source.groups)) {
      const route = files.get(page.file);
      if (route) add(page.slug, route);
    }
    names.set(tab.slug, result); return result;
  }
  // A source's generated navigation names output paths, which become links as pages are drawn, and
  // an authored section names its page by any address a host answers it at.
  function routeAt(href: string) {
    if (href.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(href)) return undefined;
    const path = href.split(/[?#]/)[0];
    return routes.pageAt(path.startsWith("/") ? path : toPublicPath(path, config.baseUrl, config.prettyUrls));
  }
  return (nav: SiteTab, tab: ResolvedTab, context: ResolvedSiteContext): void => {
    const members = config.contexts.filter(candidate => candidate.locale === context.locale && (candidate.scope === context.scope ? candidate.version.id === context.version.id : candidate.isDefaultVersion));
    function owner(id: string | undefined): ResolvedTab {
      if (id === undefined) return tab;
      const found = members.flatMap(member => member.tabs).filter(candidate => candidate.id === id);
      if (found.length !== 1) throw new Error(`Navigation in ${tab.id}: ${found.length ? "ambiguous" : "unavailable"} source ${JSON.stringify(id)} in ${context.locale}/${context.version.id}`);
      return found[0];
    }
    function label(route: RouteRecord): string {
      const page = route.page.currentPage;
      if (page.kind === "markdown") return page.markdown.navTitle ?? page.markdown.title;
      if (page.kind === "changelog") return page.changelog.title;
      if (page.kind === "spec") return page.view?.kind === "operation" ? referenceOperation(page.spec, page.view.id).summary ?? page.view.id
        : page.view?.kind === "section" ? tagDisplayName(referenceTag(page.spec, page.view.tag)) : page.view?.kind === "schema" ? page.view.name : page.spec.info.title;
      return page.title;
    }
    function resolve(item: SiteNavItem, target: NavigationTarget): boolean {
      const source = owner("operation" in target ? target.reference : target.tab);
      if ("operation" in target) {
        const destination = targets.get(source.slug)?.operations[target.operation];
        const spec = references.get(source.slug);
        if (!spec || !destination) throw new Error(`Navigation in ${tab.id}: operation ${JSON.stringify(target.operation)} is not published by reference ${JSON.stringify(source.id)}`);
        const operation = referenceOperation(spec, target.operation);
        item.href = destination.href;
        item.label = target.label ?? operation.summary ?? target.operation;
        item.method = operation.method;
        item.id = source.slug === tab.slug ? operationAnchor(operation, spec) : JSON.stringify([source.slug, target.operation]);
        item.documentId = source.slug === tab.slug ? target.operation : undefined;
      } else {
        const found = [...named(source).get(target.page) ?? []];
        if (found.length !== 1) throw new Error(`Navigation in ${tab.id}: ${found.length ? "ambiguous" : "unknown"} document ${JSON.stringify(target.page)} in source ${JSON.stringify(source.id)}`);
        const route = found[0];
        if (route.page.hidden) return false;
        item.href = route.publicPath;
        item.label = target.label ?? label(route);
        item.id = source.slug === tab.slug ? route.page.pageSlug : route.key;
        item.documentId = source.slug === tab.slug ? route.page.identity.document : undefined;
        const page = route.page.currentPage;
        if (page.kind === "spec" && page.view?.kind === "operation") item.method = referenceOperation(page.spec, page.view.id).method;
      }
      delete item.target;
      return true;
    }
    /** The address of a page of this tab; navigation that names a page without one has nowhere else to lead. */
    function documentHref(document: string, href = ""): string {
      const found = [...named(tab).get(document) ?? []];
      if (found.length === 1) return found[0].publicPath;
      if (!href) throw new Error(`Navigation in ${tab.id}: ${found.length ? "ambiguous" : "unknown"} document ${JSON.stringify(document)}`);
      return href;
    }
    function group(value: SiteNavGroup): void {
      value.items = value.items.filter(item => {
        if (isNavGroup(item)) { group(item); return true; }
        return !item.target || resolve(item, item.target);
      });
    }
    for (const value of nav.groups) group(value);
    // Generated source navigation uses the same canonical destinations.
    const spec = references.get(tab.slug), destinations = targets.get(tab.slug);
    const overview = spec ? (byOwner.get(tab.slug) ?? []).find(route => route.page.currentPage.kind === "spec" && (!route.page.currentPage.view || route.page.currentPage.view.kind === "overview")) : undefined;
    const generated = new Map<string, string>();
    if (spec && destinations) {
      for (const operation of spec.operations) {
        const destination = destinations.operations[`${operation.method.toUpperCase()} ${operation.path}`];
        if (destination) generated.set(operationAnchor(operation, spec), destination.href);
      }
      for (const name of Object.keys(spec.schemas)) if (destinations.schemas[name]) generated.set(definitionAnchor(name, spec), destinations.schemas[name].href);
      if (overview && !tab.navigation) {
        // Split into pages, the reference's introduction is its overview page, and a section
        // with a page of its own leads there.
        const split = overview.page.currentPage.kind === "spec" && overview.page.currentPage.view?.kind === "overview";
        for (const anchor of ["introduction", "authentication"]) if (overview.anchors.has(anchor)) generated.set(anchor, split && anchor === "introduction" ? overview.publicPath : `${overview.publicPath}#${anchor}`);
        const sectionPages = new Map((byOwner.get(tab.slug) ?? []).flatMap(route => route.page.currentPage.kind === "spec" && route.page.currentPage.view?.kind === "section" ? [[route.page.pageSlug, route.publicPath]] : []));
        function sections(groups: SiteNavGroup[]) {
          for (const value of groups) {
            const own = value.id ? sectionPages.get(value.id) : undefined;
            if (own) value.href = own;
            else if (value.id && value.href && overview!.anchors.has(value.id)) value.href = `${overview!.publicPath}#${value.id}`;
            sections(value.items.filter(isNavGroup));
          }
        }
        sections(nav.groups);
      }
    }
    for (const item of walkNavItems(nav.groups)) {
      const generatedHref = generated.get(item.id);
      if (generatedHref) item.href = generatedHref;
      else if (item.documentId) item.href = documentHref(item.documentId, item.href);
    }
    // A section that links a whole page of this tab is current on that page, and links it at the
    // page's own address; one linking a section of a page (an API tag) is matched by its ID.
    for (const value of walkNavGroups(nav.groups)) {
      const route = value.href && !value.href.includes("#") ? routeAt(value.href) : undefined;
      if (route?.page.tabSlug === tab.slug) { value.page = route.page.pageSlug; value.href = route.publicPath; }
    }
    // A reference leads to its overview, and a tab whose navigation names the page it lands
    // on, such as Rust's workspace overview, to that page. Other tabs lead to their first destination, a
    // section's own page before those it holds; a cross-source link, or an index the
    // build generated for a long section, never makes a header tab land elsewhere.
    const declared = nav.documentId ? documentHref(nav.documentId) : undefined;
    const first = [...readingOrder(nav.groups)].find(href => {
      const page = routeAt(href)?.page;
      return page?.tabSlug === tab.slug && !page.identity.document.startsWith("section");
    });
    nav.href = overview ? overview.publicPath : declared ?? first ?? (byOwner.get(tab.slug) ?? [])[0]?.publicPath ?? nav.href;
  };
}
