/**
 * `sourcey migrate docusaurus`: a Docusaurus site's documentation becomes a
 * standalone native Sourcey project. Docs instances, sidebars, document
 * routes, admonitions, theme components, pages, the static directory, theme
 * basics and redirects are converted once.
 */
import { posix } from "node:path";
import type { NavbarLink } from "../../config.js";
import { firstHeadingText, headingInfo, lexMarkdown } from "../../utils/markdown.js";
import { isAbsoluteHttpUrl } from "../../site-url.js";
import type { Tokens } from "marked";
import { identityKey } from "../components.js";
import type { Call, ConfigValue } from "../config-writer.js";
import type { Diagnostics } from "../diagnostics.js";
import { evaluate, identifierName, parseModule } from "../javascript.js";
import type { ResolvedMapping } from "../mapping.js";
import type { EstreeNode } from "../mdx.js";
import { footerLinks, groupsOf, navbarLink, navbarOption, networkOf } from "../navigation.js";
import { markdownSource, type FrameworkMigration, type NativePlan, type PlannedDocument, type SourceDialect } from "../plan.js";
import type { ProjectFiles } from "../project-files.js";
import { editLinkOptions } from "../repository.js";
import { readFrontmatter } from "../text-edits.js";
import { schemeColours, stylesheetFonts, themeColours } from "../theme.js";
import { readDocs, type DocusaurusDoc } from "./docs.js";
import { docusaurusConversion, docusaurusPreprocess } from "./markdown.js";
import { convertSidebars, type SidebarNavigation } from "./sidebars.js";
import { loadSite, type DocsInstance, type DocusaurusSite } from "./site.js";
import { localeLabel, readTranslations, translatedLocales } from "./translations.js";
import { readVersions, type DocsVersion } from "./versions.js";

/**
 * Frontmatter the docs plugin reads for routing and sidebars, which native
 * navigation now carries. A Docusaurus `id` names a page within its directory;
 * native identity is the file path, as translations and versions mirror it.
 */
const CONSUMED = ["id", "sidebar_position", "sidebar_label", "sidebar_key", "parse_number_prefixes", "slug", "unlisted"];
/** Frontmatter with no native equivalent; it is removed and named in the report. */
const UNCARRIED = [
  "keywords", "image", "hide_title", "hide_table_of_contents", "toc_min_heading_level", "toc_max_heading_level", "pagination_label",
  "pagination_next", "pagination_prev", "custom_edit_url", "last_update", "displayed_sidebar", "sidebar_class_name", "sidebar_custom_props",
];

/** Plugin and theme names (by substring) and what becomes of each. */
const PLUGINS: [RegExp, string | undefined][] = [
  [/theme-mermaid/, undefined],
  [/plugin-sitemap/, undefined],
  [/plugin-client-redirects/, undefined],
  [/search/, "native search replaces it"],
  [/plugin-google-|gtag|analytics|tag-manager/, "analytics are not carried over"],
];

