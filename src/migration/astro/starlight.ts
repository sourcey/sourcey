/**
 * Starlight to native Sourcey. Reads the Starlight integration options and the
 * docs collection once and plans native configuration, navigation, locales,
 * API references and the document edits that keep every published route.
 */
import { posix } from "node:path";
import type { JsonValue } from "../../core/markdown-components.js";
import type { ConfigValue } from "../config-writer.js";
import { toJson, type Value } from "../javascript.js";
import { navbarLink, navbarOption } from "../navigation.js";
import { markdownSource, type NativePlan, type PlannedDocument } from "../plan.js";
import type { ProjectFiles } from "../project-files.js";
import { editLinkOptions } from "../repository.js";
import { astroEntrySlug } from "../slugs.js";
import { lineAt, readFrontmatter } from "../text-edits.js";
import { schemeColours, stylesheetFonts, themeColours } from "../theme.js";
import { stringOption } from "./project.js";
import { convertOpenApiPlugins } from "./starlight-openapi.js";
import { convertSidebar } from "./starlight-sidebar.js";
import { withoutPrefix, type Locale, type SourceEntry, type StarlightContext } from "./starlight-model.js";
import { isAbsoluteHttpUrl } from "../../site-url.js";

const DOC_EXTENSIONS = /\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/;

/** Options this converter maps. Anything else stops the migration with its location. */
const MAPPED_OPTIONS = new Set([
  "title", "logo", "favicon", "social", "editLink", "customCss", "sidebar", "defaultLocale", "locales", "plugins", "disable404Route", "lastUpdated",
]);
/** Options with no native equivalent whose loss is a reviewable choice, not lost content. */
const UNCARRIED_OPTIONS: Record<string, string> = {
  description: "The site description has no native setting; page descriptions are kept",
  credits: "The Starlight credit link is not carried over",
  pagination: "Native pages always show previous and next links",
  tableOfContents: "Native themes size the page outline themselves",
};

/** The native mount and plan for one Astro root using Starlight. */
export interface StarlightConversion {
  plan: NativePlan;
  /** Mount path inside the Astro site, for the `sourcey/astro` integration. */
  routeBase: string;
}

