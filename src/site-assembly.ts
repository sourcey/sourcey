import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Redirect, ResolvedConfig, ResolvedTab } from "./config.js";
import { joinHref, normalizeBaseUrl, pageOutputPath, tabPath, toPublicPath, toPublicUrl } from "./site-url.js";
import { markdownPages } from "./adapters/shared.js";
import type { ResolvedDoxygenSource, ResolvedGodocSource, ResolvedMarkdownSource, ResolvedMcpSource, ResolvedOpenApiSource, ResolvedRustdocSource } from "./adapters/types.js";
import type { BuildDiagnostics } from "./core/build-diagnostics.js";
import { convertToOpenApi3 } from "./core/converter.js";
import { loadDoxygenTab } from "./core/doxygen-loader.js";
import { loadGodocTab, type GodocLoaderDiagnostic } from "./core/godoc-loader.js";
import { InputReader, loadSpec, type InputReaderOptions } from "./core/loader.js";
import { sectionIndexDependencies } from "./core/markdown-components.js";
import { docsExport, drawDocsSource, loadDocsSource, outlineDocsSource, slugFromPath, type DocsPage, type DocsSource, type LoadDocsPageOptions, type MarkdownPage, type MarkdownSource } from "./core/markdown-loader.js";
import { normalizeMcpSpec } from "./core/mcp-normalizer.js";
import { buildAuthoredNavigation, buildNavFromPages, buildNavFromSpec, buildSiteNavigation, prettyNavigationHrefs, walkNavGroups, walkNavItems, type SiteTab } from "./core/navigation.js";
import { navigationResolver } from "./core/navigation-targets.js";
import { normalizeSpec } from "./core/normalizer.js";
import { applyOverlays, type OverlayDiagnostic } from "./core/overlay.js";
import { parseSpec } from "./core/parser.js";
import { definitionAnchor, operationAnchor, operationKey, operationPagePath, referenceOperation, schemaPagePath } from "./core/reference-identity.js";
import { shareReferenceSnapshot } from "./core/reference-snapshot.js";
import { RouteTable, SITE_PAGES, identityKey, reportUnmatchedAnchor, validateAnchorAliases, type AnchorDiagnostic, type ReferenceTargets, type ResolvedSiteContext, type SitePage } from "./core/site-model.js";
import { pageLinks, resolveInternalHref, rewriteHtmlLinks, rewriteMarkdownLinks, siteLinks, type LinkedReference, type LinkScope } from "./core/site-links.js";
import { sitePageFiles } from "./core/site-pages.js";
import type { ArtifactBody } from "./core/source-file.js";
import type { ChangelogDiagnostic, NormalizedSpec } from "./core/types.js";
import { loadRustdocTab, type RustdocLoaderDiagnostic } from "./core/rustdoc-loader.js";
import { slugify } from "./utils/slug.js";
import { renderMarkdown } from "./utils/markdown.js";
import { attachSiteFiles } from "./site-assets.js";
import { addPermalinkPages, attachChangelogFeeds } from "./site-changelog.js";

export interface AssemblyCache {
  reader: InputReader;
  documents: Map<string, DocsSource>;
  references: Map<string, { key: string; spec: NormalizedSpec; publicDocument?: Record<string, unknown>; diagnostics?: OverlayDiagnostic[] }>;
  /** Each page as drawn and linked, by output path, with the source and the routes it was drawn from. */
  pages: Map<string, { source: DocsSource | DocsPage; key: string; page: DocsPage }>;
}
export interface SiteAssembly extends BuildDiagnostics {
  publicSpecs: Map<string, Record<string, unknown>>;
  siteTabs: SiteTab[];
  references: Map<string, NormalizedSpec>;
  pageMap: Map<string, SitePage>;
  routes: RouteTable;
  /** Where the routes publish each reference's overview, operations and models, by its tab. */
  referenceTargets: Map<string, ReferenceTargets>;
  cache: AssemblyCache;
  extraFiles: Map<string, ArtifactBody>;
}

