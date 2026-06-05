import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createJiti } from "jiti";
import { normalizeBaseUrl, normalizeSiteUrl } from "./site-url.js";
import type { PrettyUrls } from "./site-url.js";
import {
  doxygen as doxygenSource,
  godoc as godocSource,
  markdown as markdownSource,
  mcp as mcpSource,
  mkdocs as mkdocsSource,
  openapi as openapiSource,
  rustdoc as rustdocSource,
} from "./adapters/index.js";
import type { MarkdownPreprocessor } from "./core/markdown-loader.js";
import type { ResolvedTabSource, SourceAdapter } from "./adapters/types.js";
import { DEFAULT_CODE_SAMPLE_LANGS, SUPPORTED_CODE_SAMPLE_LANGS } from "./utils/code-samples.js";

export type { PrettyUrls } from "./site-url.js";

// ---------------------------------------------------------------------------
// User-facing config types (used in sourcey.config.ts)
// ---------------------------------------------------------------------------

export type ThemePreset = "default" | "minimal" | "api-first";

export interface ThemeConfig {
  preset?: ThemePreset;
  colors?: {
    primary: string;
    light?: string;
    dark?: string;
  };
  fonts?: {
    sans?: string;
    mono?: string;
  };
  layout?: {
    sidebar?: string;
    toc?: string;
    content?: string;
  };
  css?: string[];
}

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

export interface SourceyConfig {
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
    links?: NavbarLink[];
  };
  changelog?: false | ChangelogConfig;
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
  | string
  | DoxygenSourceUrlRoute[]
  | ((input: DoxygenSourceUrlInput) => string | undefined);

export interface DoxygenConfig {
  /** Path to Doxygen XML output directory */
  xml: string;
  /** Programming language (default: "cpp") */
  language?: string;
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
  tab: string;
  /** Custom URL slug for this tab. Defaults to slugified tab name. */
  slug?: string;
  /** Source adapter object, usually created with `mkdocs()`, `openapi()`, `markdown()`, `doxygen()`, `godoc()`, or `mcp()`. */
  source?: SourceAdapter;
  openapi?: string;
  /** Path to a MkDocs mkdocs.yml/mkdocs.yaml file. Sourcey imports docs_dir and nav. */
  mkdocs?: string;
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

export interface GroupConfig {
  group: string;
  pages: string[];
}

export type LinkType =
  | "github"
  | "twitter"
  | "discord"
  | "linkedin"
  | "youtube"
  | "slack"
  | "mastodon"
  | "bluesky"
  | "reddit"
  | "npm"
  | "link";

export interface NavbarLink {
  type: LinkType;
  href: string;
  label?: string;
}

export function defineConfig(config: SourceyConfig): SourceyConfig {
  return config;
}

// ---------------------------------------------------------------------------
// Resolved config types (internal, after validation + path resolution)
// ---------------------------------------------------------------------------

export interface ResolvedTheme {
  preset: ThemePreset;
  colors: { primary: string; light: string; dark: string };
  fonts: { sans: string; mono: string; googleFont: string };
  layout: { sidebar: string; toc: string; content: string };
  css: string[];
}

export interface ResolvedChangelogConfig {
  enabled: boolean;
  feed: false | { title?: string; description?: string };
  permalinks: boolean;
  ogImages: boolean;
}

export interface ResolvedConfig {
  name: string;
  titleSeparator: string;
  siteUrl?: string;
  baseUrl: string;
  prettyUrls: PrettyUrls;
  theme: ResolvedTheme;
  logo?: { light?: string; dark?: string; href?: string };
  favicon?: string;
  ogImage?: string;
  repo?: string;
  editBranch?: string;
  editBasePath?: string;
  codeSamples: string[];
  tabs: ResolvedTab[];
  navbar: { links: NavbarLink[]; primary?: { type: "button"; label: string; href: string } };
  footer: { links: NavbarLink[] };
  changelog: ResolvedChangelogConfig;
  search: { featured: string[] };
}

export interface ResolvedDoxygenConfig {
  xml: string;
  language: string;
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
  label: string;
  slug: string;
  source: ResolvedTabSource;
  openapi?: string;
  mkdocs?: string;
  groups?: ResolvedGroup[];
  doxygen?: ResolvedDoxygenConfig;
  mcp?: string;
  godoc?: ResolvedGodocConfig;
  rustdoc?: ResolvedRustdocConfig;
}

export interface ResolvedPage {
  /** Original config slug (e.g. "run/index") */
  slug: string;
  /** Absolute filesystem path to the .md/.mdx file */
  file: string;
  /** Optional navigation label supplied by a source format such as MkDocs. */
  label?: string;
  /** Optional source root used for source-format-relative includes and assets. */
  sourceRoot?: string;
  /** Optional source-adapter Markdown preprocessors. */
  preprocess?: MarkdownPreprocessor[];
}

export interface ResolvedGroup {
  label: string;
  pages: ResolvedPage[];
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

export async function loadConfig(configOrDir?: string): Promise<ResolvedConfig> {
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

  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath)) as { default: SourceyConfig };
  const raw = mod.default;