export async function convertStarlight(context: StarlightContext): Promise<StarlightConversion | undefined> {
  const { project, diagnostics, root, options } = context;
  const at = (value: Value | undefined) => lineAt(root.scope.source, value?.node.start);
  const fail = (message: string, value?: Value, suggestion?: string) =>
    diagnostics.error({ file: root.configFile, line: at(value), code: "starlight", message, suggestion });
  const json = (name: string): JsonValue | undefined => {
    const value = options.entries.get(name);
    if (!value) return undefined;
    const result = toJson(value);
    if (result.ok) return result.value;
    fail(`Starlight option "${name}" is not static: ${result.reason}`, value);
    return undefined;
  };

  for (const [name, value] of options.entries) {
    if (UNCARRIED_OPTIONS[name]) diagnostics.review({ file: root.configFile, line: at(value), code: "starlight", message: `${name}: ${UNCARRIED_OPTIONS[name]}` });
    else if (!MAPPED_OPTIONS.has(name)) fail(`Starlight option "${name}" has no native conversion`, value);
  }

  const locales = readLocales(json("locales"), json("defaultLocale"));
  const docsDir = posix.join(root.dir, "src/content/docs");
  const collection = await docsCollection(project, docsDir, context.assembled);
  const entries = await readEntries(project, collection, locales);
  if (!entries.length) {
    fail(
      `No Starlight documents found in ${docsDir}`,
      undefined,
      `If the build copies the collection in from elsewhere, declare the copies under astro.roots["${root.dir}"].assemble in the --mapping file.`,
    );
    return undefined;
  }

  // The native mount is the deepest directory holding every default-locale document.
  const mount = sharedDirectory(entries.filter((entry) => !entry.locale).map((entry) => entry.contentPath));
  if (mount && locales.length > 1) {
    fail(`Translated Starlight content under a shared "${mount}" directory is not supported yet`);
    return undefined;
  }
  for (const entry of entries) {
    entry.documentPath = withoutPrefix(entry.documentPath, mount) || "index";
    entry.slug = withoutPrefix(entry.slug, mount) ?? entry.slug;
  }
  const markdownRoot = posix.join("src/content/docs", mount);
  const hostBase = stringOption(root.options.entries.get("base"))?.replace(/\/+$/, "") ?? "";
  const routeBase = `/${mount}`.replace(/\/$/, "") || "/";

  if (json("disable404Route") !== true && routeBase !== "/")
    diagnostics.review({
      file: root.configFile,
      code: "starlight-404",
      message: `Starlight served the site's 404 page at ${hostBase}/404; the native mount at ${routeBase} has its own, so the host needs a src/pages/404 page`,
    });
  const navigation = await convertSidebar(context, options.entries.get("sidebar"), entries, locales, mount, hostBase);
  const apiTabs = await convertOpenApiPlugins(context, options.entries.get("plugins"));
  const published = entries.map((entry) => ({ entry, reference: entry.documentPath, path: entry.slug || "index" }));
  const markdown = markdownSource(markdownRoot, navigation.groups, published);

  const documents: PlannedDocument[] = published.map((page) => ({
    file: page.entry.file,
    route: publicRoute(hostBase, routeBase, page.entry),
    locale: page.entry.locale,
    dialect: { fragments: context.fragments, directives: true },
    frontmatter: documentFrontmatter(context, page.entry, markdown.slugs.get(page)),
    ...(page.entry.frontmatter.template === "splash" ? { after: async (text: string) => splashTitle(text, page.entry.frontmatter.title as JsonValue | undefined) } : {}),
  }));

  const config: Record<string, ConfigValue> = {
    name: siteName(json("title"), locales[0].lang),
    ...logoOptions(json("logo")),
    favicon: await faviconPath(project, root.dir, json("favicon")),
    ...editOptions(json("editLink")),
    ...(json("lastUpdated") === true ? { lastUpdated: true } : {}),
    ...(await themeOptions(context, json("customCss"))),
    prettyUrls: "slash",
    ...(locales.length > 1 ? { i18n: i18nOptions(locales, navigation.messages) } : {}),
    navbar: socialLinks(json("social")),
    navigation: {
      tabs: [
        { tab: "Documentation", slug: "", source: markdown.source },
        ...apiTabs.tabs,
      ],
    },
  };

  return {
    routeBase,
    plan: {
      configDir: root.dir,
      config: {
        imports: [{ from: "sourcey", names: ["defineConfig", "markdown", ...(apiTabs.tabs.length ? ["openapi"] : [])] }],
        config,
      },
      documents,
      routes: [
        ...apiTabs.pages.map((page) => ({ route: mountPath(hostBase, routeBase, page.route), origin: "starlight-openapi", fragments: page.fragments })),
        // Starlight serves the whole site's 404; a mount below the root cannot.
        ...(json("disable404Route") === true || routeBase !== "/" ? [] : [{ route: `${hostBase}/404`, origin: "Starlight 404 page" }]),
      ],
      files: new Map(),
      ...(context.assembled ? { assembly: { root: root.dir, files: context.assembled } } : {}),
    },
  };
}

function readLocales(locales: JsonValue | undefined, defaultLocale: JsonValue | undefined): Locale[] {
  if (!locales || typeof locales !== "object" || Array.isArray(locales)) return [{ key: "en", label: "English", lang: "en", directory: "" }];
  const defaultDirectory = typeof defaultLocale === "string" && defaultLocale !== "root" ? defaultLocale : "";
  const result: Locale[] = [];
  for (const [key, value] of Object.entries(locales)) {
    const locale = (value ?? {}) as Record<string, JsonValue>;
    const lang = typeof locale.lang === "string" ? locale.lang : key === "root" ? "en" : key;
    result.push({
      key: key === "root" ? lang : key,
      label: typeof locale.label === "string" ? locale.label : lang,
      lang,
      dir: locale.dir === "rtl" ? "rtl" : undefined,
      directory: key === "root" ? "" : key,
    });
  }
  // The default locale leads; native maps it to the unprefixed content root.
  return result.sort((a, b) => Number(b.directory === defaultDirectory) - Number(a.directory === defaultDirectory));
}

/** The docs collection as the build sees it, assets included: collection path to project file. */
async function docsCollection(project: ProjectFiles, docsDir: string, assembled?: Map<string, string>): Promise<Map<string, string>> {
  const prefix = "src/content/docs/";
  if (assembled)
    return new Map([...assembled].filter(([path]) => path.startsWith(prefix)).map(([path, file]) => [path.slice(prefix.length), file]));
  return new Map((await project.list(docsDir)).map((file) => [file.slice(docsDir.length + 1), file]));
}

