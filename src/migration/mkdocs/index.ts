/**
 * `sourcey migrate mkdocs`: `mkdocs.yml` and its Markdown become a standalone
 * native Sourcey project. Navigation, routes, edit links, theme basics,
 * redirects and the enabled Markdown extensions' syntax are converted once.
 */
import { posix } from "node:path";
import { CORE_SCHEMA, defineMappingTag, defineScalarTag, defineSequenceTag, load as parseYaml } from "js-yaml";
import type { GroupConfig, NavigationItem } from "../../config.js";
import { Environment, type ConfigValue } from "../config-writer.js";
import { counted, type Diagnostics } from "../diagnostics.js";
import { footerLinks, groupIds, navbarLink, navbarOption, networkOf, placeUnlisted, topLevelGroups } from "../navigation.js";
import { markdownSource, type FrameworkMigration, type NativePlan, type PlannedDocument, type SourcePath } from "../plan.js";
import type { ProjectFiles } from "../project-files.js";
import { element, googleTag, writePageParts, type PartMarkup } from "../page-parts.js";
import { editLinkOptions } from "../repository.js";
import { lineAt, readFrontmatter } from "../text-edits.js";
import { convertMkDocsMarkdown, pageHeading, type MkDocsExtensions } from "./syntax.js";

const CONFIG_FILES = ["mkdocs.yml", "mkdocs.yaml"];
/** Where files MkDocs served as pages of their own go, so they keep their URLs. */
const PUBLIC_DIR = "public";

/** Material for MkDocs primary palette colours. */
const MATERIAL_COLOURS: Record<string, string> = {
  red: "#ef5350", pink: "#e91e63", purple: "#ab47bc", "deep-purple": "#7e57c2", indigo: "#4051b5", blue: "#2094f3",
  "light-blue": "#02a6f2", cyan: "#00bdd6", teal: "#009485", green: "#4cae4f", "light-green": "#8bc34b", lime: "#cbdc38",
  yellow: "#ffec3d", amber: "#ffc105", orange: "#ffa724", "deep-orange": "#ff6e42", brown: "#795649", grey: "#757575",
  "blue-grey": "#546d78", black: "#000000", white: "#ffffff",
};

/** Plugins that date each page by its last commit, as native `lastUpdated` does. */
const DATE_PLUGINS = ["git-revision-date", "git-revision-date-localized"];
/** Plugins whose output native builds provide or that change nothing a reader sees. */
const PROVIDED_PLUGINS = new Set(["search", "minify", "gh-admonitions", "redirects", ...DATE_PLUGINS]);
/** Plugins that generate or rewrite content; converting them needs work of its own. */
const CONTENT_PLUGINS = new Set(["macros", "awesome-pages", "blog", "mkdocstrings", "i18n", "static-i18n", "include-markdown", "monorepo", "multirepo", "gen-files", "literate-nav", "section-index"]);
/** Extensions whose syntax native Markdown reads as written, or that only style output. */
const NATIVE_EXTENSIONS = new Set(["tables", "footnotes", "fenced_code", "toc", "codehilite", "pymdownx.highlight", "pymdownx.superfences", "pymdownx.tasklist", "pymdownx.magiclink", "pymdownx.betterem", "pymdownx.smartsymbols", "meta", "sane_lists", "nl2br"]);

/**
 * MkDocs configs carry environment and Python tags. `!ENV NAME` (or
 * `!ENV [NAME, default]`) becomes the same read in the native configuration;
 * the tags only MkDocs can resolve read as null.
 */
const MKDOCS_SCHEMA = CORE_SCHEMA.withTags(
  defineScalarTag("!ENV", { resolve: (name) => new Environment(name), identify: () => false }),
  defineSequenceTag("!ENV", {
    create: () => [] as string[],
    addItem: (names, item) => void names.push(String(item)),
    finalize: (names) => new Environment(names[0], names.length > 1 ? names.at(-1) : undefined),
    identify: () => false,
  }),
  ...["!", "tag:yaml.org,2002:python/"].flatMap((prefix) => [
    defineScalarTag(prefix, { matchByTagPrefix: true, resolve: () => null, identify: () => false }),
    defineSequenceTag(prefix, { matchByTagPrefix: true, create: () => null, addItem: () => undefined, finalize: () => null, identify: () => false }),
    defineMappingTag(prefix, {
      matchByTagPrefix: true, create: () => null, addPair: () => "", has: () => false, keys: () => [], get: () => undefined, finalize: () => null, identify: () => false,
    }),
  ]),
);

/** A Material social link (`extra.social`). Material reads no other list, so one elsewhere never showed. */
interface SocialLink {
  icon?: string;
  link?: string;
  /** The link's title. */
  name?: string;
}

