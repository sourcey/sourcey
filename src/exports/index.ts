import type { ResolvedConfig } from "../config.js";
import type { SiteAssembly } from "../site-assembly.js";
import type { SiteNavigation } from "../core/navigation.js";
import type { SiteConfig } from "../renderer/context.js";
import type { AlternateLink } from "../core/site-model.js";
import type { ResolvedSiteContext, SitePage } from "../core/site-model.js";
import { isAbsoluteHttpUrl, toPublicPath, toPublicUrl } from "../site-url.js";
import { generateLlmsTxt, generateLlmsFullTxt } from "../renderer/llms.js";
import { collectReadableDocuments, exportRoot, pageMarkdownPath } from "./documents.js";
import type { DiscoveryResource } from "./config.js";
import { parseDocumentationIndex } from "./document-index.js";
import { createHash } from "node:crypto";
import { compactDescription, searchTerms } from "./markdown.js";

export interface GeneratedExports {
  files: Map<string, string | Buffer>;
  /** Media types also cover extensionless discovery files. */
  mediaTypes: Map<string, string>;
  responseHeaders: Map<string, Record<string, string>>;
  llmsTxt: string;
  llmsFullTxt: string;
}

/** One projection for production and each cached development snapshot. */
export function generateExports(
  assembled: SiteAssembly,
  pages: SitePage[],
  navigation: SiteNavigation,
  site: SiteConfig,
  config: ResolvedConfig,
): GeneratedExports {
  const claimed = new Set(pages.map(page => page.outputPath));
  const files = new Map<string, string | Buffer>();
  const mediaTypes = new Map<string, string>();
  // Kept as UTF-8 bytes, as they are written: as text, a whole export is
  // held two bytes a character once one character, such as a curly quote,
  // falls outside Latin-1, and it counts against the script heap.
  const put = (path: string, body: string, type: string) => {
    if (files.has(path) || assembled.extraFiles.has(path) || claimed.has(path))
      throw new Error(`Generated output collision: ${path}`);
    files.set(path, Buffer.from(body));
    mediaTypes.set(path, type);
  };
  const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
  const url = (path: string) =>
    toPublicUrl(path, config.siteUrl, config.baseUrl, config.prettyUrls);
  const enabled = config.exports;
  const documents =
    enabled.markdown || enabled.llms.index || enabled.llms.full
      ? collectReadableDocuments(pages, site)
      : [];
  if (enabled.markdown) for (const document of documents)
    put(document.entry.file, document.content, "text/markdown; charset=utf-8");
  const name = site.name && site.name !== "API Reference" ? site.name : documents[0]?.entry.title || site.name;
  const pageByTab = new Map(pages.map(page => [page.tabSlug, page]));
  const rootDocuments = documents.filter(document => { const owner = pageByTab.get(document.entry.tab); return owner?.context.isDefaultVersion && owner.context.locale === owner.context.defaultLocale; });
  const projections = new Map<string, typeof documents>();
  projections.set("", rootDocuments);
  for (const context of config.contexts) {
    const prefix = exportRoot(context);
    const members = documents.filter(document => {
      const owner = pageByTab.get(document.entry.tab);
      return owner && (context.isDefaultVersion ? owner.context.locale === context.locale && owner.context.isDefaultVersion : owner.context.key === context.key);
    });
    if (prefix || context.locale === context.defaultLocale && context.isDefaultVersion) projections.set(prefix, members);
  }
  // The site's own indexes are its root projection's, generated once.
  let llmsTxt = "", llmsFullTxt = "";
  for (const [prefix, selected] of projections) {
    const within = (path: string) => prefix ? `${prefix}/${path}` : path;
    if (enabled.markdown) {
      const index = parseDocumentationIndex({ version: 1, name: name || "Documentation", documents: selected.map(document => {
        const file = prefix ? document.entry.file.slice(prefix.length + 1) : document.entry.file;
        if (prefix && !document.entry.file.startsWith(`${prefix}/`)) throw new Error(`Document outside index root: ${document.entry.file}`);
        return { ...document.entry, file, searchText: searchTerms(document.entry.searchText ?? document.content) };
      }) });
      put(within("documents.json"), json(index), "application/json; charset=utf-8");
    }
    if (enabled.llms.index) {
      const text = generateLlmsTxt(selected, navigation, name, enabled.markdown);
      put(within("llms.txt"), text, "text/plain; charset=utf-8");
      if (!prefix) llmsTxt = text;
    }
    if (enabled.llms.full) {
      const text = generateLlmsFullTxt(selected, name);
      put(within("llms-full.txt"), text, "text/plain; charset=utf-8");
      if (!prefix) llmsFullTxt = text;
    }
  }
  /** A page is described by the index that lists it: its own version's and language's. */
  const llmsIndex = (context: ResolvedSiteContext | undefined) => [context && exportRoot(context), "llms.txt"].filter(Boolean).join("/");

  const resources: DiscoveryResource[] = [];
  if (
    config.discovery.apiCatalog &&
    !enabled.openapi &&
    config.contexts.flatMap(c => c.tabs).some((tab) => tab.source.kind === "openapi")
  )
    throw new Error(
      "discovery.apiCatalog requires exports.openapi so its contract links refer to published definitions.",
    );
  const publisher = config.siteUrl ? new URL(config.siteUrl).hostname : "";
  const scope = createHash("sha256")
    .update(config.baseUrl || "/")
    .digest("hex")
    .slice(0, 12);
  const identifier = (name: string) => `urn:air:${publisher}:docs:${scope}:${name}`;
  const resource = (name: string, displayName: string, path: string, description: string) =>
    resources.push({
      identifier: identifier(name),
      displayName,
      type: mediaTypes.get(path)!.split(";", 1)[0],
      url: url(path),
      description: compactDescription(description),
    });
  if (enabled.markdown)
    resource(
      "documents",
      `${site.name || "Project"} documentation`,
      "documents.json",
      "Index of guides, API operations, schemas and library reference with readable Markdown URLs.",
    );
  if (enabled.llms.index)
    resource(
      "llms",
      "Documentation index",
      "llms.txt",
      "Links to individual reference documents and guides.",
    );
  if (enabled.llms.full)
    resource(
      "llms-full",
      "Complete documentation",
      "llms-full.txt",
      "Complete readable documentation export.",
    );

  const linkset: {
    anchor: string;
    "service-desc": { href: string; type: string }[];
    "service-doc": { href: string; type: string }[];
  }[] = [];
  if (enabled.openapi) {
    for (const [slug, contract] of assembled.publicSpecs) {
      const path = [slug, "openapi.json"].filter(Boolean).join("/");
      put(path, json(contract), "application/json; charset=utf-8");
      const spec = assembled.references.get(slug)!;
      const owner = pageByTab.get(slug);
      if (owner?.context.isDefaultVersion && owner.context.locale === owner.context.defaultLocale) resource(
        `api:${slug || "root"}`,
        spec.info.title,
        path,
        spec.info.summary || spec.info.description || "OpenAPI contract.",
      );
      const page = pages.find(
        (candidate) => candidate.tabSlug === slug && candidate.currentPage.kind === "spec",
      );
      for (const server of spec.servers) {
        const href = server.url.replace(
          /\{([^}]+)\}/g,
          (match, name: string) => server.variables?.[name]?.default ?? match,
        );
        if (!isAbsoluteHttpUrl(href) || /\{/.test(href)) continue;
        linkset.push({
          anchor: href,
          "service-desc": [{ href: url(path), type: "application/json" }],
          "service-doc": page ? [{ href: url(page.outputPath), type: "text/html" }] : [],
        });
      }
    }
  }
  resources.push(...config.discovery.resources);
  const paths = {
    ard: config.discovery.wellKnown ? ".well-known/ard.json" : "ard.json",
    apiCatalog: config.discovery.wellKnown ? ".well-known/api-catalog" : "api-catalog.json",
  };
  if (config.discovery.ard) {
    const seen = new Set<string>();
    for (const entry of resources) {
      if (seen.has(entry.identifier))
        throw new Error(`Duplicate discovery identifier: ${entry.identifier}`);
      seen.add(entry.identifier);
    }
    put(paths.ard, json({ entries: resources }), "application/json; charset=utf-8");
  }
  if (config.discovery.apiCatalog && linkset.length)
    put(
      paths.apiCatalog,
      json({ linkset }),
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );

  // A not-found page has no readable document, so it names none.
  const written = new Set(enabled.markdown ? documents.map((document) => document.entry.file) : []);
  for (const page of pages) {
    // Export generation may run again after a dev edit. Replace only its own links.
    const links = (page.alternateLinks ?? []).filter(
      (link) =>
        !(
          link.rel === "ard" ||
          link.rel === "describedby" ||
          link.rel === "api-catalog" ||
          (link.rel === "alternate" && link.type === "text/markdown")
        ),
    );
    const add = (rel: AlternateLink["rel"], type: string, path: string, title?: string) =>
      links.push({ rel, type, href: url(path), title });
    if (written.has(pageMarkdownPath(page)))
      add("alternate", "text/markdown", pageMarkdownPath(page), "Markdown");
    if (enabled.llms.index) add("describedby", "text/plain", llmsIndex(page.context), "Documentation index");
    if (config.discovery.ard) add("ard", "application/json", paths.ard, "Agentic resources");
    if (config.discovery.apiCatalog && linkset.length)
      add("api-catalog", "application/linkset+json", paths.apiCatalog, "API catalog");
    page.alternateLinks = links;
  }
  const responseHeaders = new Map<string, Record<string, string>>();
  for (const [path, type] of mediaTypes)
    responseHeaders.set(toPublicPath(path, config.baseUrl), { "Content-Type": type });
  for (const page of pages) {
    if (!page.alternateLinks?.length) continue;
    responseHeaders.set(toPublicPath(page.outputPath, config.baseUrl, config.prettyUrls), {
      Link: page.alternateLinks
        .map((link) => `<${link.href}>; rel="${link.rel ?? "alternate"}"; type="${link.type}"`)
        .join(", "),
    });
  }
  if (enabled.markdown)
    for (const document of documents) {
      const links = [`<${document.entry.url}>; rel="canonical"`];
      if (enabled.llms.index) links.push(`<${url(llmsIndex(pageByTab.get(document.entry.tab)?.context))}>; rel="describedby"`);
      responseHeaders.get(toPublicPath(document.entry.file, config.baseUrl))!.Link =
        links.join(", ");
    }
  if (config.discovery.apiCatalog && linkset.length) {
    responseHeaders.get(toPublicPath(paths.apiCatalog, config.baseUrl))!.Link =
      `<${url(paths.apiCatalog)}>; rel="api-catalog"`;
  }
  if (files.size)
    put(
      "response-headers.json",
      json(Object.fromEntries(responseHeaders)),
      "application/json; charset=utf-8",
    );
  return { files, mediaTypes, responseHeaders, llmsTxt, llmsFullTxt };
}
