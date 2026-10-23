import type {
  DoxygenSourceOptions,
  GodocSourceOptions,
  MarkdownSourceOptions,
  McpSourceOptions,
  OpenApiSourceOptions,
  RustdocSourceOptions,
  SourceAdapter,
} from "./types.js";
import { resolve } from "node:path";
import { assertLocalPath, resolveMarkdownGroups, toWatchPaths } from "./shared.js";

export function openapi(specOrOptions: string | OpenApiSourceOptions): SourceAdapter {
  const options = typeof specOrOptions === "string" ? { spec: specOrOptions } : specOrOptions;
  const { spec } = options;
  return {
    name: "openapi",
    async resolve(ctx) {
      if (options.overlayUnmatched && !["error", "warn", "ignore"].includes(options.overlayUnmatched)) throw new Error("Invalid OpenAPI overlayUnmatched; expected error, warn or ignore");
      async function input(path: string, label: string): Promise<string> {
        if (ctx.isUrl(path)) return path;
        const absolute = ctx.resolvePath(path);
        await ctx.assertExists(absolute, `${label} "${path}" in tab "${ctx.tabName}"`);
        return absolute;
      }
      const resolvedSpec = await input(spec, "OpenAPI spec");
      const overlays = await Promise.all((options.overlays ?? []).map(path => input(path, "OpenAPI overlay")));
      return { kind: "openapi", spec: resolvedSpec, overlays, overlayUnmatched: options.overlayUnmatched ?? "error",
        watchPaths: [resolvedSpec, ...overlays].filter(path => !ctx.isUrl(path)) };
    },
  };
}

export function mcp(specOrOptions: string | McpSourceOptions): SourceAdapter {
  const { spec, groups } = typeof specOrOptions === "string" ? { spec: specOrOptions } : specOrOptions;
  return {
    name: "mcp",
    async resolve(ctx) {
      if (groups !== undefined) {
        if (!groups || typeof groups !== "object" || Array.isArray(groups)) throw new Error(`MCP groups in tab "${ctx.tabName}" must map each section's name to the names it lists`);
        for (const [group, names] of Object.entries(groups)) {
          if (!group.trim()) throw new Error(`MCP groups in tab "${ctx.tabName}" need a name for each section`);
          if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== "string" || !name))
            throw new Error(`MCP group "${group}" in tab "${ctx.tabName}" must list the names of its tools, resources or prompts`);
        }
      }
      if (ctx.isUrl(spec)) return { kind: "mcp", spec, groups };
      const absPath = ctx.resolvePath(spec);
      await ctx.assertExists(absPath, `MCP spec "${spec}" in tab "${ctx.tabName}"`);
      return { kind: "mcp", spec: absPath, groups, watchPaths: [absPath] };
    },
  };
}

export function markdown(options: MarkdownSourceOptions): SourceAdapter {
  return {
    name: "markdown",
    async resolve(ctx) {
      if (options.slugs !== undefined && options.slugs !== "normalized" && options.slugs !== "file") throw new Error("Markdown slugs must be normalized or file");
      return {
        kind: "markdown",
        slugs: options.slugs ?? "normalized",
        adapter: "markdown",
        groups: await resolveMarkdownGroups(
          options.groups,
          ctx.tabName,
          resolve(ctx.configDir, options.root ?? "."),
          undefined,
          ctx.locale,
        ),
        watchPaths: [resolve(ctx.configDir, options.root ?? ".")],
      };
    },
  };
}

export function doxygen(options: DoxygenSourceOptions): SourceAdapter {
  return {
    name: "doxygen",
    async resolve(ctx) {
      if (options.language !== undefined && options.language !== "cpp" && options.language !== "java") throw new Error(`Doxygen language must be "cpp" or "java", not ${JSON.stringify(options.language)}; C uses "cpp"`);
      const absXml = assertLocalPath(ctx, options.xml, "Doxygen XML directory");
      await ctx.assertExists(
        absXml,
        `Doxygen XML directory "${options.xml}" in tab "${ctx.tabName}"`,
      );
      return {
        kind: "doxygen",
        config: {
          xml: absXml,
          language: options.language ?? "cpp",
          groups: options.groups ?? false,
          index: options.index === false ? "none" : (options.index ?? "auto"),
          sourceUrl: options.sourceUrl,
        },
        watchPaths: [absXml],
      };
    },
  };
}

export function godoc(configOrPath: GodocSourceOptions): SourceAdapter {
  return {
    name: "godoc",
    async resolve(ctx) {
      const cfg = typeof configOrPath === "string" ? { module: configOrPath } : configOrPath;
      const moduleAbs = assertLocalPath(ctx, cfg.module ?? ".", "Go module directory");
      await ctx.assertExists(
        moduleAbs,
        `Go module directory "${cfg.module ?? "."}" in tab "${ctx.tabName}"`,
      );
      const snapshotAbs = cfg.snapshot ? ctx.resolvePath(cfg.snapshot) : undefined;
      return {
        kind: "godoc",
        config: {
          module: moduleAbs,
          packages: cfg.packages?.length ? cfg.packages : ["./..."],
          snapshot: snapshotAbs,
          mode: cfg.mode ?? "auto",
          includeTests: cfg.includeTests ?? true,
          includeUnexported: cfg.includeUnexported ?? false,
          hideUndocumented: cfg.hideUndocumented ?? false,
          exclude: cfg.exclude ?? [],
          goEnv: cfg.goEnv,
          sourceBasePath: trimSlashes(cfg.sourceBasePath ?? ""),
        },
        watchPaths: toWatchPaths([snapshotAbs]),
      };
    },
  };
}

export function rustdoc(configOrPath: RustdocSourceOptions): SourceAdapter {
  return {
    name: "rustdoc",
    async resolve(ctx) {
      const cfg = typeof configOrPath === "string" ? { manifest: configOrPath } : configOrPath;
      const manifestAbs = assertLocalPath(ctx, cfg.manifest ?? ".", "Cargo manifest");
      await ctx.assertExists(
        manifestAbs,
        `Cargo manifest "${cfg.manifest ?? "."}" in tab "${ctx.tabName}"`,
      );
      const snapshotAbs = cfg.snapshot ? ctx.resolvePath(cfg.snapshot) : undefined;
      const features = {
        default: cfg.features?.default ?? true,
        list: cfg.features?.list ?? [],
        all: cfg.features?.all ?? false,
      };
      return {
        kind: "rustdoc",
        config: {
          manifest: manifestAbs,
          crates: cfg.crates?.length ? cfg.crates : [],
          snapshot: snapshotAbs,
          mode: cfg.mode ?? "auto",
          features,
          includePrivate: cfg.includePrivate ?? false,
          includeHidden: cfg.includeHidden ?? false,
          target: cfg.target,
          toolchain: cfg.toolchain ?? "nightly",
          sourceBasePath: trimSlashes(cfg.sourceBasePath ?? ""),
          doctestsIndex: cfg.doctestsIndex ?? true,
        },
        watchPaths: toWatchPaths([snapshotAbs]),
      };
    },
  };
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export { assertLocalPath };
export type {
  DoxygenSourceOptions,
  GodocSourceOptions,
  MarkdownSourceOptions,
  McpGroups,
  McpSourceOptions,
  OpenApiSourceOptions,
  PageMarkdownOptions,
  ResolvedTabSource,
  RustdocSourceOptions,
  SourceAdapter,
  SourceAdapterContext,
} from "./types.js";
