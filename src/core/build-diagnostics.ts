import type { ChangelogDiagnostic } from "./types.js";
import type { GodocLoaderDiagnostic } from "./godoc-loader.js";
import type { RustdocLoaderDiagnostic } from "./rustdoc-loader.js";
import { formatOverlayDiagnostic, type OverlayDiagnostic } from "./overlay.js";
import type { ContentDiagnostic } from "./markdown-loader.js";
import type { AnchorDiagnostic } from "./site-model.js";

/** What a build found in its sources: what each source reported, and its content's own findings. */
export interface BuildDiagnostics {
  changelogDiagnostics: ChangelogDiagnostic[];
  godocDiagnostics: GodocLoaderDiagnostic[];
  rustdocDiagnostics: RustdocLoaderDiagnostic[];
  overlayDiagnostics: OverlayDiagnostic[];
  referenceDiagnostics: ReferenceDiagnostic[];
  contentDiagnostics: ContentDiagnostic[];
  anchorDiagnostics: AnchorDiagnostic[];
}

/**
 * How an OpenAPI or MCP reference publishes against its shape: the shape the
 * build chose where the config names none, entries its groups leave out, a
 * split with one section to split by, a page too long to read as one.
 */
export interface ReferenceDiagnostic {
  severity: "info" | "warning";
  code: "shape" | "mcp-ungrouped" | "one-section" | "long-page";
  tab: string;
  message: string;
}

/** One reporting projection for the CLI, preview server and host integrations. */
export function formatBuildDiagnostics(result: BuildDiagnostics): string[] {
  return [
    ...result.changelogDiagnostics.map(formatChangelogDiagnostic),
    ...result.godocDiagnostics.map(formatGodocDiagnostic),
    ...result.rustdocDiagnostics.map(formatRustdocDiagnostic),
    ...result.overlayDiagnostics.map(formatOverlayDiagnostic),
    ...result.referenceDiagnostics.map(diagnostic => `${diagnostic.severity === "info" ? "" : `WARNING ${diagnostic.code} `}${diagnostic.tab}: ${diagnostic.message}`),
    ...result.contentDiagnostics.map(formatContentDiagnostic),
    ...result.anchorDiagnostics.map(diagnostic => `anchor [${diagnostic.code}]: ${diagnostic.message} Unmatched aliases are omitted.`),
  ];
}

/**
 * Stop a build at the first error a Go, Rust or changelog source reported,
 * and with `strictChangelog` at a changelog's first warning too.
 */
export function enforceBuildDiagnostics(result: BuildDiagnostics, strictChangelog = false): void {
  const changelog = result.changelogDiagnostics.find(diagnostic => diagnostic.severity === "error")
    ?? (strictChangelog ? result.changelogDiagnostics.find(diagnostic => diagnostic.severity === "warning") : undefined);
  if (changelog) throw new Error(formatChangelogFailure(changelog));
  const godoc = result.godocDiagnostics.find(diagnostic => diagnostic.severity === "error");
  if (godoc) throw new Error(formatGodocFailure(godoc));
  const rustdoc = result.rustdocDiagnostics.find(diagnostic => diagnostic.severity === "error");
  if (rustdoc) throw new Error(formatRustdocFailure(rustdoc));
}

export function formatChangelogDiagnostic(diagnostic: ChangelogDiagnostic): string {
  const location = diagnostic.version ? ` (${diagnostic.version})` : "";
  const line = diagnostic.line ? ` line ${diagnostic.line}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}${line}: ${diagnostic.message}`;
}

function formatChangelogFailure(diagnostic: ChangelogDiagnostic): string {
  const location = diagnostic.version ? ` (${diagnostic.version})` : "";
  const line = diagnostic.line ? ` line ${diagnostic.line}` : "";
  return `[${diagnostic.code}]${location}${line}: ${diagnostic.message}`;
}

function formatContentDiagnostic(diagnostic: ContentDiagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`;
}

function formatGodocDiagnostic(diagnostic: GodocLoaderDiagnostic): string {
  const where = diagnostic.package ? ` [${diagnostic.package}]` : "";
  return `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${where}${location(diagnostic)} ${diagnostic.message}`;
}

function formatGodocFailure(diagnostic: GodocLoaderDiagnostic): string {
  const where = diagnostic.package ? ` (${diagnostic.package})` : "";
  return `[${diagnostic.code}]${where}${location(diagnostic)}: ${diagnostic.message}`;
}

function formatRustdocDiagnostic(diagnostic: RustdocLoaderDiagnostic): string {
  const crate = diagnostic.crate ? ` [${diagnostic.crate}]` : "";
  return `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${crate}${location(diagnostic)} ${diagnostic.message}`;
}

function formatRustdocFailure(diagnostic: RustdocLoaderDiagnostic): string {
  const crate = diagnostic.crate ? ` (${diagnostic.crate})` : "";
  return `[${diagnostic.code}]${crate}${location(diagnostic)}: ${diagnostic.message}`;
}

/** A source diagnostic's file and line, as ` file:line`, or nothing where it names no file. */
function location(diagnostic: { file?: string; line?: number }): string {
  return diagnostic.file ? ` ${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}` : "";
}