export async function prepareDocusaurus(project: ProjectFiles, diagnostics: Diagnostics, mapping: ResolvedMapping): Promise<FrameworkMigration> {
  const site = await loadSite(project, diagnostics);
  if (!site) return { plans: [], dependencies: [] };
  const fail = (message: string, suggestion?: string) => diagnostics.error({ file: site.configFile, code: "docusaurus", message, suggestion });
  const review = (message: string) => diagnostics.review({ file: site.configFile, code: "docusaurus", message });

  reportPlugins(site, fail, review);
  if (await project.exists("src/theme")) review("Swizzled theme components in src/theme are not carried over");

  const pretty = site.trailingSlash === false ? "strip" : "slash";
  const base = site.baseUrl.replace(/\/+$/, "");
  const collected: Collected = { documents: [], routes: [], files: new Map(), sections: new Map(), messages: new Map() };
  const { documents, routes, files, sections } = collected;
  const tabs: ConfigValue[] = [];
  const routeBases = new Set<string>();
  const markdownPages = await sitePages(project, site, mapping, fail, review);
  const globals = await mdxComponents(project);

  for (const instance of site.docs) {
    if (typeof instance.options.numberPrefixParser === "function") fail(`Docs "${instance.id}" parses number prefixes with its own function, which has no native conversion`);
    if (routeBases.has(instance.routeBase)) fail(`Two docs instances publish at /${instance.routeBase}`);
    routeBases.add(instance.routeBase);
    const versions = await readVersions(project, instance);
    const items: ConfigValue[] = [];
    let source: Call | undefined;
    for (const version of versions) {
      const versionSource = await convertVersion({ project, diagnostics, site, instance, version, base, pretty, fail, globals }, collected);
      if (version.last) source = versionSource;
      items.push({ id: version.name, label: version.label, path: version.path, ...versionStatus(version), ...(version.last ? {} : { source: versionSource }) });
    }
    const last = versions.find((version) => version.last);
    tabs.push({ tab: tabLabel(site, instance), slug: instance.routeBase, source, ...(versions.length > 1 && last ? { versions: { default: last.name, items } } : {}) });
  }

  // Markdown pages are the site's own: its header and footer around them, and no sidebar.
  const pageDialect = docsDialect(site, site.pageAdmonitions, globals);
  const pageConversion = docusaurusConversion(site.pageAdmonitions, site.mdx1Compat);
  for (const page of markdownPages)
    documents.push({ file: page.file, route: `${base}/${page.path}${page.path && pretty === "slash" ? "/" : ""}`, dialect: pageDialect(page.file), ...pageConversion, frontmatter: { set: {}, remove: [] } });

  const theme = site.themeConfig;
  const navbar = (theme.navbar ?? {}) as Record<string, unknown>;
  const statics = await existing(project, site.staticDirectories);
  const publicDir = await mergeStatics(project, statics, files, fail, review);
  const header = navbarLinks(navbar.items, review);
  // The site's pages by the paths links name them: `to` is read below the site's base.
  const pages = new Set(documents.flatMap((document) => [document.route, document.route.slice(base.length) || "/"]).map((route) => route.replace(/\/+$/, "") || "/"));
  if (site.url) for (const route of [...pages]) pages.add(`${new URL(site.url).origin}${base}${route === "/" ? "" : route}`);
  const config: Record<string, ConfigValue> = {
    name: typeof site.config.title === "string" ? site.config.title : "",
    ...(site.url ? { siteUrl: new URL(site.url).origin } : {}),
    ...(base ? { baseUrl: `${base}/` } : {}),
    ...(await logoOptions(project, statics, publicDir, navbar, site.config.favicon, review)),
    ...editOptions(site.docs[0]?.editUrl, review),
    ...(await themeOptions(project, site, review)),
    prettyUrls: pretty,
    ...(publicDir ? { publicDir } : {}),
    ...(markdownPages.length ? { pages: `./${site.pages}` } : {}),
    navbar: navbarOption(header),
    ...footerOptions(theme.footer, header, (href) => pages.has(href.replace(/\/+$/, "") || "/"), review),
    ...i18nOptions(site, collected.messages),
    navigation: { tabs },
    ...(await redirectOptions(site, documents)),
  };
  routes.push({ route: `${base}/404`, origin: "Docusaurus 404 page" });

  const plan: NativePlan = {
    configDir: ".",
    config: { imports: [{ from: "sourcey", names: ["defineConfig", "markdown"] }], config },
    documents,
    routes,
    sections,
    files,
  };
  return {
    plans: [plan],
    dependencies: [{ name: "sourcey", status: "required", detail: "Install it to build the native project; Docusaurus and its plugins are no longer used." }],
  };
}

/** What the conversion of every version adds to the native plan. */
interface Collected {
  documents: PlannedDocument[];
  routes: NativePlan["routes"];
  files: NativePlan["files"];
  sections: Map<string, string>;
  /** Translated navigation labels by locale, keyed by native group ID. */
  messages: Map<string, Record<string, string>>;
}

interface VersionContext {
  /** Components the site's MDXComponents makes available without imports. */
  globals: ReadonlyMap<string, string>;
  project: ProjectFiles;
  diagnostics: Diagnostics;
  site: DocusaurusSite;
  instance: DocsInstance;
  version: DocsVersion;
  /** The site's base path, without a trailing slash. */
  base: string;
  pretty: "slash" | "strip";
  fail: (message: string) => void;
}