export async function assembleSite(config: ResolvedConfig, previous?: AssemblyCache, changed: string[] = [], signal?: AbortSignal, reading: InputReaderOptions = {}): Promise<SiteAssembly> {
  const reader = previous?.reader.fork(changed, signal) ?? new InputReader(signal, reading);
  const cache: AssemblyCache = { reader, documents: new Map(), references: new Map(), pages: new Map() };
  const publicSpecs = new Map<string, Record<string, unknown>>();
  const references = new Map<string, NormalizedSpec>();
  const pageMap = new Map<string, SitePage>();
  const siteTabs: SiteTab[] = [];
  const changelogDiagnostics: ChangelogDiagnostic[] = [];
  const godocDiagnostics: GodocLoaderDiagnostic[] = [];
  const rustdocDiagnostics: RustdocLoaderDiagnostic[] = [];
  const overlayDiagnostics: OverlayDiagnostic[] = [];
  const anchorDiagnostics: AnchorDiagnostic[] = [];
  const tabs = config.contexts.flatMap(context => context.tabs);
  // A page drawn from content is outlined as it is added and drawn once the site's routes and
  // navigation are compiled, so its HTML and export are written with their final links.
  const drafts: PageDrafts = new Map();
  const referenceRedirects = new Map<string, Redirect>();
  const sectionRenders: { page: MarkdownPage; content: () => string }[] = [];
  function localizeNavigation(nav: SiteTab, context: ResolvedSiteContext): void {
    const names = context.localeConfig.messages.navigation;
    nav.label = names?.[nav.label] ?? nav.label;
    for (const group of walkNavGroups(nav.groups)) group.label = names?.[group.id ?? ""] ?? group.label;
    for (const item of walkNavItems(nav.groups)) item.label = names?.[item.documentId ?? item.id] ?? names?.[item.id] ?? item.label;
  }
  /**
   * The site's own pages, outside the documentation: one set per language, in
   * no tab or version, each at the address its path names. `404` is the
   * site's not-found page.
   */
  async function addSitePages(root: string): Promise<void> {
    const languages = [...new Set(config.contexts.map(context => context.locale))].map(locale =>
      config.contexts.find(context => context.locale === locale && context.isDefaultVersion && context.scope === "site") ?? config.contexts.find(context => context.locale === locale && context.isDefaultVersion)!);
    const others = languages.filter(context => context.locale !== context.defaultLocale && context.source.content).map(context => resolve(root, context.source.content));
    for (const context of languages) {
      const own = context.locale === context.defaultLocale;
      for (const { file, slug, contentLocale } of await sitePageFiles(root, context.source, others)) {
        const status = slug === "404";
        if (status && !own) {
          if (contentLocale === context.locale) throw new Error(`${file}: the not-found page is the default language's own 404 page`);
          continue;
        }
        const input = await reader.read(file, context.key);
        const key = JSON.stringify([SITE_PAGES, file, input.digest, slug, context.key, config.theme.icons, config.markdown.smartypants]);
        let source = previous?.documents.get(key);
        if (!source || previous && await previous.reader.affected(file, changed)) source = await loadDocsSource(file, slug, { ...loadOptions(context, contentLocale), changelog: false, sourceRoot: root });
        cache.documents.set(key, source);
        if (source.kind !== "markdown" || source.draft) continue;
        if (source.layout === "doc") throw new Error(`${source.sourcePath}: a site page is drawn as page or blank, not doc`);
        const sitePage: MarkdownSource = { ...source, layout: source.layout ?? "page" };
        const markdown = outlineDocsSource(sitePage) as MarkdownPage;
        const page: SitePage = { outputPath: status ? statusPath : pageOutputPath(context.localePath, markdown.slug, config.prettyUrls), currentPage: { kind: "markdown", markdown },
          tabSlug: context.localePath ? `${context.localePath}/${SITE_PAGES}` : SITE_PAGES, pageSlug: markdown.slug, identity: { tab: SITE_PAGES, kind: "markdown", document: slug },
          context, contentLocale, source: file, ...(status ? { status: 404 as const } : {}) };
        if (pageMap.has(identityKey(page))) throw new Error(`Duplicate document: ${identityKey(page)}`);
        pageMap.set(identityKey(page), page);
        drafts.set(page, { source: sitePage, document: sitePage.slug });
      }
    }
  }
  /** What every Markdown page of a language and version loads with. */
  function loadOptions(context: ResolvedSiteContext, contentLocale: string): LoadDocsPageOptions {
    return { repoUrl: config.repo, input: reader, components: config.components, smartypants: config.markdown.smartypants, configDir: config.configDir,
      editRoot: context.version.revision ? resolve(config.configDir, context.version.content ?? "") : undefined, baseUrl: config.baseUrl,
      context: { locale: context.locale, lang: context.localeConfig.lang, dir: context.localeConfig.dir, contentLocale, version: context.version, versionScope: context.scope, messages: context.localeConfig.messages, icons: config.theme.icons } };
  }
  function routeOutputPath(tab: ResolvedTab, route: string): string {
    return /\.html$/.test(route) ? tabPath(tab.slug, route) : pageOutputPath(tab.slug, route, config.prettyUrls);
  }
  function outputPathFor(tab: ResolvedTab, document: string, slug: string): string {
    const route = tab.routes?.[document];
    return route ? routeOutputPath(tab, route) : pageOutputPath(tab.slug, slug, config.prettyUrls);
  }
  function add(context: ResolvedSiteContext, tab: ResolvedTab, currentPage: Exclude<SitePage["currentPage"], { kind: "not-found" }>, document: string, source?: string, contentLocale = context.locale) {
    const slug = currentPage.kind === "spec" ? document === "introduction" ? "index" : document : currentPage.kind === "markdown" ? currentPage.markdown.slug : currentPage.changelog.slug;
    const outputPath = outputPathFor(tab, document, slug);
    const view = currentPage.kind === "spec" ? currentPage.view : undefined;
    const active = currentPage.kind === "spec" ? view?.kind === "operation" ? operationAnchor(referenceOperation(currentPage.spec, view.id), currentPage.spec) : view?.kind === "schema" ? definitionAnchor(view.name, currentPage.spec) : "introduction" : slug;
    const page: SitePage = { outputPath, currentPage, tabSlug: tab.slug, pageSlug: active, anchorAliases: tab.anchors?.[document], anchorUnmatched: tab.anchorUnmatched,
      identity: { tab: tab.id, kind: currentPage.kind === "spec" && currentPage.view && currentPage.view.kind !== "overview" ? currentPage.view.kind : currentPage.kind, document }, context, contentLocale, source,
      hidden: currentPage.kind === "markdown" ? currentPage.markdown.hideInMenu : undefined };
    const key = identityKey(page);
    if (pageMap.has(key)) throw new Error(`Duplicate document: ${key}`);
    pageMap.set(key, page);
    return page;
  }
  /** An OpenAPI or MCP reference: its overview, and in a split reference each operation's and model's own page. */
  async function addReference(context: ResolvedSiteContext, tab: ResolvedTab, source: ResolvedOpenApiSource | ResolvedMcpSource): Promise<void> {
    const input = await reader.read(source.spec, context.key);
        const overlays = source.kind === "openapi" ? await Promise.all((source.overlays ?? []).map(async file => [file, (await reader.read(file, source.spec)).digest])) : [];
    const owner = JSON.stringify([source.kind, source.spec, source.kind === "openapi" ? source.overlays ?? [] : undefined, source.kind === "openapi" ? source.overlayUnmatched ?? "error" : undefined, config.exports.openapi]);
    const key = JSON.stringify([input.digest, overlays]);
    const prior = previous?.references.get(owner);
    let reference = cache.references.get(owner);
    if (!reference && previous && prior?.key === key && !await previous.reader.affected(source.spec, changed)) reference = prior;
    if (!reference) {
      if (source.kind === "openapi") {
        const loaded = await loadSpec(source.spec, reader);
        const diagnostics = await applyOverlays(loaded, source, reader);
        const parsed = await parseSpec(loaded, { publishBundle: config.exports.openapi, input: reader });
        reference = { key, spec: shareReferenceSnapshot(normalizeSpec(await convertToOpenApi3(parsed)), prior?.spec), publicDocument: parsed.publicDocument, diagnostics };
      } else {
        const { parse } = await import("mcp-parser");
        reference = { key, spec: shareReferenceSnapshot(normalizeMcpSpec(await parse(source.spec)), prior?.spec) };
      }
    }
    cache.references.set(owner, reference);
    overlayDiagnostics.push(...reference.diagnostics ?? []);
    const spec = reference.spec;
    references.set(tab.slug, spec);
    if (reference.publicDocument) publicSpecs.set(tab.slug, reference.publicDocument);
    const navTab = tab.navigation ? buildAuthoredNavigation(tab, tab.navigation) : buildNavFromSpec(spec, tab.slug, config.prettyUrls);
    navTab.label = tab.label;
    siteTabs.push(navTab);
    const current: Extract<SitePage["currentPage"], { kind: "spec" }> = { kind: "spec", spec, specKey: tab.slug,
      tryIt: source.kind === "mcp" ? false : tab.tryIt ?? config.tryIt };
    const split = tab.reference.split === "operations";
    const overview = add(context, tab, { ...current, view: split ? { kind: "overview" } : undefined }, "introduction", source.spec, tab.contentLocale);
    const operations = spec.operations.filter(op => !op.hidden);
    if (split) {
      const models = !tab.navigation && navTab.groups.find(group => group.label === "Models");
      if (models) { models.href = toPublicUrl(overview.outputPath, undefined, config.baseUrl, config.prettyUrls) + "#models"; models.id = "models"; }
      for (const operation of operations) {
        const document = operationKey(operation);
        add(context, { ...tab, routes: { ...tab.routes, [document]: tab.routes?.[document] ?? operationPagePath(operation, spec, tab.reference.operations) } }, { ...current, view: { kind: "operation", id: document } }, document, source.spec, tab.contentLocale);
      }
      for (const name of Object.keys(spec.schemas)) {
        const document = `schema:${name}`;
        add(context, { ...tab, routes: { ...tab.routes, [document]: tab.routes?.[document] ?? schemaPagePath(name, spec) } }, { ...current, view: { kind: "schema", name } }, document, source.spec, tab.contentLocale);
      }
      return;
    }
    // On one page, an operation's or model's own address stays permanent: it
    // redirects to the section, so the reference can split or join again.
    const page = toPublicPath(overview.outputPath, config.baseUrl, config.prettyUrls);
    const permanent = (address: string | undefined, anchor: string) => {
      if (address) referenceRedirects.set(toPublicPath(routeOutputPath(tab, address), config.baseUrl, config.prettyUrls), { to: `${page}#${anchor}`, status: 301 });
    };
    for (const operation of operations) permanent(tab.routes?.[operationKey(operation)] ?? (tab.reference.operations && operationPagePath(operation, spec, tab.reference.operations)), operationAnchor(operation, spec));
    for (const name of Object.keys(spec.schemas)) permanent(tab.routes?.[`schema:${name}`], definitionAnchor(name, spec));
  }
  /** A reference a Doxygen, Go or Rust source generates, its pages drawn by its loader. */
  async function addGeneratedReference(context: ResolvedSiteContext, tab: ResolvedTab, source: ResolvedDoxygenSource | ResolvedGodocSource | ResolvedRustdocSource): Promise<void> {
    let result;
    const edit = { repo: config.repo, editBranch: context.version.revision ?? config.editBranch };
    const callouts = { icons: config.theme.icons, messages: context.localeConfig.messages };
    if (source.kind === "doxygen") result = await loadDoxygenTab(source.config, tab.slug, tab.label, config.titleSeparator, callouts);
    else if (source.kind === "godoc") {
      const loaded = await loadGodocTab(source.config, tab.slug, tab.label, { ...edit, editBasePath: source.config.sourceBasePath }, reader, callouts);
      godocDiagnostics.push(...loaded.diagnostics); result = loaded;
    } else {
      const loaded = await loadRustdocTab(source.config, tab.slug, tab.label, { ...edit, editBasePath: source.config.sourceBasePath }, reader, callouts);
      rustdocDiagnostics.push(...loaded.diagnostics); result = loaded;
    }
    for (const [id, page] of result.pages) add(context, tab, { kind: "markdown", markdown: page }, id, page.sourcePath);
    siteTabs.push(tab.navigation ? buildAuthoredNavigation(tab, tab.navigation) : result.navTab);
  }
  /** A tab of Markdown pages, outlined in its navigation's order and drawn once the site's routes compile. */
  async function addMarkdownTab(context: ResolvedSiteContext, tab: ResolvedTab, content: ResolvedMarkdownSource): Promise<void> {
    // A tab's pages load together, so one page's media and diagram work overlaps another's
    // (the heavy-job budget bounds it); they are kept in navigation order, first listing wins.
    const listed = new Set<string>();
    const slugs = content.slugs;
    const loaded = await Promise.all([...markdownPages(content.groups)].filter(rp => !listed.has(rp.slug) && listed.add(rp.slug)).map(async rp => {
      const input = await reader.read(rp.file, context.key);
      const key = JSON.stringify([rp.file, input.digest, rp.slug, config.changelog.enabled, rp.title, context.key, config.theme.icons, config.markdown.smartypants]);
      let source = previous?.documents.get(key);
      if (!source || previous && await previous.reader.affected(rp.file, changed)) {
        source = await loadDocsSource(rp.file, slugFromPath(rp.slug, slugs), { ...loadOptions(context, rp.contentLocale ?? context.locale), changelog: config.changelog.enabled,
          sourceRoot: rp.sourceRoot, preprocess: rp.preprocess, title: rp.title });
      }
      return { rp, key, source };
    }));
    for (const { key, source } of loaded) cache.documents.set(key, source);
    const published = loaded.filter(({ source }) => source.kind !== "markdown" || !source.draft);
    const sources = new Map(published.map(({ rp, source }) => [rp.slug, source]));
    const navTab = tab.navigation ? buildAuthoredNavigation(tab, tab.navigation) : buildNavFromPages(tab, sources, config.prettyUrls, (source, reference) => {
      const documentId = source.id ?? slugFromPath(reference, slugs);
      return toPublicUrl(outputPathFor(tab, documentId, source.slug), undefined, config.baseUrl, config.prettyUrls);
    }, context.localeConfig.messages.navigation);
    for (const { rp, source } of published) {
      const documentId = source.kind === "markdown" ? source.id ?? slugFromPath(rp.slug, slugs) : slugFromPath(rp.slug, slugs);
      const page = outlineDocsSource(source);
      if (page.kind === "changelog") changelogDiagnostics.push(...page.changelog.diagnostics);
      const record = add(context, tab, page.kind === "markdown" ? { kind: "markdown", markdown: page } : { kind: "changelog", changelog: page }, documentId, rp.file, rp.contentLocale ?? context.locale);
      drafts.set(record, { source, navigation: navTab, document: documentId });
    }
    siteTabs.push(navTab);
  }
  for (const context of config.contexts) for (const tab of context.tabs) {
    const source = tab.source;
    if (source.kind === "openapi" || source.kind === "mcp") await addReference(context, tab, source);
    else if (source.kind === "markdown") await addMarkdownTab(context, tab, source);
    else await addGeneratedReference(context, tab, source);
  }
  // Section destinations exist before routes compile; their link content is a
  // projection of final navigation and is rendered only after target resolution.
  for (const context of config.contexts) for (const tab of context.tabs) {
    const nav = siteTabs.find(value => value.slug === tab.slug)!;
    if (nav.kind !== "docs" && !tab.navigation) continue;
    function sectionPage(id: string, slug: string, title: string, content: () => string): string {
      const page: MarkdownPage = { kind: "markdown", title, description: "", slug, markdown: "", html: "", headings: [], sourcePath: "", editPath: null };
      sectionRenders.push({ page, content });
      const record = add(context, tab, { kind: "markdown", markdown: page }, id);
      return toPublicUrl(record.outputPath, undefined, config.baseUrl, config.prettyUrls);
    }
    const wide = nav.groups.length > 20;
    for (const group of [...walkNavGroups(nav.groups)].reverse()) {
      if (group.href || group.items.length <= 80 && !(wide && nav.groups.includes(group))) continue;
      const id = `section:${group.id ?? group.label}`;
      const slug = `_sections/${slugify(group.label) || "pages"}-${createHash("sha256").update(id).digest("hex").slice(0,8)}`;
      const title = context.localeConfig.messages.navigation?.[group.id ?? ""] ?? group.label;
      group.href = sectionPage(id, slug, title, () => [...walkNavItems([group])].map(item => `- [${item.label.replace(/\]/g, "\\]")}](${item.href})`).join("\n"));
    }
    if (wide) {
      const label = context.localeConfig.messages.sections;
      nav.sectionIndex = { label, href: sectionPage("section-index", "_sections/index", label, () => nav.groups.map(group => `- [${group.label}](${group.href})`).join("\n")) };
    }
  }
  if (config.changelog.permalinks) addPermalinkPages(pageMap, config.prettyUrls);
  prettyNavigationHrefs(siteTabs, config);
  const statusPath = config.host?.statusPageFormat === "directory" ? "404/index.html" : "404.html";
  if (config.pages) await addSitePages(config.pages);
  const defaultContext = config.contexts.find(context => context.isDefaultVersion && context.locale === context.defaultLocale && context.scope === "site") ?? config.contexts[0];
  const home = siteTabs.find(tab => defaultContext?.tabs.some(member => member.slug === tab.slug));
  if (config.notFound && defaultContext && home && ![...pageMap.values()].some(page => page.status === 404)) {
    const messages = defaultContext.localeConfig.messages;
    const page: SitePage = { outputPath: statusPath, currentPage: { kind: "not-found", title: messages.notFound, description: messages.notFoundDescription, homeHref: home.href },
      tabSlug: home.slug, pageSlug: "404", identity: { tab: "@site", kind: "not-found", document: "404" }, context: defaultContext, contentLocale: defaultContext.locale, hidden: true, status: 404 };
    pageMap.set(identityKey(page), page);
  }
  const pages = [...pageMap.values()];
  for (const context of config.contexts) for (const tab of context.tabs) for (const document of Object.keys(tab.anchors ?? {})) {
    if (!pages.some(page => page.context.key === context.key && page.identity.tab === tab.id && page.identity.document === document)) {
      validateAnchorAliases(tab.anchors![document], `${tab.id}/${document}`);
      reportUnmatchedAnchor(tab.anchorUnmatched ?? "error", { severity: "warning", code: "anchor-unmatched", tab: tab.id, document, message: `Fragment aliases target an unknown document: ${tab.id}/${document} (${context.key}).` }, anchorDiagnostics);
    }
  }
  const redirects = { ...config.redirects };
  for (const [from, redirect] of referenceRedirects) {
    if (redirects[from]) throw new Error(`Redirect ${from} is also an operation or model address`);
    redirects[from] = redirect;
  }
  const routes = new RouteTable(pages, config.baseUrl, config.prettyUrls, Boolean(config.host) && config.landingPage, redirects, Boolean(config.host));
  anchorDiagnostics.push(...routes.anchorDiagnostics);
  const targetsByTab = new Map<string, ReferenceTargets>();
  for (const page of pages) {
    if (page.currentPage.kind !== "spec" || targetsByTab.has(page.tabSlug)) continue;
    targetsByTab.set(page.tabSlug, routes.referenceTargets(page)!);
  }
  const resolveNavigation = navigationResolver(config, routes, references, targetsByTab);
  for (const context of config.contexts) for (const tab of context.tabs) {
    const nav = siteTabs.find(nav => nav.slug === tab.slug)!;
    resolveNavigation(nav, tab, context);
    localizeNavigation(nav, context);
  }
  prettyNavigationHrefs(siteTabs, config);
  // Standalone, the site is Sourcey's: a root no page publishes leads to the first section.
  const root = toPublicPath("index.html", config.baseUrl, config.prettyUrls);
  if (!config.host && home && !routes.match(root) && !routes.redirectFor(root)) routes.addRedirects({ [root]: { to: joinHref(normalizeBaseUrl(config.baseUrl) || "/", home.href), status: 302 } });
  for (const { page, content } of sectionRenders) { const body = content(); page.markdown = `# ${page.title}\n\n${body}\n`; page.html = renderMarkdown(body); }
  for (const page of pages) if (page.currentPage.kind === "not-found" && home) page.currentPage.homeHref = home.href;
  const navigationByContext = new Map<string, ReturnType<typeof buildSiteNavigation>>();
  for (const page of pages) {
    const context = page.context;
    const members = config.contexts.filter(c => c.locale === context.locale && (c.scope === context.scope ? c.version.id === context.version.id : c.isDefaultVersion));
    page.referenceTargets = targetsByTab.get(page.tabSlug);
    page.canonical = routes.byKey.get(identityKey(page))?.canonical;
    const equivalents = routes.equivalents(page);
    // A site page has its own in each language, and no versions.
    const own = page.identity.tab === SITE_PAGES;
    const choices = config.contexts.filter(candidate => candidate.scope === context.scope && (own ? candidate.version.id === context.version.id : candidate.tabs.some(tab => tab.id === page.identity.tab)));
    function choice(candidate: ResolvedSiteContext, kind: "locale" | "version") {
      const route = equivalents.find(route => route.page.context.key === candidate.key);
      const tab = own ? undefined : candidate.tabs.find(tab => tab.id === page.identity.tab)!;
      const landing = tab && siteTabs.find(nav => nav.slug === tab.slug)?.href;
      if (!route && !landing) return [];
      const label = kind === "locale" ? candidate.localeConfig.label : candidate.version.label;
      return [{ kind, label: route ? label : `${label} · ${context.localeConfig.messages.overview}`,
        href: route?.publicPath ?? landing!, lang: kind === "locale" && route?.page.contentLocale === candidate.locale ? candidate.localeConfig.lang : undefined,
        anchors: route ? [...routes.byKey.get(identityKey(page))!.anchors].filter(anchor => route.anchors.has(anchor)) : undefined,
        active: kind === "locale" ? candidate.locale === context.locale : candidate.version.id === context.version.id }];
    }
    page.equivalents = [
      ...choices.filter(candidate => candidate.version.id === context.version.id).flatMap(candidate => choice(candidate, "locale")),
      ...choices.filter(candidate => candidate.locale === context.locale).flatMap(candidate => choice(candidate, "version")),
    ];
    let nav = navigationByContext.get(context.key);
    if (!nav) {
      // Version scopes select content; authored section order still owns the header.
      const selectedTabs = members.flatMap(member => member.tabs);
      const ordered = config.authoring.navigation.tabs.flatMap(authored => {
        const selected = selectedTabs.find(tab => authored.id ? tab.id === authored.id : tab.label === authored.tab);
        const projected = selected && siteTabs.find(tab => tab.slug === selected.slug);
        return projected ? [projected] : [];
      });
      nav = buildSiteNavigation(ordered);
      navigationByContext.set(context.key, nav);
    }
    page.navigation = nav;
  }
  // Pages are drawn, and linked, one language and version at a time. A page
  // names operations in the references its navigation can reach.
  for (const context of config.contexts) {
    const members = config.contexts.filter(c => c.locale === context.locale && (c.scope === context.scope ? c.version.id === context.version.id : c.isDefaultVersion));
    const linked = members.flatMap(member => member.tabs).flatMap(tab => targetsByTab.has(tab.slug) ? [{ id: tab.id, targets: targetsByTab.get(tab.slug)! }] : []);
    drawPages(pages.filter(p => p.context.key === context.key), config, routes, drafts, cache.pages, previous?.pages, linked);
  }
  const extraFiles = attachChangelogFeeds(pages, config);
  await attachSiteFiles(extraFiles, pages, tabs, config, reader);
  const contentDiagnostics = [...new Map(pages.flatMap(page => page.currentPage.kind === "markdown" ? page.currentPage.markdown.diagnostics ?? [] : []).map(diagnostic => [JSON.stringify(diagnostic), diagnostic])).values()];
  return { publicSpecs, siteTabs, references, pageMap, routes, referenceTargets: targetsByTab, cache, changelogDiagnostics, godocDiagnostics, rustdocDiagnostics, overlayDiagnostics, contentDiagnostics, anchorDiagnostics, extraFiles };
}

