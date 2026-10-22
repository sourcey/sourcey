import { access, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { isAbsoluteHttpUrl, normalizeBaseUrl, normalizeSiteUrl, type PrettyUrls } from "./site-url.js";
import {
  doxygen as doxygenSource,
  godoc as godocSource,
  markdown as markdownSource,
  mcp as mcpSource,
  openapi as openapiSource,
  rustdoc as rustdocSource,
} from "./adapters/index.js";
import type { ResolvedSiteContext } from "./core/site-model.js";
import { canonicalInputPath } from "./core/loader.js";
import { resolveContexts } from "./core/contexts.js";
import type { NativeComponentDefinition } from "./core/markdown-components.js";
import type { MarkdownPreprocessor } from "./core/markdown-loader.js";
import {
  resolveDiscovery,
  resolveExports,
  type DiscoveryConfig,
  type ExportsConfig,
  type ResolvedDiscovery,
  type ResolvedExports,
} from "./exports/config.js";
import type { ResolvedTabSource, SourceAdapter } from "./adapters/types.js";
import { DEFAULT_CODE_SAMPLE_LANGS, SUPPORTED_CODE_SAMPLE_LANGS } from "./utils/code-samples.js";
import { themeDefinitions, type ThemeName } from "./themes/registry.js";
import { textShades } from "./utils/palette.js";
import { slugify } from "./utils/slug.js";

export type { PrettyUrls } from "./site-url.js";

// ---------------------------------------------------------------------------
// User-facing config types (used in sourcey.config.ts)
// ---------------------------------------------------------------------------

export type { ThemeName } from "./themes/registry.js";

/** @deprecated Use ThemeName. */
export type ThemePreset = ThemeName;

export interface ReaderLink {
  /** Optional icon for reader sidebar and aside links. */
  icon?: "code" | "layers";
  label: string;
  href: string;
  /** Optional supporting line for an aside or pagination link. */
  description?: string;
}

/** Editorial chrome for long-form documentation. All fields are optional. */
export interface ReaderThemeConfig {
  document?: {
    label: string;
    title?: string;
    version?: string;
    status?: string;
    /** Short badge when the full status is longer (for example, Draft). */
    badge?: string;
    /** Human-readable publication or revision date; never inferred from build time. */
    updated?: string;
  };
  /** @deprecated Use `logo.mark`; accepted through the 3.x line. */
  logoMark?: boolean;
  /** Host-authored links and note rendered below the chapter navigation. */
  sidebar?: { links?: ReaderLink[]; note?: string };
  /** Host-authored links rendered below the generated table of contents. */
  aside?: { links?: ReaderLink[] };
  pagination?: { before?: ReaderLink; after?: ReaderLink };
  footer?: { text?: string; links?: ReaderLink[] };
  /** Use a host site's search route instead of Sourcey's search dialog. */
  searchHref?: string;
}

export interface ThemeConfig {
  appearance?: { default?: "system" | "light" | "dark"; storageKey?: string };
  /** Selects the complete rendering theme. */
  name?: ThemeName;
  /** @deprecated Use `name`. Retained for compatibility through the 3.x line. */
  preset?: ThemeName;
  colors?: {
    primary: string;
    light?: string;
    dark?: string;
  };
  fonts?: {
    /** A family for text, loaded from Google Fonts, or "system" for the platform stack without a downloaded typeface. */
    sans?: string;
    /** A family for code, loaded from Google Fonts, or "system" (the default) for the platform monospace stack. */
    mono?: string;
    /** Disable Google Fonts when fonts are supplied through custom CSS. */
    google?: boolean;
  };
  layout?: {
    sidebar?: string;
    toc?: string;
    content?: string;
  };
  css?: string[];
  reader?: ReaderThemeConfig;
  /**
   * Outline icons for cards, callouts and built-in chrome. `lucide` needs the
   * optional `lucide-static` package installed beside Sourcey.
   * @default "heroicons"
   */
  icons?: IconSet;
}

/** Outline icon sets a theme can draw from; brand marks for links are separate. */
export const ICON_SETS = ["heroicons", "lucide"] as const;
export type IconSet = (typeof ICON_SETS)[number];

export interface ChangelogConfig {
  /** Disable changelog auto-detection for CHANGELOG.md and layout: changelog pages. */
  enabled?: boolean;
  /** Generate Atom and RSS feeds for changelog pages. */
  feed?: boolean | { title?: string; description?: string };
  /** Generate standalone per-version changelog pages. */
  permalinks?: boolean;
  /** Generate dedicated OG images for per-version changelog pages. */
  ogImages?: boolean;
}

export interface TryItConfig {
  /** Browser-managed session credentials. Defaults to same-origin. */
  credentials?: "omit" | "same-origin" | "include";
}

export interface LocaleConfig {
  label: string;
  lang?: string;
  dir?: "ltr" | "rtl";
  content?: string;
  path?: string;
  messages?: import("./core/messages.js").UiMessageOverrides;
}
export interface I18nConfig {
  defaultLocale: string;
  locales: Record<string, LocaleConfig>;
  fallback?: "default" | false;
}
export interface VersionItem {
  id: string;
  label: string;
  path?: string;
  content?: string;
  revision?: string;
  status?: "maintained" | "preview" | "archived";
  notice?: string | false;
  index?: boolean;
}
export interface VersionsConfig {
  default: string;
  items: (VersionItem & { navigation?: SourceyConfig["navigation"] })[];
}
export interface TabVersionsConfig {
  default: string;
  items: (VersionItem & { source?: SourceAdapter })[];
}
export type Redirect = { to: string; status: 301 | 302 | 303 | 307 | 308 };

export interface SourceyConfig {
  /** Copy this explicitly public directory to the output root, retaining paths. */
  publicDir?: string | false;
  /**
   * A folder of the site's own pages, outside the documentation: each at the
   * address its path names (`pages/index.md` is the home page, `pages/404.md`
   * the not-found page), in no tab or version, and drawn by its frontmatter
   * `layout`: `page` (the default) or `blank`.
   */
  pages?: string;
  /** Omit the generated status page when the host owns it. */
  notFound?: boolean;
  i18n?: I18nConfig;
  versions?: VersionsConfig;
  components?: Record<string, NativeComponentDefinition>;
  redirects?: Record<string, string | Redirect>;
  /** Interactive console on OpenAPI references. No requests run until Send. */
  tryIt?: false | TryItConfig;
  /** Static machine-readable documentation outputs. */
  exports?: false | ExportsConfig;
  /** Discovery manifests and explicitly configured service descriptors. Off by default. */
  discovery?: false | DiscoveryConfig;
  name?: string;
  /**
   * Separator inserted between the page title and the site name in `<title>`/OG
   * metadata, and between fields in generated API search snippets.
   * @default " - "
   */
  titleSeparator?: string;
  /** Public site origin for absolute feeds, OG metadata, and canonical URLs (e.g. "https://docs.example.com"). */
  siteUrl?: string;
  /** Public path prefix when the docs are served from a subpath (e.g. "/reference"). */
  baseUrl?: string;
  /**
   * Clean URLs without `.html` extensions.
   * - `"slash"`: emit `foo/index.html` and link as `/foo/`.
   * - `"strip"`: emit `foo.html` and link as `/foo`.
   * - `false` (default): keep `.html` extensions.
   */
  prettyUrls?: PrettyUrls;
  theme?: ThemeConfig;
  logo?:
    | string
    | {
        light: string;
        dark?: string;
        href?: string;
        /** The image is a mark without the site's name, so the name shows beside it. Full wordmarks are the default. */
        mark?: boolean;
      };
  favicon?: string;
  /** Static OG image URL or local path. When set, skips automatic per-page OG image generation. */
  ogImage?: string;
  /** GitHub repo URL (e.g. "https://github.com/user/repo"). */
  repo?: string;
  /** Branch name for "Edit this page" links (e.g. "main", "master"). When set, enables edit links on markdown pages. */
  editBranch?: string;
  /** Base path prepended to source file paths in "Edit this page" URLs. Use when docs source lives in a subdirectory of the repo (e.g. "docs"). */
  editBasePath?: string;
  /**
   * Which languages to auto-generate code samples for.
   * Available: "curl", "javascript", "typescript", "python", "go", "ruby", "java", "php", "rust", "csharp"
   * @default ["curl", "javascript", "python"]
   */
  codeSamples?: string[];
  navigation: {
    tabs: TabConfig[];
  };
  navbar?: {
    links?: NavbarLink[];
    primary?: { type: "button"; label: string; href: string };
  };
  footer?: {
    /** One line of inline Markdown at the foot of every page, such as a copyright or licence notice. */
    text?: string;
    links?: NavbarLink[];
  };
  changelog?: false | ChangelogConfig;
  /** How Markdown prose renders. */
  markdown?: {
    /**
     * Typographer's quotes, dashes and ellipses in prose: `"` becomes “ or ”,
     * `--` an em dash and `...` an ellipsis, as Astro renders Markdown by
     * default. Code keeps every character as written. Off by default.
     */
    smartypants?: boolean;
  };
  /** Search configuration. */
  search?: {
    /** Page slugs to feature at the top of search results when no query is entered. */
    featured?: string[];
  };
}

export type DoxygenIndexStyle = "auto" | "rich" | "structured" | "flat" | "none";

export interface DoxygenSourceUrlInput {
  path: string;
  line?: string;
  symbol?: string;
}

export interface DoxygenSourceUrlRoute {
  /** Doxygen source path prefix. Longest matching prefix wins. */
  prefix: string;
  /**
   * Base URL or template for this route. Omit or set false to suppress public
   * links while still rendering the plain "Defined in path:line" location.
   */
  url?: string | false;
}

export type DoxygenSourceUrlResolver =
  string | DoxygenSourceUrlRoute[] | ((input: DoxygenSourceUrlInput) => string | undefined);

export interface DoxygenConfig {
  /** Path to Doxygen XML output directory */
  xml: string;
  /** Template language: "cpp" (the default, for C as well as C++) or "java" */
  language?: "cpp" | "java";
  /** Use Doxygen groups for navigation grouping */
  groups?: boolean;
  /**
   * Index page style for the API reference landing page.
   * - "auto": pick the best format based on available data (default)
   * - "rich": card grid with module descriptions (requires groups with descriptions)
   * - "structured": grouped list of types by module/namespace
   * - "flat": alphabetical list categorized by kind (classes, structs, etc.)
   * - "none" or false: no index page, land on the first API page
   */
  index?: DoxygenIndexStyle | false;
  /**
   * Base URL or template for source links in generated API pages.
   * A plain URL is joined with the Doxygen file path and "#L<line>".
   * Templates may use {path}, {fullPath}, and {line}. In route maps,
   * {path} is the matched-prefix-relative path and {fullPath} is the original
   * Doxygen path.
   */
  sourceUrl?: DoxygenSourceUrlResolver;
}

export type GodocMode = "auto" | "live" | "snapshot";

export interface GodocGoEnv {
  GOOS?: string;
  GOARCH?: string;
  tags?: string[];
}

export type RustdocMode = "auto" | "live" | "snapshot";

export interface RustdocFeatures {
  /** Use the crate's default features. Defaults to `true`. */
  default?: boolean;
  /** Extra features to enable. */
  list?: string[];
  /** Enable every feature. Overrides `default` and `list`. */
  all?: boolean;
}

export interface RustdocConfig {
  /** Cargo manifest path. Either a Cargo.toml or a directory that contains one. */
  manifest?: string;
  /** Crates to document. Defaults to the manifest's own package. */
  crates?: string[];
  /** Optional path to a committed v1 RustdocSpec snapshot (rustdoc.json). */
  snapshot?: string;
  /**
   * Source mode.
   * - "live": invoke the bundled Rust helper at build time (requires nightly).
   * - "snapshot": read the committed snapshot file; no Rust toolchain required.
   * - "auto" (default): prefer live when nightly is available; fall back to snapshot.
   */
  mode?: RustdocMode;
  /** Feature selection. Defaults to `{ default: true }`. */
  features?: RustdocFeatures;
  /** Include `pub(crate)` and private items (default: false). */
  includePrivate?: boolean;
  /** Include items marked `#[doc(hidden)]` (default: false). */
  includeHidden?: boolean;
  /** Target triple to build docs for. */
  target?: string;
  /** rustup toolchain name. Defaults to `nightly`. */
  toolchain?: string;
  /**
   * Repository-relative base path for source links. Leave empty when the
   * configured manifest is at the repository root.
   */
  sourceBasePath?: string;
  /** Render a dedicated doctests index page. Defaults to `true`. */
  doctestsIndex?: boolean;
}

export interface ResolvedRustdocConfig {
  /** Absolute path to the Cargo manifest file. */
  manifest: string;
  /** Crates to document. Always at least one entry. */
  crates: string[];
  /** Absolute path to a snapshot file when configured. */
  snapshot?: string;
  mode: RustdocMode;
  features: Required<RustdocFeatures>;
  includePrivate: boolean;
  includeHidden: boolean;
  target?: string;
  toolchain: string;
  sourceBasePath: string;
  doctestsIndex: boolean;
}

export interface GodocConfig {
  /** Module root (directory containing go.mod). Defaults to the directory containing sourcey.config.ts. */
  module?: string;
  /** Package patterns passed to `go list`, e.g. "./..." or "./internal/core/...". */
  packages?: string[];
  /** Optional path to a committed godoc snapshot (godoc.json). */
  snapshot?: string;
  /**
   * Source mode.
   * - "live": run the Go toolchain at build time.
   * - "snapshot": read the committed snapshot file; no Go required.
   * - "auto" (default): prefer live when Go is available; fall back to snapshot.
   */
  mode?: GodocMode;
  /** Include package examples from *_test.go files (default: true). */
  includeTests?: boolean;
  /** Include unexported symbols (default: false). */
  includeUnexported?: boolean;
  /** Hide packages with no package comment from navigation (default: false). */
  hideUndocumented?: boolean;
  /** Package path prefixes to exclude after `go list` expansion. */
  exclude?: string[];
  /**
   * Pin Go build environment for reproducible live-mode docs across hosts.
   * When unset, live mode follows the host's GOOS/GOARCH and active tags.
   */
  goEnv?: GodocGoEnv;
  /**
   * Repository-relative base path for Go source links. Leave empty when the
   * configured Go module is at the repository root.
   */
  sourceBasePath?: string;
}

export interface TabConfig {
  /** Browse canonical documents in an authored order instead of generated groups. */
  navigation?: GroupConfig[];
  /** Existing fragment spellings mapped to real section IDs, by document identity. */
  anchors?: Record<string, Record<string, string>>;
  /** Missing imported fragment targets. Default: error. Invalid aliases always fail. */
  anchorUnmatched?: import("./core/types.js").UnmatchedTargetPolicy;
  id?: string;
  versions?: false | TabVersionsConfig;
  translations?: Record<string, SourceAdapter>;
  /** How an OpenAPI or MCP reference publishes: one page unless split. */
  reference?: ReferenceConfig;
  routes?: Record<string, string>;
  /** Override the site's console setting for this API. */
  tryIt?: false | TryItConfig;
  tab: string;
  /** Custom URL slug for this tab. Defaults to slugified tab name. */
  slug?: string;
  /** Source adapter object, usually created with `openapi()`, `markdown()`, `doxygen()`, `godoc()`, or `mcp()`. */
  source?: SourceAdapter;
  openapi?: string;
  groups?: GroupConfig[];
  doxygen?: DoxygenConfig;
  /** Path to an mcp.json file (MCP server snapshot). */
  mcp?: string;
  /**
   * Native Go documentation. String shorthand expands to
   * `{ module: <value>, packages: ["./..."], mode: "auto", includeTests: true }`.
   */
  godoc?: GodocConfig | string;
  /**
   * Native Rust API documentation. String shorthand expands to
   * `{ manifest: <value>, mode: "auto", doctestsIndex: true }`.
   */
  rustdoc?: RustdocConfig | string;
}

export interface ReferenceConfig {
  /** `"operations"`: a page for each operation and model, beside an overview that lists them. */
  split?: "operations";
  /**
   * Each operation's permanent address, built from `{operationId}`, `{method}`,
   * `{path}` or `{operation}` (its ID, or its path when it has none). A split
   * reference publishes the operation's page there; a single page redirects it
   * to the operation's section.
   */
  operations?: string;
}

export interface PageNavigation {
  page: string;
  /** Stable owning tab ID for a document in another source. */
  tab?: string;
  label?: string;
  hidden?: boolean;
}
export interface OperationNavigation {
  /** Canonical operation identity, for example GET /keys. */
  operation: string;
  /** Stable owning reference tab ID. Defaults to the current tab. */
  reference?: string;
  label?: string;
}
export type NavigationTarget = PageNavigation | OperationNavigation;
export type NavigationItem = string | NavigationTarget | { href: string; label: string } | GroupConfig;
export interface GroupConfig {
  group: string;
  id?: string;
  href?: string;
  collapsed?: boolean;
  pages: NavigationItem[];
}

/** Networks a navbar or footer link can name; each renders as its brand icon. */
export const SOCIAL_NETWORKS = ["github", "twitter", "discord", "discourse", "linkedin", "youtube", "slack", "mastodon", "bluesky", "reddit", "npm"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type LinkType = SocialNetwork | "link";

export interface NavbarLink {
  type: LinkType;
  href: string;
  /** A text link's text; for a network, its icon's accessible name (the network's name by default). */
  label?: string;
}

export function defineConfig(config: SourceyConfig): SourceyConfig {
  return config;
}

// ---------------------------------------------------------------------------
// Resolved config types (internal, after validation + path resolution)
// ---------------------------------------------------------------------------

export interface ResolvedTheme {
  appearance: { default: "system" | "light" | "dark"; storageKey: string };
  name: ThemeName;
  colors: { primary: string; light: string; dark: string };
  /** CSS stacks, and the named families loaded from Google Fonts. */
  fonts: { sans: string; mono: string; google: string[] };
  layout: { sidebar: string; toc: string; content: string };
  css: string[];
  reader?: ReaderThemeConfig;
  icons: IconSet;
}

export interface ResolvedChangelogConfig {
  enabled: boolean;
  feed: false | { title?: string; description?: string };
  permalinks: boolean;
  ogImages: boolean;
}

/** Host-owned URL policy, retained when native config or its imports reload. */
export interface SiteHostConfig {
  landingPage?: boolean;
  /** Physical status-page layout required by the host router. */
  statusPageFormat?: "file" | "directory";
  baseUrl?: string;
  siteUrl?: string | false;
  prettyUrls?: PrettyUrls;
}

export interface ResolvedConfig {
  landingPage: boolean;
  publicDir?: string;
  pages?: string;
  notFound: boolean;
  host?: Readonly<SiteHostConfig>;
  tryIt?: false | TryItConfig;
  exports: ResolvedExports;
  discovery: ResolvedDiscovery;
  name: string;
  titleSeparator: string;
  siteUrl?: string;
  baseUrl: string;
  prettyUrls: PrettyUrls;
  theme: ResolvedTheme;
  logo?: { light?: string; dark?: string; href?: string; mark?: boolean };
  favicon?: string;
  ogImage?: string;
  repo?: string;
  editBranch?: string;
  editBasePath?: string;
  codeSamples: string[];
  contexts: ResolvedSiteContext[];
  configDir: string;
  authoring: SourceyConfig;
  configPath?: string;
  configDependencies?: string[];
  components: Record<string, NativeComponentDefinition>;
  redirects: Record<string, Redirect>;
  navbar: { links: NavbarLink[]; primary?: { type: "button"; label: string; href: string } };
  footer: { text?: string; links: NavbarLink[] };
  changelog: ResolvedChangelogConfig;
  markdown: { smartypants: boolean };
  search: { featured: string[] };
}

export interface ResolvedDoxygenConfig {
  xml: string;
  language: "cpp" | "java";
  groups: boolean;
  index: DoxygenIndexStyle;
  sourceUrl?: DoxygenSourceUrlResolver;
}

export interface ResolvedGodocConfig {
  /** Absolute path to the Go module directory (containing go.mod). */
  module: string;
  /** Package patterns to pass to `go list`. Always at least one entry. */
  packages: string[];
  /** Absolute path to a snapshot file when configured. */
  snapshot?: string;
  mode: GodocMode;
  includeTests: boolean;
  includeUnexported: boolean;
  hideUndocumented: boolean;
  exclude: string[];
  goEnv?: GodocGoEnv;
  sourceBasePath: string;
}

export interface ResolvedTab {
  navigation?: GroupConfig[];
  anchors?: Record<string, Record<string, string>>;
  anchorUnmatched?: import("./core/types.js").UnmatchedTargetPolicy;
  contentLocale?: string;
  id: string;
  reference: ReferenceConfig;
  routes?: Record<string, string>;
  tryIt?: false | TryItConfig;
  label: string;
  slug: string;
  source: ResolvedTabSource;
  openapi?: string;
  groups?: ResolvedGroup[];
  doxygen?: ResolvedDoxygenConfig;
  mcp?: string;
  godoc?: ResolvedGodocConfig;
  rustdoc?: ResolvedRustdocConfig;
}

export interface ResolvedPage {
  kind: "page";
  contentLocale?: string;
  /** Original config slug (e.g. "run/index") */
  slug: string;
  /** Absolute filesystem path to the .md/.mdx file */
  file: string;
  /** Optional navigation label supplied by a source format such as MkDocs. */
  label?: string;
  /**
   * Optional page title supplied by a source format, such as an MkDocs nav
   * label. A frontmatter title or the page's own first heading wins.
   */
  title?: string;
  /** Optional source root used for source-format-relative includes and assets. */
  sourceRoot?: string;
  /** Optional source-adapter Markdown preprocessors. */
  preprocess?: MarkdownPreprocessor[];
  hidden?: boolean;
}

export interface ResolvedGroup {
  kind: "group";
  label: string;
  id: string;
  href?: string;
  collapsed?: boolean;
  items: (ResolvedPage | ResolvedGroup | { kind: "link"; label: string; href: string } | { kind: "target"; target: NavigationTarget })[];
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = {
  primary: "99 102 241",
  light: "129 140 248",
  dark: "79 70 229",
};

const DEFAULT_FONT_SANS = "Inter";
const SYSTEM_SANS =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SYSTEM_MONO =
  "ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', Menlo, monospace";

const DEFAULT_LAYOUT = {
  sidebar: "18rem",
  toc: "19rem",
  content: "44rem",
};

export async function loadConfig(configOrDir?: string, host?: Readonly<SiteHostConfig>, mode: "production" | "development" = "production"): Promise<ResolvedConfig> {
  let configPath: string;

  if (configOrDir && configOrDir.endsWith(".ts")) {
    configPath = resolve(configOrDir);
  } else {
    const dir = configOrDir ?? process.cwd();
    configPath = resolve(dir, "sourcey.config.ts");
  }

  try {
    await access(configPath);
  } catch {
    throw new Error(
      `Config not found: ${configPath}\n` +
        `Create one with:\n\n` +
        `  import { defineConfig } from "sourcey";\n` +
        `  export default defineConfig({ navigation: { tabs: [...] } });\n`,
    );
  }

  // Native builds default to production; dev selects its mode at startup.
  // An embedding host's established environment always retains ownership.
  process.env.NODE_ENV ??= mode;
  // Vite reads the config and what it imports, as TypeScript, JSON or any
  // module Vite reads, and names each file it read for a rebuild to watch.
  // It loads only here, so a host that passes a resolved config never loads it.
  // JSON is data, exported as one default value. Vite can then skip the
  // JavaScript AST transform for large imported navigation/fragment tables.
  const { runnerImport } = await import("vite");
  const { module, dependencies } = await runnerImport<{ default: SourceyConfig }>(configPath, { root: dirname(configPath), configFile: false, logLevel: "silent", json: { stringify: true, namedExports: false } });
  const raw = module.default;

  if (!raw?.navigation?.tabs) {
    throw new Error(
      "sourcey.config.ts must export default defineConfig({ navigation: { tabs: [...] } })",
    );
  }

  const config = await resolveConfigFromRaw(raw, dirname(configPath), host);
  config.configPath = configPath;
  config.configDependencies = [...new Set(await Promise.all([configPath, ...dependencies.filter(path => !path.includes("/node_modules/"))].map(canonicalInputPath)))];
  return config;
}

/**
 * Build a ResolvedConfig for a standalone spec file (no config file needed).
 */
export async function configFromSpec(specPath: string): Promise<ResolvedConfig> {
  return resolveConfigFromRaw(
    {
      name: "API Reference",
      navigation: {
        tabs: [{ tab: "API Reference", slug: "api", source: openapiSource(resolve(specPath)) }],
      },
    },
    process.cwd(),
  );
}

// ---------------------------------------------------------------------------
// Resolution + validation
// ---------------------------------------------------------------------------

function publicSettings(raw: SourceyConfig, host?: Readonly<SiteHostConfig>) {
  const siteUrl = normalizeSiteUrl(host?.siteUrl === false ? undefined : host?.siteUrl ?? raw.siteUrl);
  const baseUrl = normalizeBaseUrl(host?.baseUrl ?? raw.baseUrl);
  return {
    host,
    landingPage: host?.landingPage ?? true,
    siteUrl,
    baseUrl,
    prettyUrls: resolvePrettyUrls(host?.prettyUrls ?? raw.prettyUrls),
    discovery: resolveDiscovery(raw.discovery, siteUrl, baseUrl),
  };
}

export function applySiteHostConfig(config: ResolvedConfig, host: Readonly<SiteHostConfig>): ResolvedConfig {
  return { ...config, ...publicSettings(config.authoring, host) };
}

export async function resolveConfigFromRaw(
  raw: SourceyConfig,
  configDir: string,
  host?: Readonly<SiteHostConfig>,
): Promise<ResolvedConfig> {
  const theme = resolveTheme(raw, configDir);
  const logo = resolveLogo(raw.logo, raw.theme?.reader?.logoMark, configDir);
  const contexts = await resolveContexts(raw, configDir, resolveTabs);
  const changelog = resolveChangelog(raw.changelog);

  return {
    ...publicSettings(raw, host),
    publicDir: raw.publicDir ? resolve(configDir, raw.publicDir) : undefined,
    pages: raw.pages ? await pagesDirectory(resolve(configDir, raw.pages)) : undefined,
    exports: resolveExports(raw.exports),
    tryIt: resolveTryIt(raw.tryIt),
    name: raw.name ?? "",
    titleSeparator: raw.titleSeparator ?? " - ",
    theme,
    logo,
    favicon:
      raw.favicon && !raw.favicon.startsWith("http") && !raw.favicon.startsWith("data:")
        ? resolve(configDir, raw.favicon)
        : raw.favicon,
    ogImage:
      raw.ogImage && !raw.ogImage.startsWith("http") && !raw.ogImage.startsWith("data:")
        ? resolve(configDir, raw.ogImage)
        : raw.ogImage,
    repo: raw.repo,
    editBranch: raw.editBranch,
    editBasePath: raw.editBasePath,
    codeSamples: resolveCodeSamples(raw.codeSamples),
    contexts,
    configDir,
    authoring: raw,
    components: raw.components ?? {},
    notFound: raw.notFound !== false,
    redirects: resolveRedirects(raw.redirects),
    navbar: {
      links: raw.navbar?.links ?? [],
      primary: raw.navbar?.primary,
    },
    footer: {
      text: raw.footer?.text?.trim() || undefined,
      links: raw.footer?.links ?? [],
    },
    changelog,
    markdown: { smartypants: raw.markdown?.smartypants === true },
    search: {
      featured: raw.search?.featured ?? [],
    },
  };
}

function resolveTryIt(value: SourceyConfig["tryIt"]): false | TryItConfig {
  if (value === false) return false;
  if (
    value !== undefined &&
    (value === null ||
      typeof value !== "object" ||
      (value.credentials !== undefined &&
        !["omit", "same-origin", "include"].includes(value.credentials)))
  ) {
    throw new Error(
      "tryIt must be false or an object with credentials: omit, same-origin, or include.",
    );
  }
  return { credentials: value?.credentials ?? "same-origin" };
}

const VALID_THEMES = Object.keys(themeDefinitions) as ThemeName[];

function resolveTheme(raw: SourceyConfig, configDir: string): ResolvedTheme {
  if (raw.theme?.name && raw.theme?.preset && raw.theme.name !== raw.theme.preset) {
    throw new Error(
      `Conflicting theme names: theme.name is "${raw.theme.name}" but deprecated theme.preset is "${raw.theme.preset}"`,
    );
  }
  const name = raw.theme?.name ?? raw.theme?.preset ?? "default";
  if (!VALID_THEMES.includes(name)) {
    throw new Error(`Invalid theme "${name}". Must be one of: ${VALID_THEMES.join(", ")}`);
  }
  if (raw.theme?.reader && name !== "reader") {
    throw new Error('theme.reader options require theme.name to be "reader"');
  }

  const rawColors = raw.theme?.colors;
  const colors = rawColors ? brandColors(rawColors) : { ...DEFAULT_COLORS };

  const named = (name: string | undefined) => (name && name !== "system" ? name : undefined);
  const sansName = named(raw.theme?.fonts?.sans ?? DEFAULT_FONT_SANS);
  const monoName = named(raw.theme?.fonts?.mono);
  const fonts = {
    sans: sansName ? `'${sansName}', ${SYSTEM_SANS}` : SYSTEM_SANS,
    mono: monoName ? `'${monoName}', ${SYSTEM_MONO}` : SYSTEM_MONO,
    google: raw.theme?.fonts?.google === false ? [] : [sansName, monoName].filter((name): name is string => Boolean(name)),
  };

  const defaults =
    name === "reader"
      ? { sidebar: "245px", toc: "220px", content: "850px" }
      : name === "api-first"
        ? { sidebar: "17.5rem", toc: "13.5rem", content: "44rem" }
        : DEFAULT_LAYOUT;
  const layout = {
    sidebar: raw.theme?.layout?.sidebar ?? defaults.sidebar,
    toc: raw.theme?.layout?.toc ?? defaults.toc,
    content: raw.theme?.layout?.content ?? defaults.content,
  };

  const css = (raw.theme?.css ?? []).map((p) => resolve(configDir, p));

  const appearance = {
    default: raw.theme?.appearance?.default ?? "system",
    storageKey: raw.theme?.appearance?.storageKey ?? "sourcey-theme",
  };
  if (!["system", "light", "dark"].includes(appearance.default))
    throw new Error("Invalid theme.appearance.default");
  const icons = raw.theme?.icons ?? "heroicons";
  if (!ICON_SETS.includes(icons)) throw new Error(`Invalid theme.icons "${icons}"; use ${ICON_SETS.map((set) => `"${set}"`).join(" or ")}`);
  return { name, colors, fonts, layout, css, reader: raw.theme?.reader, appearance, icons };
}

function resolveLogo(logo: SourceyConfig["logo"], readerMark: boolean | undefined, configDir: string): ResolvedConfig["logo"] {
  if (!logo) return undefined;
  const resolvePath = (p?: string) =>
    p && !p.startsWith("http") && !p.startsWith("data:") ? resolve(configDir, p) : p;
  const { light, dark, href, mark } = typeof logo === "string" ? { light: logo } : logo;
  // The reader theme's earlier `logoMark` says the same of its logo.
  return { light: resolvePath(light), dark: resolvePath(dark), href, ...((mark ?? readerMark) ? { mark: true } : {}) };
}

function resolveChangelog(raw: SourceyConfig["changelog"]): ResolvedChangelogConfig {
  if (raw === false) {
    return { enabled: false, feed: false, permalinks: false, ogImages: false };
  }

  return {
    enabled: raw?.enabled ?? true,
    feed: raw?.feed === true ? {} : (raw?.feed ?? false),
    permalinks: raw?.permalinks ?? false,
    ogImages: raw?.ogImages ?? false,
  };
}

async function resolveTabs(
  tabs: TabConfig[],
  configDir: string,
  locale?: import("./adapters/types.js").SourceLocaleContext,
): Promise<ResolvedTab[]> {
  const slugs = new Set<string>();
  const resolved: ResolvedTab[] = [];

  for (const tab of tabs) {
    if (!tab.tab) throw new Error('Tab missing "tab" name');

    const slug = tab.slug !== undefined ? tab.slug : slugify(tab.tab);
    if (slugs.has(slug)) throw new Error(`Duplicate tab slug "${slug}" (from "${tab.tab}")`);
    if (slug.startsWith("@")) throw new Error(`Tab slug "${slug}" (from "${tab.tab}"): slugs starting with @ are reserved`);
    slugs.add(slug);

    const sources = [
      tab.source,
      tab.openapi,
      tab.groups?.length ? tab.groups : undefined,
      tab.doxygen,
      tab.mcp,
      tab.godoc,
      tab.rustdoc,
    ].filter(Boolean).length;
    if (sources > 1) {
      throw new Error(
        `Tab "${tab.tab}" has multiple sources; use only one of "source", "openapi", "groups", "doxygen", "mcp", "godoc", or "rustdoc"`,
      );
    }
    if (sources === 0) {
      throw new Error(
        `Tab "${tab.tab}" needs one of "source", "openapi", "groups", "doxygen", "mcp", "godoc", or "rustdoc"`,
      );
    }

    const adapter = tab.source ?? tabSourceAdapter(tab);
    const source = await adapter.resolve({
      configDir,
      locale,
      tabName: tab.tab,
      tabSlug: slug,
      resolvePath: (path) => resolve(configDir, path),
      assertExists,
      isUrl: isAbsoluteHttpUrl,
    });
    if (tab.anchorUnmatched !== undefined && !["error", "warn", "ignore"].includes(tab.anchorUnmatched)) throw new Error(`Invalid anchorUnmatched in tab "${tab.tab}"; expected error, warn or ignore`);
    const reference = tab.reference ?? {};
    if (reference.split !== undefined && reference.split !== "operations") throw new Error(`Invalid reference.split in tab "${tab.tab}"; expected "operations"`);
    if (reference.operations !== undefined && (typeof reference.operations !== "string" || !reference.operations.trim())) throw new Error(`Invalid reference.operations in tab "${tab.tab}"; expected an address such as "{operationId}"`);
    resolved.push({
      ...resolvedTabFromSource(tab.tab, slug, source),
      id: tab.id ?? slug,
      reference,
      routes: tab.routes,
      anchors: tab.anchors,
      anchorUnmatched: tab.anchorUnmatched,
      navigation: tab.navigation,
      tryIt: tab.tryIt === undefined ? undefined : resolveTryIt(tab.tryIt),
    });
  }

  return resolved;
}

function tabSourceAdapter(tab: TabConfig): SourceAdapter {
  if (tab.openapi) return openapiSource(tab.openapi);
  if (tab.mcp) return mcpSource(tab.mcp);
  if (tab.doxygen) return doxygenSource(tab.doxygen);
  if (tab.godoc) return godocSource(tab.godoc);
  if (tab.rustdoc) return rustdocSource(tab.rustdoc);
  return markdownSource({ groups: tab.groups! });
}

function resolvedTabFromSource(
  label: string,
  slug: string,
  source: ResolvedTabSource,
): ResolvedTab {
  const base: ResolvedTab = { id: slug, label, slug, source, reference: {} };
  switch (source.kind) {
    case "openapi":
      return { ...base, openapi: source.spec };
    case "mcp":
      return { ...base, mcp: source.spec };
    case "markdown":
      return {
        ...base,
        groups: source.groups,
      };
    case "doxygen":
      return { ...base, doxygen: source.config };
    case "godoc":
      return { ...base, godoc: source.config };
    case "rustdoc":
      return { ...base, rustdoc: source.config };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function resolvePrettyUrls(value: PrettyUrls | undefined): PrettyUrls {
  if (value === undefined || value === false) return false;
  if (value === "slash" || value === "strip") return value;
  throw new Error(`Invalid prettyUrls "${String(value)}". Expected false, "slash", or "strip".`);
}

/** The site's colours; a text shade it leaves out is its primary as text that reads in that scheme. */
function brandColors(raw: { primary: string; light?: string; dark?: string }): ResolvedTheme["colors"] {
  const primary = hexToRgb(raw.primary);
  const shades = textShades(primary);
  return {
    primary,
    light: raw.light ? hexToRgb(raw.light) : shades.light,
    dark: raw.dark ? hexToRgb(raw.dark) : shades.ink,
  };
}

export function hexToRgb(hex: string): string {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Invalid hex color: "${hex}"`);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function resolveCodeSamples(value: string[] | undefined): string[] {
  const langs = value ?? DEFAULT_CODE_SAMPLE_LANGS;
  const unsupported = langs.filter((lang) => !SUPPORTED_CODE_SAMPLE_LANGS.includes(lang));
  if (unsupported.length) {
    throw new Error(
      `Invalid codeSamples value "${unsupported[0]}". Must be one of: ${SUPPORTED_CODE_SAMPLE_LANGS.join(", ")}`,
    );
  }
  return [...langs];
}

async function pagesDirectory(path: string): Promise<string> {
  if (!(await stat(path).then(info => info.isDirectory(), () => false))) throw new Error(`pages is not a folder: ${path}`);
  return path;
}

async function assertExists(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function resolveRedirects(raw: SourceyConfig["redirects"]): Record<string, Redirect> {
  const result: Record<string, Redirect> = {};
  for (const [from, value] of Object.entries(raw ?? {})) {
    if (!from.startsWith("/") || from.startsWith("//") || /[\s?*#\\]/.test(from) || decodeURI(new URL(from, "https://sourcey.invalid").pathname) !== decodeURI(from))
      throw new Error(`Unsupported redirect path: ${from}`);
    const redirect: Redirect = typeof value === "string" ? { to: value, status: 301 } : value;
    if (
      ![301, 302, 303, 307, 308].includes(redirect.status) ||
      !/^(\/(?!\/)|https?:\/\/)/.test(redirect.to) || /[\s\\]/.test(redirect.to)
    )
      throw new Error(`Invalid redirect: ${from}`);
    result[from] = redirect;
  }
  return result;
}