  if (!raw?.navigation?.tabs) {
    throw new Error(
      "sourcey.config.ts must export default defineConfig({ navigation: { tabs: [...] } })",
    );
  }

  return resolveConfigFromRaw(raw, dirname(configPath));
}

/**
 * Build a ResolvedConfig for a standalone spec file (no config file needed).
 */
export function configFromSpec(specPath: string): ResolvedConfig {
  const absSpec = resolve(specPath);
  return {
    name: "API Reference",
    titleSeparator: " - ",
    siteUrl: undefined,
    baseUrl: "",
    prettyUrls: false,
    theme: {
      preset: "default",
      colors: { ...DEFAULT_COLORS },
      fonts: {
        sans: `'${DEFAULT_FONT_SANS}', ${SYSTEM_SANS}`,
        mono: SYSTEM_MONO,
        googleFont: DEFAULT_FONT_SANS,
      },
      layout: { ...DEFAULT_LAYOUT },
      css: [],
    },
    codeSamples: ["curl", "javascript", "python"],
    tabs: [
      {
        label: "API Reference",
        slug: "api",
        source: { kind: "openapi", spec: absSpec, watchPaths: [absSpec] },
        openapi: absSpec,
      },
    ],
    navbar: { links: [] },
    footer: { links: [] },
    changelog: { enabled: true, feed: false, permalinks: false, ogImages: false },
    search: { featured: [] },
  };
}

// ---------------------------------------------------------------------------
// Resolution + validation
// ---------------------------------------------------------------------------

export async function resolveConfigFromRaw(
  raw: SourceyConfig,
  configDir: string,
): Promise<ResolvedConfig> {
  const theme = resolveTheme(raw, configDir);
  const logo = resolveLogo(raw.logo, configDir);
  const tabs = await resolveTabs(raw.navigation.tabs, configDir);
  const changelog = resolveChangelog(raw.changelog);

  return {
    name: raw.name ?? "",
    titleSeparator: raw.titleSeparator ?? " - ",
    siteUrl: normalizeSiteUrl(raw.siteUrl),
    baseUrl: normalizeBaseUrl(raw.baseUrl),
    prettyUrls: resolvePrettyUrls(raw.prettyUrls),
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
    tabs,
    navbar: {
      links: raw.navbar?.links ?? [],
      primary: raw.navbar?.primary,
    },
    footer: {
      links: raw.footer?.links ?? [],
    },
    changelog,
    search: {
      featured: raw.search?.featured ?? [],
    },
  };
}

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

const VALID_PRESETS: ThemePreset[] = ["default", "minimal", "api-first"];

function resolveTheme(raw: SourceyConfig, configDir: string): ResolvedTheme {
  const preset = raw.theme?.preset ?? "default";
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(
      `Invalid theme preset "${preset}". Must be one of: ${VALID_PRESETS.join(", ")}`,
    );
  }

  const rawColors = raw.theme?.colors;
  const colors = rawColors
    ? {
        primary: hexToRgb(rawColors.primary),
        light: rawColors.light ? hexToRgb(rawColors.light) : hexToRgb(rawColors.primary),
        dark: rawColors.dark ? hexToRgb(rawColors.dark) : hexToRgb(rawColors.primary),
      }
    : { ...DEFAULT_COLORS };

  const sansName = raw.theme?.fonts?.sans ?? DEFAULT_FONT_SANS;
  const monoName = raw.theme?.fonts?.mono;
  const fonts = {
    sans: `'${sansName}', ${SYSTEM_SANS}`,
    mono: monoName ? `'${monoName}', ${SYSTEM_MONO}` : SYSTEM_MONO,
    googleFont: sansName,
  };

  const layout = {
    sidebar: raw.theme?.layout?.sidebar ?? DEFAULT_LAYOUT.sidebar,
    toc: raw.theme?.layout?.toc ?? DEFAULT_LAYOUT.toc,
    content: raw.theme?.layout?.content ?? DEFAULT_LAYOUT.content,
  };

  const css = (raw.theme?.css ?? []).map((p) => resolve(configDir, p));

  return { preset, colors, fonts, layout, css };
}