/** One version of a docs instance: its documents, navigation and native Markdown source. */
async function convertVersion(context: VersionContext, collected: Collected): Promise<Call> {
  const { project, diagnostics, site, instance, version, base, pretty, fail, globals } = context;
  const route = (slug: string, locale?: string) => {
    const path = slug.replace(/^\/+|\/+$/g, "");
    const prefix = [base, locale, instance.routeBase, version.path].filter(Boolean).map((part) => `/${part!.replace(/^\/+/, "")}`).join("");
    return `${prefix}/${path}${path && pretty === "slash" ? "/" : ""}`;
  };
  const docs = (await readDocs(project, instance, version.contentDir)).filter((doc) => !doc.draft);
  const reference = (doc: DocusaurusDoc) => doc.source.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "") || "index";
  const navigation = await convertSidebars({ project, diagnostics, site, instance, sidebarPath: version.sidebarPath, contentDir: version.contentDir, docs, reference, route });
  await writeIndexes(project, version.contentDir, navigation, collected.files, route, collected.routes, fail);
  const translations = await readTranslations(project, site, instance, version, docs, fail);
  // A category's page lands it in every language.
  for (const [slug, group] of navigation.sections)
    for (const locale of [undefined, ...translations.map((translation) => translation.locale)]) collected.sections.set(route(slug, locale), group);
  for (const translation of translations) {
    for (const [target, file] of translation.files) {
      collected.files.set(target, { bytes: await project.readBytes(file), reason: `Moved from ${file}; native reads a locale from inside its content` });
      collected.files.set(file, { bytes: null, reason: `Moved to ${target}` });
    }
    const messages = collected.messages.get(translation.locale) ?? {};
    for (const group of groupsOf(navigation.groups)) if (translation.labels.has(group.group)) messages[group.id!] = translation.labels.get(group.group)!;
    if (Object.keys(messages).length) collected.messages.set(translation.locale, messages);
  }

  const path = (doc: DocusaurusDoc) => doc.slug.replace(/^\/+|\/+$/g, "") || "index";
  /** A page this version publishes: a document (translated ones move) or a generated index. */
  interface Entry {
    doc?: DocusaurusDoc & { target?: string };
    locale?: string;
    reference: string;
    path: string;
  }
  const published: Entry[] = [
    ...docs.map((doc) => ({ doc, reference: reference(doc), path: path(doc) })),
    ...navigation.indexes.map((index) => ({ doc: undefined, reference: index.path, path: index.path })),
    ...translations.flatMap((translation) => translation.docs.map((doc) => ({ doc, locale: translation.locale, reference: reference(doc), path: path(doc) }))),
  ];
  const markdown = markdownSource(version.contentDir, navigation.groups, published);
  const dialect = docsDialect(site, instance.admonitions, globals);
  const convert = docusaurusConversion(instance.admonitions, site.mdx1Compat);
  for (const entry of published) {
    const slug = markdown.slugs.get(entry);
    if (entry.doc) {
      collected.documents.push({
        file: entry.doc.file,
        ...(entry.doc.target ? { target: entry.doc.target } : {}),
        route: route(entry.doc.slug, entry.locale),
        ...(entry.locale ? { locale: entry.locale } : {}),
        dialect: dialect(entry.doc.file),
        ...convert,
        frontmatter: documentFrontmatter(entry.doc, slug, await project.readText(entry.doc.file), diagnostics),
      });
    }
  }
  return markdown.source;
}

/** Native locales: the default one, then each translation with its label, language, direction and navigation labels. */
function i18nOptions(site: DocusaurusSite, messages: ReadonlyMap<string, Record<string, string>>): Record<string, ConfigValue> {
  const translated = translatedLocales(site);
  if (!translated.length) return {};
  const { defaultLocale, configs } = site.locales;
  const locale = (key: string) => ({
    label: localeLabel(site, key),
    ...(configs[key]?.htmlLang && configs[key]?.htmlLang !== key ? { lang: configs[key].htmlLang } : {}),
    ...(configs[key]?.direction === "rtl" ? { dir: "rtl" } : {}),
    ...(messages.has(key) ? { messages: { navigation: messages.get(key)! } } : {}),
  });
  return { i18n: { defaultLocale, locales: Object.fromEntries([defaultLocale, ...translated].map((key) => [key, locale(key)])) } };
}

