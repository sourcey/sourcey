import type { NormalizedSpec, UnmatchedTargetPolicy } from "./types.js";
import type { ChangelogPage, MarkdownPage } from "./markdown-loader.js";
import type { ResolvedTab, TryItConfig, VersionItem, LocaleConfig, Redirect } from "../config.js";
import type { SiteNavigation } from "./navigation.js";
import {
  operationAnchor,
  operationAnchors,
  definitionAnchor,
  definitionAnchors,
  tagAnchor,
  referenceOperation,
} from "./reference-identity.js";
import { toPublicPath, normalizeBaseUrl } from "../site-url.js";
import { Parser } from "htmlparser2";

export interface AlternateLink {
  rel?: "alternate" | "describedby" | "ard" | "api-catalog";
  href: string;
  type: string;
  title?: string;
}

export interface EquivalentPageLink {
  label: string;
  href: string;
  lang?: string;
  kind: "locale" | "version";
  active: boolean;
  /** Fragments that exist on both this page and the destination. */
  anchors?: string[];
}

export interface ResolvedSiteContext {
  key: string;
  scope: string;
  version: VersionItem;
  locale: string;
  /** The language's settings, resolved: it names its `lang` and `dir`, and holds every message. */
  localeConfig: LocaleConfig & {
    lang: string;
    dir: "ltr" | "rtl";
    messages: import("./messages.js").UiMessages & { navigation?: Record<string, string> };
  };
  defaultLocale: string;
  /** The default language's tag, which a page reading its content in that language declares. */
  defaultLang: string;
  isDefaultVersion: boolean;
  prefix: string;
  /** The language's path, without the version's. */
  localePath: string;
  /** Where the language's content lives, and its fallback. */
  source: import("../adapters/types.js").SourceLocaleContext;
  tabs: ResolvedTab[];
}

/** The owner of the site's own pages, which belong to no tab. Tab slugs cannot start with @. */
export const SITE_PAGES = "@pages";

export type CurrentPage =
  | {
      kind: "spec";
      spec: NormalizedSpec;
      tryIt?: false | TryItConfig;
      specKey?: string;
      view?:
        { kind: "operation"; id: string } | { kind: "schema"; name: string } | { kind: "overview" };
    }
  | { kind: "markdown"; markdown: MarkdownPage }
  | { kind: "changelog"; changelog: ChangelogPage }
  | { kind: "not-found"; title: string; description: string; homeHref: string };

export interface PageIdentity {
  tab: string;
  kind: string;
  document: string;
}

export interface ReferenceTarget {
  href: string;
  outputPath: string;
  anchor?: string;
}
export interface ReferenceTargets {
  /** The reference's own page: its overview, or the whole reference on one page. */
  overview: ReferenceTarget;
  operations: Record<string, ReferenceTarget>;
  schemas: Record<string, ReferenceTarget>;
}
export interface SitePage {
  anchorAliases?: Record<string, string>;
  anchorUnmatched?: UnmatchedTargetPolicy;
  /** Public URL projected once by RouteTable. */
  publicPath?: string;
  outputPath: string;
  currentPage: CurrentPage;
  tabSlug: string;
  pageSlug: string;
  identity: PageIdentity;
  context: ResolvedSiteContext;
  contentLocale: string;
  source?: string;
  canonical?: string;
  navigation?: SiteNavigation;
  hidden?: boolean;
  searchIndexes?: string[];
  referenceTargets?: ReferenceTargets;
  equivalents?: EquivalentPageLink[];
  ogImagePath?: string;
  alternateLinks?: AlternateLink[];
  /** Served for every address the site does not have. */
  status?: 404;
  /** The page's own published stylesheets. */
  stylesheets?: string[];
}

export interface RouteRecord {
  aliasOf?: string;
  key: string;
  publicPath: string;
  outputPath: string;
  canonical: string;
  anchors: ReadonlySet<string>;
  index: boolean;
  status: 200 | 404;
  page: SitePage;
}

export interface RedirectRecord extends Redirect {
  publicPath: string;
  /** Undefined when the host router, rather than standalone output, owns it. */
  outputPath?: string;
}

/** An explicit destination query replaces the incoming query; otherwise retain it. */
export function redirectLocation(redirect: Redirect, request: string): string {
  if (redirect.to.includes("?")) return redirect.to;
  const query = new URL(request, "https://sourcey.invalid").search;
  const hash = redirect.to.indexOf("#");
  return hash < 0
    ? redirect.to + query
    : redirect.to.slice(0, hash) + query + redirect.to.slice(hash);
}

/** A changelog's own page, rather than one of its releases' pages. */
export function isMainChangelogPage(page: SitePage): page is SitePage & { currentPage: { kind: "changelog"; changelog: ChangelogPage } } {
  return page.currentPage.kind === "changelog" && !page.currentPage.changelog.permalinkVersionId;
}

