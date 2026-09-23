import { defineCommand } from "citty";
import consola from "consola";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename, relative } from "node:path";

// ---------------------------------------------------------------------------
// Auto-detection helpers
// ---------------------------------------------------------------------------

function findDoxyfile(dir: string): string | null {
  for (const name of ["Doxyfile", "doxyfile", "Doxyfile.in"]) {
    if (existsSync(resolve(dir, name))) return name;
  }
  return null;
}

function parseDoxyfileValue(doxyfile: string, key: string): string | null {
  const content = readFileSync(doxyfile, "utf-8");
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, "m"));
  return match ? match[1].trim() : null;
}

function findOpenAPISpecs(dir: string): string[] {
  const specs: string[] = [];
  const exts = [".yaml", ".yml", ".json"];
  try {
    for (const file of readdirSync(dir)) {
      if (!exts.some((e) => file.endsWith(e))) continue;
      try {
        const content = readFileSync(resolve(dir, file), "utf-8");
        if (content.includes("openapi:") || content.includes('"openapi"')) {
          specs.push(file);
        }
      } catch {
        // Ignore unreadable candidate files during spec auto-detection.
      }
    }
  } catch {
    // Ignore unreadable directories during spec auto-detection.
  }
  return specs;
}

function isExistingProject(dir: string): boolean {
  // Has source files, package.json, or git — not an empty directory
  return (
    existsSync(resolve(dir, "package.json")) ||
    existsSync(resolve(dir, ".git")) ||
    existsSync(resolve(dir, "src"))
  );
}

function suggestDocsDir(dir: string): string {
  // Common docs directory names — suggest first one that doesn't exist
  for (const name of ["docs", "documentation"]) {
    if (!existsSync(resolve(dir, name))) return name;
  }
  return "docs";
}