/** Native version status: Docusaurus's unreleased and unmaintained banners, and versions kept out of search engines. */
function versionStatus(version: DocsVersion): Record<string, ConfigValue> {
  return {
    ...(version.banner === "unreleased" ? { status: "preview" } : version.banner === "unmaintained" ? { status: "archived" } : {}),
    ...(version.noIndex ? { index: false } : {}),
  };
}

/**
 * Components a swizzled `src/theme/MDXComponents` adds to every page, as
 * `module#export` by tag name, read statically from its default export.
 */
async function mdxComponents(project: ProjectFiles): Promise<Map<string, string>> {
  const globals = new Map<string, string>();
  let file: string | undefined;
  for (const name of ["js", "jsx", "ts", "tsx"].map((extension) => `src/theme/MDXComponents.${extension}`)) if (!file && (await project.exists(name))) file = name;
  if (!file) return globals;
  const scope = await parseModule(project, file);
  const declared = scope.defaultExport?.type === "Identifier" ? scope.constants.get(identifierName(scope.defaultExport)) : scope.defaultExport;
  if (declared?.type !== "ObjectExpression") return globals;
  // The spread of Docusaurus's own mapping adds nothing to convert; each named entry is a component.
  for (const property of declared.properties as EstreeNode[]) {
    if (property.type !== "Property" || property.computed) continue;
    const name = identifierName(property.key as EstreeNode);
    const value = evaluate(property.value as EstreeNode, scope);
    globals.set(name, value.kind === "reference" ? identityKey(value.binding.module, value.binding.export) : identityKey(file, name));
  }
  return globals;
}

/** How the docs plugin reads one of this instance's documents, and how verification reads it back. */
function docsDialect(site: DocusaurusSite, admonitions: DocsInstance["admonitions"], globals: ReadonlyMap<string, string>): (file: string) => SourceDialect {
  const preprocess = docusaurusPreprocess(admonitions, site.mdx1Compat);
  return (file) => ({
    fragments: "github",
    mdx: site.markdownFormat === "mdx" || (site.markdownFormat === "detect" && file.endsWith(".mdx")),
    mdx1: site.major < 3,
    directives: true,
    htmlComments: true,
    headingIds: site.mdx1Compat.headingIds,
    globals,
    preprocess,
  });
}

/** The label of the navbar item that opens this instance's sidebar, else "Documentation". */
function tabLabel(site: DocusaurusSite, instance: DocsInstance): string {
  const items = ((site.themeConfig.navbar as Record<string, unknown> | undefined)?.items ?? []) as Record<string, unknown>[];
  const item = items.find((entry) => (entry.type === "docSidebar" || entry.type === "doc") && (entry.docsPluginId ?? "default") === instance.id);
  return typeof item?.label === "string" ? item.label : "Documentation";
}

/** Frontmatter edits: the native route, title and navigation label where native would differ, and what native does not carry. */
function documentFrontmatter(doc: DocusaurusDoc, slug: string | undefined, text: string, diagnostics: Diagnostics): PlannedDocument["frontmatter"] {
  const data = doc.frontmatter;
  const set: Record<string, string | boolean> = {};
  if (slug) set.slug = slug;
  // Docusaurus titles a page from frontmatter, an opening heading, or its ID; native from frontmatter or its first heading.
  const body = text.slice(readFrontmatter(text).bodyStart);
  // A page that opens with its own heading shows that heading, its frontmatter title only naming it elsewhere.
  const opening = openingHeading(body);
  const shown = typeof data.title === "string" && opening && opening !== data.title ? opening : doc.title;
  if (shown !== doc.title || (typeof data.title !== "string" && firstHeadingText(body, 1) !== doc.title)) set.title = shown;
  if (doc.label !== shown) set.navTitle = doc.label;
  if (doc.unlisted) set.hideInMenu = true;
  const uncarried = UNCARRIED.filter((key) => data[key] !== undefined);
  if (uncarried.length) diagnostics.review({ file: doc.file, code: "docusaurus-frontmatter", message: `Frontmatter ${uncarried.join(", ")} has no native equivalent and is removed` });
  if (data.tags !== undefined) diagnostics.error({ file: doc.file, code: "docusaurus-frontmatter", message: "Tags publish tag pages, which have no native equivalent yet" });
  return { set, remove: [...CONSUMED, ...uncarried].filter((key) => data[key] !== undefined) };
}

