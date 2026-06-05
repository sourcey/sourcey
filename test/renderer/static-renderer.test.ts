import { describe, it, expect } from "vitest";
import { renderPage } from "../../src/renderer/static-renderer.js";
import { buildNavFromSpec, buildSiteNavigation } from "../../src/core/navigation.js";
import type { SiteNavigation } from "../../src/core/navigation.js";
import type { NormalizedChangelog, NormalizedSpec } from "../../src/core/types.js";
import type { ChangelogPage, MarkdownPage } from "../../src/core/markdown-loader.js";
import type { RenderOptions, CurrentPage, SiteConfig } from "../../src/renderer/context.js";
import { loadSpec } from "../../src/core/loader.js";
import { parseSpec } from "../../src/core/parser.js";
import { convertToOpenApi3 } from "../../src/core/converter.js";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dirname, "../fixtures");

function createMinimalSpec(overrides?: Partial<NormalizedSpec>): NormalizedSpec {
  return {
    info: {
      title: "Test API",
      version: "1.0.0",
      description: "A test API",
    },
    servers: [{ url: "https://api.test.com" }],
    tags: [],
    operations: [],
    schemas: {},
    securitySchemes: {},
    webhooks: [],
    ...overrides,
  };
}

const defaultOptions: RenderOptions = {
  embeddable: false,
  assetBase: "",
};

const defaultSite: SiteConfig = {
  name: "Test",
  titleSeparator: " - ",
  siteUrl: undefined,
  baseUrl: "",
  theme: {
    preset: "default",
    colors: { primary: "99 102 241", light: "129 140 248", dark: "79 70 229" },
    fonts: {
      sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      googleFont: "Inter",
    },
    layout: { sidebar: "18rem", toc: "19rem", content: "44rem" },
    css: [],
  },
  codeSamples: ["curl", "javascript", "python"],
  navbar: { links: [] },
  footer: { links: [] },
  changelog: { enabled: true, feed: false, permalinks: false, ogImages: false },
};

function renderSpec(spec: NormalizedSpec, options: RenderOptions): string {
  const tab = buildNavFromSpec(spec, "api");
  tab.label = "API Reference";
  const navigation = buildSiteNavigation([tab]);
  const currentPage: CurrentPage = { kind: "spec", spec };
  return renderPage(spec, options, navigation, currentPage, defaultSite);
}

async function loadAndNormalizeFixture(fixture: string): Promise<NormalizedSpec> {
  const loaded = await loadSpec(`${FIXTURES}/${fixture}`);
  const parsed = await parseSpec(loaded);
  const converted = await convertToOpenApi3(parsed);
  return normalizeSpec(converted);
}

function createMarkdownPage(overrides?: Partial<MarkdownPage>): MarkdownPage {
  return {
    kind: "markdown",
    title: "Guide",
    description: "",
    slug: "guides/current",
    html: "<p>Body</p>",
    headings: [],
    sourcePath: "guides/current.md",
    editPath: "guides/current.md",
    ...overrides,
  };
}

function createChangelogPage(overrides?: Partial<ChangelogPage>): ChangelogPage {
  const changelog: NormalizedChangelog = {
    title: "Changelog",
    format: "keepachangelog",
    versions: [
      {
        id: "1-2-0",
        version: "1.2.0",
        date: "2026-04-20",
        yanked: false,
        prerelease: false,
        sections: [
          {
            type: "added",
            label: "Added",
            entries: [{ text: "Added feeds", html: "Added feeds", links: [], refs: [] }],
          },
        ],
        sourceOrder: 0,
      },
    ],
    links: [],
    diagnostics: [],
    rawMarkdown: "# Changelog",
  };

  return {
    kind: "changelog",
    title: "Changelog",
    description: "Release notes",
    slug: "changelog",
    headings: [{ level: 2, text: "1.2.0", id: "1-2-0" }],
    sourcePath: "CHANGELOG.md",
    editPath: "CHANGELOG.md",
    changelog,
    rawBody: "# Changelog",
    ...overrides,
  };
}

function createDocsNavigation(): SiteNavigation {
  return {
    tabs: [
      {
        label: "Documentation",
        slug: "documentation",
        href: "documentation/guides/previous.html",
        kind: "docs",
        groups: [
          {
            label: "Guides",
            items: [
              { label: "Previous", href: "documentation/guides/previous.html", id: "guides/previous" },
              { label: "Current", href: "documentation/guides/current.html", id: "guides/current" },
              { label: "Next", href: "documentation/guides/next.html", id: "guides/next" },
            ],
          },
        ],
      },
    ],
    activeTabSlug: "documentation",
    activePageSlug: "guides/current",
  };
}

