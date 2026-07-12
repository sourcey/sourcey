import { resolve } from "node:path";
import type {
  ChangelogDiagnostic,
  NormalizedSpec,
} from "./core/types.js";
import type { ResolvedConfig } from "./config.js";
import { loadConfig, configFromSpec } from "./config.js";
import { buildSourceySite, writeSourceySite } from "./site.js";
import { createMinimalSpec } from "./site-assembly.js";

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
  const config = configFromSpec(options.specSource);

  const result = await buildSiteDocs({
    config,
    outputDir: options.outputDir,
    skipWrite: options.skipWrite,
    embeddable: options.embeddable,
    strictChangelog: options.strictChangelog,
  });

  const spec = result._specs?.values().next().value ?? createMinimalSpec();
  return {
    spec,
    outputDir: result.outputDir,
    pageCount: result.pageCount,
    changelogDiagnostics: result.changelogDiagnostics,
  };
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
  /** @internal specs by tab slug, for buildDocs compat */
  _specs?: Map<string, NormalizedSpec>;
}

export async function buildSiteDocs(options: SiteBuildOptions = {}): Promise<SiteBuildResult> {
  const outputDir = resolve(options.outputDir ?? "dist");
  const config = options.config ?? (await loadConfig(options.configDir));
  const sourceySite = await buildSourceySite({
    config,
    outputDir,
    strictChangelog: options.strictChangelog,
    generateOgImages: options.generateOgImages,
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
    _specs: sourceySite.specsBySlug,
  };
}

export { defineConfig } from "./config.js";
export { doxygen, godoc, markdown, mcp, mkdocs, openapi, rustdoc } from "./adapters/index.js";
export { resolveInternalLinks } from "./site-assembly.js";
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
} from "./core/types.js";

export type {
  DoxygenSourceOptions,
  GodocSourceOptions,
  MarkdownSourceOptions,
  McpSourceOptions,
  MkDocsSourceOptions,
  OpenApiSourceOptions,
  ResolvedTabSource,
  RustdocSourceOptions,
  SourceAdapter,
  SourceAdapterContext,
} from "./adapters/index.js";

export type {
  RustdocConfig,
  ResolvedRustdocConfig,
  RustdocMode,
  RustdocFeatures,
} from "./config.js";
