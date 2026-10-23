import { describe, expect, it } from "vitest";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrateProject } from "../../src/migration/index.js";
import { read, withProject } from "./helpers.js";

const MAPPING = `export default {
  markdown: ["./src/utils/markdown.tsx#components"],
  components: {
    "./src/components/Callout.tsx": {
      Callout: ({ props }) => ({ component: props.type === "warning" ? "Warning" : "Info", props: { title: props.title ?? "Note" } }),
    },
    "./src/components/Contents.tsx": {
      Contents: ({ props, section }) => ({ component: "PageCards", props: { section: section(props.parent), layout: "list" } }),
    },
  },
  astro: {
    roots: {
      ".": {
        name: "Example",
        documentation: [
          {
            source: "src/pages/documentation",
            kind: "pages",
            route: "/documentation",
            move: "documentation",
            navigation: { module: "./src/nav.ts", export: "menu", fields: { label: "text", link: "href", children: "items" } },
          },
        ],
      },
    },
  },
};
`;

const site = {
  "package.json": JSON.stringify({ name: "site", type: "module" }),
  "astro.config.mjs": "import { defineConfig } from 'astro/config';\nimport mdx from '@astrojs/mdx';\n\nexport default defineConfig({ integrations: [mdx()] });\n",
  "src/pages/index.astro": "<h1>Home</h1>\n",
  "src/components/Callout.tsx": "export const Callout = () => null;\n",
  "src/components/Contents.tsx": "export const Contents = () => null;\n",
  "src/utils/markdown.tsx": "export const components = {};\n",
  "src/nav.ts": [
    "import { faBook } from '@fortawesome/free-solid-svg-icons';",
    "const base = { text: 'Docs', href: '/documentation', icon: faBook };",
    "export const menu = [",
    "  { ...base, text: 'Getting started', items: [{ text: 'Install', href: '/documentation/install' }, { text: 'FAQ', href: '/documentation/faq' }] },",
    "  { text: 'Advanced', href: '/documentation/advanced', items: [{ text: 'Tuning', href: '/documentation/advanced/tuning' }, { text: 'SDK', href: 'https://sdk.example.com' }] },",
    "];",
    "",
  ].join("\n"),
  "src/pages/documentation/index.mdx": "---\nlayout: ../../layouts/Docs.astro\n---\n\n## Getting started\n\nWelcome.\n",
  "src/pages/documentation/install.mdx": [
    "---",
    "layout: ../../layouts/Docs.astro",
    "---",
    "",
    "import { Callout } from '../../components/Callout';",
    "import { components as overrides } from '../../utils/markdown';",
    "",
    "export const components = overrides;",
    "",
    "## Install",
    "",
    '<Callout type="warning" title="Careful">',
    "  <p>",
    "    Back up first.",
    "  </p>",
    "  Then run the [installer](/documentation/advanced/).",
    "</Callout>",
    "",
  ].join("\n"),
  "src/pages/documentation/advanced/index.mdx": [
    "---",
    "layout: ../../../layouts/Docs.astro",
    "---",
    "",
    "import { Contents } from '../../../components/Contents';",
    "",
    "## Advanced",
    "",
    '<Contents parent="/documentation/advanced" />',
    "",
  ].join("\n"),
  "src/pages/documentation/advanced/tuning.mdx": "---\nlayout: ../../../layouts/Docs.astro\n---\n\n## Tuning\n\nFaster.\n\n### Threads\n\nMore.\n",
  // Two headings share the top level, so neither titles the page.
  "src/pages/documentation/faq.mdx": "---\nlayout: ../../layouts/Docs.astro\n---\n\n## Questions\n\nAsk.\n\n## Answers\n\nReply.\n",
};

describe("sourcey migrate astro (custom documentation)", () => {
  it("moves pages out of the route directory and keeps their routes, titles and sections", async () => {
    await withProject(site, async (root) => {
      const mapping = join(root, "migration-mapping.ts");
      await writeFile(mapping, MAPPING);
      const report = await migrateProject({ framework: "astro", root, mapping });
      expect(report.routes.map((route) => route.source).sort()).toEqual([
        "/documentation/",
        "/documentation/advanced/",
        "/documentation/advanced/tuning/",
        "/documentation/faq/",
        "/documentation/install/",
      ]);
      await expect(access(join(root, "src/pages/documentation/install.mdx"))).rejects.toThrow();
      // The layout printed no title: each page's one opening heading was it, and the outline rises to make it the `#` title.
      expect(await read(root, "documentation/install.mdx")).toBe(
        [
          "# Install",
          "",
          '<Warning title="Careful">',
          // A plain <p> is a paragraph; as raw HTML, CommonMark would swallow the link line after it.
          // It keeps its column, so the component's children dedent together.
          "",
          "  Back up first.",
          "",
          "  Then run the [installer](/documentation/advanced/).",
          "</Warning>",
          "",
        ].join("\n"),
      );
      expect(await read(root, "documentation/advanced/index.mdx")).toBe(
        ["# Advanced", "", '<PageCards section="advanced" layout="list" />', ""].join("\n"),
      );
      expect(await read(root, "documentation/advanced/tuning.mdx")).toBe("# Tuning\n\nFaster.\n\n## Threads\n\nMore.\n");
      // Two headings share the top level, so the navigation label titles the page and the outline stays.
      expect(await read(root, "documentation/faq.mdx")).toBe("---\ntitle: FAQ\n---\n\n## Questions\n\nAsk.\n\n## Answers\n\nReply.\n");
      expect(await read(root, "astro.config.mjs")).toBe(
        "import { defineConfig } from 'astro/config';\nimport mdx from '@astrojs/mdx';\nimport sourcey from \"sourcey/astro\";\n\nexport default defineConfig({ integrations: [mdx(), sourcey({ routeBase: \"/documentation\" })] });\n",
      );
      const config = await read(root, "sourcey.config.ts");
      expect(config).toContain('group: "Advanced",\n              id: "advanced",\n              href: "/documentation/advanced/",');
      expect(config).toContain('{ href: "https://sdk.example.com", label: "SDK" }');
    });
  });
});