async function readEntries(project: ProjectFiles, collection: Map<string, string>, locales: Locale[]): Promise<SourceEntry[]> {
  const prefixed = new Map(locales.filter((locale) => locale.directory).map((locale) => [locale.directory, locale]));
  const defaultLocale = locales[0];
  const entries: SourceEntry[] = [];
  const documents = [...collection].filter(([path]) => DOC_EXTENSIONS.test(path) && !posix.basename(path).startsWith("_"));
  for (const [collectionPath, file] of documents.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const frontmatter = readFrontmatter(await project.readText(file)).data;
    const first = collectionPath.split("/")[0];
    const locale = prefixed.get(first);
    const insideLocale = locale ? withoutPrefix(collectionPath, first)! : collectionPath;
    const slug = typeof frontmatter.slug === "string" ? frontmatter.slug : await astroEntrySlug(collectionPath);
    entries.push({
      file,
      contentPath: insideLocale,
      locale: locale && locale !== defaultLocale ? locale.key : undefined,
      documentPath: insideLocale.replace(DOC_EXTENSIONS, "").replace(/\/index$/, "") || "index",
      slug: (locale ? (withoutPrefix(slug, locale.directory) ?? slug) : slug).replace(/^index$/, ""),
      frontmatter,
    });
  }
  return entries;
}

function sharedDirectory(paths: string[]): string {
  const split = paths.map((path) => path.split("/").slice(0, -1));
  const shared: string[] = [];
  for (let index = 0; split.every((parts) => index < parts.length && parts[index] === split[0][index]); index += 1)
    shared.push(split[0][index]);
  return shared.join("/");
}

/** Public path of a mount-relative route (`""` or ending in `/`, or a bare file name such as `404`). */
function mountPath(hostBase: string, routeBase: string, route: string): string {
  return `${hostBase}${routeBase === "/" ? "" : routeBase}/${route}`;
}

function publicRoute(hostBase: string, routeBase: string, entry: SourceEntry): string {
  return mountPath(hostBase, routeBase, `${entry.locale ? `${entry.locale}/` : ""}${entry.slug ? `${entry.slug}/` : ""}`);
}

/** Frontmatter edits that keep Starlight's route (`slug` where native would spell it otherwise), navigation label and visibility. */
function documentFrontmatter(context: StarlightContext, entry: SourceEntry, slug: string | undefined): PlannedDocument["frontmatter"] {
  const { diagnostics } = context;
  const set: Record<string, string | boolean | number> = {};
  const remove: string[] = [];
  const data = entry.frontmatter;
  if (slug) set.slug = slug;
  else if (data.slug !== undefined) remove.push("slug");
  if (data.template !== undefined) {
    // A splash page has no sidebars: native's page layout.
    if (data.template === "splash") set.layout = "page";
    if (data.template === "doc" || data.template === "splash") remove.push("template");
    else diagnostics.error({ file: entry.file, code: "starlight-frontmatter", message: `template: ${String(data.template)} has no native layout` });
  }
  const sidebar = data.sidebar as Record<string, unknown> | undefined;
  if (sidebar) {
    remove.push("sidebar");
    if (typeof sidebar.label === "string") set.navTitle = sidebar.label;
    if (sidebar.hidden === true) set.hideInMenu = true;
    if (sidebar.badge !== undefined || sidebar.attrs !== undefined)
      diagnostics.review({ file: entry.file, code: "starlight-frontmatter", message: "sidebar badge and attrs have no native equivalent" });
  }
  for (const key of ["hero", "banner", "head"]) {
    if (data[key] !== undefined)
      diagnostics.error({ file: entry.file, code: "starlight-frontmatter", message: `Frontmatter "${key}" has no native equivalent yet` });
  }
  for (const key of ["pagefind", "editUrl", "tableOfContents", "prev", "next", "lastUpdated"]) {
    if (data[key] === undefined) continue;
    remove.push(key);
    diagnostics.review({ file: entry.file, code: "starlight-frontmatter", message: `Frontmatter "${key}" has no native equivalent and is removed` });
  }
  return { set, remove };
}