export function identityKey(page: Pick<SitePage, "identity" | "context">): string {
  return JSON.stringify([
    page.identity.tab,
    page.identity.kind,
    page.identity.document,
    page.context.scope,
    page.context.version.id,
    page.context.locale,
  ]);
}

/** The ids a page's HTML draws: the anchors of a page generated as HTML, such as a Rust or Go reference page. */
function drawnAnchors(html: string): string[] {
  const ids: string[] = [];
  const parser = new Parser({ onopentag(_name, attributes) { if (attributes.id) ids.push(attributes.id); } });
  parser.end(html);
  return ids;
}

function pageAnchors(current: CurrentPage): string[] {
  if (current.kind === "not-found") return [];
  if (current.kind !== "spec")
    return current.kind === "markdown"
      ? (current.markdown.anchors ?? [...current.markdown.headings.map((heading) => heading.id), ...drawnAnchors(current.markdown.html)])
      : current.changelog.headings.map((heading) => heading.id);
  const { spec, view } = current;
  if (view?.kind === "operation")
    return operationAnchors(
      referenceOperation(spec, view.id),
      spec,
      true,
    );
  if (view?.kind === "schema")
    return definitionAnchors(view.name, spec);
  const result = [
    "introduction",
    ...spec.tags.filter((tag) => !tag.hidden).map((tag) => tagAnchor(tag.name, spec)),
  ];
  if (Object.keys(spec.securitySchemes).length) result.push("authentication");
  if (view?.kind === "overview") {
    // Each entry keeps the anchor its section has on a single page.
    result.push(...new Set(spec.tags.filter((tag) => !tag.hidden).flatMap((tag) => tag.operations.filter((op) => !op.hidden).map((op) => operationAnchor(op, spec)))));
    if (Object.keys(spec.schemas).length) result.push("models", ...Object.keys(spec.schemas).map((name) => definitionAnchor(name, spec)));
  } else {
    result.push(
      ...spec.tags
        .filter((tag) => !tag.hidden)
        .flatMap((tag) =>
          tag.operations
            .filter((op) => !op.hidden)
            .flatMap((op) => operationAnchors(op, spec, false)),
        ),
    );
    result.push(
      ...Object.keys(spec.schemas).flatMap((name) => definitionAnchors(name, spec)),
    );
  }
  return result;
}

export interface AnchorDiagnostic {
  severity: "warning";
  code: "anchor-unmatched";
  tab: string;
  document: string;
  alias?: string;
  target?: string;
  message: string;
}

export function reportUnmatchedAnchor(policy: UnmatchedTargetPolicy, diagnostic: AnchorDiagnostic, diagnostics: AnchorDiagnostic[]): void {
  if (policy === "error") throw new Error(`${diagnostic.message} Use anchorUnmatched: 'warn' or 'ignore' for imported fragment history.`);
  if (policy === "warn") diagnostics.push(diagnostic);
}

