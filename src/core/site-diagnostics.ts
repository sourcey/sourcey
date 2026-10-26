import { decodeHTMLAttribute } from "entities";
import { pageMetadata } from "./page-metadata.js";
import { operationKey } from "./reference-identity.js";
import { identityKey, type RouteTable, type SitePage } from "./site-model.js";
import { referenceTag } from "./tag-utils.js";
import type { ResolvedConfig } from "../config.js";
import { rewriteMarkdownDestinations } from "../utils/markdown-links.js";
import { outputPathCandidatesForRequest, requestPathMatchesBase } from "../renderer/static-files.js";

export interface SiteDiagnostic {
  severity: "warning";
  code: "missing-site-origin" | "missing-description" | "short-description" | "broken-link" | "broken-fragment" | "canonical-target" | "hreflang-target" | "github-stats";
  page?: string;
  message: string;
}

const documentLinks = new WeakMap<object, string[]>();
/**
 * Each link in a page's HTML. Sourcey wrote all of it, through its renderer,
 * its components or the sanitizer, so every attribute is double-quoted with
 * `"` and `>` escaped inside it, and an attribute scan reads what a parser would.
 */
const ANCHOR_HREF = /<a\s(?:[^>]*?\s)?href="([^"]+)"/g;

/** Inspect completed routes and source prose; never infer another site's content graph. */
export function collectSiteDiagnostics(
  pages: readonly SitePage[],
  routes: RouteTable,
  config: Pick<ResolvedConfig, "name" | "titleSeparator" | "siteUrl" | "baseUrl" | "prettyUrls">,
  /** The files the site publishes beside its pages, by output path. */
  files: ReadonlySet<string> = new Set(),
): SiteDiagnostic[] {
  const diagnostics: SiteDiagnostic[] = [];
  const origin = config.siteUrl ?? "https://sourcey.invalid";
  if (!config.siteUrl && pages.some(page => routes.byKey.get(identityKey(page))?.index)) diagnostics.push({
    severity: "warning", code: "missing-site-origin",
    message: "Set siteUrl to the public origin before publishing: without it, pages name no canonical URL or language alternates and the site has no sitemap.",
  });
  // The files a static host serves for a path within the site's base, such as a page's for its address without the trailing slash.
  const served = (pathname: string) => {
    if (!requestPathMatchesBase(pathname, config.baseUrl)) return [];
    try { return outputPathCandidatesForRequest(pathname, config.baseUrl, config.prettyUrls); }
    catch { return []; }
  };
  const pageAt = (pathname: string) => routes.match(pathname) ?? served(pathname).map(path => routes.byOutputPath.get(path)).find(Boolean);
  // A path with no page is still the site's when a file or redirect answers it, and may be the host's
  // when a host serves pages beside these, or lies outside the site's base.
  const publishes = (pathname: string) =>
    routes.hostOwned || !requestPathMatchesBase(pathname, config.baseUrl) || !!routes.redirectFor(pathname) || served(pathname).some(path => files.has(path));
  for (const page of pages) {
    const route = routes.byKey.get(identityKey(page));
    if (!route || page.status === 404) continue;
    const warn = (code: SiteDiagnostic["code"], message: string) => diagnostics.push({ severity: "warning", code, page: route.publicPath, message });
    // A page Sourcey composes from navigation, such as a large tree's section page, has no source to summarise.
    const composed = page.currentPage.kind === "markdown" && !page.currentPage.markdown.sourcePath;
    if (route.index && !composed) {
      const metadata = pageMetadata(page.currentPage, config);
      if (metadata.description === metadata.title) warn("missing-description", "No source summary is available; metadata uses the page title.");
      else if (metadata.summary && metadata.summary.split(/\s+/).length === 1) warn("short-description", `The source summary is only one word: ${JSON.stringify(metadata.summary)}.`);
    }
    const canonical = new URL(route.canonical, origin);
    if (canonical.origin === origin && !routes.match(canonical.pathname)) warn("canonical-target", `Canonical URL has no published page: ${route.canonical}.`);
    const languages = new Map<string, string>();
    for (const equivalent of page.equivalents ?? []) {
      if (equivalent.kind !== "locale" || !equivalent.lang) continue;
      const destination = new URL(equivalent.href, origin);
      const target = destination.origin === origin && routes.match(destination.pathname);
      const previous = languages.get(equivalent.lang.toLowerCase());
      languages.set(equivalent.lang.toLowerCase(), destination.href);
      if (!target || target.page.contentLocale !== target.page.context.locale ||
        target.page.identity.tab !== page.identity.tab || target.page.identity.kind !== page.identity.kind || target.page.identity.document !== page.identity.document ||
        target.page.context.version.id !== page.context.version.id ||
        equivalent.lang.toLowerCase() !== target.page.context.localeConfig.lang.toLowerCase() ||
        previous !== undefined && previous !== destination.href) {
        warn("hreflang-target", `Language alternate ${equivalent.lang} does not identify one translated equivalent: ${equivalent.href}.`);
      }
    }
    for (const href of sourceLinks(page)) {
      let destination: URL;
      try { destination = new URL(href, new URL(route.publicPath, origin)); } catch { continue; }
      if (destination.origin !== origin) continue;
      const target = pageAt(destination.pathname);
      if (!target) {
        if (!publishes(destination.pathname)) warn("broken-link", `Link ${JSON.stringify(href)} leads to ${destination.pathname}, which the site does not publish.`);
        continue;
      }
      if (!destination.hash) continue;
      let anchor: string;
      try { anchor = decodeURIComponent(destination.hash.slice(1)); } catch { continue; }
      if (anchor && !target.anchors.has(anchor)) warn("broken-fragment", `Link ${JSON.stringify(href)} points to a missing fragment on ${target.publicPath}.`);
    }
  }
  return diagnostics;
}