/** The level-one heading a document opens with, after any imports, exports and comments, as Docusaurus reads its content title. */
function openingHeading(body: string): string | undefined {
  const first = lexMarkdown(body).find((token) => token.type !== "space" && !(token.type === "html" && /^\s*<!--/.test(token.raw)) && !(token.type === "paragraph" && /^\s*(import|export)\s/.test(token.raw)));
  return first?.type === "heading" && (first as Tokens.Heading).depth === 1 ? headingInfo(first as Tokens.Heading).text.trim() || undefined : undefined;
}

/** Generated category index pages become authored pages listing their section. */
async function writeIndexes(
  project: ProjectFiles,
  contentDir: string,
  navigation: SidebarNavigation,
  files: NativePlan["files"],
  route: (slug: string) => string,
  routes: NativePlan["routes"],
  fail: (message: string) => void,
): Promise<void> {
  for (const index of navigation.indexes) {
    const file = posix.join(contentDir, `${index.path}.md`);
    if (await project.exists(file)) fail(`${file} already exists, so the generated index of "${index.title}" cannot be written there`);
    const frontmatter = [`title: ${JSON.stringify(index.title)}`, ...(index.description ? [`description: ${JSON.stringify(index.description)}`] : [])];
    files.set(file, { bytes: `---\n${frontmatter.join("\n")}\n---\n\n<PageCards section="${index.section}" />\n`, reason: "Docusaurus generated this category index; native pages are authored" });
    routes.push({ route: route(`/${index.path}`), origin: "Docusaurus category index" });
  }
}

/**
 * Docusaurus pages, by their path below the site root. Markdown pages become
 * the native site's own pages; React pages have no native form.
 */
async function sitePages(
  project: ProjectFiles,
  site: DocusaurusSite,
  mapping: ResolvedMapping,
  fail: (message: string, suggestion?: string) => void,
  review: (message: string) => void,
): Promise<{ file: string; path: string }[]> {
  if (!site.pages) return [];
  const directory = site.pages;
  const files = await project.list(directory, (path) => /\.(mdx?|[jt]sx?)$/.test(path) && !/(^|\/)_|\.test\.|__tests__/.test(path.slice(directory.length + 1)));
  const pages: { file: string; path: string }[] = [];
  for (const file of files) {
    const path = file.slice(directory.length + 1).replace(/\.\w+$/, "").replace(/(^|\/)index$/, "");
    if (/\.mdx?$/.test(file)) {
      // A draft page is left out of the production build.
      if (readFrontmatter(await project.readText(file)).data.draft === true) continue;
      pages.push({ file, path });
    } else if (mapping.removedPages.has(file)) review(`${file} is retired with the migration; /${path} is no longer published`);
    else fail(`${file} is a React page, which has no native form`, "Rewrite it as Markdown, or list it under docusaurus.removePages in the --mapping file.");
  }
  return pages;
}

function reportPlugins(site: DocusaurusSite, fail: (message: string) => void, review: (message: string) => void): void {
  for (const plugin of site.plugins) {
    if (/plugin-content-pages/.test(plugin.name)) continue;
    if (/plugin-content-blog/.test(plugin.name)) review("The blog stays with the website; its pages are not migrated");
    else if (/openapi|redoc/.test(plugin.name)) fail(`The API reference plugin "${plugin.name}" needs its own conversion, which is not available yet`);
    else {
      const known = PLUGINS.find(([pattern]) => pattern.test(plugin.name));
      if (!known) review(`Plugin "${plugin.name}" is not carried over`);
      else if (known[1]) review(`Plugin "${plugin.name}": ${known[1]}`);
    }
  }
  if (Array.isArray(site.config.scripts) && site.config.scripts.length) review("Scripts the site adds to every page are not carried over");
}