/** Starlight draws a splash page's title above its body; native's page layout draws the body alone, so the title joins it. */
function splashTitle(text: string, title: JsonValue | undefined): string {
  const { bodyStart } = readFrontmatter(text);
  const body = text.slice(bodyStart);
  if (typeof title !== "string" || /^\s*#\s/.test(body)) return text;
  return `${text.slice(0, bodyStart)}\n# ${title}\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

/** Starlight titles are a string or a map by language; native takes the default language's. */
function siteName(title: JsonValue | undefined, lang: string): string {
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && !Array.isArray(title)) return String(title[lang] ?? Object.values(title)[0] ?? "");
  return "";
}

/** Starlight draws the site title beside its logo unless the logo `replacesTitle`: then it is a wordmark, native's default. */
function logoOptions(logo: JsonValue | undefined): Record<string, ConfigValue> {
  if (!logo || typeof logo !== "object" || Array.isArray(logo)) return {};
  const local = (path: JsonValue | undefined) => (typeof path === "string" ? `./${posix.normalize(path).replace(/^\.\//, "")}` : undefined);
  const mark = logo.replacesTitle === true ? {} : { mark: true };
  if (typeof logo.src === "string") return { logo: logo.replacesTitle === true ? local(logo.src) : { light: local(logo.src), ...mark } };
  if (typeof logo.light === "string") return { logo: { light: local(logo.light), dark: local(logo.dark), ...mark } };
  return {};
}

async function faviconPath(project: ProjectFiles, rootDir: string, favicon: JsonValue | undefined): Promise<string | undefined> {
  const path = typeof favicon === "string" ? favicon : "/favicon.svg";
  if (isAbsoluteHttpUrl(path)) return path;
  const file = posix.join(rootDir, "public", path);
  return (await project.exists(file)) ? `./${posix.join("public", path)}` : undefined;
}

/** Starlight appends the project-relative file path to `editLink.baseUrl`, as native does. */
function editOptions(editLink: JsonValue | undefined): Record<string, ConfigValue> {
  const base = editLink && typeof editLink === "object" && !Array.isArray(editLink) ? editLink.baseUrl : undefined;
  return typeof base === "string" ? editLinkOptions(base) : {};
}

/** Starlight's social links: a list of `{ icon, label, href }`, or the older `{ github: url }` object. */
function socialLinks(social: JsonValue | undefined): ConfigValue {
  if (Array.isArray(social))
    return navbarOption((social as Record<string, JsonValue>[]).map((item) => navbarLink(String(item.icon), String(item.href), typeof item.label === "string" ? item.label : undefined)));
  if (social && typeof social === "object") return navbarOption(Object.entries(social).map(([icon, href]) => navbarLink(icon, String(href))));
  return undefined;
}

/**
 * Brand colours from Starlight's accent variables: native `primary` is the
 * light scheme's accent, `light` the dark scheme's text accent and `dark` the
 * light scheme's ink. Fonts from `--sl-font`, the platform's by default. Other
 * custom CSS is reported for a deliberate native replacement.
 */
async function themeOptions(context: StarlightContext, customCss: JsonValue | undefined): Promise<Record<string, ConfigValue>> {
  const { project, root, diagnostics } = context;
  const colours = { light: new Map<string, string>(), dark: new Map<string, string>() };
  const stylesheets: string[] = [];
  for (const path of Array.isArray(customCss) ? customCss : []) {
    if (typeof path !== "string") continue;
    const file = posix.join(root.dir, path);
    if (!(await project.exists(file))) {
      diagnostics.review({ file: root.configFile, code: "starlight-css", message: `Custom CSS "${path}" is a package stylesheet and is not carried over` });
      continue;
    }
    const css = await project.readText(file);
    stylesheets.push(css);
    // Starlight's own scheme at :root is dark.
    const found = schemeColours(css, "dark");
    for (const scheme of ["light", "dark"] as const) for (const [name, value] of found[scheme]) colours[scheme].set(name, value);
    diagnostics.review({
      file,
      code: "starlight-css",
      message: "Starlight-specific styles are not carried over; brand colours are mapped from --sl-color-accent and fonts from --sl-font, other rules need a deliberate native replacement",
    });
  }
  const review = (message: string) => diagnostics.review({ file: root.configFile, code: "starlight-css", message });
  return {
    theme: {
      ...themeColours(colours.light.get("--sl-color-accent") ?? colours.dark.get("--sl-color-accent"), colours.dark.get("--sl-color-accent-high"), colours.light.get("--sl-color-accent-high")),
      ...stylesheetFonts(stylesheets, { sans: "--sl-font", mono: "--sl-font-mono" }, review),
    },
  };
}

function i18nOptions(locales: Locale[], messages: Map<string, Record<string, string>>): ConfigValue {
  return {
    defaultLocale: locales[0].key,
    locales: Object.fromEntries(
      locales.map((locale) => [
        locale.key,
        {
          label: locale.label,
          ...(locale.lang !== locale.key ? { lang: locale.lang } : {}),
          ...(locale.dir ? { dir: locale.dir } : {}),
          ...(locale.directory && locale.directory !== locale.key ? { content: locale.directory, path: locale.directory } : {}),
          ...(messages.has(locale.key) ? { messages: { navigation: messages.get(locale.key)! } } : {}),
        },
      ]),
    ),
  };
}

