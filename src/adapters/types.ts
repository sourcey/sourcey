import type { MarkdownPreprocessor } from "../core/markdown-loader.js";
import type { UnmatchedTargetPolicy } from "../core/types.js";
import type {
  DoxygenConfig,
  GodocConfig,
  GroupConfig,
  ResolvedDoxygenConfig,
  ResolvedGodocConfig,
  ResolvedGroup,
  ResolvedRustdocConfig,
  RustdocConfig,
} from "../config.js";

export interface SourceLocaleContext {
  locale: string;
  defaultLocale: string;
  content: string;
  defaultContent: string;
  fallback: boolean;
}
export interface SourceAdapterContext {
  locale?: SourceLocaleContext;
  configDir: string;
  tabName: string;
  tabSlug: string;
  resolvePath(path: string): string;
  assertExists(path: string, label: string): Promise<void>;
  isUrl(source: string): boolean;
}

export interface SourceAdapter<TResolved extends ResolvedTabSource = ResolvedTabSource> {
  name: string;
  resolve(ctx: SourceAdapterContext): Promise<TResolved>;
}

export interface ResolvedSourceAsset {
  /** Absolute source file path. */
  file: string;
  /** Output path relative to the adapter tab root. */
  outputPath: string;
}

export interface ResolvedOpenApiSource {
  kind: "openapi";
  spec: string;
  overlays?: string[];
  overlayUnmatched?: UnmatchedTargetPolicy;
  watchPaths?: string[];
}

export interface ResolvedMcpSource {
  kind: "mcp";
  spec: string;
  groups?: McpGroups;
  watchPaths?: string[];
}

export interface ResolvedMarkdownSource {
  kind: "markdown";
  slugs: "normalized" | "file";
  adapter?: string;
  configPath?: string;
  groups: ResolvedGroup[];
  assets?: ResolvedSourceAsset[];
  watchPaths?: string[];
}

export interface ResolvedDoxygenSource {
  kind: "doxygen";
  config: ResolvedDoxygenConfig;
  watchPaths?: string[];
}

export interface ResolvedGodocSource {
  kind: "godoc";
  config: ResolvedGodocConfig;
  watchPaths?: string[];
}

export interface ResolvedRustdocSource {
  kind: "rustdoc";
  config: ResolvedRustdocConfig;
  watchPaths?: string[];
}

export type ResolvedTabSource =
  | ResolvedOpenApiSource
  | ResolvedMcpSource
  | ResolvedMarkdownSource
  | ResolvedDoxygenSource
  | ResolvedGodocSource
  | ResolvedRustdocSource;

export interface MarkdownSourceOptions {
  root?: string;
  slugs?: "normalized" | "file";
  groups: GroupConfig[];
}

export interface OpenApiSourceOptions {
  spec: string;
  /** Ordered OpenAPI Overlay 1.0 JSON/YAML inputs, applied before dereferencing. */
  overlays?: string[];
  /** Drift check, separate from the standard's valid zero-match no-op. Default: error. */
  overlayUnmatched?: UnmatchedTargetPolicy;
}

export interface McpSourceOptions {
  spec: string;
  /**
   * The sections the reference lists the server in, in order: each names its
   * tools, resources and prompts. The snapshot stays as captured. Anything no
   * section names is listed by kind after them, and the build says so.
   */
  groups?: McpGroups;
}

/** Section names, each with the tools, resources and prompts it lists, by name. */
export type McpGroups = Record<string, string[]>;

export type DoxygenSourceOptions = DoxygenConfig;
export type GodocSourceOptions = GodocConfig | string;
export type RustdocSourceOptions = RustdocConfig | string;

export interface PageMarkdownOptions {
  sourceRoot?: string;
  preprocess?: MarkdownPreprocessor[];
}