async function existing(project: ProjectFiles, paths: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) if (await project.isDirectory(path)) found.push(path);
  return found;
}

/**
 * Docusaurus publishes each static directory at the site root; native
 * publishes one public directory, so the others' files move into it.
 */
async function mergeStatics(
  project: ProjectFiles,
  statics: readonly string[],
  files: NativePlan["files"],
  fail: (message: string) => void,
  review: (message: string) => void,
): Promise<string | undefined> {
  const target = statics.includes("static") ? "static" : statics[0];
  for (const directory of statics.filter((path) => path !== target)) {
    for (const file of await project.list(directory)) {
      const destination = posix.join(target, file.slice(directory.length + 1));
      if (await project.exists(destination)) {
        fail(`${file} and ${destination} both publish at /${file.slice(directory.length + 1)}`);
        continue;
      }
      files.set(destination, { bytes: await project.readBytes(file), reason: `Moved from ${directory}; native publishes one public directory` });
      files.set(file, { bytes: null, reason: `Moved to ${destination}` });
    }
    review(`${directory} moves into ${target}, which native publishes at the site root as Docusaurus did`);
  }
  return target;
}

/** A site path a static directory served, as its file in the native public directory; a web address stays one. */
async function siteImage(project: ProjectFiles, statics: readonly string[], publicDir: string | undefined, path: string): Promise<string | undefined> {
  if (isAbsoluteHttpUrl(path)) return path;
  const inside = path.replace(/^\/+/, "");
  for (const directory of statics) if (publicDir && (await project.exists(posix.join(directory, inside)))) return `./${posix.join(publicDir, inside)}`;
  return undefined;
}

async function logoOptions(
  project: ProjectFiles,
  statics: readonly string[],
  publicDir: string | undefined,
  navbar: Record<string, unknown>,
  favicon: unknown,
  review: (message: string) => void,
): Promise<Record<string, ConfigValue>> {
  const options: Record<string, ConfigValue> = {};
  const image = (navbar.logo ?? {}) as { src?: string; srcDark?: string };
  if (typeof image.src === "string") {
    const light = await siteImage(project, statics, publicDir, image.src);
    const dark = typeof image.srcDark === "string" ? await siteImage(project, statics, publicDir, image.srcDark) : undefined;
    // The navbar's title beside its logo makes the logo a mark.
    const mark = typeof navbar.title === "string" && navbar.title.trim() !== "";
    if (light) options.logo = dark || mark ? { light, ...(dark ? { dark } : {}), ...(mark ? { mark: true } : {}) } : light;
    else review(`The navbar logo ${image.src} is not in a static directory or on the web and is not carried over`);
  }
  if (typeof favicon === "string") {
    const file = await siteImage(project, statics, publicDir, favicon);
    if (file) options.favicon = file;
    else review(`The favicon ${favicon} is not in a static directory or on the web and is not carried over`);
  }
  return options;
}

/** A string `editUrl` names the repository, branch and site path; native appends each file's path from the project. */
function editOptions(editUrl: unknown, review: (message: string) => void): Record<string, ConfigValue> {
  if (typeof editUrl === "string") return editLinkOptions(editUrl);
  if (editUrl !== undefined) review("editUrl is a function; set repo, editBranch and editBasePath for native edit links");
  return {};
}

