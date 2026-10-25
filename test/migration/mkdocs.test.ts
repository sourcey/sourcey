import { describe, expect, it } from "vitest";
import { loadDocsPage } from "../../src/core/markdown-loader.js";
import { Diagnostics } from "../../src/migration/diagnostics.js";
import { migrateProject, MigrationError } from "../../src/migration/index.js";
import { convertMkDocsMarkdown, type MkDocsExtensions } from "../../src/migration/mkdocs/syntax.js";
import { read, withProject } from "./helpers.js";

const ALL: MkDocsExtensions = {
  admonition: true,
  details: true,
  tabbed: true,
  snippets: [""],
  attrList: true,
  mdInHtml: true,
  emoji: true,
  inlineHilite: true,
  githubAlerts: true,
};

async function convert(markdown: string, files: Record<string, string> = {}, extensions = ALL) {
  const diagnostics = new Diagnostics();
  const text = await convertMkDocsMarkdown(markdown, {
    file: "docs/index.md",
    route: "/",
    docsDir: "docs",
    extensions,
    diagnostics,
    exists: async (path) => path in files,
  });
  return { text, diagnostics };
}

describe("MkDocs syntax", () => {
  it("writes admonitions, collapsibles, tabs and indented GitHub alerts as native blocks", async () => {
    const { text, diagnostics } = await convert(
      [
        '!!! note "Read this"',
        "    The note body survives.",
        "",
        "    Second paragraph.",
        "",
        '??? example "Example"',
        "    Hidden until opened.",
        "",
        '=== "Modern"',
        "    New way.",
        "",
        '=== "Classic"',
        "    Old way.",
        "",
        "> [!IMPORTANT]",
        "> Native Markdown reads this alert as written.",
        "",
        "1. Upgrade",
        "",
        "    > [!WARNING]",
        "    > Back up first.",
        "",
        "After.",
      ].join("\n"),
    );
    expect(diagnostics.errors).toEqual([]);
    expect(text).toBe(
      [
        ":::note[Read this]",
        "The note body survives.",
        "",
        "Second paragraph.",
        ":::",
        "",
        ":::accordion[Example]",
        "Hidden until opened.",
        ":::",
        "",
        ":::tabs",
        ":::tab[Modern]",
        "New way.",
        ":::",
        ":::tab[Classic]",
        "Old way.",
        ":::",
        ":::",
        "",
        "> [!IMPORTANT]",
        "> Native Markdown reads this alert as written.",
        "",
        "1. Upgrade",
        "",
        "    :::warning",
        "    Back up first.",
        "    :::",
        "",
        "After.",
      ].join("\n"),
    );
  });

  it("keeps Python-Markdown headings written without an ASCII space", async () => {
    const { text } = await convert("#Install\n\n#\u00a0Prune\n\n## Kept as written\n\n```sh\n#comment\n```");
    expect(text).toBe("# Install\n\n# Prune\n\n## Kept as written\n\n```sh\n#comment\n```");
  });

  it("keeps an alert marker as text where MkDocs had no alert plugin", async () => {
    const { text } = await convert("> [!NOTE]\n> Shown as a quote.", {}, { ...ALL, githubAlerts: false });
    expect(text).toBe("> \\[!NOTE]\n> Shown as a quote.");
  });

  it("includes snippets relative to the page, as code when a fence holds only the snippet", async () => {
    const { text } = await convert(
      ["Inline code keeps `#!cpp json value;` readable.", "", '--8<-- "docs/shared/intro.md"', "", "```cpp", '--8<-- "docs/examples/basic.cpp"', "```"].join("\n"),
      { "docs/shared/intro.md": "", "docs/examples/basic.cpp": "" },
    );
    expect(text).toBe(
      ["Inline code keeps `json value;` readable.", "", '<Include src="./shared/intro.md" />', "", '<Include src="./examples/basic.cpp" language="cpp" />'].join("\n"),
    );
  });

  it("includes markdown_include files from the project root, its default base path", async () => {
    const { text } = await convert("Before.\n\n{!docs/shared/functions.md!}\n", { "docs/shared/functions.md": "" }, { ...ALL, snippets: undefined, include: "" });
    expect(text).toBe('Before.\n\n<Include src="./shared/functions.md" />\n');
  });

  it("reads attr_list, md_in_html and icons where Python-Markdown applies them", async () => {
    const { text } = await convert(
      [
        "## Install { #setup .wide }",
        "",
        '<div class="grid" markdown>',
        '![Hatch logo](logo.svg){ role="img" }',
        "</div>",
        "",
        "Hatch manages `std::vector<int>` projects.",
        "{: .lead }",
        "",
        "Templates keep {{ name }}, {name} and `{.app.metadata.name}`.",
        "",
        "-   :material-clock:{ .lg .middle } __Set up in 5 minutes__",
        "",
        "```yaml",
        'format: "{{.ID}}" { #not-an-id }',
        "```",
      ].join("\n"),
    );
    expect(text).toBe(
      [
        "## Install {#setup}",
        "",
        '<div class="grid">',
        "",
        "![Hatch logo](logo.svg)",
        "",
        "</div>",
        "",
        "Hatch manages `std::vector<int>` projects.",
        "",
        "Templates keep {{ name }}, {name} and `{.app.metadata.name}`.",
        "",
        "-   __Set up in 5 minutes__",
        "",
        "```yaml",
        'format: "{{.ID}}" { #not-an-id }',
        "```",
      ].join("\n"),
    );
  });

  it("refuses includes outside the project and reports what it could not place", async () => {
    const { diagnostics } = await convert(['--8<-- "../secret.txt"'].join("\n"));
    expect(diagnostics.errors.map((error) => error.message)).toEqual(['Included file "../secret.txt" was not found inside the project']);
  });

  it("points raw HTML and root-relative assets at their files, as MkDocs served them", async () => {
    const diagnostics = new Diagnostics();
    const text = await convertMkDocsMarkdown(
      ['<img src="../../images/a.png" alt="A">', "", "![A](/images/a.png) and [a page](/guide/other/) and ![B](b.png)"].join("\n"),
      { file: "docs/guide/setup.md", route: "/guide/setup/", docsDir: "docs", extensions: ALL, diagnostics, exists: async (path) => path === "docs/images/a.png" },
    );
    expect(text).toBe(['<img src="../images/a.png" alt="A">', "", "![A](../images/a.png) and [a page](/guide/other/) and ![B](b.png)"].join("\n"));
  });

  it("keeps C++ template names as text, which CommonMark would read as autolinks", async () => {
    const { text } = await convert("Use <small>std::</small>hash<nlohmann::basic_json\\> or <https://example.com>.");
    expect(text).toBe("Use <small>std::</small>hash\\<nlohmann::basic_json\\> or <https://example.com>.");
    await withProject({ "index.md": `# Hash\n\n${text}\n` }, async (root) => {
      const page = await loadDocsPage(`${root}/index.md`, "index");
      expect(page.kind === "markdown" && page.html).toContain("hash&lt;nlohmann::basic_json&gt;");
    });
  });
});

