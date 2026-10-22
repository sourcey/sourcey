import type { CurrentPage } from "../../src/core/site-model.js";
import { describe, it, expect } from "vitest";
import { renderPage } from "../../src/renderer/static-renderer.js";
import { buildNavFromSpec, buildSiteNavigation } from "../../src/core/navigation.js";
import type { SiteNavigation } from "../../src/core/navigation.js";
import type { NormalizedChangelog, NormalizedSpec } from "../../src/core/types.js";
import type { ChangelogPage, MarkdownPage } from "../../src/core/markdown-loader.js";
import type { RenderOptions, SiteConfig } from "../../src/renderer/context.js";
import { english } from "../../src/core/messages.js";
import { loadSpec } from "../../src/core/loader.js";
import { parseSpec } from "../../src/core/parser.js";
import { convertToOpenApi3 } from "../../src/core/converter.js";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { GOOGLE_FONT_WEIGHTS } from "../../src/components/layout/Head.js";

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
  locale: "en",
  contentLocale: "en",
  dir: "ltr",
  messages: english,
};

const defaultSite: SiteConfig = {
  name: "Test",
  titleSeparator: " - ",
  siteUrl: undefined,
  baseUrl: "",
  theme: {
    name: "default",
    colors: { primary: "99 102 241", light: "129 140 248", dark: "79 70 229" },
    fonts: {
      sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      google: ["Inter"],
    },
    layout: { sidebar: "18rem", toc: "19rem", content: "44rem" },
    css: [],
    icons: "heroicons",
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
              {
                label: "Previous",
                href: "documentation/guides/previous.html",
                id: "guides/previous",
              },
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
  it("renders network links as named icons and the call to action in the header and drawer", () => {
    const tab = buildNavFromSpec(createMinimalSpec(), "api");
    const site: SiteConfig = {
      ...defaultSite,
      navbar: {
        links: [
          { type: "discourse", href: "https://community.example.com", label: "Community Forum" },
          { type: "github", href: "https://github.com/example" },
          { type: "link", href: "https://example.com/blog", label: "Blog" },
        ],
        primary: { type: "button", label: "Try it", href: "https://example.com" },
      },
    };
    const html = renderPage(createMinimalSpec(), defaultOptions, buildSiteNavigation([tab]), { kind: "spec", spec: createMinimalSpec() }, site);
    const header = html.slice(html.indexOf("sourcey-header-actions"), html.indexOf("theme-toggle"));
    // The label names the icon for assistive technology; the header shows only the brand mark, at the controls' 16px.
    const forum = header.match(/<a[^>]*aria-label="Community Forum"[^>]*>(.*?)<\/a>/s)?.[1] ?? "";
    expect(forum).toContain('class="sourcey-social-icon');
    expect(forum).toContain('width="16"');
    expect(forum).not.toContain("Community Forum");
    expect(header).toContain('aria-label="GitHub"');
    expect(header).toMatch(/<a[^>]*href="https:\/\/example.com\/blog"[^>]*>Blog<\/a>/);
    // The drawer lists each link with its icon and its name, and repeats the call to action.
    expect(html.match(/class="sourcey-primary-action[^"]*"/g)).toHaveLength(2);
    expect(html).toMatch(/<span>Community Forum<\/span>/);
  });

  it("opens a configured link to another site in a new tab and one on this site in place", () => {
    const tab = buildNavFromSpec(createMinimalSpec(), "api");
    const site: SiteConfig = {
      ...defaultSite,
      siteUrl: "https://example.com",
      navbar: {
        links: [
          { type: "link", href: "/pricing", label: "Pricing" },
          { type: "link", href: "https://example.com/blog", label: "Blog" },
          { type: "github", href: "https://github.com/example" },
        ],
        primary: { type: "button", label: "Get started", href: "/install" },
      },
    };
    const html = renderPage(createMinimalSpec(), defaultOptions, buildSiteNavigation([tab]), { kind: "spec", spec: createMinimalSpec() }, site);
    const header = html.slice(html.indexOf("sourcey-header-actions"), html.indexOf("theme-toggle"));
    const opening = (href: string) => header.match(new RegExp(`<a href="${href.replace(/[./]/g, "\\$&")}"[^>]*>`))?.[0] ?? "";
    for (const href of ["/pricing", "https://example.com/blog", "/install"]) {
      expect(opening(href)).toMatch(/^<a /);
      expect(opening(href)).not.toContain("_blank");
    }
    expect(opening("https://github.com/example")).toContain('target="_blank"');
  });

  it("renders a complete HTML document with the engine files it is given", () => {
    const assets = { styles: ["_assets/test/sourcey.css"], client: "_assets/test/sourcey.js", theme: "_assets/test/sourcey-theme.js", search: "_assets/test/sourcey-search.js" };
    const html = renderSpec(createMinimalSpec(), { ...defaultOptions, assets });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("Test API");
    expect(html).toContain("API Reference");
    expect(html).toContain('<link rel="stylesheet" href="_assets/test/sourcey.css"/>');
    expect(html).toContain('<script src="_assets/test/sourcey.js" defer></script>');
    expect(html).toContain('<meta name="sourcey-search-module" content="_assets/test/sourcey-search.js"/>');
  });

  it("requests Google families at every weight the themes set", () => {
    const html = renderSpec(createMinimalSpec(), defaultOptions);
    expect(html).toContain(`family=Inter:wght@${GOOGLE_FONT_WEIGHTS}&amp;display=swap`);
    const themes = resolve(import.meta.dirname, "../../src/themes");
    const css = readdirSync(themes, { recursive: true, encoding: "utf8" }).filter(file => file.endsWith(".css")).map(file => readFileSync(resolve(themes, file), "utf8")).join("\n");
    const used = new Set([...css.matchAll(/font-weight:\s*(\d+)/g)].map(match => match[1]));
    expect([...used].filter(weight => !GOOGLE_FONT_WEIGHTS.split(";").includes(weight))).toEqual([]);
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

  it("links the further reading the spec names for its API, a tag and an operation", () => {
    const operation = {
      method: "get" as const, path: "/search", summary: "Search", tags: ["search"], parameters: [], responses: [], security: [], deprecated: false,
      externalDocs: { description: "Search Documentation", url: "/how-to/search/" },
    };
    const spec = createMinimalSpec({
      externalDocs: { url: "https://example.com/guide" },
      tags: [{ name: "search", description: "Find things.", externalDocs: { description: "Search syntax", url: "https://example.com/syntax" }, operations: [operation] }],
      operations: [operation],
    });
    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain('<p class="reference-external-docs mb-6"><a href="https://example.com/guide" target="_blank" rel="noopener">https://example.com/guide<span aria-hidden="true"> →</span></a></p>');
    expect(html).toContain('<a href="https://example.com/syntax" target="_blank" rel="noopener">Search syntax<span aria-hidden="true"> →</span></a>');
    expect(html).toContain('<a href="/how-to/search/">Search Documentation<span aria-hidden="true"> →</span></a>');
  });

  it("names an endpoint's address as its samples do, its path parameters drawn as parameters", () => {
    const operation = {
      method: "get" as const, path: "/v{version}/items/{id}", summary: "Get an item", tags: ["items"], responses: [], security: [], deprecated: false,
      parameters: [{ name: "version", in: "path" as const, required: true, schema: { type: "string", enum: ["3", "2"] } }, { name: "id", in: "path" as const, required: true, schema: { type: "string" } }],
    };
    const endpoint = (servers: NormalizedSpec["servers"]) => {
      const html = renderSpec(createMinimalSpec({ servers, tags: [{ name: "items", operations: [operation] }], operations: [operation] }), defaultOptions);
      return { bar: html.match(/data-endpoint-url="true"[^>]*>([\s\S]*?)<\/div>/)![1], html };
    };
    // Each variable takes its default, as in the request sample beside it.
    const hosted = endpoint([{ url: "{scheme}://{host}/api", variables: { scheme: { default: "https", enum: ["https", "http"] }, host: { default: "s.test" } } }]);
    expect(hosted.bar).toContain(">https://s.test/api</span>");
    expect(hosted.bar).not.toContain("{scheme}");
    expect(hosted.html).toContain("https://s.test/api/v3/items/");
    expect(hosted.bar).toContain('<a class="sourcey-endpoint-param" href="#fields/GET/~002fv~007bversion~007d~002fitems~002f~007bid~007d/parameters/path/version">{version}</a>');
    expect(hosted.bar).toContain(">{id}</a>");
    // A host no one can guess is the reader's: the endpoint names the path alone.
    expect(endpoint([{ url: "{scheme}://{host}/api", variables: { scheme: { default: "https" }, host: { default: "" } } }]).bar).toMatch(/^<span[^>]*>\/api<\/span>/);
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

  it("lists a body's fields once when its media types carry one schema, keeping each type's field anchors", () => {
    const schema = { type: "object", properties: { name: { type: "string", description: "The pet's name." } } } as const;
    const operation = {
      method: "post" as const, path: "/pets", summary: "Add a pet", tags: ["pets"], parameters: [], responses: [], security: [], deprecated: false,
      requestBody: { required: true, content: { "application/json": { schema }, "application/x-www-form-urlencoded": { schema } } },
    };
    const html = renderSpec(createMinimalSpec({ tags: [{ name: "pets", operations: [operation] }], operations: [operation] }), defaultOptions);
    const root = "fields/POST/~002fpets/request-body";
    expect(html.match(/The pet&#39;s name\./g)).toHaveLength(1);
    expect(html).toMatch(/>Body<\/h3><\/div>/);
    expect(html).toContain(">application/json,</code>");
    expect(html).toContain(">application/x-www-form-urlencoded</code>");
    expect(html).toContain(`id="${root}/application~002fjson/properties/name"`);
    expect(html).toContain(`<span class="reference-anchor-alias" id="${root}/application~002fx-www-form-urlencoded/properties/name" aria-hidden="true"></span>`);
  });

  it("reads an allOf as one field list and leaves out what a request never sends", () => {
    const record = { name: "Record", refName: "Record", type: "object", required: ["id"], properties: { id: { type: "integer", readOnly: true } } } as const;
    const schema = { allOf: [record, { type: "object", properties: { name: { type: "string" }, audit: { type: "object", properties: { by: { type: "string", readOnly: true } } } } }], required: ["name"] } as const;
    const operation = {
      method: "post" as const, path: "/pets", summary: "Add a pet", tags: ["pets"], parameters: [], security: [], deprecated: false,
      requestBody: { required: true, content: { "application/json": { schema } } },
      responses: [{ statusCode: "201", description: "Created", content: { "application/json": { schema } } }],
    };
    const html = renderSpec(createMinimalSpec({ tags: [{ name: "pets", operations: [operation] }], operations: [operation] }), defaultOptions);
    const [body, response] = html.split(/id="[^"]*-responses"/);
    const fields = (section: string) => [...section.matchAll(/<code class="param-name">([^<]*)<\/code>/g)].map(match => match[1]);
    expect(fields(body)).toEqual(["name", "audit"]);
    expect(body.match(/class="params-list"/g)).toHaveLength(1);
    expect(body.match(/class="required-badge"/g)).toHaveLength(1);
    expect(body).not.toContain("Show child attributes");
    expect(fields(response)).toEqual(["id", "name", "audit", "by"]);
    expect(response.match(/class="required-badge"/g)).toHaveLength(2);
  });

  it("heads a model's own page with its name, as an operation's page is headed", () => {
    const spec = createMinimalSpec({ schemas: { Pet: { name: "Pet", type: "object", properties: { name: { type: "string" } } } } });
    const tab = buildNavFromSpec(spec, "api");
    const own = renderPage(spec, defaultOptions, buildSiteNavigation([tab]), { kind: "spec", spec, view: { kind: "schema", name: "Pet" } }, defaultSite);
    expect(own.match(/<h1[^>]*>([^<]*)<\/h1>/g)).toEqual([expect.stringMatching(/>Pet<\/h1>$/)]);
    expect(own).not.toMatch(/id="definition-pet" class="[^"]*border-t/);
    expect(renderSpec(spec, defaultOptions)).toMatch(/<h2[^>]*>Pet<\/h2>/);
  });

  it("breaks a snake_case name after its underscores, and reads prose as written", () => {
    const operation = (summary: string, path: string) => ({ method: "post" as const, path, summary, tags: ["tools"], parameters: [], responses: [], security: [], deprecated: false });
    const operations = [operation("list_applications", "/list"), operation("Sync an application", "/sync")];
    const spec = createMinimalSpec({ tags: [{ name: "tools", operations }], operations });
    const html = renderSpec(spec, defaultOptions);
    // In the navigation and the heading; a code sample's one-line title stays as written.
    expect(html).toMatch(/break-words[^"]*">list_<wbr\/>applications<\/span>/);
    expect(html).toMatch(/>list_<wbr\/>applications<\/h2>/);
    expect(html).toContain(">Sync an application<");
  });

  it("prefixes a version with v only where it is a number", () => {
    const label = (version: string) => {
      const spec = createMinimalSpec({ info: { title: "Test API", version } });
      const html = renderPage(spec, defaultOptions, buildSiteNavigation([buildNavFromSpec(spec, "api")]), { kind: "spec", spec, view: { kind: "overview" } }, defaultSite);
      return html.match(/reference-page-title[^>]*>[^<]*<\/h1>\s*<span[^>]*>([^<]*)<\/span>/)?.[1].trim();
    };
    expect(label("1.0.0")).toBe("v1.0.0");
    expect(label("v2.0")).toBe("v2.0");
    expect(label("latest")).toBe("latest");
  });

  it("shows a field's format only where it says more than its type", () => {
    const spec = createMinimalSpec({
      schemas: {
        Note: { name: "Note", type: "object", properties: { title: { type: "string", format: "string" }, id: { type: "integer", format: "int64" } } },
      },
    });
    const html = renderSpec(spec, defaultOptions);
    expect(html).toContain('<span class="json-property-type">string</span>');
    expect(html).toContain('<span class="json-property-type">integer&lt;int64></span>');
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

  it("names what each placeholder of a templated server URL takes", () => {
    const spec = createMinimalSpec({
      servers: [{
        url: "{scheme}://{host}",
        variables: {
          scheme: { default: "https", enum: ["https", "http"] },
          host: { default: "", description: "Your instance's domain" },
        },
      }],
    });

    const text = renderSpec(spec, defaultOptions).replace(/<[^>]+>/g, "");
    expect(text).toContain("{scheme}://{host}");
    expect(text).toContain("schemedefault https; one of https, http");
    expect(text).toContain("hostno default. Your instance's domain");
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
    const options: RenderOptions = { ...defaultOptions, assetBase: "../../" };
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

  it("keeps a deeper heading that comes before the page's first section in the table of contents", () => {
    const currentPage: CurrentPage = {
      kind: "markdown",
      markdown: createMarkdownPage({
        headings: [
          { level: 3, text: "RoadRunner", id: "roadrunner" },
          { level: 2, text: "FrankenPHP", id: "frankenphp" },
          { level: 3, text: "Classic web server", id: "classic-web-server" },
        ],
      }),
    };

    const html = renderPage(createMinimalSpec(), defaultOptions, createDocsNavigation(), currentPage, defaultSite);

    expect(html).toContain('href="#roadrunner"');
    expect(html).toContain('href="#frankenphp"');
    expect(html).toContain('href="#classic-web-server"');
  });

  it("keeps a section that opens in place on its siblings' edge, its pages one step in", () => {
    const navigation: SiteNavigation = {
      tabs: [{ label: "Docs", slug: "", href: "start/", kind: "docs", groups: [
        { label: "Get started", items: [
          { label: "Requirements", href: "requirements/", id: "requirements" },
          { label: "Installation", collapsed: true, items: [{ label: "Docker", href: "installation/docker/", id: "installation/docker" }] },
        ] },
      ] }],
      activeTabSlug: "",
      activePageSlug: "installation/docker",
    };
    const html = renderPage(createMinimalSpec(), defaultOptions, navigation, { kind: "markdown", markdown: createMarkdownPage({ slug: "installation/docker" }) }, defaultSite);
    const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)![0];
    expect(nav).toContain('<li><a href="requirements/" class="nav-link">');
    expect(nav).toMatch(/<li><details open class="sourcey-nav-group"><summary><span class="nav-group-label">Installation<\/span><\/summary><ul class="pl-3 space-y-px"><li><a href="installation\/docker\/" class="nav-link active"/);
  });

  it("draws a tag whose operations are elsewhere as a link, and keeps a heading a heading", () => {
    const navigation: SiteNavigation = {
      tabs: [{ label: "API", slug: "api", href: "api/", kind: "docs", groups: [
        { label: "", items: [{ label: "Introduction", href: "api/#introduction", id: "introduction" }] },
        { label: "Accounts", href: "api/#tag-accounts", id: "tag-accounts", items: [{ label: "Piggy banks", href: "api/#tag-piggy-banks", id: "tag-piggy-banks", items: [] }] },
        { label: "Administration", items: [{ label: "Backups", href: "api/backups/", id: "tag-backups", items: [] }] },
      ] }],
      activeTabSlug: "api",
      activePageSlug: "introduction",
    };
    const html = renderPage(createMinimalSpec(), defaultOptions, navigation, { kind: "markdown", markdown: createMarkdownPage({ slug: "introduction" }) }, defaultSite);
    const nav = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)![0];
    expect(nav).toMatch(/<div class="mt-px"><a href="[^"]*api\/#tag-accounts" class="nav-link">/);
    expect(nav).toMatch(/<ul class="pl-3 mt-px space-y-px"><li><a href="[^"]*api\/#tag-piggy-banks" class="nav-link">/);
    expect(nav).toMatch(/<div class="mt-6 lg:mt-8"><span class="nav-group-label">Administration<\/span><ul class="space-y-px"><li><a href="[^"]*api\/backups\/" class="nav-link">/);
    expect(nav).not.toContain("nav-group-link");
    expect(nav).not.toContain('<ul class="space-y-px"></ul>');
  });

  it("renders the footer text as inline Markdown on every page", () => {
    const site = { ...defaultSite, footer: { text: "© Example, licensed under [CC BY-SA 4.0](https://example.com/license).", links: [] } };
    const html = renderPage(createMinimalSpec(), defaultOptions, createDocsNavigation(), { kind: "markdown", markdown: createMarkdownPage() }, site);
    expect(html).toContain('<span class="sourcey-footer-text">© Example, licensed under <a href="https://example.com/license" target="_blank" rel="noopener">CC BY-SA 4.0</a>.</span>');
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
    expect(markdownHtml).toContain(
      "https://github.com/sourcey/example/edit/main/docs/guides/current.md",
    );

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
    expect(generatedHtml).toContain(
      "https://github.com/sourcey/example/edit/main/internal/app/build/build.go",
    );
    expect(generatedHtml).not.toContain(
      "https://github.com/sourcey/example/edit/main/docs/internal/app/build/build.go",
    );
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
              items: [
                { label: "Changelog", href: "documentation/changelog.html", id: "changelog" },
              ],
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
              items: [
                { label: "Changelog", href: "documentation/changelog.html", id: "changelog" },
              ],
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
      ...defaultOptions,
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

    expect(html).toContain(
      'rel="canonical" href="https://docs.example.com/reference/changelog.html"',
    );
    expect(html).toContain(
      'property="og:url" content="https://docs.example.com/reference/changelog.html"',
    );
    expect(html).toContain(
      'property="og:image" content="https://docs.example.com/reference/_og/changelog.png"',
    );
    expect(html).toContain(
      'rel="alternate" type="application/atom+xml" href="https://docs.example.com/reference/feed.xml"',
    );
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
