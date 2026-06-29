#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDocs, buildSiteDocs } from "./index.js";
import { loadConfig } from "./config.js";
import type { ChangelogDiagnostic } from "./core/types.js";
import { runIntrospector, GodocIntrospectorError } from "./core/godoc-introspector.js";
import { GODOC_SCHEMA_VERSION } from "./core/godoc-types.js";
import type { GodocSnapshot } from "./core/godoc-types.js";
import { init } from "./init.js";
import {
  formatChangelogDiagnostic,
  formatGodocDiagnostic,
  formatRustdocDiagnostic,
} from "./site-assembly.js";
import type { GodocLoaderDiagnostic } from "./core/godoc-loader.js";
import type { RustdocLoaderDiagnostic } from "./core/rustdoc-loader.js";
import { findPlaceholderServerUrls } from "./utils/server-warnings.js";
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
          logChangelogDiagnostics(result.changelogDiagnostics);
          logGodocDiagnostics(result.godocDiagnostics);
          logRustdocDiagnostics(result.rustdocDiagnostics);
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

const main = defineCommand({
  meta: {
    name: "sourcey",
    version: pkg.version,
    description:
      "Open source documentation platform for OpenAPI, MCP, Doxygen, godoc, and Markdown",
  },
  subCommands: {
    init,
    build,
    dev,
    validate,
    godoc,
  },
});

function logChangelogDiagnostics(diagnostics: ChangelogDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.log(`  ${formatChangelogDiagnostic(diagnostic)}`);
  }
}

function logGodocDiagnostics(diagnostics: GodocLoaderDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const writer = diagnostic.severity === "error" ? console.error : console.log;
    writer(`  ${formatGodocDiagnostic(diagnostic)}`);
  }
}

function logRustdocDiagnostics(diagnostics: RustdocLoaderDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const writer = diagnostic.severity === "error" ? console.error : console.log;
    writer(`  ${formatRustdocDiagnostic(diagnostic)}`);
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