describe("renderPage (spec)", () => {
  it("renders a complete HTML document", () => {
    const html = renderSpec(createMinimalSpec(), defaultOptions);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("Test API");
    expect(html).toContain("API Reference");
    expect(html).toContain("sourcey.css");
  });

  it("includes sidebar navigation", () => {
    const html = renderSpec(createMinimalSpec(), defaultOptions);
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="nav"');
    expect(html).toContain("data-sourcey-sidebar-scroll");
    expect(html).toContain('data-sourcey-sidebar-tab="api"');
    expect(html).toContain("Introduction");
  });

  it("renders operations in tags", () => {
    const spec = createMinimalSpec({
      tags: [
        {
          name: "Pets",
          description: "Pet operations",
          operations: [
            {
              method: "get",
              path: "/pets",
              summary: "List all pets",
              tags: ["Pets"],
              parameters: [],
              responses: [],
              security: [],
              deprecated: false,
            },
          ],
        },
      ],
      operations: [
        {
          method: "get",
          path: "/pets",
          summary: "List all pets",
          tags: ["Pets"],
          parameters: [],
          responses: [],
          security: [],
          deprecated: false,
        },
      ],
    });

    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain("Pets");
    expect(html).toContain("List all pets");
    expect(html).toContain("operation-pets-get");
  });

  it("renders schema definitions", () => {
    const spec = createMinimalSpec({
      schemas: {
        Pet: {
          name: "Pet",
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
          },
          required: ["id", "name"],
        },
      },
    });

    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain("Models");
    expect(html).toContain("definition-pet");
    expect(html).toContain("Pet");
  });

  it("renders security schemes in sidebar", () => {
    const spec = createMinimalSpec({
      securitySchemes: {
        api_key: {
          type: "apiKey",
          name: "X-API-Key",
          in: "header",
        },
      },
    });

    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain("Authentication");
    expect(html).toContain("api_key");
  });

  it("renders server endpoints", () => {
    const spec = createMinimalSpec({
      servers: [
        { url: "https://api.example.com", description: "Production" },
        { url: "https://staging-api.example.com", description: "Staging" },
      ],
    });

    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain("https://api.example.com");
    expect(html).toContain("Production");
  });

  it("renders response summaries and device authorization URLs", () => {
    const queryOperation = {
      operationId: "querySearch",
      method: "query" as const,
      path: "/search",
      summary: "Query search index",
      tags: ["Search"],
      parameters: [],
      responses: [
        {
          statusCode: "200",
          summary: "Search results",
          description: "Returns ranked matches.",
        },
      ],
      security: [],
      deprecated: false,
    };

    const spec = createMinimalSpec({
      tags: [
        {
          name: "Search",
          operations: [queryOperation],
        },
      ],
      operations: [queryOperation],
      securitySchemes: {
        oauth: {
          type: "oauth2",
          flows: {
            deviceAuthorization: {
              deviceAuthorizationUrl: "https://example.com/oauth/device",
              tokenUrl: "https://example.com/oauth/token",
              scopes: {
                search: "Query the search index",
              },
            },
          },
        },
      },
    });

    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain("Search results");
    expect(html).toContain("Returns ranked matches.");
    expect(html).toContain("Device Authorization URL");
    expect(html).toContain("https://example.com/oauth/device");
  });

  it("renders rich OpenAPI 3.2 summaries, hierarchy, encodings, and security metadata", async () => {
    const spec = await loadAndNormalizeFixture("openapi-3.2-rich.yaml");
    const html = renderSpec(spec, defaultOptions);

    expect(html).toContain("Search and indexing endpoints");
    expect(html).toContain('meta name="description" content="Search and indexing endpoints"');
    expect(html).toContain("Administration");
    expect(html).toContain("Index Management");
    expect(html).toContain("admin-index");
    expect(html).toContain("audience");
    expect(html).toContain("Administration / Index Management");
    expect(html).toContain("querystring");
    expect(html).toContain("Structured query string payload.");
    expect(html).toContain("application/x-www-form-urlencoded");
    expect(html).toContain("Encoding");
    expect(html).toContain("Ordered Parts");
    expect(html).toContain("X-Part-Id");
    expect(html).toContain("OAuth2 Metadata");
    expect(html).toContain("https://example.com/.well-known/oauth-authorization-server");
    expect(html).toContain("deprecated");
  });

  it("prefixes markdown page navigation links with the page asset base", () => {
    const spec = createMinimalSpec();
    const navigation = createDocsNavigation();
    const options: RenderOptions = { embeddable: false, assetBase: "../../" };
    const currentPage: CurrentPage = {
      kind: "markdown",
      markdown: createMarkdownPage(),
    };

    const html = renderPage(spec, options, navigation, currentPage, defaultSite);

    expect(html).toContain('href="../../documentation/guides/previous.html"');
    expect(html).toContain('href="../../documentation/guides/next.html"');
  });

  it("renders a table of contents for h3-only generated API pages", () => {
    const spec = createMinimalSpec();
    const navigation = createDocsNavigation();
    const currentPage: CurrentPage = {
      kind: "markdown",
      markdown: createMarkdownPage({
        headings: [
          { level: 3, text: "Namespaces", id: "namespaces" },
          { level: 3, text: "Classes", id: "classes" },
          { level: 3, text: "Functions", id: "functions" },
        ],
      }),
    };

    const html = renderPage(spec, defaultOptions, navigation, currentPage, defaultSite);

    expect(html).toContain("On this page");
    expect(html).toContain('href="#namespaces"');
    expect(html).toContain('href="#classes"');
    expect(html).toContain('href="#functions"');
  });

  it("uses the global edit base for markdown pages unless the page overrides it", () => {
    const spec = createMinimalSpec();
    const navigation = createDocsNavigation();
    const site = {
      ...defaultSite,
      repo: "https://github.com/sourcey/example",
      editBranch: "main",
      editBasePath: "docs",
    };

    const markdownHtml = renderPage(
      spec,
      defaultOptions,
      navigation,
      { kind: "markdown", markdown: createMarkdownPage({ editPath: "guides/current.md" }) },
      site,
    );
    expect(markdownHtml).toContain("https://github.com/sourcey/example/edit/main/docs/guides/current.md");

    const generatedHtml = renderPage(
      spec,
      defaultOptions,
      navigation,
      {
        kind: "markdown",
        markdown: createMarkdownPage({
          editPath: "internal/app/build/build.go",
          editBasePath: "",
        }),
      },
      site,
    );
    expect(generatedHtml).toContain("https://github.com/sourcey/example/edit/main/internal/app/build/build.go");
    expect(generatedHtml).not.toContain("https://github.com/sourcey/example/edit/main/docs/internal/app/build/build.go");
  });

  it("renders changelog pages through the structured changelog component", () => {
    const spec = createMinimalSpec();
    const navigation = {
      ...createDocsNavigation(),
      tabs: [
        {
          label: "Documentation",
          slug: "documentation",
          href: "documentation/changelog.html",
          kind: "docs" as const,
          groups: [
            {
              label: "Guides",
              items: [{ label: "Changelog", href: "documentation/changelog.html", id: "changelog" }],
            },
          ],
        },
      ],
      activePageSlug: "changelog",
    };
    const currentPage: CurrentPage = {
      kind: "changelog",
      changelog: createChangelogPage(),
    };

    const html = renderPage(spec, defaultOptions, navigation, currentPage, defaultSite);

    expect(html).toContain("sourcey-changelog-version");
    expect(html).toContain("1.2.0");
    expect(html).toContain("Added");
  });

  it("renders canonical, feed, and OG metadata from resolved public URLs", () => {
    const spec = createMinimalSpec();
    const navigation = {
      ...createDocsNavigation(),
      tabs: [
        {
          label: "Documentation",
          slug: "documentation",
          href: "documentation/changelog.html",
          kind: "docs" as const,
          groups: [
            {
              label: "Guides",
              items: [{ label: "Changelog", href: "documentation/changelog.html", id: "changelog" }],
            },
          ],
        },
      ],
      activePageSlug: "changelog",
    };
    const currentPage: CurrentPage = {
      kind: "changelog",
      changelog: createChangelogPage(),
    };
    const options: RenderOptions = {
      embeddable: false,
      assetBase: "../../",
      pageUrl: "https://docs.example.com/reference/changelog.html",
      ogImageUrl: "https://docs.example.com/reference/_og/changelog.png",
      alternateLinks: [
        {
          href: "https://docs.example.com/reference/feed.xml",
          type: "application/atom+xml",
          title: "Changelog Atom Feed",
        },
      ],
    };

    const html = renderPage(spec, options, navigation, currentPage, {
      ...defaultSite,
      siteUrl: "https://docs.example.com",
      baseUrl: "/reference/",
    });

    expect(html).toContain('rel="canonical" href="https://docs.example.com/reference/changelog.html"');
    expect(html).toContain('property="og:url" content="https://docs.example.com/reference/changelog.html"');
    expect(html).toContain('property="og:image" content="https://docs.example.com/reference/_og/changelog.png"');
    expect(html).toContain('rel="alternate" type="application/atom+xml" href="https://docs.example.com/reference/feed.xml"');
  });

  it("does not duplicate the site name in markdown page titles", () => {
    const spec = createMinimalSpec();
    const navigation = createDocsNavigation();
    const currentPage: CurrentPage = {
      kind: "markdown",
      markdown: createMarkdownPage({
        title: "icey",
        description: "C++ media stack",
      }),
    };

    const html = renderPage(spec, defaultOptions, navigation, currentPage, {
      ...defaultSite,
      name: "icey",
    });

    expect(html).toContain("<title>icey</title>");
    expect(html).toContain('property="og:title" content="icey"');
    expect(html).not.toContain("icey — icey");
  });
});
