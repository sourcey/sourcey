import { describe, expect, it } from "vitest";
import { buildSearchIndex, referenceSearchText } from "../../src/core/search-indexer.js";
import type { DocsPage } from "../../src/core/markdown-loader.js";
import type { SiteNavigation } from "../../src/core/navigation.js";
import type { NormalizedOperation, NormalizedSchema, NormalizedSpec } from "../../src/core/types.js";

describe("buildSearchIndex", () => {
  it("preserves generated symbol metadata for client-side ranking", () => {
    const pages = new Map<string, DocsPage[]>([
      [
        "api-reference",
        [
          {
            kind: "markdown",
            title: "Application",
            description: "Application runtime.",
            slug: "icy-Application",
            html: "<h1>Application</h1>",
            headings: [],
            sourcePath: "api/icy-Application.md",
            searchEntries: [
              {
                title: "setSinkVolume",
                content: "icy::Application::setSinkVolume",
                anchor: "setsinkvolume",
                category: "Functions",
                symbolKind: "function",
                owner: "icy::Application",
                ownerKind: "class",
                namespace: "icy",
                qualifiedName: "icy::Application::setSinkVolume",
              },
            ],
          },
        ],
      ],
    ]);
    const navigation: SiteNavigation = {
      activeTabSlug: "api-reference",
      activePageSlug: "icy-Application",
      tabs: [{ label: "API Reference", slug: "api-reference", href: "api-reference.html", kind: "docs", groups: [] }],
    };

    const documents = new Map([["api-reference", pages.get("api-reference")!.map(page => ({ page, url: "/api-reference/icy-Application.html" }))]]);
    const entries = buildSearchIndex(new Map(), documents, navigation, new Map());
    const member = entries.find((entry) => entry.qualifiedName === "icy::Application::setSinkVolume");

    expect(member).toMatchObject({
      title: "setSinkVolume",
      url: "/api-reference/icy-Application.html#setsinkvolume",
      category: "Functions",
      symbolKind: "function",
      owner: "icy::Application",
      ownerKind: "class",
      namespace: "icy",
      qualifiedName: "icy::Application::setSinkVolume",
    });
  });

  it("opens on featured pages, then where each tab's sections start, taken in turn", () => {
    const operation = (method: NormalizedOperation["method"], path: string, summary: string, tag: string): NormalizedOperation =>
      ({ method, path, summary, tags: [tag], parameters: [], responses: [], security: [], deprecated: false });
    const [listPets, addPet, listStores] = [operation("get", "/pets", "List pets", "Pets"), operation("post", "/pets", "Add a pet", "Pets"), operation("get", "/stores", "List stores", "Stores")];
    const spec: NormalizedSpec = {
      info: { title: "Pets API", version: "1" }, servers: [], webhooks: [], securitySchemes: {},
      tags: [{ name: "Pets", operations: [listPets, addPet] }, { name: "Stores", operations: [listStores] }],
      operations: [listPets, addPet, listStores], schemas: { Pet: { type: "object" } },
    };
    const target = (href: string) => ({ href, outputPath: "" });
    const targets = new Map([["api", { overview: target("/api/"), operations: { "GET /pets": target("/api/list-pets/"), "POST /pets": target("/api/add-pet/"), "GET /stores": target("/api/list-stores/") }, schemas: { Pet: target("/api/pet/") } }]]);
    const guides = ["a", "b", "c", "d", "e", "f", "faq", "community"];
    const documents = new Map([["", guides.map(slug => ({ page: { kind: "markdown" as const, title: slug, slug, html: "", headings: [], sourcePath: `${slug}.md` }, url: `/${slug}/` }))]]);
    const item = (label: string, href: string) => ({ label, href, id: href });
    const navigation: SiteNavigation = { activeTabSlug: "", activePageSlug: "", tabs: [
      { label: "Docs", slug: "", href: "/a/", kind: "docs", groups: [
        { label: "Start", items: guides.slice(0, 6).map(slug => item(slug, `/${slug}/`)) },
        { label: "More", items: [item("faq", "/faq/"), item("community", "/community/")] },
      ] },
      { label: "API", slug: "api", href: "/api/", kind: "spec", groups: [
        { label: "", items: [item("Introduction", "/api/"), item("Authentication", "/api/#authentication")] },
        { label: "Pets", href: "/api/#tag-pets", items: [item("List pets", "/api/list-pets/"), item("Add a pet", "/api/add-pet/")] },
        { label: "Stores", href: "/api/#tag-stores", items: [item("List stores", "/api/list-stores/")] },
        { label: "Models", items: [item("Pet", "/api/pet/")] },
      ] },
    ] };
    const entries = buildSearchIndex(new Map([["api", spec]]), documents, navigation, targets, ["faq"]);
    const opened = entries.filter(entry => entry.start !== undefined).sort((a, b) => a.start! - b.start!);
    expect(opened.map(entry => entry.title)).toEqual(["faq", "a", "community", "b", "c", "d", "Pets API", "List pets", "List stores", "Add a pet"]);
    expect(opened.find(entry => entry.title === "Pets API")).toMatchObject({ url: "/api/", tab: "API", category: "Pages" });
    // Navigation that lists no introduction still opens the reference at the page its tab leads to.
    const authored: SiteNavigation = { ...navigation, tabs: [navigation.tabs[0], { ...navigation.tabs[1], groups: navigation.tabs[1].groups.slice(1) }] };
    const reference = buildSearchIndex(new Map([["api", spec]]), documents, authored, targets)
      .filter(entry => entry.start !== undefined && entry.tab === "API").sort((a, b) => a.start! - b.start!);
    expect(reference.map(entry => entry.title)).toEqual(["Pets API", "List pets", "List stores", "Add a pet"]);
  });
});

describe("referenceSearchText", () => {
  it("reads an operation's words and its fields' once per named type, without the document's own keys", () => {
    // A Kubernetes-style type nested at every level, as a normalized document repeats it.
    const condition = (depth: number): NormalizedSchema => ({
      name: "Condition", type: "object", description: "A condition observed on the resource.",
      properties: {
        status: { type: "string", enum: ["True", "False", "Unknown"] },
        ...(depth ? { nested: condition(depth - 1) } : {}),
      },
    });
    const operation: NormalizedOperation = {
      operationId: "ApplicationSetService_Create", summary: "Create an application set", method: "post", path: "/api/v1/applicationsets",
      tags: ["ApplicationSetService"], deprecated: false, security: [],
      parameters: [{ name: "upsert", in: "query", required: false, deprecated: false, description: "Replace one that exists.", schema: { type: "boolean" } }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { conditions: { type: "array", items: condition(40) } } } } } },
      responses: [{ statusCode: "200", description: "The created set.", headers: { "X-Trace": { name: "X-Trace", in: "header", required: false, deprecated: false, description: "Trace identifier." } } }],
    };
    const words = referenceSearchText(operation).split(" ");
    for (const word of ["ApplicationSetService_Create", "/api/v1/applicationsets", "upsert", "conditions", "Condition", "status", "Unknown", "nested", "Trace"]) expect(words).toContain(word);
    expect(words.filter(word => word === "observed")).toHaveLength(1);
    for (const key of ["properties", "type", "operationId", "required"]) expect(words).not.toContain(key);
  });
});