export const init = defineCommand({
  meta: {
    name: "init",
    description: "Scaffold a new Sourcey docs project",
  },
  async run() {
    const cwd = process.cwd();

    consola.log("");

    // -- Directory selection --
    let targetDir = cwd;

    if (isExistingProject(cwd)) {
      const suggested = suggestDocsDir(cwd);
      const dir = (await consola.prompt("Docs directory:", {
        type: "text",
        default: suggested,
        placeholder: suggested,
      })) as string;

      if (typeof dir === "symbol") process.exit(0);

      targetDir = resolve(cwd, dir);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
    }

    if (existsSync(resolve(targetDir, "sourcey.config.ts"))) {
      consola.error(
        "sourcey.config.ts already exists in " +
          (targetDir === cwd ? "this directory" : relative(cwd, targetDir)) +
          ".",
      );
      process.exit(1);
    }

    // -- Auto-detect sources --
    const doxyfile = findDoxyfile(cwd);
    const openapiSpecs = findOpenAPISpecs(cwd);

    // -- Project name --
    const defaultName = basename(cwd)
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const name = (await consola.prompt("Project name:", {
      type: "text",
      default: defaultName,
    })) as string;

    if (typeof name === "symbol") process.exit(0);

    // -- Theme --
    const theme = (await consola.prompt("Theme:", {
      type: "select",
      options: ["default", "minimal", "api-first"],
    })) as string;

    if (typeof theme === "symbol") process.exit(0);

    // -- Detected sources --
    let addOpenAPI: string | null = null;
    let addDoxygen: { doxyfile: string; xmlDir: string } | null = null;

    if (openapiSpecs.length > 0) {
      const spec =
        openapiSpecs.length === 1
          ? openapiSpecs[0]
          : ((await consola.prompt("Which OpenAPI spec?", {
              type: "select",
              options: openapiSpecs,
            })) as string);

      if (typeof spec === "symbol") process.exit(0);

      const useSpec = (await consola.prompt(`Add API reference from ${spec}?`, {
        type: "confirm",
        initial: true,
      })) as boolean;

      if (typeof useSpec === "symbol") process.exit(0);
      if (useSpec) addOpenAPI = spec;
    }

    if (doxyfile) {
      const useDoxygen = (await consola.prompt(`Found ${doxyfile}. Add Doxygen API reference?`, {
        type: "confirm",
        initial: true,
      })) as boolean;

      if (typeof useDoxygen === "symbol") process.exit(0);

      if (useDoxygen) {
        const doxyfilePath = resolve(cwd, doxyfile);
        const outputDir = parseDoxyfileValue(doxyfilePath, "OUTPUT_DIRECTORY") || ".";
        const xmlOutput = parseDoxyfileValue(doxyfilePath, "XML_OUTPUT") || "xml";
        const genXml = parseDoxyfileValue(doxyfilePath, "GENERATE_XML");

        if (genXml && genXml.toUpperCase() !== "YES") {
          consola.warn(
            `${doxyfile} has GENERATE_XML = ${genXml}. Set it to YES and run doxygen first.`,
          );
        }

        addDoxygen = {
          doxyfile,
          xmlDir: outputDir + "/" + xmlOutput,
        };
      }
    }

    // -- Example content (only if no sources detected) --
    let withExample = false;
    if (!addOpenAPI && !addDoxygen) {
      withExample = (await consola.prompt("Include example content?", {
        type: "confirm",
        initial: true,
      })) as boolean;

      if (typeof withExample === "symbol") process.exit(0);
    }

    // -- Generate files --
    const pages = withExample ? `["introduction", "quickstart"]` : `["introduction"]`;

    // Build tabs array — paths relative from targetDir to cwd
    const relPath = (file: string) => {
      const abs = resolve(cwd, file);
      const rel = relative(targetDir, abs);
      return rel.startsWith(".") ? rel : "./" + rel;
    };

    const imports = new Set(["defineConfig", "markdown"]);

    let tabs = `      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          groups: [
            {
              group: "Getting Started",
              pages: ${pages},
            },
          ],
        }),
      },`;

    if (addOpenAPI) {
      imports.add("openapi");
      tabs += `
      {
        tab: "API Reference",
        slug: "api",
        source: openapi("${relPath(addOpenAPI)}"),
      },`;
    }

    if (addDoxygen) {
      imports.add("doxygen");
      tabs += `
      {
        tab: "C++ Reference",
        slug: "cpp-api",
        source: doxygen({ xml: "${relPath(addDoxygen.xmlDir)}" }),
      },`;
    }

    const config = `import { ${[...imports].join(", ")} } from "sourcey";

export default defineConfig({
  name: "${name}",
  theme: {
    name: "${theme}",
  },
  navigation: {
    tabs: [
${tabs}
    ],
  },
});
`;

    const intro = `---
title: Introduction
description: Welcome to ${name}
---

Welcome to **${name}**. Start writing your docs here.
`;

    const quickstart = `---
title: Quick Start
description: Get up and running
---

Install the package:

\`\`\`bash
npm install my-package
\`\`\`

Then import it:

\`\`\`typescript
import { myFunction } from "my-package";
\`\`\`
`;

    const rel = targetDir === cwd ? "" : relative(cwd, targetDir) + "/";

    writeFileSync(resolve(targetDir, "sourcey.config.ts"), config);
    consola.log(`  Created ${rel}sourcey.config.ts`);

    writeFileSync(resolve(targetDir, "introduction.md"), intro);
    consola.log(`  Created ${rel}introduction.md`);

    if (withExample) {
      writeFileSync(resolve(targetDir, "quickstart.md"), quickstart);
      consola.log(`  Created ${rel}quickstart.md`);
    }

    if (!existsSync(resolve(targetDir, "package.json"))) {
      const pkg = JSON.stringify(
        {
          name: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          private: true,
          type: "module",
          scripts: {
            dev: "sourcey dev",
            build: "sourcey build",
          },
          dependencies: {
            sourcey: "^3.6.0",
          },
        },
        null,
        2,
      );
      writeFileSync(resolve(targetDir, "package.json"), pkg + "\n");
      consola.log(`  Created ${rel}package.json`);
    } else {
      consola.log(`  Skipped ${rel}package.json (already exists)`);
    }

    if (!existsSync(resolve(targetDir, ".gitignore"))) {
      writeFileSync(resolve(targetDir, ".gitignore"), "node_modules\ndist\n");
      consola.log(`  Created ${rel}.gitignore`);
    }

    consola.log("");
    consola.success(`Created sourcey project in ${rel || "./"}`);
    consola.log("");
    consola.log(`  Next steps:`);
    if (rel) consola.log(`    cd ${relative(cwd, targetDir)}`);
    consola.log(`    npm install`);
    consola.log(`    npx sourcey dev`);
    consola.log("");
  },
});