const site = {
  "mkdocs.yml": [
    "site_name: JSON for Modern C++",
    "site_url: https://example.com/json/",
    "repo_url: https://github.com/example/json",
    "extra_css:",
    "  - css/extra.css",
    "docs_dir: content",
    "nav:",
    "  - Home:",
    "      - Overview: index.md",
    "      - Guide:",
    "          - Install: guides/install.md",
    "  - API Documentation:",
    "      - basic_json:",
    "          - Constructor: api/basic_json/basic_json.md",
    "markdown_extensions:",
    "  - admonition",
    "  - pymdownx.emoji:",
    "      emoji_index: !!python/name:material.extensions.emoji.twemoji",
    "plugins:",
    "  - search",
    "  - gh-admonitions",
    "  - htmlproofer:",
    "      enabled: !ENV [ENABLED_HTMLPROOFER, False]",
  ].join("\n"),
  "content/index.md": "# JSON for Modern C++\n\nStart here, or read the [scan](reports/scan.html).\n",
  "content/reports/scan.html": "<!doctype html><title>Scan</title><p>No issues.</p>\n",
  "content/css/extra.css": "body { color: teal; }\n",
  "content/guides/install.md": "# Install\n\n!!! warning\n    Use a release.\n\n> [!TIP]\n> Pin the version.\n\n## Café setup\n\nNotes.\n",
  "content/api/basic_json/basic_json.md": "# Constructor\n\nCreates a value.\n",
  "content/unlisted.md": "# Unlisted\n\nPublished, not in nav.\n",
  "content/getting-started.md": "Steps only, so MkDocs titles the page from its file name.\n",
  "content/reference/README.md": "# Reference\n\nMkDocs serves this at /reference/.\n",
  "content/reference.md": "# Old reference\n\nMkDocs builds the README over this page.\n",
};

