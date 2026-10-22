import { rewriteMarkdownDestinations } from "./utils/markdown-links.js";
import { createHash } from "node:crypto";
import { OPERATION_LINK, renderMarkdown } from "./utils/markdown.js";
import { htmlId } from "./utils/html-id.js";
import { operationAnchor, operationKey, definitionAnchor, operationPagePath, schemaPagePath, referenceOperation } from "./core/reference-identity.js";
import { dirname, posix, relative, resolve } from "node:path";
import { InputReader, loadSpec, type InputReaderOptions } from "./core/loader.js";
import { applyOverlays, formatOverlayDiagnostic, type OverlayDiagnostic } from "./core/overlay.js";
import { convertToOpenApi3 } from "./core/converter.js";
import { parseSpec } from "./core/parser.js";
import { normalizeSpec } from "./core/normalizer.js";
import { normalizeMcpSpec } from "./core/mcp-normalizer.js";
import { shareReferenceSnapshot } from "./core/reference-snapshot.js";
import { docsExport, drawDocsSource, loadDocsSource, outlineDocsSource, slugFromPath, type ContentDiagnostic, type LoadDocsPageOptions, type MarkdownSource } from "./core/markdown-loader.js";
import { loadDoxygenTab } from "./core/doxygen-loader.js";
import { loadGodocTab, type GodocLoaderDiagnostic } from "./core/godoc-loader.js";
import { loadRustdocTab, type RustdocLoaderDiagnostic } from "./core/rustdoc-loader.js";
import { buildNavFromSpec, buildNavFromPages, buildAuthoredNavigation, buildSiteNavigation, walkNavGroups, walkNavItems, isNavGroup } from "./core/navigation.js";
import { navigationResolver } from "./core/navigation-targets.js";
import { generateChangelogFeeds } from "./renderer/changelog-feed.js";
import { pageOutputPath, tabPath } from "./config.js";
import type { PrettyUrls, Redirect, ResolvedConfig, ResolvedTab } from "./config.js";
import type { ChangelogPage, DocsPage, DocsSource, MarkdownPage } from "./core/markdown-loader.js";
import type { ResolvedMarkdownSource } from "./adapters/types.js";
import type { SiteTab } from "./core/navigation.js";
import type { ContentLinks } from "./core/markdown-components.js";
import type { Links } from "marked";
import type {
  ChangelogDiagnostic,
  NormalizedChangelogVersion,
  NormalizedSpec,
} from "./core/types.js";
import { RouteTable, SITE_PAGES, identityKey, reportUnmatchedAnchor, validateAnchorAliases, type AnchorDiagnostic, type ReferenceTarget, type ReferenceTargets, type SitePage, type ResolvedSiteContext } from "./core/site-model.js";
import { sitePageFiles } from "./core/site-pages.js";
import { english } from "./core/messages.js";
import { sectionIndexDependencies } from "./core/markdown-components.js";
import { markdownPages } from "./adapters/shared.js";
import type { SiteConfig } from "./renderer/context.js";
import { joinHref, normalizeBaseUrl, toPrettyLink, toPublicPath, toPublicUrl, type LinkStyle } from "./site-url.js";
import { consoleArtifactPath, consoleData } from "./renderer/try-it.js";
import { stringifyShared } from "./core/shared-json.js";
import { staticMediaAsset } from "./core/media.js";
import type { ArtifactBody } from "./core/source-file.js";