/** Colour mode, and brand colours from Infima's `--ifm-color-primary` in the site's custom CSS. */
async function themeOptions(project: ProjectFiles, site: DocusaurusSite, review: (message: string) => void): Promise<Record<string, ConfigValue>> {
  const mode = (site.themeConfig.colorMode ?? {}) as { defaultMode?: string; respectPrefersColorScheme?: boolean };
  const colours = { light: new Map<string, string>(), dark: new Map<string, string>() };
  const stylesheets: string[] = [];
  for (const file of site.customCss) {
    if (!(await project.exists(file))) continue;
    const css = await project.readText(file);
    stylesheets.push(css);
    const found = schemeColours(css, "light");
    for (const scheme of ["light", "dark"] as const) for (const [name, value] of found[scheme]) colours[scheme].set(name, value);
    review(`Custom CSS in ${file} is not carried over; brand colours are mapped from --ifm-color-primary and fonts from --ifm-font-family-base`);
  }
  return {
    theme: {
      ...(mode.respectPrefersColorScheme ? {} : mode.defaultMode === "dark" || mode.defaultMode === "light" ? { appearance: { default: mode.defaultMode } } : {}),
      ...themeColours(colours.light.get("--ifm-color-primary"), colours.dark.get("--ifm-color-primary"), colours.light.get("--ifm-color-primary-darkest")),
      ...stylesheetFonts(stylesheets, { sans: "--ifm-font-family-base", mono: "--ifm-font-family-monospace" }, review),
    },
  };
}

/** Navbar links, to other sites (`href`) and to pages of this one (`to`); sidebar, version, locale and search items are native navigation. */
function navbarLinks(items: unknown, review: (message: string) => void): NavbarLink[] {
  const links: NavbarLink[] = [];
  for (const item of (items ?? []) as Record<string, unknown>[]) {
    const href = typeof item.href === "string" ? item.href : typeof item.to === "string" ? item.to : undefined;
    if (href) links.push(navbarLink(networkOf(href), href, typeof item.label === "string" ? item.label : undefined));
    else if (Array.isArray(item.items) || item.type === "html") review(`The navbar ${item.type === "html" ? "HTML item" : `menu "${String(item.label ?? "")}"`} is not carried over`);
  }
  return links;
}

/**
 * Footer columns flatten into native footer links, less those the header or
 * sidebar already show; the copyright line is the footer's text.
 */
function footerOptions(footer: unknown, header: readonly NavbarLink[], isPage: (href: string) => boolean, review: (message: string) => void): Record<string, ConfigValue> {
  const value = (footer ?? {}) as { links?: { title?: string; items?: Record<string, unknown>[] }[]; copyright?: string };
  const items = (value.links ?? []).flatMap((column) => column.items ?? []).filter((item) => typeof (item.href ?? item.to) === "string");
  const label = (item: Record<string, unknown>) => typeof item.label === "string" ? item.label : undefined;
  const listed = items.map((item) => navbarLink(networkOf(String(item.href ?? item.to)), String(item.href ?? item.to), label(item)));
  const { kept: links, repeated } = footerLinks(listed, header, isPage);
  if (value.links?.some((column) => column.title)) review("Footer column titles are not carried over; their links become one row");
  if (repeated.length) review(`Footer links the header or sidebar already show are left out: ${repeated.map((link) => label(items[listed.indexOf(link)]) ?? link.href).join(", ")}`);
  // The configuration ran to read it, so a year it computed is now written down.
  if (value.copyright?.includes(String(new Date().getFullYear()))) review(`The footer copyright line keeps the year ${new Date().getFullYear()} as written; compute it in sourcey.config.ts to keep it current`);
  if (!value.copyright && !links.length) return {};
  return { footer: { ...(value.copyright ? { text: value.copyright } : {}), ...(links.length ? { links: links as unknown as ConfigValue } : {}) } };
}

/** `@docusaurus/plugin-client-redirects`: listed redirects, and `createRedirects` asked about every page as Docusaurus asks it. */
async function redirectOptions(site: DocusaurusSite, documents: readonly PlannedDocument[]): Promise<Record<string, ConfigValue>> {
  const plugin = site.plugins.find((entry) => /plugin-client-redirects/.test(entry.name));
  if (!plugin) return {};
  const redirects: Record<string, string> = {};
  for (const entry of (plugin.options.redirects ?? []) as { from: string | string[]; to: string }[])
    for (const from of [entry.from].flat()) redirects[from] = entry.to;
  const create = plugin.options.createRedirects as ((path: string) => string | string[] | undefined) | undefined;
  if (typeof create === "function")
    for (const document of documents) for (const from of [create(document.route.replace(/(.)\/$/, "$1")) ?? []].flat()) redirects[from] = document.route;
  return Object.keys(redirects).length ? { redirects } : {};
}