const CONFIG = `import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  name: "JSON for Modern C++",
  siteUrl: "https://example.com",
  baseUrl: "/json/",
  repo: "https://github.com/example/json",
  editBranch: "master",
  theme: {
    fonts: { sans: "system" },
  },
  prettyUrls: "slash",
  publicDir: "public",
  navbar: {
    links: [
      { type: "github", href: "https://github.com/example/json" },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          root: "content",
          slugs: "file",
          groups: [
            {
              group: "Home",
              id: "home",
              pages: [
                { page: "index", label: "Overview" },
                {
                  group: "Guide",
                  id: "home/guide",
                  pages: [
                    { page: "guides/install", label: "Install" },
                  ],
                },
                { page: "getting-started", hidden: true },
                { page: "reference/README", hidden: true },
                { page: "unlisted", hidden: true },
              ],
            },
            {
              group: "API Documentation",
              id: "api-documentation",
              pages: [
                {
                  group: "basic_json",
                  id: "api-documentation/basic-json",
                  pages: [
                    { page: "api/basic_json/basic_json", label: "Constructor" },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ],
  },
});
`;

describe("sourcey migrate mkdocs", () => {
  it("converts nav, keeps MkDocs routes and verifies the native build", async () => {
    await withProject(site, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root });
      expect(report.routes.map((route) => route.source).sort()).toEqual([
        "/json/",
        "/json/api/basic_json/basic_json/",
        "/json/getting-started/",
        "/json/guides/install/",
        "/json/reference/",
        "/json/unlisted/",
      ]);
      expect(await read(root, "content/getting-started.md")).toBe("---\ntitle: Getting started\n---\n\nSteps only, so MkDocs titles the page from its file name.\n");
      // MkDocs served the report as a page of its own; the native public directory keeps its URL.
      expect(await read(root, "public/reports/scan.html")).toBe(site["content/reports/scan.html"]);
      await expect(read(root, "content/reports/scan.html")).rejects.toThrow();
      expect(await read(root, "content/reference/README.md")).toBe("---\nslug: reference\n---\n\n# Reference\n\nMkDocs serves this at /reference/.\n");
      expect(report.diagnostics.map((item) => item.message)).toEqual([
        "MkDocs built content/reference/README.md over this page at the same URL, so it stays unpublished",
        'Plugin "htmlproofer" is not carried over',
        "Nav labels other than the page heading titled 1 page; native titles a page by its heading and keeps the label in the navigation",
        "Custom styles (css/extra.css) are not carried over; replace what they do deliberately",
      ]);
      // MkDocs routes are file paths as written, which native keeps with one source option.
      expect(await read(root, "content/api/basic_json/basic_json.md")).toBe(site["content/api/basic_json/basic_json.md"]);
      // The title heading needs no fragment; the next keeps MkDocs's ASCII `cafe-setup`, where native keeps the accent.
      expect(await read(root, "content/guides/install.md")).toBe("# Install\n\n:::warning\nUse a release.\n:::\n\n> [!TIP]\n> Pin the version.\n\n## Café setup {#cafe-setup}\n\nNotes.\n");
      expect(await read(root, "sourcey.config.ts")).toBe(CONFIG);
    });
  });

  it("carries what MkDocs adds to every page: the author and analytics in the head, extra_javascript at the end of the body", async () => {
    const analytics = '<script>var _paq = window._paq || []; _paq.push(["trackPageView"]);</script>\n';
    await withProject({
      ...site,
      "mkdocs.yml": `${site["mkdocs.yml"]}\nsite_author: Ada\ntheme:\n  name: material\n  custom_dir: overrides\nextra:\n  analytics:\n    provider: custom\nextra_javascript:\n  - js/tables.js\n  - path: https://cdn.example.com/kit.js\n    defer: true\n`,
      "overrides/partials/integrations/analytics/custom.html": analytics,
      "overrides/404.html": "<h1>Gone</h1>\n",
      "content/js/tables.js": "sortTables();\n",
    }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root });
      expect(await read(root, "components/Head.html")).toBe(`<meta name="author" content="Ada">\n${analytics}`);
      expect(await read(root, "components/BodyEnd.html")).toBe('<script src="/json/js/tables.js"></script>\n<script src="https://cdn.example.com/kit.js" defer></script>\n');
      expect(await read(root, "public/js/tables.js")).toBe("sortTables();\n");
      expect(report.diagnostics.map((item) => item.message)).toContain("Theme overrides in overrides (404.html) are not carried over; a page part in components/, or pages/404.md for a not-found page, draws their place");
    });
    await withProject({ ...site, "mkdocs.yml": `${site["mkdocs.yml"]}\nextra:\n  analytics:\n    provider: google\n    property: G-EXAMPLE\n` }, async (root) => {
      await migrateProject({ framework: "mkdocs", root });
      expect(await read(root, "components/Head.html")).toContain('gtag("config", "G-EXAMPLE");');
    });
  });

  it("reads an !ENV site URL at build time, as MkDocs did", async () => {
    await withProject({ ...site, "mkdocs.yml": site["mkdocs.yml"].replace("site_url: https://example.com/json/", "site_url: !ENV READTHEDOCS_CANONICAL_URL") }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root, dryRun: true });
      const config = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
      expect(config).toContain(
        [
          "  siteUrl: process.env.READTHEDOCS_CANONICAL_URL && new URL(process.env.READTHEDOCS_CANONICAL_URL).origin,",
          "  baseUrl: process.env.READTHEDOCS_CANONICAL_URL && new URL(process.env.READTHEDOCS_CANONICAL_URL).pathname,",
        ].join("\n"),
      );
    });
  });

  it("stops on nav entries outside docs_dir without writing", async () => {
    await withProject({ ...site, "mkdocs.yml": site["mkdocs.yml"].replace("Constructor: api/basic_json/basic_json.md", "Outside: ../outside.md"), "outside.md": "# Outside\n" }, async (root) => {
      const failure = await migrateProject({ framework: "mkdocs", root }).catch((error: unknown) => error);
      const errors = (failure as MigrationError).diagnostics.filter((item) => item.severity === "error");
      expect(errors.map((item) => item.message)).toEqual(['Nav entry "../outside.md" is not a page in docs_dir']);
      expect(await read(root, "content/guides/install.md")).toContain("!!! warning");
    });
  });

  it("draws in the fonts the MkDocs theme drew in", async () => {
    const fontsFor = async (theme: string) => {
      let config = "";
      await withProject({ ...site, "mkdocs.yml": `${site["mkdocs.yml"]}\n${theme}\n` }, async (root) => {
        await migrateProject({ framework: "mkdocs", root });
        config = await read(root, "sourcey.config.ts");
      });
      return config.match(/fonts: \{[^}]*\}/)?.[0];
    };
    expect(await fontsFor("theme: material")).toBe('fonts: { sans: "Roboto", mono: "Roboto Mono" }');
    expect(await fontsFor("theme:\n  name: material\n  font: false")).toBe('fonts: { sans: "system" }');
    expect(await fontsFor("theme:\n  name: material\n  font:\n    text: Work Sans")).toBe('fonts: { sans: "Work Sans", mono: "Roboto Mono" }');
    expect(await fontsFor("theme: readthedocs")).toBe('fonts: { sans: "Lato" }');
  });

  it("draws a page that hides Material's sidebar, or has its own template, as page, saying what it cannot keep", async () => {
    await withProject({
      ...site,
      "content/index.md": "---\nhide:\n  - navigation\n  - toc\n---\n\n# JSON for Modern C++\n",
      "content/guides/install.md": "---\nhide:\n  - toc\n  - feedback\n---\n\n# Install\n",
      "content/getting-started.md": "---\ntemplate: home.html\n---\n\n# Getting started\n",
      "content/unlisted.md": "---\nhide:\n  - navigation\n---\n\n# Unlisted\n",
    }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root });
      expect(await read(root, "content/index.md")).toBe("---\nlayout: page\n---\n\n# JSON for Modern C++\n");
      expect(await read(root, "content/guides/install.md")).toBe("# Install\n");
      expect(await read(root, "content/getting-started.md")).toMatch(/^---\nlayout: page\n/);
      const notes = report.diagnostics.filter((item) => item.code === "mkdocs-frontmatter").map(({ file, message }) => ({ file, message }));
      expect(notes).toEqual([
        { file: "content/getting-started.md", message: "Frontmatter template: home.html is the theme's own; native draws the page's Markdown as page" },
        { file: "content/guides/install.md", message: "Frontmatter hide: toc has no native equivalent; native lists a page's sections beside it; hide: feedback has no native equivalent" },
        { file: "content/unlisted.md", message: "Frontmatter hide: navigation keeps Material's contents list; the native page, drawn as page, has none" },
      ]);
      expect(await read(root, "content/unlisted.md")).toBe("---\nlayout: page\n---\n\n# Unlisted\n");
    });
  });

  it("collapses the sidebar's sections as Material does", async () => {
    const collapsed = async (theme: string) => {
      let count = 0;
      await withProject({ ...site, "mkdocs.yml": `${site["mkdocs.yml"]}\n${theme}\n` }, async (root) => {
        const report = await migrateProject({ framework: "mkdocs", root, dryRun: true });
        count = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString().split("collapsed: true").length - 1;
      });
      return count;
    };
    // Home, its Guide, API Documentation and its basic_json: every group but the reader's starts closed.
    expect(await collapsed("theme: material")).toBe(4);
    // Top-level sections are headings; only Guide and basic_json collapse.
    expect(await collapsed("theme:\n  name: material\n  features:\n    - navigation.sections")).toBe(2);
    expect(await collapsed("theme:\n  name: material\n  features:\n    - navigation.expand")).toBe(0);
    expect(await collapsed("theme: readthedocs")).toBe(0);
  });

  it("keeps the copyright notice and Material's social links in the footer, titling links no network icon names", async () => {
    const social = [
      'copyright: "&copy; Example, licensed under <a href=\\"https://example.com/license\\">CC BY-SA 4.0</a>."',
      "extra:",
      "  social:",
      "    - icon: fontawesome/brands/mastodon",
      "      link: https://fosstodon.org/@json",
      "    - icon: fontawesome/brands/gitter",
      "      link: https://gitter.im/example/json",
      "    - icon: fontawesome/solid/globe",
      "      link: https://example.com/",
      "      name: Website",
    ].join("\n");
    await withProject({ ...site, "mkdocs.yml": `${site["mkdocs.yml"].replace("https://github.com/example/json", "https://gitlab.com/example/json")}\n${social}\n` }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root, dryRun: true });
      const config = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
      expect(config).toContain(
        [
          "  navbar: {",
          "    links: [",
          "      {",
          '        type: "link",',
          '        href: "https://gitlab.com/example/json",',
          '        label: "gitlab.com",',
          "      },",
          "    ],",
          "  },",
          "  footer: {",
          `    text: ${JSON.stringify('&copy; Example, licensed under <a href="https://example.com/license">CC BY-SA 4.0</a>.')},`,
          "    links: [",
          '      { type: "mastodon", href: "https://fosstodon.org/@json" },',
          "      {",
          '        type: "link",',
          '        href: "https://gitter.im/example/json",',
          '        label: "gitter.im",',
          "      },",
          '      { type: "link", href: "https://example.com/", label: "Website" },',
          "    ],",
          "  },",
        ].join("\n"),
      );
    });
  });

  it("does not repeat the header's repository link among the footer's", async () => {
    const social = ["extra:", "  social:", "    - icon: fontawesome/brands/github", "      link: https://github.com/example/json/", "    - icon: fontawesome/brands/mastodon", "      link: https://fosstodon.org/@json"].join("\n");
    await withProject({ ...site, "mkdocs.yml": `${site["mkdocs.yml"]}\n${social}\n` }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root, dryRun: true });
      const config = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
      const footer = config.slice(config.indexOf("  footer: {"));
      expect(footer).toContain('{ type: "mastodon", href: "https://fosstodon.org/@json" }');
      expect(footer).not.toContain("github.com");
    });
  });

  it("turns Material's navigation tabs into native tabs, each publishing its section's folder", async () => {
    await withProject(tabbed, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root });
      expect(report.routes.map((route) => route.source).sort()).toEqual([
        "/",
        "/explanation/",
        "/explanation/budgets/",
        "/explanation/support/",
        "/misc/notes/",
        "/reference/",
        "/tutorials/",
        "/tutorials/draft/",
        "/tutorials/first-steps/",
        "/tutorials/import/csv/",
      ]);
      expect(report.diagnostics.map(({ file, message }) => ({ file, message }))).toEqual([
        {
          file: "docs/explanation/support.md",
          message: "Reference lists this page from the Explanation tab's folder; it keeps its URL in that tab, without a menu entry there, and Reference links to it",
        },
      ]);
      expect(await read(root, "sourcey.config.ts")).toBe(TABBED_CONFIG);
    });
  });

  it("links a page two sections list from the tab that holds its folder", async () => {
    const nav = `${tabbed["mkdocs.yml"]}\n      - Support: explanation/support.md`;
    await withProject({ ...tabbed, "mkdocs.yml": nav }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root, dryRun: true });
      expect(report.diagnostics.map((item) => item.message)).toEqual(["Reference lists this page from the Explanation tab's folder; it keeps its URL in that tab, and Reference links to it"]);
      const config = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
      expect(config).toContain('{ page: "support", label: "Support", tab: "explanation" }');
      expect(config).not.toContain('{ page: "support", hidden: true }');
    });
  });

  it("keeps one tab when two of Material's sections start in the same folder", async () => {
    const nav = tabbed["mkdocs.yml"].replace("      - reference/index.md\n", "");
    await withProject({ ...tabbed, "mkdocs.yml": nav }, async (root) => {
      const report = await migrateProject({ framework: "mkdocs", root, dryRun: true });
      expect(report.diagnostics.map((item) => item.message)).toContain(
        "Material's navigation tabs become top-level sidebar groups: each native tab publishes one folder, and two sections start in the same one",
      );
      const config = report.changes.find((change) => change.path === "sourcey.config.ts")!.bytes!.toString();
      expect(config.match(/tab: "[^"]*"/g)).toEqual(['tab: "Documentation"']);
    });
  });
});