/** A page still to draw from its content: its source, and the navigation and document its page lists read. */
interface PageDraft { source: DocsSource; navigation?: SiteTab; document: string }
type PageDrafts = Map<SitePage, PageDraft>;

/**
 * Draw one language and version's pages against the site's routes. A page
 * from content is drawn now, its HTML, summary and Markdown export linking
 * where the routes publish each page; its export resolves only what its
 * content marked as links. A page an adapter drew has its HTML and text
 * relinked. A page whose source and routes are the previous build's is that
 * build's page.
 */
function drawPages(pages: SitePage[], config: ResolvedConfig, routes: RouteTable, drafts: ReadonlyMap<SitePage, PageDraft>,
  cache: AssemblyCache["pages"], previous: AssemblyCache["pages"] | undefined, references: readonly LinkedReference[]): void {
  const links = siteLinks(pages, config, references);
  for (const page of pages) {
    const draft = drafts.get(page);
    const source = draft?.source ?? (page.currentPage.kind === "markdown" ? page.currentPage.markdown : page.currentPage.kind === "changelog" ? page.currentPage.changelog : undefined);
    if (!source) continue;
    const scope = links.scope(page);
    // A page with no source of its own, such as a long section's index, links as it was written.
    if (!scope && !draft) continue;
    // A page list's content follows the navigation it lists.
    const lists = draft?.navigation && draft.source.kind === "markdown" ? sectionIndexDependencies(draft.source.nodes, draft.navigation, draft.document) : "";
    const key = JSON.stringify([links.digest, scope?.sourceBase, lists]);
    const cached = previous?.get(page.outputPath);
    const document = cached?.source === source && cached.key === key ? cached.page
      : draft ? drawDraft(draft, scope, routes.byKey.get(identityKey(page))!.anchors, page.outputPath)
      : relinked(source as DocsPage, scope!);
    page.currentPage = document.kind === "markdown" ? { kind: "markdown", markdown: document } : { kind: "changelog", changelog: document };
    cache.set(page.outputPath, { source, key, page: document });
  }
}