/** Material's "Was this page helpful?" question (`extra.analytics.feedback`). */
interface MaterialFeedback {
  title?: string;
  ratings?: { icon?: string; name?: string; data?: string | number; note?: string }[];
}

interface MkDocsTheme {
  name?: string;
  logo?: string;
  favicon?: string;
  palette?: unknown;
  font?: { text?: string; code?: string } | false;
  features?: string[];
  /** Templates that override the theme's, Material's analytics partial among them. */
  custom_dir?: string;
}

interface MkDocsConfig {
  site_name?: string;
  site_author?: string;
  /** The footer's notice, HTML as written. */
  copyright?: string;
  site_url?: string | Environment | null;
  repo_url?: string;
  edit_uri?: string;
  docs_dir?: string;
  use_directory_urls?: boolean;
  nav?: unknown[];
  exclude_docs?: string;
  theme?: string | MkDocsTheme;
  extra?: { social?: SocialLink[]; analytics?: { provider?: string; property?: string; feedback?: MaterialFeedback } };
  extra_css?: string[];
  extra_javascript?: (string | { path?: string; type?: string; async?: boolean; defer?: boolean })[];
  markdown_extensions?: unknown[];
  plugins?: unknown[];
}

export async function prepareMkDocs(project: ProjectFiles, diagnostics: Diagnostics): Promise<FrameworkMigration> {
  let configFile: string | undefined;
  for (const name of CONFIG_FILES) if (!configFile && (await project.exists(name))) configFile = name;
  if (!configFile) {
    diagnostics.error({ file: "mkdocs.yml", code: "mkdocs", message: "No mkdocs.yml found in the project root" });
    return { plans: [], dependencies: [] };
  }
  const config = (parseYaml(await project.readText(configFile), { schema: MKDOCS_SCHEMA }) ?? {}) as MkDocsConfig;
  const fail = (message: string) => diagnostics.error({ file: configFile, code: "mkdocs", message });
  const review = (message: string, file = configFile) => diagnostics.review({ file, code: "mkdocs", message });

  const docsDir = posix.normalize(config.docs_dir ?? "docs");
  const extensions = readExtensions(config, fail, review);
  const plugins = names(config.plugins);
  for (const plugin of plugins) {
    if (CONTENT_PLUGINS.has(plugin)) fail(`Plugin "${plugin}" generates content and has no native conversion`);
    else if (!PROVIDED_PLUGINS.has(plugin)) review(`Plugin "${plugin}" is not carried over`);
  }
  extensions.githubAlerts = plugins.includes("gh-admonitions");

  const directoryUrls = config.use_directory_urls !== false;
  const excluded = (config.exclude_docs ?? "").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const files = (await project.list(docsDir, (path) => path.endsWith(".md")))
    .map((file) => file.slice(docsDir.length + 1))
    .filter((path) => !excluded.some((pattern) => posix.matchesGlob(path, pattern.replace(/^\//, ""))));
  // MkDocs publishes each page at its file path as written and README.md as its
  // directory's index. Where two files share a URL, the one it builds last wins.
  const published = new Map<string, SourcePath & { file: string }>();
  for (const file of [...files].sort(buildOrder)) {
    const stem = file.replace(/\.md$/, "");
    const path = stem.replace(/(^|\/)(index|README)$/, "") || "index";
    const earlier = published.get(path);
    if (earlier) diagnostics.review({ file: posix.join(docsDir, earlier.file), code: "mkdocs-route", message: `MkDocs built ${posix.join(docsDir, file)} over this page at the same URL, so it stays unpublished` });
    // Native resolves a directory reference to its index.md, and needs README named.
    published.set(path, { file, reference: stem.replace(/(^|\/)index$/, "") || "index", path });
  }
  const pageOf = (file: string) => published.get(file.replace(/\.md$/, "").replace(/(^|\/)(index|README)$/, "") || "index")!;
  const pages = new Map(files.map((file) => [file, pageOf(file)]));
  const nav = convertNav(config.nav, files, pages, fail);
  const feedback = materialFeedback(config.extra?.analytics?.feedback, review);
  // `theme: material` names the theme alone; without one, MkDocs uses its own.
  const theme = typeof config.theme === "string" ? { name: config.theme } : { name: "mkdocs", ...config.theme };
  const sidebar = theme.name === "material" ? materialSidebar(theme.features ?? []) : (groups: GroupConfig[]) => groups;
  const tabs = theme.features?.includes("navigation.tabs") ? navigationTabs(nav.groups, nav.labels, [...published.values()], docsDir, sidebar, review) : undefined;
  const markdown = tabs ?? (() => {
    const single = markdownSource(docsDir, sidebar(nav.groups), [...published.values()]);
    return { tabs: [{ tab: "Documentation", slug: "", source: single.source }], slugs: single.slugs };
  })();
  // MkDocs links relatively, so its pages work below any path; native publishes below the site URL's path.
  const base = typeof config.site_url === "string" ? new URL(config.site_url).pathname.replace(/\/$/, "") : "";
  const documents: PlannedDocument[] = [];
  let relabelled = 0;
  for (const page of published.values()) {
    const documentFile = posix.join(docsDir, page.file);
    const source = await project.readText(documentFile);
    const { data: frontmatter, bodyStart } = readFrontmatter(source);
    const remove = ["hide", "template", "search"].filter((key) => frontmatter[key] !== undefined);
    const layout = materialLayout(frontmatter);
    if (layout.dropped.length) diagnostics.review({ file: documentFile, code: "mkdocs-frontmatter", message: `Frontmatter ${layout.dropped.join("; ")}` });
    const route = `/${page.path === "index" ? "" : directoryUrls ? `${page.path}/` : `${page.path}.html`}`;
    const slug = markdown.slugs.get(page);
    const set: Record<string, string | boolean> = { ...(slug ? { slug } : {}), ...(layout.page ? { layout: "page" } : {}), ...(feedback && layout.hidesFeedback ? { feedback: false } : {}) };
    // A page naming no title takes MkDocs's: its nav label, Home, or its file name.
    const heading = typeof frontmatter.title === "string" ? frontmatter.title : pageHeading(source.slice(bodyStart));
    const label = nav.labels.get(page.file);
    if (!heading) set.title = label ?? fileTitle(page);
    else if (label && label !== heading) relabelled += 1;
    documents.push({
      file: documentFile,
      route: `${base}${route}`,
      dialect: { fragments: "python-markdown", compareConverted: true, directives: true },
      after: (text) => convertMkDocsMarkdown(text, { file: documentFile, route, docsDir, extensions, diagnostics, exists: (target) => project.exists(target) }),
      frontmatter: { set, remove },
    });
  }

  if (relabelled)
    review(`Nav labels other than the page heading titled ${counted(relabelled, "page")}; native titles a page by its heading and keeps the label in the navigation`);
  const statics = await staticPages(project, docsDir, base, fail);
  const parts = await pageParts(project, config, theme, docsDir, base, statics.files, review);
  // The files that move to the public directory, before the page parts join the files written.
  const publishesFiles = statics.files.size > 0;
  await writePageParts(project, statics.files, parts, fail);
  const editUri = config.edit_uri ?? (config.repo_url && /github\.com|gitlab\.com/.test(config.repo_url) ? `edit/master/${docsDir}/` : undefined);
  const editUrl = editUri && config.repo_url ? new URL(editUri, config.repo_url.replace(/\/?$/, "/")).href : undefined;
  const native: Record<string, ConfigValue> = {
    name: config.site_name ?? "",
    ...siteOptions(config.site_url),
    // MkDocs appends the docs-relative path; native appends the path from the project root.
    ...(editUrl ? editLinkOptions(editUrl, (path) => (path === docsDir || path.endsWith(`/${docsDir}`) ? path.slice(0, -docsDir.length).replace(/\/$/, "") : path)) : config.repo_url ? { repo: config.repo_url.replace(/\/+$/, "") } : {}),
    // MkDocs themes draw the site name beside the logo.
    ...(theme.logo ? { logo: { light: `./${posix.join(docsDir, theme.logo)}`, mark: true } } : {}),
    ...(theme.favicon ? { favicon: `./${posix.join(docsDir, theme.favicon)}` } : {}),
    ...themeOptions(theme, review),
    prettyUrls: directoryUrls ? "slash" : false,
    ...(publishesFiles ? { publicDir: PUBLIC_DIR } : {}),
    ...linkOptions(config),
    ...(feedback ? { feedback } : {}),
    ...(plugins.some((plugin) => DATE_PLUGINS.includes(plugin)) ? { lastUpdated: true } : {}),
    navigation: { tabs: markdown.tabs },
    ...redirects(config.plugins, pages, directoryUrls, base),
  };
  if (config.extra_css?.length) review(`Custom styles (${config.extra_css.join(", ")}) are not carried over; replace what they do deliberately`);
  await reportHosting(project, diagnostics);

  const plan: NativePlan = {
    configDir: ".",
    config: { imports: [{ from: "sourcey", names: ["defineConfig", "markdown"] }], config: native },
    documents,
    routes: statics.routes,
    publishedRoot: docsDir,
    files: statics.files,
  };
  return { plans: [plan], dependencies: [{ name: "sourcey", status: "required", detail: "Install it to build the native project; MkDocs and its plugins are no longer used." }] };
}

/** `site_url` as the native origin and base path: MkDocs links relatively, native links from the site root. */
function siteOptions(siteUrl: MkDocsConfig["site_url"]): Record<string, ConfigValue> {
  if (siteUrl instanceof Environment)
    return { siteUrl: new Environment(siteUrl.name, siteUrl.fallback, "origin"), baseUrl: new Environment(siteUrl.name, siteUrl.fallback, "pathname") };
  if (typeof siteUrl !== "string") return {};
  const url = new URL(siteUrl);
  return { siteUrl: url.origin, ...(url.pathname !== "/" ? { baseUrl: url.pathname } : {}) };
}

/**
 * MkDocs copies every other file in docs_dir to the site. An HTML file there is
 * a page of its own; it moves to the native public directory and keeps its URL.
 */
async function staticPages(project: ProjectFiles, docsDir: string, base: string, fail: (message: string) => void): Promise<Pick<NativePlan, "routes" | "files">> {
  const files: NativePlan["files"] = new Map();
  const routes: NativePlan["routes"] = [];
  for (const file of await project.list(docsDir, (path) => /\.html?$/i.test(path))) {
    const path = file.slice(docsDir.length + 1);
    const target = posix.join(PUBLIC_DIR, path);
    if (await project.exists(target)) fail(`${target} already exists, so ${file} cannot move there`);
    files.set(target, { bytes: await project.readBytes(file), reason: `Moved from ${file}; MkDocs published it as a page of its own` });
    files.set(file, { bytes: null, reason: `Moved to ${target}` });
    routes.push({ route: `${base}/${path}`, origin: "MkDocs static page" });
  }
  return { files, routes };
}

/** Material's partial for analytics of the site's own, in its template overrides. */
const ANALYTICS_PARTIAL = "partials/integrations/analytics/custom.html";

/**
 * What MkDocs adds to every page, as native page parts: the author and
 * analytics in the head, and `extra_javascript` where Material loads it, at
 * the end of the body. A local script moves to the public directory, keeping
 * its address. Other template overrides are reported.
 */
async function pageParts(
  project: ProjectFiles,
  config: MkDocsConfig,
  theme: MkDocsTheme,
  docsDir: string,
  base: string,
  files: NativePlan["files"],
  review: (message: string, file?: string) => void,
): Promise<{ Head: PartMarkup[]; BodyEnd: PartMarkup[] }> {
  const head: PartMarkup[] = [];
  const bodyEnd: PartMarkup[] = [];
  if (config.site_author) head.push({ html: element("meta", { name: "author", content: config.site_author }), from: "site_author" });
  // MkDocs reads custom_dir from beside mkdocs.yml.
  const overrides = theme.custom_dir ? posix.normalize(theme.custom_dir).replace(/\/$/, "") : undefined;
  const partial = overrides && posix.join(overrides, ANALYTICS_PARTIAL);
  const analytics = config.extra?.analytics;
  let carried: string | undefined;
  if (analytics?.provider === "google" && analytics.property) head.push({ html: googleTag(analytics.property), from: "extra.analytics" });
  else if (analytics?.provider === "custom" && partial && (await project.exists(partial))) {
    const text = await project.readText(partial);
    if (/\{[{%#]/.test(text)) review("This partial is a MkDocs template; write what it does into components/Head.html", partial);
    else head.push({ html: text, from: partial });
    carried = partial;
  } else if (analytics) review(`Analytics (${[analytics.provider, analytics.property].filter(Boolean).join(" ") || "extra.analytics"}) are not carried over`);
  if (overrides && (await project.isDirectory(overrides))) {
    const others = (await project.list(overrides, () => true)).filter((file) => file !== carried);
    if (others.length)
      review(`Theme overrides in ${overrides} (${others.map((file) => file.slice(overrides.length + 1)).join(", ")}) are not carried over; a page part in components/, or pages/404.md for a not-found page, draws their place`);
  }
  for (const item of config.extra_javascript ?? []) {
    const script = typeof item === "string" ? { path: item } : item;
    if (!script.path) continue;
    let src = script.path;
    if (!/^(?:[a-z][\w+.-]*:)?\/\//i.test(src)) {
      const path = posix.normalize(src).replace(/^\/+/, "");
      const source = posix.join(docsDir, path);
      if (!(await project.exists(source))) {
        review(`extra_javascript ${src} is not in ${docsDir}, so it is not carried over`);
        continue;
      }
      files.set(posix.join(PUBLIC_DIR, path), { bytes: await project.readBytes(source), reason: `Moved from ${source}; every page loads it` });
      files.set(source, { bytes: null, reason: `Moved to ${posix.join(PUBLIC_DIR, path)}` });
      src = `${base}/${path}`;
    }
    bodyEnd.push({ html: element("script", { src, type: script.type, async: script.async, defer: script.defer }), from: "extra_javascript" });
  }
  return { Head: head, BodyEnd: bodyEnd };
}

/** A Read the Docs build that runs MkDocs; the project switches it to Sourcey. */
async function reportHosting(project: ProjectFiles, diagnostics: Diagnostics): Promise<void> {
  for (const file of [".readthedocs.yaml", ".readthedocs.yml"]) {
    if (!(await project.exists(file))) continue;
    const text = await project.readText(file);
    const index = text.search(/^mkdocs:/m);
    if (index !== -1)
      diagnostics.review({ file, line: lineAt(text, index), code: "hosting", message: "Read the Docs builds this project with MkDocs; build it with `sourcey build` into $READTHEDOCS_OUTPUT/html instead" });
  }
}

function names(list: unknown[] | undefined): string[] {
  return (list ?? []).map((item) => (typeof item === "string" ? item : item && typeof item === "object" ? Object.keys(item)[0] : "")).filter(Boolean);
}

function options(list: unknown[] | undefined, name: string): Record<string, unknown> | undefined {
  const entry = (list ?? []).find((item) => item && typeof item === "object" && name in item) as Record<string, unknown> | undefined;
  return entry?.[name] as Record<string, unknown> | undefined;
}

function readExtensions(config: MkDocsConfig, fail: (message: string) => void, review: (message: string) => void): MkDocsExtensions {
  const enabled = new Set(names(config.markdown_extensions));
  const snippets = options(config.markdown_extensions, "pymdownx.snippets");
  const include = options(config.markdown_extensions, "markdown_include.include");
  const base = (value: unknown) => (Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : ["."]).map((path) => posix.normalize(path).replace(/^\.$/, ""));
  if (options(config.markdown_extensions, "toc")?.slugify !== undefined) fail("A custom toc slugify has no native conversion yet");
  const handled = new Set(["admonition", "pymdownx.details", "pymdownx.tabbed", "pymdownx.snippets", "markdown_include.include", "attr_list", "md_in_html", "pymdownx.emoji", "pymdownx.inlinehilite"]);
  for (const name of enabled) {
    if (handled.has(name) || NATIVE_EXTENSIONS.has(name)) continue;
    if (name === "pymdownx.arithmatex") fail("Math (pymdownx.arithmatex) needs the native maths renderer, which is not available yet");
    else review(`Markdown extension "${name}" is not carried over; its syntax renders as written`);
  }
  return {
    admonition: enabled.has("admonition"),
    details: enabled.has("pymdownx.details"),
    tabbed: enabled.has("pymdownx.tabbed"),
    snippets: enabled.has("pymdownx.snippets") ? base(snippets?.base_path) : undefined,
    include: enabled.has("markdown_include.include") ? base(include?.base_path)[0] : undefined,
    attrList: enabled.has("attr_list"),
    mdInHtml: enabled.has("md_in_html"),
    emoji: enabled.has("pymdownx.emoji"),
    inlineHilite: enabled.has("pymdownx.inlinehilite"),
    githubAlerts: false,
  };
}

/** MkDocs nav to native groups. Top-level pages share an unlabelled group; every published page is referenced. */
function convertNav(
  nav: unknown[] | undefined,
  files: string[],
  pages: Map<string, SourcePath>,
  fail: (message: string) => void,
): { groups: GroupConfig[]; labels: Map<string, string> } {
  const listed = new Set<string>();
  const labels = new Map<string, string>();
  const page = (file: string, label?: string): NavigationItem | undefined => {
    const normalised = posix.normalize(file.replace(/^\/+/, ""));
    const reference = pages.get(normalised)?.reference;
    if (!reference) {
      fail(`Nav entry "${file}" is not a page in docs_dir`);
      return undefined;
    }
    listed.add(normalised);
    if (label) labels.set(normalised, label);
    return label ? { page: reference, label } : reference;
  };
  const groupId = groupIds();
  const entry = (value: unknown, parent: string): NavigationItem | undefined => {
    if (typeof value === "string") return /^[a-z]+:/i.test(value) ? { href: value, label: value } : page(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const [[label, target]] = Object.entries(value);
    if (typeof target === "string") return /^[a-z]+:|^\//i.test(target) ? { href: target, label } : page(target, label);
    if (!Array.isArray(target)) return undefined;
    const id = groupId(parent, label, "group");
    return { group: label, id, pages: target.map((item) => entry(item, id)).filter((item): item is NavigationItem => !!item) };
  };

  const groups = topLevelGroups((nav ?? defaultNav(files)).map((item) => entry(item, "")).filter((item): item is NavigationItem => !!item));
  const unlisted = new Set(files.filter((file) => !listed.has(file)).map((file) => pages.get(file)!));
  for (const file of listed) unlisted.delete(pages.get(file)!);
  placeUnlisted(groups, [...unlisted].map((page) => page.reference));
  return { groups, labels };
}

/**
 * Material's `navigation.tabs` as native tabs. Each top-level section is a tab
 * publishing the folder of its first page (the docs root, for a page there),
 * so every page keeps its URL; pages in no tab's folder stay in the root tab.
 * A page a section lists from another tab's folder stays in that tab, and the
 * section links to it. Undefined, with the reason reviewed, when the sections
 * cannot each own a folder.
 */
function navigationTabs(
  groups: GroupConfig[],
  labels: Map<string, string>,
  published: (SourcePath & { file: string })[],
  docsDir: string,
  sidebar: (groups: GroupConfig[]) => GroupConfig[],
  review: (message: string, file?: string) => void,
): { tabs: ConfigValue[]; slugs: Map<SourcePath, string> } | undefined {
  const pages = new Map(published.map((page) => [page.reference, page]));
  const folderOf = (page: { file: string }) => (page.file.includes("/") ? page.file.split("/")[0] : "");
  // The pages a navigation lists itself, not those it links in another tab.
  const references = (items: readonly NavigationItem[]): string[] =>
    items.flatMap((item) => (typeof item === "string" ? [item] : "group" in item ? references(item.pages) : "page" in item && !("tab" in item) ? [item.page] : []));
  const fallback = (reason: string) => void review(`Material's navigation tabs become top-level sidebar groups: each native tab publishes one folder, and ${reason}`);

  const sections: { group: GroupConfig; folder: string; label: string; adopted: string[] }[] = [];
  for (const group of groups) {
    const first = pages.get(references(group.pages)[0]);
    if (!first) return fallback("a top-level entry lists no pages");
    sections.push({ group, folder: folderOf(first), label: group.group || labels.get(first.file) || fileTitle(first), adopted: [] });
  }
  const byFolder = new Map(sections.map((section) => [section.folder, section]));
  if (byFolder.size < sections.length) return fallback("two sections start in the same one");
  const ownerOf = (page: { file: string }) => byFolder.get(folderOf(page)) ?? byFolder.get("");
  if (published.some((page) => !ownerOf(page))) return fallback("no section starts at the docs root to keep the pages outside every section's folder");

  // A reference or path inside the folder its tab publishes.
  const local = (path: string, folder: string) => (!folder ? path : path === folder ? "index" : path.slice(folder.length + 1));
  const crossed: { section: (typeof sections)[number]; owner: (typeof sections)[number]; reference: string; file: string }[] = [];
  const convert = (items: readonly NavigationItem[], section: (typeof sections)[number]): NavigationItem[] =>
    items.flatMap((item): NavigationItem[] => {
      if (typeof item === "object" && "group" in item) return [{ ...item, pages: convert(item.pages, section) }];
      if (typeof item === "object" && !("page" in item)) return [item];
      const target = typeof item === "string" ? { page: item } : item;
      const page = pages.get(target.page)!;
      const owner = ownerOf(page)!;
      const reference = local(target.page, owner.folder);
      // Pages without a menu entry join their tab's groups once those are final.
      if (target.hidden) {
        owner.adopted.push(reference);
        return [];
      }
      if (owner === section) return [typeof item === "string" ? reference : { ...target, page: reference }];
      crossed.push({ section, owner, reference, file: page.file });
      // A tab's ID is its slug.
      return [{ ...target, page: reference, tab: owner.folder }];
    });
  // A section's pages and subsections are its tab's groups; the top-level pages stay one group.
  const navigation = sections.map((section) => (section.group.group ? topLevelGroups(convert(section.group.pages, section)) : [{ ...section.group, pages: convert(section.group.pages, section) }]));
  for (const { section, owner, reference, file } of crossed) {
    const listed = references(navigation[sections.indexOf(owner)]).includes(reference);
    if (!listed) owner.adopted.push(reference);
    review(`${section.label} lists this page from the ${owner.label} tab's folder; it keeps its URL in that tab${listed ? "" : ", without a menu entry there"}, and ${section.label} links to it`, posix.join(docsDir, file));
  }

  const tabs: ConfigValue[] = [];
  const slugs = new Map<SourcePath, string>();
  for (const [index, section] of sections.entries()) {
    placeUnlisted(navigation[index], section.adopted);
    const hosted = new Map(published.filter((page) => ownerOf(page) === section).map((page) => [{ reference: local(page.reference, section.folder), path: local(page.path, section.folder) }, page]));
    const source = markdownSource(posix.join(docsDir, section.folder), sidebar(navigation[index]), [...hosted.keys()]);
    for (const [document, slug] of source.slugs) slugs.set(hosted.get(document)!, slug);
    tabs.push({ tab: section.label, slug: section.folder, source: source.source });
  }
  return { tabs, slugs };
}

/**
 * Material's sidebar: every section collapsed but the one holding the open
 * page, unless `navigation.expand` opens them all; with `navigation.sections`,
 * the top level shows as headings that do not collapse.
 */
function materialSidebar(features: readonly string[]): (groups: GroupConfig[]) => GroupConfig[] {
  const fold = (group: GroupConfig, collapsed: boolean): GroupConfig => {
    const { pages, ...rest } = group;
    return { ...rest, ...(collapsed && group.group ? { collapsed: true } : {}), pages: pages.map((item) => (typeof item === "object" && "group" in item ? fold(item, true) : item)) };
  };
  if (features.includes("navigation.expand")) return (groups) => groups;
  return (groups) => groups.map((group) => fold(group, !features.includes("navigation.sections")));
}

/**
 * Material's per-page frontmatter as a native layout. A page that hides its
 * sidebar (`hide: navigation`) or draws its own template stands on its own:
 * native draws it as `page`, the site's header and footer around its body.
 * What has no native form is said, not silently lost.
 */
function materialLayout(frontmatter: Record<string, unknown>): { page: boolean; hidesFeedback: boolean; dropped: string[] } {
  const hide = Array.isArray(frontmatter.hide) ? frontmatter.hide.map(String) : [];
  const template = typeof frontmatter.template === "string" ? frontmatter.template : undefined;
  const page = hide.includes("navigation") || template !== undefined;
  const dropped = [
    ...(hide.includes("navigation") && !hide.includes("toc") ? ["hide: navigation keeps Material's contents list; the native page, drawn as page, has none"] : []),
    ...(!page && hide.includes("toc") ? ["hide: toc has no native equivalent; native lists a page's sections beside it"] : []),
    ...hide.filter((key) => !["navigation", "toc", "feedback"].includes(key)).map((key) => `hide: ${key} has no native equivalent`),
    ...(template ? [`template: ${template} is the theme's own; native draws the page's Markdown as page`] : []),
    ...(frontmatter.search !== undefined ? ["search has no native equivalent"] : []),
  ];
  return { page, hidesFeedback: hide.includes("feedback"), dropped };
}

/** Material's feedback icons as the native default set (Heroicons) names them. */
const FEEDBACK_ICONS: Record<string, string> = {
  "material/emoticon-happy-outline": "face-smile", "material/emoticon-happy": "face-smile",
  "material/emoticon-sad-outline": "face-frown", "material/emoticon-sad": "face-frown",
  "material/thumb-up-outline": "hand-thumb-up", "material/thumb-up": "hand-thumb-up",
  "material/thumb-down-outline": "hand-thumb-down", "material/thumb-down": "hand-thumb-down",
  "material/heart-outline": "heart", "material/heart": "heart",
};

/** Material's feedback question as native `feedback`: its title, and each rating's name, value, icon and note. */
function materialFeedback(feedback: MaterialFeedback | undefined, review: (message: string) => void): ConfigValue | undefined {
  if (!feedback?.ratings?.length) return undefined;
  const ratings = feedback.ratings.map((rating) => {
    const icon = rating.icon && FEEDBACK_ICONS[rating.icon];
    if (rating.icon && !icon) review(`Feedback icon ${rating.icon} has no native match; the rating shows its name`);
    return { label: rating.name ?? String(rating.data ?? ""), value: rating.data ?? rating.name ?? "", ...(icon ? { icon } : {}), ...(rating.note ? { note: rating.note } : {}) };
  });
  return { ...(feedback.title ? { title: feedback.title } : {}), ratings };
}

/** MkDocs's title for a page with no nav label, title or H1: Home, or its file name as words. */
function fileTitle(page: SourcePath & { file: string }): string {
  if (page.path === "index") return "Home";
  const stem = posix.basename(page.file, ".md").replace(/^README$/, "index");
  const words = stem.replace(/[-_]/g, " ");
  return words.toLowerCase() === words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/** MkDocs's build order (a sorted `os.walk`): a directory's files, index and README first, then its subdirectories. */
function buildOrder(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  for (let index = 0; ; index += 1) {
    const leftFile = index === left.length - 1;
    const rightFile = index === right.length - 1;
    if (leftFile && rightFile) {
      const rank = (name: string) => Number(!/^(index|README)\.md$/.test(name));
      return rank(left[index]) - rank(right[index]) || compare(left[index], right[index]);
    }
    if (leftFile !== rightFile) return leftFile ? -1 : 1;
    if (left[index] !== right[index]) return compare(left[index], right[index]);
  }
}

/** Python's string order: by code point. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** MkDocs's nav without a `nav` setting: index first, then files, then directories as sections, alphabetically. */
function defaultNav(files: string[]): unknown[] {
  interface Dir { files: string[]; dirs: Map<string, Dir> }
  const root: Dir = { files: [], dirs: new Map() };
  for (const file of files) {
    const parts = file.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { files: [], dirs: new Map() });
      dir = dir.dirs.get(part)!;
    }
    dir.files.push(file);
  }
  const title = (name: string) => name.replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  const build = (dir: Dir): unknown[] => [
    ...dir.files.sort((a, b) => Number(/(^|\/)(index|README)\.md$/.test(b)) - Number(/(^|\/)(index|README)\.md$/.test(a)) || a.localeCompare(b)),
    ...[...dir.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => ({ [title(name)]: build(child) })),
  ];
  return build(root);
}

function themeOptions(theme: MkDocsTheme, review: (message: string) => void): Record<string, ConfigValue> {
  const palette = (Array.isArray(theme.palette) ? theme.palette[0] : theme.palette) as { primary?: string } | undefined;
  const primary = palette?.primary && MATERIAL_COLOURS[palette.primary.toLowerCase()];
  if (palette?.primary && !primary) review(`Palette primary "${palette.primary}" is a custom scheme; set theme.colors.primary yourself`);
  const fonts = themeFonts(theme);
  return primary || fonts ? { theme: { ...(primary ? { colors: { primary } } : {}), ...(fonts ? { fonts } : {}) } } : {};
}

/**
 * The fonts a theme draws with: Material's Roboto and Roboto Mono from Google
 * Fonts unless `font` names others, or the platform's with `font: false`;
 * Lato for readthedocs; the platform's for mkdocs. Another theme's are its own.
 */
function themeFonts(theme: MkDocsTheme): { sans: string; mono?: string } | undefined {
  if (theme.name === "material") return theme.font === false ? { sans: "system" } : { sans: theme.font?.text ?? "Roboto", mono: theme.font?.code ?? "Roboto Mono" };
  if (theme.name === "readthedocs") return { sans: "Lato" };
  if (theme.name === "mkdocs") return { sans: "system" };
  return undefined;
}

/**
 * The repository link MkDocs themes show in their header, and the copyright
 * notice and Material's social links in its footer. A link without a network's
 * icon shows its title: its name or, as Material titles it, its host.
 */
function linkOptions(config: MkDocsConfig): Record<string, ConfigValue> {
  const titled = (href: string, icon: string, name?: string) => {
    const link = navbarLink(icon, href, name);
    return link.type === "link" && !link.label && URL.canParse(href) ? { ...link, label: new URL(href).host } : link;
  };
  const header = config.repo_url ? [titled(config.repo_url, networkOf(config.repo_url))] : [];
  // The header's repository link is not repeated among the footer's.
  const social = footerLinks((config.extra?.social ?? []).filter((item) => item.link).map((item) => titled(item.link!, item.icon ?? "", item.name)), header, () => false).kept;
  const copyright = config.copyright?.trim();
  return {
    navbar: navbarOption(header),
    ...(copyright || social.length ? { footer: { ...(copyright ? { text: copyright } : {}), ...(social.length ? { links: social as unknown as ConfigValue } : {}) } } : {}),
  };
}

/** mkdocs-redirects `redirect_maps` (page path to page path or URL) as native redirects. */
function redirects(plugins: unknown[] | undefined, pages: Map<string, SourcePath>, directoryUrls: boolean, base: string): Record<string, ConfigValue> {
  const maps = options(plugins, "redirects")?.redirect_maps as Record<string, string> | undefined;
  if (!maps) return {};
  const url = (file: string) => {
    const path = pages.get(file)?.path ?? file.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
    return `${base}/${path === "index" || !path ? "" : directoryUrls ? `${path}/` : `${path}.html`}`;
  };
  return { redirects: Object.fromEntries(Object.entries(maps).map(([from, to]) => [url(from), /^[a-z]+:/i.test(to) ? to : url(to.split("#")[0])])) };
}