const tabbed = {
  "mkdocs.yml": [
    "site_name: Ledger",
    "theme:",
    "  name: material",
    "  features:",
    "    - navigation.tabs",
    "nav:",
    "  - Home: index.md",
    "  - Tutorials:",
    "      - tutorials/index.md",
    "      - First steps: tutorials/first-steps.md",
    "      - Imports:",
    "          - CSV: tutorials/import/csv.md",
    "  - Reference:",
    "      - reference/index.md",
    "      - Support: explanation/support.md",
    "  - Explanation:",
    "      - explanation/index.md",
    "      - Budgets: explanation/budgets.md",
  ].join("\n"),
  "docs/index.md": "# Home\n",
  "docs/misc/notes.md": "# Notes\n\nIn no section's folder, so the root tab keeps it.\n",
  "docs/tutorials/index.md": "# Tutorials\n",
  "docs/tutorials/first-steps.md": "# First steps\n",
  "docs/tutorials/draft.md": "# Draft\n\nUnlisted, so it joins its folder's tab without a menu entry.\n",
  "docs/tutorials/import/csv.md": "# CSV\n",
  "docs/reference/index.md": "# Reference\n",
  "docs/explanation/index.md": "# Explanation\n",
  "docs/explanation/budgets.md": "# Budgets\n",
  "docs/explanation/support.md": "# Support\n",
};