export interface AssemblyCache {
  reader: InputReader;
  documents: Map<string, DocsSource>;
  references: Map<string, { key: string; spec: NormalizedSpec; publicDocument?: Record<string, unknown>; diagnostics?: OverlayDiagnostic[] }>;
  /** Each page as drawn and linked, by output path, with the source and the routes it was drawn from. */
  pages: Map<string, { source: DocsSource | DocsPage; key: string; page: DocsPage }>;
}
export interface SiteAssembly {
  publicSpecs: Map<string, Record<string, unknown>>;
  siteTabs: SiteTab[];
  references: Map<string, NormalizedSpec>;
  pageMap: Map<string, SitePage>;
  routes: RouteTable;
  cache: AssemblyCache;
  changelogDiagnostics: ChangelogDiagnostic[];
  godocDiagnostics: GodocLoaderDiagnostic[];
  rustdocDiagnostics: RustdocLoaderDiagnostic[];
  overlayDiagnostics: OverlayDiagnostic[];
  contentDiagnostics: ContentDiagnostic[];
  anchorDiagnostics: AnchorDiagnostic[];
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
    const messages = context.localeConfig.messages;
    nav.label = messages?.navigation?.[nav.label] ?? nav.label;
    for (const group of walkNavGroups(nav.groups)) group.label = messages?.navigation?.[group.id ?? ""] ?? group.label;
    for (const item of walkNavItems(nav.groups)) item.label = messages?.navigation?.[item.documentId ?? item.id] ?? messages?.navigation?.[item.id] ?? item.label;
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
      context: { locale: context.locale, lang: context.localeConfig.lang ?? context.locale, dir: context.localeConfig.dir ?? "ltr", contentLocale, version: context.version, versionScope: context.scope, messages: context.localeConfig.messages, icons: config.theme.icons } };
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
  for (const context of config.contexts) for (const tab of context.tabs) {
    if (tab.source.kind === "openapi" || tab.source.kind === "mcp") {
      const input = await reader.read(tab.source.spec, context.key);
      const source = tab.source;
      const overlays = source.kind === "openapi" ? await Promise.all((source.overlays ?? []).map(async file => [file, (await reader.read(file, source.spec)).digest])) : [];
      const owner = JSON.stringify([source.kind, source.spec, source.kind === "openapi" ? source.overlays ?? [] : undefined, source.kind === "openapi" ? source.overlayUnmatched ?? "error" : undefined, config.exports.openapi]);
      const key = JSON.stringify([input.digest, overlays]);
      const prior = previous?.references.get(owner);
      let reference = cache.references.get(owner);
      if (!reference && previous && prior?.key === key && !await previous.reader.affected(source.spec, changed)) reference = prior;
      if (!reference) {
        if (tab.source.kind === "openapi") {
          const loaded = await loadSpec(tab.source.spec, reader);
          const diagnostics = await applyOverlays(loaded, tab.source, reader);
          const parsed = await parseSpec(loaded, { publishBundle: config.exports.openapi, input: reader });
          reference = { key, spec: shareReferenceSnapshot(normalizeSpec(await convertToOpenApi3(parsed)), prior?.spec), publicDocument: parsed.publicDocument, diagnostics };
        } else {
          const { parse } = await import("mcp-parser");
          reference = { key, spec: shareReferenceSnapshot(normalizeMcpSpec(await parse(tab.source.spec)), prior?.spec) };
        }
        cache.references.set(owner, reference);
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
        tryIt: tab.source.kind === "mcp" ? false : tab.tryIt ?? config.tryIt };
      const split = tab.reference.split === "operations";
      const overview = add(context, tab, { ...current, view: split ? { kind: "overview" } : undefined }, "introduction", tab.source.spec, tab.contentLocale);
      const operations = spec.operations.filter(op => !op.hidden);
      if (split) {
        const models = !tab.navigation && navTab.groups.find(group => group.label === "Models");
        if (models) { models.href = toPublicUrl(overview.outputPath, undefined, config.baseUrl, config.prettyUrls) + "#models"; models.id = "models"; }
        for (const operation of operations) {
          const document = operationKey(operation);
          add(context, { ...tab, routes: { ...tab.routes, [document]: tab.routes?.[document] ?? operationPagePath(operation, spec, tab.reference.operations) } }, { ...current, view: { kind: "operation", id: document } }, document, tab.source.spec, tab.contentLocale);
        }
        for (const name of Object.keys(spec.schemas)) {
          const document = `schema:${name}`;
          add(context, { ...tab, routes: { ...tab.routes, [document]: tab.routes?.[document] ?? schemaPagePath(name, spec) } }, { ...current, view: { kind: "schema", name } }, document, tab.source.spec, tab.contentLocale);
        }
        continue;
      }
      // On one page, an operation's or model's own address stays permanent: it
      // redirects to the section, so the reference can split or join again.
      const page = toPublicPath(overview.outputPath, config.baseUrl, config.prettyUrls);
      const permanent = (address: string | undefined, anchor: string) => {
        if (address) referenceRedirects.set(toPublicPath(routeOutputPath(tab, address), config.baseUrl, config.prettyUrls), { to: `${page}#${anchor}`, status: 301 });
      };
      for (const operation of operations) permanent(tab.routes?.[operationKey(operation)] ?? (tab.reference.operations && operationPagePath(operation, spec, tab.reference.operations)), operationAnchor(operation, spec));
      for (const name of Object.keys(spec.schemas)) permanent(tab.routes?.[`schema:${name}`], definitionAnchor(name, spec));
      continue;
    }
    if (tab.source.kind !== "markdown") {
      let result;
      const edit = { repo: config.repo, editBranch: context.version.revision ?? config.editBranch };
      const callouts = { icons: config.theme.icons, messages: context.localeConfig.messages };
      if (tab.source.kind === "doxygen") result = await loadDoxygenTab(tab.source.config, tab.slug, tab.label, config.titleSeparator, callouts);
      else if (tab.source.kind === "godoc") {
        const loaded = await loadGodocTab(tab.source.config, tab.slug, tab.label, { ...edit, editBasePath: tab.source.config.sourceBasePath }, reader, callouts);
        godocDiagnostics.push(...loaded.diagnostics); result = loaded;
      } else {
        const loaded = await loadRustdocTab(tab.source.config, tab.slug, tab.label, { ...edit, editBasePath: tab.source.config.sourceBasePath }, reader, callouts);
        rustdocDiagnostics.push(...loaded.diagnostics); result = loaded;
      }
      for (const [id, page] of result.pages) add(context, tab, { kind: "markdown", markdown: page }, id, page.sourcePath);
      siteTabs.push(tab.navigation ? buildAuthoredNavigation(tab, tab.navigation) : result.navTab); continue;
    }
    // A tab's pages load together, so one page's media and diagram work overlaps another's
    // (the heavy-job budget bounds it); they are kept in navigation order, first listing wins.
    const listed = new Set<string>();
    const slugs = tab.source.slugs;
    const loaded = await Promise.all([...markdownPages(tab.source.groups)].filter(rp => !listed.has(rp.slug) && listed.add(rp.slug)).map(async rp => {
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
      const documentId = source.id ?? slugFromPath(reference, tab.source.kind === "markdown" ? tab.source.slugs : "normalized");
      return toPublicUrl(outputPathFor(tab, documentId, source.slug), undefined, config.baseUrl, config.prettyUrls);
    }, context.localeConfig.messages?.navigation);
    for (const { rp, source } of published) {
      const documentId = source.kind === "markdown" ? source.id ?? slugFromPath(rp.slug, slugs) : slugFromPath(rp.slug, slugs);
      const page = outlineDocsSource(source);
      if (page.kind === "changelog") changelogDiagnostics.push(...page.changelog.diagnostics);
      const record = add(context, tab, page.kind === "markdown" ? { kind: "markdown", markdown: page } : { kind: "changelog", changelog: page }, documentId, rp.file, rp.contentLocale ?? context.locale);
      drafts.set(record, { source, navigation: navTab, document: documentId });
    }
    siteTabs.push(navTab);
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
      const slug = `_sections/${htmlId(group.label) || "pages"}-${createHash("sha256").update(id).digest("hex").slice(0,8)}`;
      const title = context.localeConfig.messages.navigation?.[group.id ?? ""] ?? group.label;
      group.href = sectionPage(id, slug, title, () => [...walkNavItems([group])].map(item => `- [${item.label.replace(/\]/g, "\\]")}](${item.href})`).join("\n"));
    }
    if (wide) {
      const label = context.localeConfig.messages?.sections ?? english.sections;
      nav.sectionIndex = { label, href: sectionPage("section-index", "_sections/index", label, () => nav.groups.map(group => `- [${group.label}](${group.href})`).join("\n")) };
    }
  }
  if (config.changelog.permalinks) addPermalinkPages(pageMap, config.prettyUrls);
  normalizeNavigationHrefs(siteTabs, config);
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
  normalizeNavigationHrefs(siteTabs, config);
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
      return [{ kind, label: route ? label : `${label} · ${context.localeConfig.messages?.overview ?? english.overview}`,
        href: route?.publicPath ?? landing!, lang: kind === "locale" && route?.page.contentLocale === candidate.locale ? candidate.localeConfig.lang ?? candidate.locale : undefined,
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
  const emittedConsoles = new Set<string>();
  for (const page of pages) {
    if (emittedConsoles.has(page.tabSlug)) continue;
    if (page.currentPage.kind !== "spec" || page.currentPage.tryIt === false) continue;
    emittedConsoles.add(page.tabSlug);
    for (const operation of page.currentPage.spec.operations) {
      if (operation.hidden || operation.mcpExtras) continue;
      const scope = page.currentPage.specKey ?? page.tabSlug;
      extraFiles.set(consoleArtifactPath(scope, operation), stringifyShared(
        consoleData(operation, page.currentPage.spec, scope, config.codeSamples, page.currentPage.tryIt)));
    }
  }
  for (const page of pages) if (page.currentPage.kind === "markdown") for (const [path, body] of page.currentPage.markdown.assets ?? []) extraFiles.set(path, body);
  // A page's own stylesheets, published once each as the theme's are.
  const stylesheets = new Map<string, string>();
  for (const page of pages) {
    const files = page.currentPage.kind === "markdown" ? page.currentPage.markdown.css ?? [] : [];
    for (const file of files) {
      let path = stylesheets.get(file);
      if (!path) {
        const css = await loadCustomCSS([file], reader, async source => {
          const asset = await staticMediaAsset(source, reader, file);
          extraFiles.set(asset.path, asset.body);
          return toPublicUrl(asset.path, undefined, config.baseUrl, config.prettyUrls);
        }, file);
        path = `_media/${createHash("sha256").update(css).digest("hex").slice(0, 20)}.css`;
        extraFiles.set(path, css);
        stylesheets.set(file, path);
      }
      (page.stylesheets ??= []).push(path);
    }
  }
  await attachSourceAssets(extraFiles, tabs, reader);
  if (config.publicDir) {
    const { publicAssets } = await import("./core/media.js");
    for (const [path, body] of await publicAssets(config.publicDir, reader)) {
      if (extraFiles.has(path)) throw new Error(`Public asset collides with a generated artifact: ${path}`);
      extraFiles.set(path, body);
    }
  }
  const contentDiagnostics = [...new Map(pages.flatMap(page => page.currentPage.kind === "markdown" ? page.currentPage.markdown.diagnostics ?? [] : []).map(diagnostic => [JSON.stringify(diagnostic), diagnostic])).values()];
  return { publicSpecs, siteTabs, references, pageMap, routes, cache, changelogDiagnostics, godocDiagnostics, rustdocDiagnostics, overlayDiagnostics, contentDiagnostics, anchorDiagnostics, extraFiles };
}

/** One reporting projection for the CLI, preview server and host integrations. */
export function formatBuildDiagnostics(result: Pick<SiteAssembly, "changelogDiagnostics" | "godocDiagnostics" | "rustdocDiagnostics" | "overlayDiagnostics" | "contentDiagnostics" | "anchorDiagnostics">): string[] {
  return [
    ...result.changelogDiagnostics.map(formatChangelogDiagnostic),
    ...result.godocDiagnostics.map(formatGodocDiagnostic),
    ...result.rustdocDiagnostics.map(formatRustdocDiagnostic),
    ...result.overlayDiagnostics.map(formatOverlayDiagnostic),
    ...result.contentDiagnostics.map(formatContentDiagnostic),
    ...result.anchorDiagnostics.map(diagnostic => `anchor [${diagnostic.code}]: ${diagnostic.message} Unmatched aliases are omitted.`),
  ];
}

export function formatContentDiagnostic(diagnostic: ContentDiagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`;
}

export function formatGodocDiagnostic(diag: GodocLoaderDiagnostic): string {
  const sev = diag.severity.toUpperCase();
  const where = diag.package ? ` [${diag.package}]` : "";
  const loc = diag.file ? ` ${diag.file}${diag.line ? `:${diag.line}` : ""}` : "";
  return `[${sev}] ${diag.code}${where}${loc} ${diag.message}`;
}

export function enforceGodocDiagnostics(diagnostics: GodocLoaderDiagnostic[]): void {
  const error = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) throw new Error(formatGodocFailure(error));
}

export function enforceRustdocDiagnostics(diagnostics: RustdocLoaderDiagnostic[]): void {
  const error = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) throw new Error(formatRustdocFailure(error));
}

function formatGodocFailure(diagnostic: GodocLoaderDiagnostic): string {
  const where = diagnostic.package ? ` (${diagnostic.package})` : "";
  const loc = diagnostic.file
    ? ` ${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
    : "";
  return `[${diagnostic.code}]${where}${loc}: ${diagnostic.message}`;
}

export function formatRustdocDiagnostic(diagnostic: RustdocLoaderDiagnostic): string {
  const location = diagnostic.file
    ? ` ${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
    : "";
  const cratePrefix = diagnostic.crate ? ` [${diagnostic.crate}]` : "";
  return `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${cratePrefix}${location} ${diagnostic.message}`;
}

function formatRustdocFailure(diagnostic: RustdocLoaderDiagnostic): string {
  const location = diagnostic.file
    ? ` ${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
    : "";
  const cratePrefix = diagnostic.crate ? ` (${diagnostic.crate})` : "";
  return `[${diagnostic.code}]${cratePrefix}${location}: ${diagnostic.message}`;
}

/** Searchable pages by the tab that owns them; a site page's owner is its language's site pages. */
export function collectDocsPagesByTab(
  pageMap: Map<string, SitePage>,
): Map<string, import("./core/search-indexer.js").SearchDocument[]> {
  const docsPagesByTab = new Map<string, import("./core/search-indexer.js").SearchDocument[]>();
  for (const page of pageMap.values()) {
    if (page.status === 404 || !isSearchableDocsSitePage(page)) continue;
    const tabPages = docsPagesByTab.get(page.tabSlug) ?? [];
    tabPages.push({ page: page.currentPage.kind === "markdown" ? page.currentPage.markdown : page.currentPage.changelog, url: page.publicPath! });
    docsPagesByTab.set(page.tabSlug, tabPages);
  }
  return docsPagesByTab;
}

function normalizeNavigationHrefs(siteTabs: SiteTab[], links: LinkStyle): void {
  for (const tab of siteTabs) {
    tab.href = toPrettyLink(tab.href, links);
    for (const group of walkNavGroups(tab.groups)) {
      for (const item of group.items) {
        if (isNavGroup(item)) continue;
        item.href = toPrettyLink(item.href, links);
      }
    }
  }
}

export function enforceChangelogDiagnostics(
  diagnostics: ChangelogDiagnostic[],
  strictChangelog = false,
): void {
  const error = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (error) {
    throw new Error(formatChangelogFailure(error));
  }

  if (!strictChangelog) return;

  const warning = diagnostics.find((diagnostic) => diagnostic.severity === "warning");
  if (warning) {
    throw new Error(formatChangelogFailure(warning));
  }
}

export function formatChangelogDiagnostic(diagnostic: ChangelogDiagnostic): string {
  const location = diagnostic.version ? ` (${diagnostic.version})` : "";
  const line = diagnostic.line ? ` line ${diagnostic.line}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}${line}: ${diagnostic.message}`;
}

export function formatChangelogFailure(diagnostic: ChangelogDiagnostic): string {
  const location = diagnostic.version ? ` (${diagnostic.version})` : "";
  const line = diagnostic.line ? ` line ${diagnostic.line}` : "";
  return `[${diagnostic.code}]${location}${line}: ${diagnostic.message}`;
}

export function formatChangelogDiagnostics(diagnostics: ChangelogDiagnostic[]): string[] {
  return diagnostics.map(formatChangelogDiagnostic);
}

export async function buildSiteConfig(config: ResolvedConfig, input: InputReader, assets: Map<string, ArtifactBody>): Promise<SiteConfig> {
  async function assetUrl(source: string): Promise<string> {
    if (!source || /^(?:data:|https?:\/\/)/.test(source)) return source;
    const asset = await staticMediaAsset(source, input, "site");
    assets.set(asset.path, asset.body);
    return toPublicUrl(asset.path, undefined, config.baseUrl, config.prettyUrls);
  }
  const logo = config.logo
    ? {
        light: await assetUrl(config.logo.light ?? ""),
        dark: config.logo.dark ? await assetUrl(config.logo.dark) : undefined,
        href: config.logo.href,
        mark: config.logo.mark,
      }
    : undefined;

  const customCSS = await loadCustomCSS(config.theme.css, input, assetUrl);

  return {
    name: config.name,
    tryIt: config.tryIt,
    titleSeparator: config.titleSeparator,
    siteUrl: config.siteUrl,
    baseUrl: config.baseUrl,
    prettyUrls: config.prettyUrls,
    theme: config.theme,
    logo: logo?.light ? logo : undefined,
    favicon: config.favicon ? await assetUrl(config.favicon) : undefined,
    repo: config.repo,
    editBranch: config.editBranch,
    editBasePath: config.editBasePath,
    codeSamples: config.codeSamples,
    navbar: config.navbar,
    footer: config.footer,
    customCSS: customCSS || undefined,
    changelog: config.changelog,
    ...(config.markdown.smartypants ? { smartypants: true } : {}),
  };
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
  const pathMap = new Map<string, string>();
  addSourceAssetAliases(pathMap, config.contexts.flatMap(c => c.tabs), config.configDir);
  for (const page of pages) {
    const out = page.outputPath;
    const clean = out.replace(/\/index\.html$/, "").replace(/\.html$/, "");
    pathMap.set(clean, out);

    const docsSourcePath = getCanonicalSourcePath(page);
    if (!docsSourcePath) continue;

    const sourceClean = docsSourcePath
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\.(md|mdx)$/, "");
    pathMap.set(sourceClean, out);

    const sourceRelativeClean = getSourceRootRelativePath(page);
    if (sourceRelativeClean) {
      pathMap.set(sourceRelativeClean, out);
    }
  }

  const repoBase = config.repo?.replace(/\/$/, "");
  const linkDigest = createHash("sha256").update(JSON.stringify([[...pathMap], config.baseUrl, config.prettyUrls, references])).digest("hex");
  for (const page of pages) {
    const draft = drafts.get(page);
    const source = draft?.source ?? (page.currentPage.kind === "markdown" ? page.currentPage.markdown : page.currentPage.kind === "changelog" ? page.currentPage.changelog : undefined);
    if (!source) continue;
    const sourcePath = getDocsSourcePath(page);
    // A page with no source of its own, such as a long section's index, links as it was written.
    if (!sourcePath && !draft) continue;
    const branch = page.context.version.revision ?? config.editBranch;
    const sourceBase = repoBase && branch ? { href: `${repoBase}/tree/${branch}`, root: page.context.version.revision ? page.context.version.content : undefined } : undefined;
    const scope: LinkScope | undefined = sourcePath ? { outputPath: page.outputPath, sourcePath, pathMap, sourceBase, links: config, references, root: config.baseUrl || "/" } : undefined;
    // A page list's content follows the navigation it lists.
    const lists = draft?.navigation && draft.source.kind === "markdown" ? sectionIndexDependencies(draft.source.nodes, draft.navigation, draft.document) : "";
    const key = JSON.stringify([linkDigest, sourceBase, lists]);
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

function attachChangelogFeeds(
  pages: SitePage[],
  config: ResolvedConfig,
): Map<string, ArtifactBody> {
  const extraFiles = new Map<string, ArtifactBody>();
  if (!config.changelog.feed) return extraFiles;

  const changelogPages = pages.filter(isMainChangelogSitePage);
  const globalFeedLinks =
    changelogPages.length === 1
      ? createFeedLinks("feed.xml", "feed.rss", changelogPages[0].currentPage.changelog.title)
      : null;

  for (const page of changelogPages) {
    const changelog = page.currentPage.changelog;
    const versionHref = (version: NormalizedChangelogVersion) => {
      if (config.changelog.permalinks) {
        return toPublicUrl(
          pageOutputPath(page.tabSlug, `${changelog.slug}/${version.id}`, config.prettyUrls),
          config.siteUrl,
          config.baseUrl,
          config.prettyUrls,
        );
      }

      return `${toPublicUrl(page.outputPath, config.siteUrl, config.baseUrl, config.prettyUrls)}#${version.id}`;
    };

    const atomPath =
      globalFeedLinks && changelogPages.length === 1
        ? "feed.xml"
        : tabPath(page.tabSlug, `${changelog.slug}/feed.xml`);
    const rssPath =
      globalFeedLinks && changelogPages.length === 1
        ? "feed.rss"
        : tabPath(page.tabSlug, `${changelog.slug}/feed.rss`);

    const feedConfig = config.changelog.feed || undefined;
    const feeds = generateChangelogFeeds(changelog, {
      atomPath: toPublicUrl(atomPath, config.siteUrl, config.baseUrl, config.prettyUrls),
      rssPath: toPublicUrl(rssPath, config.siteUrl, config.baseUrl, config.prettyUrls),
      pagePath: toPublicUrl(page.outputPath, config.siteUrl, config.baseUrl, config.prettyUrls),
      siteName: config.name,
      title: feedConfig?.title,
      description: feedConfig?.description,
      versionHref,
    });

    extraFiles.set(atomPath, feeds.atom);
    extraFiles.set(rssPath, feeds.rss);

    const feedLinks = createFeedLinks(atomPath, rssPath, changelog.title);
    page.alternateLinks = feedLinks;

    for (const candidate of pages) {
      if (candidate.currentPage.kind !== "changelog") continue;
      if (candidate.currentPage.changelog.sourcePath !== changelog.sourcePath) continue;
      candidate.alternateLinks = feedLinks;
    }
  }

  if (globalFeedLinks) {
    for (const page of pages) {
      if (!page.alternateLinks?.length) {
        page.alternateLinks = globalFeedLinks;
      }
    }
  }

  return extraFiles;
}

async function attachSourceAssets(
  extraFiles: Map<string, ArtifactBody>,
  tabs: ResolvedTab[],
  input: InputReader,
): Promise<void> {
  for (const tab of tabs) {
    if (tab.source.kind !== "markdown") continue;
    for (const asset of tab.source.assets ?? []) {
      extraFiles.set(tabPath(tab.slug, asset.outputPath), (await input.file(asset.file, asset.file)).body);
    }
  }
}

function addPermalinkPages(pageMap: Map<string, SitePage>, prettyUrls: PrettyUrls): void {
  const changelogPages = Array.from(pageMap.values()).filter(isMainChangelogSitePage);
  for (const page of changelogPages) {
    const changelog = page.currentPage.changelog;
    for (const version of changelog.changelog.versions) {
      const permalinkPage: ChangelogPage = {
        ...structuredClone(changelog),
        description: version.summary ?? changelog.description,
        slug: `${changelog.slug}/${version.id}`,
        headings: [],
        permalinkVersionId: version.id,
      };

      const outputPath = pageOutputPath(
        page.tabSlug,
        `${changelog.slug}/${version.id}`,
        prettyUrls,
      );
      pageMap.set(JSON.stringify([page.identity, page.context.key, version.id]), {
        outputPath,
        currentPage: { kind: "changelog", changelog: permalinkPage },
        identity: { ...page.identity, document: `${page.identity.document}/${version.id}` },
        context: page.context,
        contentLocale: page.contentLocale,
        tabSlug: page.tabSlug,
        pageSlug: `${page.pageSlug}--${version.id}`,
      });
    }
  }
}

/**
 * Theme stylesheets, with each relative `url()` (a site's own fonts or images)
 * resolved from the stylesheet's folder and published as a shared asset.
 */
async function loadCustomCSS(paths: string[], input: InputReader, assetUrl: (source: string) => Promise<string>, owner = "site"): Promise<string> {
  const parts: string[] = [];
  for (const path of paths) {
    const css = await input.readText(path, owner);
    const urls = new Map<string, string>();
    for (const [, , target] of css.matchAll(CSS_URL)) {
      if (urls.has(target) || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target)) continue;
      const [file, suffix = ""] = target.split(/(?=[?#])/, 2);
      const source = resolve(dirname(path), file);
      try {
        urls.set(target, (await assetUrl(source)) + suffix);
      } catch (error) {
        throw new Error(`${path} refers to ${target}, which cannot be read: ${(error as Error).message}`, { cause: error });
      }
    }
    parts.push(css.replace(CSS_URL, (match, quote: string, target: string) => (urls.has(target) ? `url(${quote}${urls.get(target)}${quote})` : match)));
  }
  return parts.join("\n");
}
const CSS_URL = /url\(\s*(["']?)([^"')]+?)\1\s*\)/g;

function isMainChangelogSitePage(
  page: SitePage,
): page is SitePage & { currentPage: { kind: "changelog"; changelog: ChangelogPage } } {
  return page.currentPage.kind === "changelog" && !page.currentPage.changelog.permalinkVersionId;
}

function isSearchableDocsSitePage(page: SitePage): page is SitePage & {
  currentPage:
    { kind: "markdown"; markdown: MarkdownPage } | { kind: "changelog"; changelog: ChangelogPage };
} {
  return page.currentPage.kind === "markdown" || isMainChangelogSitePage(page);
}

function createFeedLinks(atomPath: string, rssPath: string, title: string) {
  return [
    { href: atomPath, type: "application/atom+xml", title: `${title} Atom Feed` },
    { href: rssPath, type: "application/rss+xml", title: `${title} RSS Feed` },
  ];
}

function getCanonicalSourcePath(page: SitePage): string | undefined {
  if (page.currentPage.kind === "markdown") return page.currentPage.markdown.sourcePath;
  if (isMainChangelogSitePage(page)) return page.currentPage.changelog.sourcePath;
  return undefined;
}

function getDocsSourcePath(page: SitePage): string | undefined {
  if (page.currentPage.kind === "markdown") return page.currentPage.markdown.sourcePath;
  if (page.currentPage.kind === "changelog") return page.currentPage.changelog.sourcePath;
  return undefined;
}

function getSourceRootRelativePath(page: SitePage): string | undefined {
  if (page.currentPage.kind !== "markdown") return undefined;
  const markdown = page.currentPage.markdown;
  if (!markdown.sourceRoot) return undefined;

  const sourceRoot = normalizeSourcePath(markdown.sourceRoot);
  const sourcePath = normalizeSourcePath(markdown.sourcePath);
  if (!sourcePath.startsWith(`${sourceRoot}/`)) return undefined;
  return stripMarkdownExtension(sourcePath.slice(sourceRoot.length + 1));
}

function addSourceAssetAliases(pathMap: Map<string, string>, tabs: ResolvedTab[], configDir: string): void {
  for (const tab of tabs) {
    if (tab.source.kind !== "markdown") continue;
    for (const asset of tab.source.assets ?? []) {
      const outputPath = tabPath(tab.slug, asset.outputPath);
      pathMap.set(normalizeSourcePath(asset.outputPath), outputPath);
      for (const sourceRoot of sourceRootsForMarkdownSource(tab.source)) {
        const sourceRootPath = normalizeSourcePath(relative(configDir, sourceRoot));
        pathMap.set(posix.join(sourceRootPath, normalizeSourcePath(asset.outputPath)), outputPath);
      }
    }
  }
}

function sourceRootsForMarkdownSource(source: ResolvedMarkdownSource): string[] {
  const roots = new Set<string>();
  for (const page of markdownPages(source.groups)) {
    {
      if (page.sourceRoot) roots.add(page.sourceRoot);
    }
  }
  return [...roots];
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(md|mdx)$/, "");
}

function rewriteHtmlLinks(html: string, scope: LinkScope): string {
  return html.replace(/\b(href|src)="([^"]+)"/g, (match, attr: string, href: string) => {
    const resolved = resolveInternalHref(href, scope);
    return resolved ? `${attr}="${resolved}"` : match;
  });
}

function rewriteMarkdownLinks(markdown: string, scope: LinkScope, definitions?: Links): string {
  return rewriteMarkdownDestinations(markdown, (href) => resolveInternalHref(href, scope) ?? href, definitions);
}

/** A page's links as its export resolves them: its marked blocks always, other text only where a link could be. */
function pageLinks(scope: LinkScope, definitions?: Links): ContentLinks {
  const markdown = (text: string) => rewriteMarkdownLinks(text, scope, definitions);
  return { markdown, text: (text) => (text.includes("](") || (definitions && text.includes("[")) ? markdown(text) : text) };
}

interface SourceLinkBase { href: string; root?: string }
/** A reference whose operations a page's `operation:` links can name. */
export interface LinkedReference { id: string; targets: ReferenceTargets }
/** What one page's links resolve against. */
interface LinkScope {
  outputPath: string;
  sourcePath: string;
  pathMap: ReadonlyMap<string, string>;
  sourceBase?: SourceLinkBase;
  links: LinkStyle;
  references: readonly LinkedReference[];
  /** The site's base, which every link on the page starts from, so it lands from any address the page answers at. */
  root: string;
}

function resolveInternalHref(href: string, scope: LinkScope): string | null {
  const { outputPath, sourcePath: docsSourcePath, pathMap, sourceBase, links } = scope;
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("#") ||
    href.startsWith("mailto:")
  ) {
    return null;
  }

  const pageDir = outputPath.includes("/")
    ? outputPath.substring(0, outputPath.lastIndexOf("/"))
    : "";
  if (href.startsWith(OPERATION_LINK)) {
    const target = operationTarget(decodeHrefPath(href.slice(OPERATION_LINK.length)), scope);
    return `${joinHref(scope.root, toPrettyLink(target.outputPath, links))}${target.anchor ? `#${target.anchor}` : ""}`;
  }

  const [path, hash] = href.split("#", 2);
  const hashSuffix = hash ? `#${hash}` : "";
  const sourcePath = decodeHrefPath(path).replace(/\\/g, "/");
  const clean = sourcePath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.(md|mdx|html)$/, "");

  const candidates = new Set<string>();

  if (!sourcePath.startsWith("/") && docsSourcePath) {
    const sourceDir = posix.dirname(docsSourcePath.replace(/\\/g, "/"));
    candidates.add(posix.normalize(posix.join(sourceDir, clean)));
  }

  if (!sourcePath.startsWith("/") && pageDir) {
    candidates.add(posix.normalize(posix.join(pageDir, clean)));
  }

  candidates.add(clean);

  let target: string | undefined;
  for (const initialCandidate of candidates) {
    let candidate = initialCandidate;
    while (!target && candidate && candidate !== ".") {
      target = pathMap.get(candidate);
      if (target) break;
      const slash = candidate.indexOf("/");
      if (slash === -1) break;
      candidate = candidate.substring(slash + 1);
    }
    if (target) break;
  }

  if (target) {
    return `${joinHref(scope.root, toPrettyLink(target, links))}${hashSuffix}`;
  }

  if (sourceBase && href.includes("../") && docsSourcePath) {
    const sourceDir = posix.dirname(docsSourcePath);
    const resolved = posix.relative(sourceBase.root || ".", posix.normalize(posix.join(sourceDir, path)));
    if (!resolved.startsWith("..")) {
      return `${sourceBase.href}/${resolved}${hashSuffix}`;
    }
  }

  return null;
}

/**
 * An operation a page links by name, `GET /pets` or `TOOL search` as navigation
 * names it, after its reference's tab ID when two references publish it
 * (`rest:GET /pets`). It lands wherever the operation is published: its own
 * page in a split reference, or its section on the single page.
 */
function operationTarget(name: string, scope: LinkScope): ReferenceTarget {
  const [, id, operation] = name.match(/^(?:([^:\s]+):)?([A-Z]+ \S.*)$/) ?? [];
  const found = operation ? scope.references.filter(reference => (id === undefined || reference.id === id) && reference.targets.operations[operation]) : [];
  if (found.length === 1) return found[0].targets.operations[operation];
  const problem = !operation ? "name an operation as METHOD /path"
    : found.length ? `${found.map(reference => reference.id).join(", ")} each publish it; name one, as ${OPERATION_LINK}${found[0].id}:${operation}`
    : id === undefined ? "no reference publishes it" : `reference ${JSON.stringify(id)} does not publish it`;
  throw new Error(`${scope.sourcePath}: link ${OPERATION_LINK}${name}: ${problem}`);
}

function decodeHrefPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