export function validateAnchorAliases(aliases: Record<string, string>, document: string): void {
  for (const [alias, target] of Object.entries(aliases)) if (!alias || /[\s#]/.test(alias) || typeof target !== "string" || !target)
    throw new Error(`Invalid fragment alias ${alias} -> ${target} on ${document}`);
}

/** The one route inventory used by renderers and every output projection. */
export class RouteTable {
  readonly anchorDiagnostics: AnchorDiagnostic[] = [];
  readonly redirects = new Map<string, RedirectRecord>();
  readonly aliases: RouteRecord[] = [];
  readonly byKey = new Map<string, RouteRecord>();
  readonly byPath = new Map<string, RouteRecord>();
  readonly byOutputPath = new Map<string, RouteRecord>();
  private readonly requests = new Map<string, RouteRecord>();
  private readonly redirectRequests = new Map<string, RedirectRecord>();
  private readonly equivalentGroups = new Map<string, RouteRecord[]>();
  private readonly physical = new Map<string, string>();
  private readonly base: string;
  private readonly hostOwned: boolean;

  constructor(
    pages: SitePage[],
    baseUrl: string,
    prettyUrls: false | "slash" | "strip",
    landingPage = true,
    redirects: Readonly<Record<string, Redirect>> = {},
    hostOwned = false,
  ) {
    for (const page of pages) {
      const key = identityKey(page);
      if (this.byKey.has(key)) throw new Error(`Duplicate document identity: ${key}`);
      const output = safeOutputPath(page.outputPath);
      const folded = output.normalize("NFC").toLowerCase();
      if (this.physical.has(folded))
        throw new Error(`Output collision: ${output} and ${this.physical.get(folded)}`);
      this.physical.set(folded, output);
      const publicPath =
        page.status === 404
          ? `${normalizeBaseUrl(baseUrl) || "/"}404`
          : toPublicPath(output, baseUrl, prettyUrls);
      page.publicPath = publicPath;
      if (this.byPath.has(publicPath)) throw new Error(`Route collision: ${publicPath}`);
      const anchors = new Set(pageAnchors(page.currentPage));
      if (page.anchorAliases && page.currentPage.kind !== "spec")
        throw new Error(`Reference fragment aliases require a reference page: ${publicPath}`);
      if (page.anchorAliases) validateAnchorAliases(page.anchorAliases, publicPath);
      let validAliases = page.anchorAliases;
      for (const [alias, target] of Object.entries(page.anchorAliases ?? {})) {
        if (anchors.has(alias) && alias !== target)
          throw new Error(`Fragment alias conflicts with section ${alias} on ${publicPath}`);
        if (!anchors.has(target)) {
          reportUnmatchedAnchor(page.anchorUnmatched ?? "error", { severity: "warning", code: "anchor-unmatched", tab: page.identity.tab, document: page.identity.document, alias, target, message: `Fragment alias ${alias} -> ${target} has no target on ${publicPath}.` }, this.anchorDiagnostics);
          if (validAliases === page.anchorAliases) validAliases = { ...page.anchorAliases };
          delete validAliases![alias];
          continue;
        }
      }
      page.anchorAliases = validAliases;
      for (const alias of Object.keys(validAliases ?? {})) anchors.add(alias);
      const record: RouteRecord = {
        key,
        publicPath,
        outputPath: output,
        canonical: page.canonical ?? publicPath,
        anchors,
        index:
          page.status !== 404 &&
          page.context.version.index !== false &&
          page.contentLocale === page.context.locale,
        status: page.status ?? 200,
        page,
      };
      this.byKey.set(key, record);
      this.byOutputPath.set(output, record);
      const groupKey = JSON.stringify([
        page.identity.tab,
        page.identity.kind,
        page.identity.document,
        page.context.scope,
      ]);
      const group = this.equivalentGroups.get(groupKey) ?? [];
      group.push(record);
      this.equivalentGroups.set(groupKey, group);
      this.byPath.set(publicPath, record);
      this.addRequestPath(record);
    }
    for (const route of this.byKey.values()) {
      const page = route.page;
      if (page.contentLocale === page.context.locale) continue;
      const original = this.byKey.get(
        identityKey({
          identity: page.identity,
          context: { ...page.context, locale: page.contentLocale },
        }),
      );
      if (original) route.canonical = original.publicPath;
    }
    if (landingPage && !this.byOutputPath.has("index.html")) {
      const page =
        pages.find(
          (page) =>
            page.currentPage.kind !== "not-found" &&
            page.context.isDefaultVersion &&
            page.context.locale === page.context.defaultLocale,
        ) ?? pages.find((page) => page.currentPage.kind !== "not-found");
      const target = page && this.byKey.get(identityKey(page));
      if (target) {
        if (this.physical.has("index.html"))
          throw new Error("Root landing alias collides with a case-folded output path");
        const publicPath = toPublicPath("index.html", baseUrl, prettyUrls);
        const alias: RouteRecord = {
          ...target,
          key: `alias:${publicPath}`,
          aliasOf: target.key,
          publicPath,
          outputPath: "index.html",
          index: false,
          status: 200,
        };
        this.aliases.push(alias);
        this.byOutputPath.set(alias.outputPath, alias);
        this.byPath.set(alias.publicPath, alias);
        this.addRequestPath(alias);
        this.physical.set(alias.outputPath, alias.outputPath);
      }
    }
    this.base = normalizeBaseUrl(baseUrl) || "/";
    this.hostOwned = hostOwned;
    this.addRedirects(redirects);
  }

  /** Redirects, each checked against the routes and every redirect it leads through. */
  addRedirects(redirects: Readonly<Record<string, Redirect>>): void {
    const { base, hostOwned } = this;
    const added: RedirectRecord[] = [];
    for (const [publicPath, redirect] of Object.entries(redirects)) {
      if (this.match(publicPath)) throw new Error(`Redirect conflicts with content: ${publicPath}`);
      // The base itself may be spelled without its slash, as strip URLs spell the root.
      const atBase = `${publicPath}/` === base;
      if (!hostOwned && !atBase && !publicPath.startsWith(base))
        throw new Error(`Redirect is outside baseUrl ${base}: ${publicPath}`);
      let outputPath: string | undefined;
      if (!hostOwned) {
        const local = atBase ? "" : publicPath.slice(base.length);
        outputPath = safeOutputPath(
          !local || local.endsWith("/")
            ? `${local}index.html`
            : /\.html$/.test(local)
              ? local
              : `${local}/index.html`,
        );
        const folded = outputPath.normalize("NFC").toLowerCase();
        if (this.physical.has(folded))
          throw new Error(`Redirect output conflicts with content: ${publicPath}`);
        this.physical.set(folded, outputPath);
      }
      const record = { ...redirect, publicPath, outputPath };
      const requestKey = requestPathKey(publicPath);
      if (this.redirectRequests.has(requestKey))
        throw new Error(`Encoded redirect collision: ${publicPath}`);
      this.redirects.set(publicPath, record);
      this.redirectRequests.set(requestKey, record);
      added.push(record);
    }
    for (const redirect of added) {
      const seen = new Set<string>([requestPathKey(redirect.publicPath)]);
      let to = redirect.to;
      let fragment = "";
      while (to.startsWith("/")) {
        const url = new URL(to, "https://sourcey.invalid");
        if (to.includes("#")) fragment = decodeURIComponent(url.hash.slice(1));
        const requestKey = requestPathKey(url.pathname);
        if (seen.has(requestKey)) throw new Error(`Redirect cycle: ${redirect.publicPath}`);
        const next = this.redirectFor(url.pathname);
        if (next) {
          seen.add(requestKey);
          to = next.to;
          continue;
        }
        const target = this.match(url.pathname);
        if (!target && (!hostOwned || url.pathname.startsWith(base)))
          throw new Error(`Redirect target does not exist: ${to}`);
        if (target && fragment && !target.anchors.has(fragment))
          throw new Error(`Redirect fragment does not exist: ${to}#${fragment}`);
        break;
      }
    }
  }

  private addRequestPath(route: RouteRecord): void {
    const key = requestPathKey(route.publicPath);
    if (this.requests.has(key)) throw new Error(`Encoded route collision: ${route.publicPath}`);
    this.requests.set(key, route);
  }

  /** URLs encode Unicode, while output paths retain their actual file spelling. */
  match(pathname: string): RouteRecord | undefined {
    try {
      return this.requests.get(requestPathKey(pathname));
    } catch {
      return undefined;
    }
  }
  redirectFor(pathname: string): RedirectRecord | undefined {
    try {
      return this.redirectRequests.get(requestPathKey(pathname));
    } catch {
      return undefined;
    }
  }

  referenceTargets(page: SitePage): ReferenceTargets | undefined {
    if (page.currentPage.kind !== "spec") return undefined;
    const spec = page.currentPage.spec;
    const pages = [...this.byKey.values()].filter(
      (route) =>
        route.page.context.key === page.context.key &&
        route.page.identity.tab === page.identity.tab,
    );
    const byDocument = new Map(
      pages.map((route) => [
        JSON.stringify([route.page.identity.kind, route.page.identity.document]),
        route,
      ]),
    );
    const overview = pages.find(
      (route) =>
        route.page.currentPage.kind === "spec" &&
        (!route.page.currentPage.view || route.page.currentPage.view.kind === "overview"),
    )!;
    return {
      overview: { href: overview.publicPath, outputPath: overview.outputPath },
      operations: Object.fromEntries(
        spec.operations
          .filter((op) => !op.hidden)
          .map((op) => {
            const id = `${op.method.toUpperCase()} ${op.path}`;
            const own = byDocument.get(JSON.stringify(["operation", id]));
            const anchor = own ? undefined : operationAnchor(op, spec);
            return [
              id,
              {
                href: own?.publicPath ?? `${overview.publicPath}#${anchor}`,
                outputPath: own?.outputPath ?? overview.outputPath,
                anchor,
              },
            ];
          }),
      ),
      schemas: Object.fromEntries(
        Object.keys(spec.schemas).map((name) => {
          const own = byDocument.get(JSON.stringify(["schema", `schema:${name}`]));
          const anchor = own ? undefined : definitionAnchor(name, spec);
          return [
            name,
            {
              href: own?.publicPath ?? `${overview.publicPath}#${anchor}`,
              outputPath: own?.outputPath ?? overview.outputPath,
              anchor,
            },
          ];
        }),
      ),
    };
  }

  equivalents(page: SitePage): RouteRecord[] {
    return (
      this.equivalentGroups.get(
        JSON.stringify([
          page.identity.tab,
          page.identity.kind,
          page.identity.document,
          page.context.scope,
        ]),
      ) ?? []
    );
  }
}

function requestPathKey(path: string): string {
  return new URL(path, "https://sourcey.invalid").pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment).normalize("NFC")))
    .join("/");
}

export function safeOutputPath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    Array.from(path).some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) ||
    /^[a-z]:/i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe output path: ${path}`);
  }
  return path;
}

export interface Artifact {
  path: string;
  body: string | Buffer;
  mediaType: string;
  hash: string;
  headers?: Record<string, string>;
}