const TABBED_CONFIG = `import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  name: "Ledger",
  theme: {
    fonts: { sans: "Roboto", mono: "Roboto Mono" },
  },
  prettyUrls: "slash",
  navigation: {
    tabs: [
      {
        tab: "Home",
        slug: "",
        source: markdown({
          root: "docs",
          groups: [
            {
              group: "",
              id: "ungrouped-1",
              pages: [
                { page: "index", label: "Home" },
                { page: "misc/notes", hidden: true },
              ],
            },
          ],
        }),
      },
      {
        tab: "Tutorials",
        slug: "tutorials",
        source: markdown({
          root: "docs/tutorials",
          groups: [
            {
              group: "",
              id: "ungrouped-1",
              pages: [
                "index",
                { page: "first-steps", label: "First steps" },
                { page: "draft", hidden: true },
              ],
            },
            {
              group: "Imports",
              id: "tutorials/imports",
              collapsed: true,
              pages: [
                { page: "import/csv", label: "CSV" },
              ],
            },
          ],
        }),
      },
      {
        tab: "Reference",
        slug: "reference",
        source: markdown({
          root: "docs/reference",
          groups: [
            {
              group: "",
              id: "ungrouped-1",
              pages: [
                "index",
                { page: "support", label: "Support", tab: "explanation" },
              ],
            },
          ],
        }),
      },
      {
        tab: "Explanation",
        slug: "explanation",
        source: markdown({
          root: "docs/explanation",
          groups: [
            {
              group: "",
              id: "ungrouped-1",
              pages: [
                "index",
                { page: "budgets", label: "Budgets" },
                { page: "support", hidden: true },
              ],
            },
          ],
        }),
      },
    ],
  },
});
`;
