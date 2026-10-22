#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setFlagsFromString } from "node:v8";
import { buildDocs, buildSiteDocs } from "./index.js";
import { loadConfig } from "./config.js";
import type { ChangelogDiagnostic } from "./core/types.js";
import { runIntrospector, GodocIntrospectorError } from "./core/godoc-introspector.js";
import { GODOC_SCHEMA_VERSION } from "./core/godoc-types.js";
import type { GodocSnapshot } from "./core/godoc-types.js";
import { init } from "./init.js";
import { formatBuildDiagnostics, formatChangelogDiagnostic } from "./core/build-diagnostics.js";
import { findPlaceholderServerUrls } from "./utils/server-warnings.js";
import { formatSiteDiagnostics } from "./core/site-diagnostics.js";
import pkg from "../package.json" with { type: "json" };

const build = defineCommand({
  meta: {
    name: "build",
    description: "Build documentation from sourcey.config.ts or a standalone OpenAPI spec",
  },
  args: {
    spec: {
      type: "positional",
      description: "Path to an OpenAPI spec (quick mode; skips config)",
      required: false,
    },
    output: {
      type: "string",
      alias: ["o"],
      description: "Output directory",
      default: "dist",
    },
    embed: {
      type: "boolean",
      alias: ["e"],
      description: "Embeddable output (no html/body wrapper)",
      default: false,
    },
    config: {
      type: "string",
      alias: ["c"],
      description: "Path to sourcey.config.ts (file or directory containing it)",
      required: false,
    },
    quiet: {
      type: "boolean",
      alias: ["q"],
      description: "Suppress output",
      default: false,
    },
    strictChangelog: {
      type: "boolean",
      description: "Treat changelog warnings as build errors",
      default: false,
    },
  },
  async run({ args }) {
    const startTime = Date.now();
    // A build renders every page once and keeps little, so most of what it
    // allocates is soon garbage, which V8 by default lets grow well past what
    // is live before collecting. A build trades a few percent of its time to
    // stay near what it actually holds: on an 838-page site, 1.24 GB to 0.84 GB.
    setFlagsFromString("--heap-growing-percent=10");

    try {
      if (args.spec) {
        if (!args.quiet) console.log(`\nSourcey: generating docs from ${args.spec}\n`);

        const result = await buildDocs({
          specSource: args.spec,
          outputDir: args.output,
          embeddable: args.embed,
          strictChangelog: args.strictChangelog,
        });

        if (!args.quiet) {
          logQuickBuildServerWarnings(result.spec);
          logChangelogDiagnostics(result.changelogDiagnostics);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  Spec:       ${result.spec.info.title} v${result.spec.info.version}`);
          console.log(`  Operations: ${result.spec.operations.length}`);
          console.log(`  Schemas:    ${Object.keys(result.spec.schemas).length}`);
          console.log(`  Time:       ${elapsed}s\n`);
        }
      } else {
        const config = await loadConfig(args.config);
        if (!args.quiet) console.log(`\nSourcey: building documentation site\n`);

        const result = await buildSiteDocs({
          config,
          outputDir: args.output,
          embeddable: args.embed,
          strictChangelog: args.strictChangelog,
        });

        if (!args.quiet) {
          for (const diagnostic of [...formatBuildDiagnostics(result), ...formatSiteDiagnostics(result.siteDiagnostics)]) console.warn(`  ${diagnostic}`);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  Pages:  ${result.pageCount}`);
          console.log(`  Output: ${result.outputDir}`);
          console.log(`  Time:   ${elapsed}s\n`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nError: ${message}\n`);
      process.exit(1);
    }
  },
});

const dev = defineCommand({
  meta: {
    name: "dev",
    description: "Start a dev server with live reload (reads sourcey.config.ts)",
  },
  args: {
    port: {
      type: "string",
      alias: ["p"],
      description: "Port to listen on",
      default: "4400",
    },
    host: {
      type: "string",
      description:
        "Address to bind to (e.g. 0.0.0.0 to expose externally; defaults to 127.0.0.1, or $HOST if set)",
      required: false,
    },
    config: {
      type: "string",
      alias: ["c"],
      description: "Path to sourcey.config.ts (file or directory containing it)",
      required: false,
    },
    strictChangelog: {
      type: "boolean",
      description: "Treat changelog warnings as dev errors",
      default: false,
    },
  },
  async run({ args }) {
    const { startDevServer } = await import("./dev-server.js");
    const port = parsePort(args.port);
    await startDevServer({
      port,
      host: args.host ?? process.env.HOST,
      config: args.config,
      strictChangelog: args.strictChangelog,
    });
  },
});

const validate = defineCommand({
  meta: {
    name: "validate",
    description: "Validate an OpenAPI spec file",
  },
  args: {
    spec: {
      type: "positional",
      description: "Path or URL to the OpenAPI spec",
      required: true,
    },
  },
  async run({ args }) {
    try {
      const result = await buildDocs({
        specSource: args.spec,
        skipWrite: true,
      });

      console.log(`\n  ✓ Valid: ${result.spec.info.title} v${result.spec.info.version}`);
      console.log(`  Operations: ${result.spec.operations.length}`);
      console.log(`  Schemas:    ${Object.keys(result.spec.schemas).length}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n  ✗ Invalid: ${message}\n`);
      process.exit(1);
    }
  },
});

const check = defineCommand({
  meta: { name: "check", description: "Check documentation inputs, routes, reference fragments and output collisions without writing a site" },
  args: { config: { type: "string", alias: ["c"], description: "Path to sourcey.config.ts or its directory" } },
  async run({ args }) {
    try {
      const { buildSourceySite, sourceyArtifacts } = await import("./site.js");
      const site = await buildSourceySite({ config: await loadConfig(args.config), generateOgImages: false });
      const files = await sourceyArtifacts(site);
      for (const diagnostic of [...formatBuildDiagnostics(site), ...formatSiteDiagnostics(site.siteDiagnostics)]) console.warn(diagnostic);
      console.log(`Checked ${site.pageCount} pages, ${site.assembly.routes.redirects.size} redirects and ${files.size} output files.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  },
});

const godoc = defineCommand({
  meta: {
    name: "godoc",
    description: "Snapshot a Go module's godoc data into a portable JSON file",
  },
  args: {
    module: {
      type: "string",
      alias: ["m"],
      description: "Go module directory (containing go.mod)",
      default: ".",
    },
    packages: {
      type: "string",
      alias: ["p"],
      description: "Package patterns (comma-separated)",
      default: "./...",
    },
    exclude: {
      type: "string",
      description: "Import-path prefixes to exclude (comma-separated)",
      required: false,
    },
    out: {
      type: "string",
      alias: ["o"],
      description: "Output file path",
      default: "godoc.json",
    },
    includeTests: {
      type: "boolean",
      description: "Include examples from *_test.go files",
      default: true,
    },
    includeUnexported: {
      type: "boolean",
      description: "Include unexported symbols",
      default: false,
    },
    quiet: {
      type: "boolean",
      alias: ["q"],
      description: "Suppress output",
      default: false,
    },
  },
  async run({ args }) {
    const moduleDir = resolve(process.cwd(), args.module);
    const patterns = args.packages
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const exclude = args.exclude
      ? args.exclude
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : [];
    const outputPath = resolve(process.cwd(), args.out);

    try {
      const spec = await runIntrospector({
        config: {
          module: moduleDir,
          packages: patterns.length > 0 ? patterns : ["./..."],
          mode: "live",
          includeTests: args.includeTests,
          includeUnexported: args.includeUnexported,
          hideUndocumented: false,
          exclude,
          sourceBasePath: "",
        },
      });

      const snapshot: GodocSnapshot = {
        schema_version: GODOC_SCHEMA_VERSION,
        source: "sourcey-godoc",
        module_path: spec.modulePath,
        generated_at: spec.generatedAt,
        packages: spec.packages,
        diagnostics: spec.diagnostics.length > 0 ? spec.diagnostics : undefined,
      };

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

      const errors = spec.diagnostics.filter((d) => d.severity === "error");
      const warnings = spec.diagnostics.filter((d) => d.severity === "warning");

      if (!args.quiet) {
        console.log(`\nSourcey: wrote godoc snapshot for ${spec.modulePath}`);
        console.log(`  Packages:    ${spec.packages.length}`);
        console.log(`  Output:      ${outputPath}`);
        if (warnings.length > 0) console.log(`  Warnings:    ${warnings.length}`);
        if (errors.length > 0) console.log(`  Errors:      ${errors.length}`);
        for (const diag of spec.diagnostics) {
          const where = diag.package ? ` [${diag.package}]` : "";
          console.log(`    ${diag.severity}: ${diag.code}${where} ${diag.message}`);
        }
        console.log("");
      }

      if (errors.length > 0) process.exit(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof GodocIntrospectorError ? ` (${error.code})` : "";
      console.error(`\nError${code}: ${message}\n`);
      process.exit(1);
    }
  },
});

const migrate = defineCommand({
  meta: { name: "migrate", description: "Convert a documentation project to native Sourcey files" },
  args: {
    framework: { type: "positional", required: true, description: "astro, mkdocs, docusaurus, or mintlify" },
    root: { type: "positional", required: false, description: "Project root", default: "." },
    "dry-run": { type: "boolean", default: false, description: "Verify and show changes without applying them" },
    mapping: { type: "string", required: false, description: "One-time mapping for custom source components or collections" },
  },
  async run({ args }) {
    try {
      const frameworks = ["astro", "mkdocs", "docusaurus", "mintlify"] as const;
      const framework = frameworks.find(value => value === args.framework);
      if (!framework) throw new Error(`Unknown migration source: ${args.framework}`);
      const { migrateProject, formatDiagnostic } = await import("./migration/index.js");
      const report = await migrateProject({ framework, root: resolve(args.root), dryRun: args["dry-run"], mapping: args.mapping ? resolve(args.mapping) : undefined });
      console.log(`${report.applied ? "Applied" : "Prepared"} ${report.changed.length} file changes; ${report.unchanged.length} unchanged.`);
      for (const change of report.changes) console.log(`  ${change.path}: ${change.reason}`);
      if (report.dryRun) {
        const { formatMigrationDiff } = await import("./cli/migration-diff.js");
        console.log(await formatMigrationDiff(report));
      }
      for (const diagnostic of report.diagnostics) console.log(formatDiagnostic(diagnostic));
      for (const dependency of report.dependencies) console.log(`  ${dependency.name}: ${dependency.detail}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  },
});

const main = defineCommand({
  meta: {
    name: "sourcey",
    version: pkg.version,
    description:
      "Open source documentation platform for OpenAPI, MCP, Doxygen, godoc, and Markdown",
  },
  subCommands: {
    init,
    migrate,
    build,
    dev,
    validate,
    check,
    godoc,
  },
});

function logChangelogDiagnostics(diagnostics: ChangelogDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.log(`  ${formatChangelogDiagnostic(diagnostic)}`);
  }
}

function logQuickBuildServerWarnings(spec: Parameters<typeof findPlaceholderServerUrls>[0]): void {
  const placeholderUrls = findPlaceholderServerUrls(spec);
  for (const url of placeholderUrls) {
    console.warn(
      `  Warning: quick build is using placeholder server URL "${url}". Generated code samples will target that host. Use sourcey.config.ts or correct the source document before publishing.`,
    );
  }
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port "${value}". Expected an integer from 1 to 65535.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${value}". Expected an integer from 1 to 65535.`);
  }
  return port;
}

runMain(main);