/** A page drawn from its content, its links resolved where it has a source to resolve them from. */
function drawDraft({ source, navigation, document }: PageDraft, scope: LinkScope | undefined, anchors: ReadonlySet<string>, outputPath: string): DocsPage {
  const drawn = drawDocsSource(source, navigation, document);
  if (drawn.kind === "changelog") return scope ? relinked(drawn, scope) : drawn;
  // Its routes were compiled from its outline; what its page lists draw must not move them.
  const ids = drawn.anchors ?? drawn.headings.map(heading => heading.id);
  if (new Set(ids).size !== anchors.size || ids.some(anchor => !anchors.has(anchor))) throw new Error(`Navigation-derived content changed route anchors: ${outputPath}`);
  const markdown = source as MarkdownSource;
  if (!scope) return { ...drawn, ...docsExport(markdown, navigation, document) };
  return { ...drawn, ...docsExport(markdown, navigation, document, pageLinks(scope, markdown.definitions)),
    description: rewriteMarkdownLinks(drawn.description, scope), html: rewriteHtmlLinks(drawn.html, scope) };
}

/** A page drawn elsewhere, an adapter's or a changelog's, with its links resolved; the drawn page is left as it was. */
function relinked(source: DocsPage, scope: LinkScope): DocsPage {
  if (source.kind === "markdown") {
    // A page an adapter drew, such as Doxygen's, holds its export as text.
    return { ...source, markdown: rewriteMarkdownLinks(source.markdown, scope),
      ...(source.readerMarkdown !== undefined && { readerMarkdown: rewriteMarkdownLinks(source.readerMarkdown, scope) }),
      description: rewriteMarkdownLinks(source.description, scope), html: rewriteHtmlLinks(source.html, scope) };
  }
  const changelog = structuredClone(source);
  for (const version of changelog.changelog.versions) {
    if (version.summary) version.summary = rewriteMarkdownLinks(version.summary, scope);
    for (const section of version.sections) {
      for (const entry of section.entries) {
        entry.html = rewriteHtmlLinks(entry.html, scope);
        entry.links = entry.links.map((link) => ({ ...link, href: resolveInternalHref(link.href, scope) ?? link.href }));
      }
    }
  }
  return changelog;
}

