import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeSpec } from "../../src/core/normalizer.js";
import { operationAnchor, definitionAnchor, tagAnchor } from "../../src/core/reference-identity.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite } from "../../src/site.js";
import { renderPage } from "../../src/renderer/static-renderer.js";
import { createRenderOptions } from "../../src/renderer/html-builder.js";
import { projectNavigation } from "../../src/core/navigation.js";

const document = {
  openapi: "3.1.0",
  info: { title: "Reference", version: "1" },
  tags: [{ name: "All" }, { name: "Other" }],
  paths: Object.fromEntries(
    ["/items/{id}", "/items/id", "/plain"].map((path) => [
      path,
      {
        get: { tags: path === "/plain" ? ["Other"] : ["All", "Other"], responses: { "200": { description: "OK" } } },
      },
    ]),
  ),
  components: {
    schemas: Object.fromEntries(
      ["Thing.Name", "Thing Name", "東", "西", "Plain"].map((name) => [name, { type: "object" }]),
    ),
  },
};
const roots: string[] = [];
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("reference identities", () => {
  it("allocates distinct anchors deterministically and retains unambiguous existing anchors", () => {
    const spec = normalizeSpec({ source: "/tmp/reference.json", document });
    const reordered = normalizeSpec({
      source: "/tmp/reference.json",
      document: {
        ...document,
        paths: Object.fromEntries(Object.entries(document.paths).reverse()),
      },
    });
    const ids = spec.operations.map((op) => operationAnchor(op, spec));
    expect(new Set(ids).size).toBe(3);
    expect(operationAnchor(spec.operations[2], spec)).toBe("operation-plain-get");
    expect(definitionAnchor("Plain", spec)).toBe("definition-plain");
    expect(
      new Set(Object.keys(spec.schemas).map((name) => definitionAnchor(name, spec))).size,
    ).toBe(5);
    for (const op of spec.operations)
      expect(operationAnchor(op, reordered)).toBe(operationAnchor(op, spec));
  });

  it.each(["single", "sections", "operations"] as const)(
    "keeps HTML, navigation, routes, search and readable exports in agreement on %s",
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), "sourcey-reference-"));
      roots.push(root);
      await writeFile(join(root, "api.json"), JSON.stringify(document));
      const config = await resolveConfigFromRaw(
        {
          theme: { fonts: { google: false } },
          navigation: { tabs: [{ tab: "API", openapi: "api.json", reference: mode === "single" ? {} : { split: mode } }] },
        },
        root,
      );
      const site = await buildSourceySite({ config, generateOgImages: false });
      const htmlByPath = new Map(
        site.pages.map((page) => [
          page.outputPath,
          renderPage(
            page.currentPage.kind === "spec" ? page.currentPage.spec : undefined,
            createRenderOptions(page, site.site),
            projectNavigation(page.navigation ?? site.navigation, page.tabSlug, page.pageSlug),
            page.currentPage,
            site.site,
          ),
        ]),
      );
      const owner = site.pages.find((page) => page.currentPage.kind === "spec")!;
      if (owner.currentPage.kind !== "spec") throw new Error("Missing reference");
      const spec = owner.currentPage.spec;
      const targets = owner.referenceTargets!;
      for (const op of spec.operations) {
        const target = targets.operations[`${op.method.toUpperCase()} ${op.path}`];
        const anchor = operationAnchor(op, spec),
          html = htmlByPath.get(target.outputPath)!;
        expect(html.split(` id="${anchor}"`)).toHaveLength(2);
        expect(
          site.assembly.routes.byPath
            .get(new URL(target.href, "https://docs.test").pathname)
            ?.anchors.has(anchor),
        ).toBe(true);
        expect(
          site.searchRows.some((entry: { url: string }) => entry.url === target.href),
        ).toBe(true);
      }
      for (const name of Object.keys(spec.schemas)) {
        const target = targets.schemas[name];
        expect(htmlByPath.get(target.outputPath)).toContain(`id="${definitionAnchor(name, spec)}"`);
      }
      const index = JSON.parse(site.extraFiles.get("documents.json")!.toString());
      for (const entry of index.documents.filter((entry: { kind: string }) =>
        ["operation", "schema"].includes(entry.kind),
      )) {
        expect(site.extraFiles.has(entry.file)).toBe(true);
        const url = new URL(entry.url, "https://docs.test"),
          route = site.assembly.routes.byPath.get(url.pathname)!;
        expect(route).toBeDefined();
        if (url.hash) expect(route.anchors.has(url.hash.slice(1))).toBe(true);
      }
      if (mode === "single") {
        const html = htmlByPath.get(owner.outputPath)!;
        for (const tag of spec.tags) expect(html).toContain(`id="${tagAnchor(tag.name, spec)}"`);
      }
      if (mode === "sections") {
        // Each tag is a page under its own heading; an operation filed under both is shown
        // under the first and linked from the second.
        const pages = site.pages.filter((page) => page.currentPage.kind === "spec" && page.currentPage.view?.kind === "section");
        expect(pages.map((page) => page.outputPath)).toEqual(["api/all.html", "api/other.html"]);
        const other = htmlByPath.get("api/other.html")!;
        expect(other).toMatch(/<h1 class="reference-page-title[^"]*">Other<\/h1>/);
        expect(other).toContain(`href="${targets.operations["GET /items/{id}"].href}"`);
        expect(targets.operations["GET /items/{id}"].href).toBe(`${site.assembly.routes.byOutputPath.get("api/all.html")!.publicPath}#${operationAnchor(spec.operations[0], spec)}`);
      }
    },
  );
});