function sourceLinks(page: SitePage): string[] {
  const current = page.currentPage;
  const view = current.kind === "spec" ? current.view : undefined;
  const source = current.kind === "markdown" ? current.markdown : current.kind === "changelog" ? current.changelog
    : current.kind === "spec" ? view?.kind === "operation"
      ? current.spec.operations.find(operation => operationKey(operation) === view.id) ?? current.spec
      : view?.kind === "section" ? referenceTag(current.spec, view.tag)
      : view?.kind === "schema" ? current.spec.schemas[view.name] : current.spec
    : undefined;
  if (!source) return [];
  const cached = documentLinks.get(source);
  if (cached) return cached;
  const links = new Set<string>();
  if (current.kind === "markdown") {
    for (const [, href] of current.markdown.html.matchAll(ANCHOR_HREF)) links.add(decodeHTMLAttribute(href));
  } else {
    const seen = new Set<object>();
    function visit(value: unknown): void {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      for (const [key, item] of Object.entries(value)) {
        if ((key === "description" || key === "summary" || key === "text") && typeof item === "string") {
          rewriteMarkdownDestinations(item, href => { links.add(href); return href; });
        } else if (typeof item === "object" && !["example", "examples", "enum", "default", "const"].includes(key)) visit(item);
      }
    }
    visit(source);
  }
  const result = [...links];
  documentLinks.set(source, result);
  return result;
}

/** A site that stops on broken links names each, and writes nothing, while one remains. */
export function stopOnBrokenLinks(diagnostics: readonly SiteDiagnostic[]): void {
  const broken = diagnostics.filter(diagnostic => diagnostic.code === "broken-link");
  if (!broken.length) return;
  throw new Error([
    `brokenLinks is "error", and ${broken.length === 1 ? "1 link leads" : `${broken.length} links lead`} nowhere the site publishes:`,
    ...broken.slice(0, 20).map(diagnostic => `  ${diagnostic.page}: ${diagnostic.message}`),
    ...(broken.length > 20 ? [`  and ${broken.length - 20} more`] : []),
  ].join("\n"));
}

/** Keep large imported references useful to inspect without printing thousands of lines. */
export function formatSiteDiagnostics(diagnostics: readonly SiteDiagnostic[]): string[] {
  const groups = new Map<SiteDiagnostic["code"], SiteDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const group = groups.get(diagnostic.code) ?? [];
    group.push(diagnostic); groups.set(diagnostic.code, group);
  }
  return [...groups].map(([code, entries]) => {
    const pages = [...new Set(entries.flatMap(entry => entry.page ? [entry.page] : []))];
    // Warnings of one kind that each name something of their own, as broken links do, say how many follow the first.
    const others = new Set(entries.map(entry => entry.message)).size - 1;
    return `WARNING ${code}: ${entries[0].message}${others ? ` And ${others} more like it.` : ""}${pages.length ? ` (${pages.length} page${pages.length === 1 ? "" : "s"}: ${pages.slice(0, 5).join(", ")}${pages.length > 5 ? ", …" : ""})` : ""}`;
  });
}