function resolveLogo(logo: SourceyConfig["logo"], configDir: string): ResolvedConfig["logo"] {
  if (!logo) return undefined;
  const resolvePath = (p?: string) =>
    p && !p.startsWith("http") && !p.startsWith("data:") ? resolve(configDir, p) : p;
  if (typeof logo === "string") return { light: resolvePath(logo) };
  return { light: resolvePath(logo.light), dark: resolvePath(logo.dark), href: logo.href };
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

async function resolveTabs(tabs: TabConfig[], configDir: string): Promise<ResolvedTab[]> {
  const slugs = new Set<string>();
  const resolved: ResolvedTab[] = [];

  for (const tab of tabs) {
    if (!tab.tab) throw new Error('Tab missing "tab" name');

    const slug = tab.slug !== undefined ? tab.slug : slugify(tab.tab);
    if (slugs.has(slug)) throw new Error(`Duplicate tab slug "${slug}" (from "${tab.tab}")`);
    slugs.add(slug);

    const sources = [
      tab.source,
      tab.openapi,
      tab.mkdocs,
      tab.groups?.length ? tab.groups : undefined,
      tab.doxygen,
      tab.mcp,
      tab.godoc,
      tab.rustdoc,
    ].filter(Boolean).length;
    if (sources > 1) {
      throw new Error(
        `Tab "${tab.tab}" has multiple sources; use only one of "source", "openapi", "mkdocs", "groups", "doxygen", "mcp", "godoc", or "rustdoc"`,
      );
    }
    if (sources === 0) {
      throw new Error(
        `Tab "${tab.tab}" needs one of "source", "openapi", "mkdocs", "groups", "doxygen", "mcp", "godoc", or "rustdoc"`,
      );
    }

    const adapter = tab.source ?? legacySourceAdapter(tab);
    const source = await adapter.resolve({
      configDir,
      tabName: tab.tab,
      tabSlug: slug,
      resolvePath: (path) => resolve(configDir, path),
      assertExists,
      isUrl,
    });
    resolved.push(resolvedTabFromSource(tab.tab, slug, source));
  }

  return resolved;
}

function legacySourceAdapter(tab: TabConfig): SourceAdapter {
  if (tab.openapi) return openapiSource(tab.openapi);
  if (tab.mkdocs) return mkdocsSource(tab.mkdocs);
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
  const base: ResolvedTab = { label, slug, source };
  switch (source.kind) {
    case "openapi":
      return { ...base, openapi: source.spec };
    case "mcp":
      return { ...base, mcp: source.spec };
    case "markdown":
      return {
        ...base,
        mkdocs: source.adapter === "mkdocs" ? source.configPath : undefined,
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

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build a path under a tab, handling empty slugs (root-level tabs). */
export function tabPath(tabSlug: string, file: string): string {
  if (!tabSlug) return file;
  if (file.startsWith(`${tabSlug}/`)) return file;
  return `${tabSlug}/${file}`;
}

/** Build the on-disk output path for a tab landing page. */
export function tabIndexOutputPath(tabSlug: string, prettyUrls: PrettyUrls): string {
  if (!tabSlug) return "index.html";
  if (prettyUrls === "slash") return tabPath(tabSlug, "index.html");
  return `${tabSlug}.html`;
}

/**
 * Build the on-disk output path for a content page within a tab.
 * `"slash"` emits directory indexes. `false` and `"strip"` emit `.html`
 * files; `"strip"` only changes the public URL, not the file layout.
 */
export function pageOutputPath(tabSlug: string, slug: string, prettyUrls: PrettyUrls): string {
  if (slug === "index") {
    return tabIndexOutputPath(tabSlug, prettyUrls);
  }
  if (prettyUrls === "slash") {
    return tabPath(tabSlug, `${slug}/index.html`);
  }
  return tabPath(tabSlug, `${slug}.html`);
}

function resolvePrettyUrls(value: PrettyUrls | undefined): PrettyUrls {
  if (value === undefined || value === false) return false;
  if (value === "slash" || value === "strip") return value;
  throw new Error(`Invalid prettyUrls "${String(value)}". Expected false, "slash", or "strip".`);
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

async function assertExists(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}
