import { resolve } from "node:path";
import type { ChangelogDiagnostic, NormalizedSpec } from "./core/types.js";
import type { ResolvedConfig } from "./config.js";
import { loadConfig, configFromSpec } from "./config.js";
import { buildSourceySite, writeSourceySite } from "./site.js";

// ---------------------------------------------------------------------------
// Build options
// ---------------------------------------------------------------------------

export interface BuildOptions {
  specSource: string;
  outputDir?: string;
  embeddable?: boolean;
  skipWrite?: boolean;
  strictChangelog?: boolean;
}

export interface BuildResult {
  spec: NormalizedSpec;
  outputDir: string;
  pageCount: number;
  changelogDiagnostics: ChangelogDiagnostic[];
}

/**
 * Build API documentation from a single OpenAPI/Swagger spec.
 * Wraps the spec in a single-tab site and renders through the modern layout.
 */
export async function buildDocs(options: BuildOptions): Promise<BuildResult> {
  const config = await configFromSpec(options.specSource);

  const site = await buildSourceySite({ config, outputDir: options.outputDir, strictChangelog: options.strictChangelog, copyFromSource: !options.skipWrite });
  if (!options.skipWrite) await writeSourceySite(site, { embeddable: options.embeddable });
  const spec = site.references.values().next().value;
  if (!spec) throw new Error("No OpenAPI reference was compiled");
  return { spec, outputDir: site.outputDir, pageCount: site.pageCount, changelogDiagnostics: site.changelogDiagnostics };
}

// ---------------------------------------------------------------------------
// Site build (the only rendering path)
// ---------------------------------------------------------------------------

export interface SiteBuildOptions {
  configDir?: string;
  outputDir?: string;
  config?: ResolvedConfig;
  skipWrite?: boolean;
  embeddable?: boolean;
  strictChangelog?: boolean;
  generateOgImages?: boolean;
}

export interface SiteBuildResult {
  outputDir: string;
  pageCount: number;
  changelogDiagnostics: ChangelogDiagnostic[];
  godocDiagnostics: import("./core/godoc-loader.js").GodocLoaderDiagnostic[];
  rustdocDiagnostics: import("./core/rustdoc-loader.js").RustdocLoaderDiagnostic[];
  overlayDiagnostics: import("./core/overlay.js").OverlayDiagnostic[];
  contentDiagnostics: import("./core/markdown-loader.js").ContentDiagnostic[];
  anchorDiagnostics: import("./core/site-model.js").AnchorDiagnostic[];
  /** Publishing checks: the public origin, page summaries, canonical and language links, and link fragments. */
  siteDiagnostics: import("./core/site-diagnostics.js").SiteDiagnostic[];
}

export async function buildSiteDocs(options: SiteBuildOptions = {}): Promise<SiteBuildResult> {
  const outputDir = resolve(options.outputDir ?? "dist");
  const config = options.config ?? (await loadConfig(options.configDir));
  const sourceySite = await buildSourceySite({
    config,
    outputDir,
    strictChangelog: options.strictChangelog,
    generateOgImages: options.generateOgImages,
    copyFromSource: !options.skipWrite,
  });

  if (!options.skipWrite) {
    await writeSourceySite(sourceySite, { embeddable: options.embeddable });
  }

  return {
    outputDir,
    pageCount: sourceySite.pageCount,
    changelogDiagnostics: sourceySite.changelogDiagnostics,
    godocDiagnostics: sourceySite.godocDiagnostics,
    rustdocDiagnostics: sourceySite.rustdocDiagnostics,
    overlayDiagnostics: sourceySite.overlayDiagnostics,
    contentDiagnostics: sourceySite.contentDiagnostics,
    anchorDiagnostics: sourceySite.anchorDiagnostics,
    siteDiagnostics: sourceySite.siteDiagnostics,
  };
}

export { defineConfig } from "./config.js";
export type { DiscoveryConfig, DiscoveryResource, ExportsConfig } from "./exports/config.js";
export type { DocumentationIndex, DocumentationEntry } from "./exports/documents.js";
export { doxygen, godoc, markdown, mcp, openapi, rustdoc } from "./adapters/index.js";
export { buildSourceySite, collectSourceyWatchPaths, writeSourceySite } from "./site.js";
export type { SourceySiteArtifacts, SourceySiteOptions, SourceySiteWriteOptions } from "./site.js";

// Re-export types for consumers
export type {
  NormalizedSpec,
  NormalizedOperation,
  NormalizedTag,
  NormalizedSchema,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  UnmatchedTargetPolicy,
} from "./core/types.js";

export type {
  DoxygenSourceOptions,
  GodocSourceOptions,
  MarkdownSourceOptions,
  McpSourceOptions,
  OpenApiSourceOptions,
  ResolvedTabSource,
  RustdocSourceOptions,
  SourceAdapter,
  SourceAdapterContext,
} from "./adapters/index.js";

export type {
  SourceyConfig,
  TabConfig,
  GroupConfig,
  NavigationItem,
  NavigationTarget,
  OperationNavigation,
  PageNavigation,
  ThemeConfig,
  TryItConfig,
  ThemeName,
  ThemePreset,
  ReaderThemeConfig,
  ReaderLink,
  RustdocConfig,
  ResolvedRustdocConfig,
  RustdocMode,
  RustdocFeatures,
} from "./config.js";
export type { OverlayDiagnostic } from "./core/overlay.js";
export type { ContentDiagnostic } from "./core/markdown-loader.js";
export type { AnchorDiagnostic } from "./core/site-model.js";

export { defineComponent } from "./core/markdown-components.js";
export type { NativeComponentDefinition, ContentNode, ComponentBuildContext, NativeContentContext, ResolvedComponent, StaticAttributes } from "./core/markdown-components.js";
export { updateSourceySite } from "./site.js";
