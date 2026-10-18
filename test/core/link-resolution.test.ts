import { describe, it, expect } from "vitest";
import { resolveInternalLinks } from "../../src/index.js";
import type { ResolvedConfig } from "../../src/config.js";
import type { SitePage } from "../../src/renderer/html-builder.js";

const EMPTY_SPEC = {
  info: { title: "", version: "", description: "" },
  servers: [],
  tags: [],
  operations: [],
  schemas: {},
  securitySchemes: {},
  webhooks: [],
};

describe("resolveInternalLinks", () => {
  it("rewrites module-guide links to aliased API reference pages", () => {
    const pages: SitePage[] = [
      {
        outputPath: "documentation/modules/base.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "Base Module",
            description: "",
            slug: "modules/base",
            html: '<p><a href="../api/base.md">API Reference</a> <a href="../concepts/runtime-contracts.md">Runtime Contracts</a></p>',
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "modules/base.md",
            editPath: "modules/base.md",
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "documentation",
        pageSlug: "modules/base",
      },
      {
        outputPath: "documentation/concepts/runtime-contracts.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "Runtime Contracts",
            description: "",
            slug: "concepts/runtime-contracts",
            html: "<p>Contracts</p>",
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "concepts/runtime-contracts.md",
            editPath: "concepts/runtime-contracts.md",
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "documentation",
        pageSlug: "concepts/runtime-contracts",
      },
      {
        outputPath: "api-reference/base.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "base",
            description: "",
            slug: "base",
            html: "<p>API reference</p>",
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "api/base.md",
            editPath: "api/base.md",
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "api-reference",
        pageSlug: "base",
      },
    ];

    resolveInternalLinks(pages, {} as ResolvedConfig);

    expect(pages[0].currentPage.markdown?.html).toContain('href="../../api-reference/base.html"');
    expect(pages[0].currentPage.markdown?.html).toContain(
      'href="../../documentation/concepts/runtime-contracts.html"',
    );
  });

  it("rewrites stale html links to strip pretty URLs when they resolve internally", () => {
    const pages: SitePage[] = [
      {
        outputPath: "introduction.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "Introduction",
            description: "",
            slug: "introduction",
            html: '<p><a href="/docs/quickstart.html">Quickstart</a> <a href="missing.html">Missing</a></p>',
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "introduction.md",
            editPath: "introduction.md",
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "",
        pageSlug: "introduction",
      },
      {
        outputPath: "quickstart.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "Quickstart",
            description: "",
            slug: "quickstart",
            html: "<p>Quickstart</p>",
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "quickstart.md",
            editPath: "quickstart.md",
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "",
        pageSlug: "quickstart",
      },
    ];

    resolveInternalLinks(pages, { prettyUrls: "strip" } as ResolvedConfig);

    expect(pages[0].currentPage.markdown?.html).toContain('href="quickstart"');
    expect(pages[0].currentPage.markdown?.html).toContain('href="missing.html"');
  });

  it("rewrites output-relative html links between generated pages", () => {
    const pages: SitePage[] = [
      {
        outputPath: "api-reference/base.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "Base",
            description: "",
            slug: "base",
            html: '<p>See <a href="icy.html#onshutdownsignal">icy</a>.</p>',
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "api/base.md",
            editPath: null,
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "api-reference",
        pageSlug: "base",
      },
      {
        outputPath: "api-reference/icy.html",
        currentPage: {
          kind: "markdown",
          markdown: {
            title: "icy",
            description: "",
            slug: "icy",
            html: "<p>icy namespace</p>",
            markdown: "[Reference](../api/base.md)",
            headings: [],
            sourcePath: "api/icy.md",
            editPath: null,
          },
        },
        spec: EMPTY_SPEC,
        tabSlug: "api-reference",
        pageSlug: "icy",
      },
    ];

    resolveInternalLinks(pages, { prettyUrls: "strip" } as ResolvedConfig);

    expect(pages[0].currentPage.markdown?.html).toContain(
      'href="../api-reference/icy#onshutdownsignal"',
    );
  });
});
