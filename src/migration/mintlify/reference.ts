/**
 * Mintlify's API pages as a native reference. Mintlify writes one MDX page per
 * operation (`openapi: "GET /keys"` frontmatter) with a hand-written title,
 * notes, URL and place in the navigation. Native generates operation pages from
 * the spec, so each of those facts goes to the owner native has for it: title
 * and notes to a standard OpenAPI Overlay, the URL to the tab's routes, the
 * place to the tab's navigation, and the fragments its pages published to the
 * tab's anchors. Operations Mintlify published no page for are removed in the
 * overlay, so the reference publishes what Mintlify did.
 */
import { dump } from "js-yaml";
import type { GroupConfig, NavigationItem } from "../../config.js";
import { operationKey } from "../../core/reference-identity.js";
import type { HttpMethod } from "../../core/types.js";
import { dedent } from "../../utils/indentation.js";
import { Call, Reference, type ConfigImport, type ConfigValue } from "../config-writer.js";
import { counted } from "../diagnostics.js";
import { operationAliases } from "./fragments.js";
import { closingTagStart, openingTagEnd, parseDocument, span, walk, type Dialect, type SyntaxNode } from "../mdx.js";
import { readApiReference, type ReferenceOperation } from "../openapi.js";
import type { ProjectFiles } from "../project-files.js";
import { readFrontmatter } from "../text-edits.js";
import { topLevelGroups } from "../navigation.js";
import { isAbsoluteHttpUrl } from "../../site-url.js";

type Node = Record<string, unknown>;

/** A Mintlify page Mintlify generates from an operation. */
export interface OperationPage {
  file: string;
  /** Page reference, the file's path without extension. */
  reference: string;
  /** The `openapi` frontmatter, `METHOD /path`. */
  operation: string;
  frontmatter: Record<string, unknown>;
}

/** Mintlify callouts as the GitHub alerts that spec descriptions render as native callouts. */
const ALERTS: Record<string, string> = { Note: "NOTE", Info: "NOTE", Tip: "TIP", Check: "TIP", Warning: "WARNING", Danger: "CAUTION" };
/** Frontmatter an operation page carries some other way. */
const CARRIED = new Set(["openapi", "title", "sidebarTitle"]);

export interface ReferencePlan {
  /** The native tab that owns the operations, named and navigated as the API section of the source's navigation. */
  tab: (label: string, navigation: GroupConfig[]) => Record<string, ConfigValue>;
  /** The navigation entry for an operation page, by page reference. */
  entry: (reference: string) => NavigationItem;
  /** Pages whose operation the spec no longer has: they stay pages, with their title and notes. */
  stale: Set<string>;
  /** Each page that documents an operation another page also documents, to that page. */
  redirects: Record<string, string>;
  /** Native routes the source published, which the build must keep. */
  routes: { route: string; origin: string }[];
  files: Map<string, { bytes: string; reason: string }>;
  imports: ConfigImport[];
}

/** The data files the reference reads: overlay, routes, navigation and original fragments. */
export const REFERENCE_FILES = { overlay: "api.overlay.yaml", routes: "api.routes.json", navigation: "api.navigation.json", anchors: "api.anchors.json" };

export async function prepareReference(
  project: ProjectFiles,
  config: Node,
  pages: OperationPage[],
  context: { dialect: Dialect; route: (path: string) => string; fail: (message: string) => void; review: (message: string) => void },
): Promise<ReferencePlan | undefined> {
  const { fail, review } = context;
  const spec = (config.api as Node | undefined)?.openapi;
  if (typeof spec !== "string") {
    fail(`Mintlify generates ${counted(pages.length, "page")} from API operations, and docs.json names ${spec === undefined ? "no OpenAPI document" : "several OpenAPI documents"} (api.openapi); native converts one`);
    return undefined;
  }
  let reference;
  try {
    reference = await readApiReference(project, spec);
  } catch (error) {
    fail(`The OpenAPI document ${spec} (api.openapi) could not be read: ${(error as Error).message}`);
    return undefined;
  }
  const operations = new Map(reference.operations.map((operation) => [operation.document, operation]));

  // Each page's operation, title and notes, as Mintlify showed them, in navigation order (the first page of an operation owns it).
  const order = navigationOrder(config.navigation);
  pages = [...pages].sort((a, b) => (order.get(a.reference) ?? Infinity) - (order.get(b.reference) ?? Infinity) || a.reference.localeCompare(b.reference));
  const documented: { page: OperationPage; key: string; title?: string; sidebarTitle?: string; notes: string }[] = [];
  for (const page of pages) {
    const [method = "", ...rest] = page.operation.trim().split(/\s+/);
    if (rest.length !== 1) {
      fail(`${page.file} names its operation as "${page.operation}"; native converts \`METHOD /path\` against api.openapi`);
      continue;
    }
    const uncarried = Object.keys(page.frontmatter).filter((key) => !CARRIED.has(key));
    if (uncarried.length) review(`${page.file}: frontmatter ${uncarried.join(", ")} has no native equivalent on an operation and is not carried over`);
    const text = typeof page.frontmatter.title === "string" ? page.frontmatter.title : undefined;
    const label = typeof page.frontmatter.sidebarTitle === "string" ? page.frontmatter.sidebarTitle : undefined;
    const notes = await operationNotes(project, page, context);
    if (notes === undefined) continue;
    documented.push({ page, key: operationKey({ method: method.toLowerCase() as HttpMethod, path: rest[0] }), ...(text ? { title: text } : {}), ...(label ? { sidebarTitle: label } : {}), notes });
  }

  const stale = documented.filter((item) => !operations.has(item.key));
  if (stale.length)
    review(`${counted(stale.length, "API page")} name operations the OpenAPI document no longer has (${stale.slice(0, 3).map((item) => `${item.page.file}: ${item.key}`).join("; ")}${stale.length > 3 ? "; ..." : ""}); they stay pages with their title and notes`);

  // One page per operation owns its URL; a repeat with the same notes redirects there, keeping its own title as its navigation label.
  const byKey = new Map<string, typeof documented>();
  for (const item of documented.filter((entry) => operations.has(entry.key))) byKey.set(item.key, [...(byKey.get(item.key) ?? []), item]);
  const canonical = new Map<string, (typeof documented)[number]>();
  const redirects: Record<string, string> = {};
  for (const [key, items] of byKey) {
    const [first, ...others] = items;
    canonical.set(key, first);
    for (const other of others) {
      if (other.notes !== first.notes) {
        fail(`${first.page.file} and ${other.page.file} document ${key} with different notes; keep one page for the operation before migrating`);
        continue;
      }
      redirects[context.route(other.page.reference)] = context.route(first.page.reference);
      review(`${key} has two pages: ${context.route(first.page.reference)} is its page and ${context.route(other.page.reference)} redirects to it${other.title !== first.title ? `; "${other.title}" stays its navigation label there` : ""}`);
    }
  }

  // The tab's slug is the first segment every operation page shares; routes are relative to it.
  const paths = [...canonical.values()].map((item) => context.route(item.page.reference).replace(/^\/+/, ""));
  const slug = paths[0]?.split("/")[0] ?? "";
  if (!slug || paths.some((path) => !path.startsWith(`${slug}/`))) {
    fail(`Mintlify's API pages do not share a first path segment (${paths.slice(0, 2).join(", ")}); native publishes a reference tab under one`);
    return undefined;
  }
  const routes = Object.fromEntries([...canonical].map(([key, item]) => [key, context.route(item.page.reference).replace(/^\/+/, "").slice(slug.length + 1)]));

  // Each page's field and credential fragments, at the native field or section that shows it.
  const anchors: Record<string, Record<string, string>> = {};
  const conflicts: string[] = [];
  const unresolved: string[] = [];
  for (const [key, item] of canonical) {
    const found = operationAliases(operations.get(key)!, reference.securitySchemes);
    if (Object.keys(found.aliases).length) anchors[key] = found.aliases;
    const at = (fragment: string) => `${context.route(item.page.reference)}#${fragment}`;
    conflicts.push(...found.conflicts.map(at));
    unresolved.push(...found.unresolved.map(at));
  }
  const sample = (fragments: string[]) => `${fragments.slice(0, 3).join(", ")}${fragments.length > 3 ? ", ..." : ""}`;
  if (conflicts.length)
    review(`${counted(conflicts.length, "original fragment")} named two fields on their API page (${sample(conflicts)}); each stays with the first, the one a browser opened`);
  if (unresolved.length)
    review(`${counted(unresolved.length, "original fragment")} pointed at fields the native reference does not show, such as ones nested deeper than it draws (${sample(unresolved)}); links to them open the operation's page`);
  const hasAnchors = Object.keys(anchors).length > 0;

  const { actions, replaced } = overlayActions(reference.operations, canonical);
  if (replaced)
    review(`${counted(replaced, "operation")} show Mintlify's notes before the OpenAPI document's description; ${REFERENCE_FILES.overlay} holds that description as converted, so update it there when the API's own text changes`);
  const removed = reference.operations.filter((operation) => !canonical.has(operation.document)).length;
  if (removed) review(`${counted(removed, "operation")} Mintlify published no page for are removed in ${REFERENCE_FILES.overlay}, so the reference publishes what Mintlify did`);
  review(`${counted(canonical.size, "API page")} become operations of the native reference at /${slug}, generated from ${spec}: titles and notes in ${REFERENCE_FILES.overlay}, URLs in ${REFERENCE_FILES.routes}, navigation in ${REFERENCE_FILES.navigation}${hasAnchors ? `, field links in ${REFERENCE_FILES.anchors}` : ""}`);

  const name = typeof config.name === "string" ? config.name : "API";
  const overlay = { overlay: "1.0.0", info: { title: `${name} API page titles and notes, from Mintlify`, version: "1.0.0" }, actions };
  const staleReferences = new Set(stale.map((item) => item.page.reference));
  const byReference = new Map(documented.map((item) => [item.page.reference, item]));
  return {
    tab: (label, navigation) => ({
      id: "api",
      tab: label,
      slug,
      source: new Call("openapi", [{ spec: isAbsoluteHttpUrl(spec) ? spec : `./${spec.replace(/^\.?\/+/, "")}`, overlays: [`./${REFERENCE_FILES.overlay}`] }]),
      reference: { split: "operations" },
      routes: new Reference("apiRoutes"),
      ...(navigation.length ? { navigation: new Reference("apiNavigation") } : {}),
      ...(hasAnchors ? { anchors: new Reference("apiAnchors"), anchorUnmatched: "warn" } : {}),
    }),
    entry: (reference) => {
      const item = byReference.get(reference);
      if (!item || staleReferences.has(reference)) return reference;
      const owner = canonical.get(item.key)!;
      const label = item.sidebarTitle ?? (item.title !== owner.title ? item.title : undefined);
      return { operation: item.key, ...(label ? { label } : {}) };
    },
    stale: staleReferences,
    redirects,
    routes: [...canonical.values()].map((item) => ({ route: context.route(item.page.reference), origin: item.page.file })),
    files: new Map([
      [REFERENCE_FILES.overlay, { bytes: dump(overlay, { lineWidth: -1, noRefs: true }), reason: "Mintlify's API page titles and notes, and the operations it did not publish, as an OpenAPI Overlay" }],
      [REFERENCE_FILES.routes, { bytes: `${JSON.stringify(routes, null, 2)}\n`, reason: "The URL Mintlify published each operation at" }],
      ...(hasAnchors ? [[REFERENCE_FILES.anchors, { bytes: `${JSON.stringify(anchors, null, 2)}\n`, reason: "The fragments Mintlify's API pages gave fields and credentials, by the native field or section" }] as const] : []),
    ]),
    imports: [
      { from: `./${REFERENCE_FILES.routes}`, default: "apiRoutes" },
      { from: `./${REFERENCE_FILES.navigation}`, default: "apiNavigation" },
      ...(hasAnchors ? [{ from: `./${REFERENCE_FILES.anchors}`, default: "apiAnchors" }] : []),
    ],
  };
}

/**
 * Overlay actions: each published operation takes its page's title as its
 * summary and its notes ahead of its description; every other operation, or a
 * path with none published, is removed.
 */
function overlayActions(operations: ReferenceOperation[], published: ReadonlyMap<string, { title?: string; notes: string }>): { actions: Node[]; replaced: number } {
  const actions: Node[] = [];
  let replaced = 0;
  const target = (path: string, method?: string) => `$.paths['${path.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']${method ? `.${method}` : ""}`;
  const byPath = new Map<string, ReferenceOperation[]>();
  for (const operation of operations) byPath.set(operation.path, [...(byPath.get(operation.path) ?? []), operation]);
  for (const [path, members] of byPath) {
    if (!members.some((operation) => published.has(operation.document))) {
      actions.push({ target: target(path), remove: true });
      continue;
    }
    for (const operation of members) {
      const page = published.get(operation.document);
      if (!page) {
        actions.push({ target: target(path, operation.method), remove: true });
        continue;
      }
      const original = typeof operation.source.operation.description === "string" ? operation.source.operation.description.trim() : "";
      if (page.notes && original) replaced += 1;
      const update = { ...(page.title ? { summary: page.title } : {}), ...(page.notes ? { description: [page.notes, original].filter(Boolean).join("\n\n") } : {}) };
      if (Object.keys(update).length) actions.push({ target: target(path, operation.method), update });
    }
  }
  return { actions, replaced };
}

/**
 * An operation page's body as Markdown for its description: callouts become
 * GitHub alerts, other Markdown stays as written. A component with no Markdown
 * form stops the conversion at its line.
 */
async function operationNotes(project: ProjectFiles, page: OperationPage, context: { dialect: Dialect; fail: (message: string) => void }): Promise<string | undefined> {
  const source = await project.readText(page.file);
  const { bodyStart } = readFrontmatter(source);
  const tree = await parseDocument(page.file, source, bodyStart, context.dialect);
  const blocks: string[] = [];
  let failed = false;
  const stop = (node: SyntaxNode, message: string) => {
    context.fail(`${page.file}:${node.position?.start.line ?? 1}: ${message}`);
    failed = true;
  };
  for (const node of tree.children ?? []) {
    if (node.type === "yaml" || node.type === "toml") continue;
    if (node.type === "mdxjsEsm") {
      stop(node, "an API page's notes import modules, which a spec description cannot");
      continue;
    }
    if (node.type === "mdxJsxFlowElement") {
      const alert = node.name ? ALERTS[node.name] : undefined;
      if (!alert) {
        stop(node, `<${node.name ?? ""}> in an API page's notes has no Markdown form for a spec description`);
        continue;
      }
      const { start, end } = span(node);
      const close = closingTagStart(source, start, end);
      const body = close === undefined ? "" : dedent(source.slice(openingTagEnd(source, start), close));
      const title = node.attributes?.find((attribute) => attribute.name === "title")?.value;
      const lines = [...(typeof title === "string" ? [`**${title}**`, ""] : []), ...body.split("\n")];
      blocks.push([`> [!${alert}]`, ...lines.map((line) => (line ? `> ${line}` : ">"))].join("\n"));
      continue;
    }
    for (const { node: inner } of walk(node)) if (inner.type === "mdxJsxTextElement") stop(inner, `<${inner.name ?? ""}> in an API page's notes has no Markdown form for a spec description`);
    const { start, end } = span(node);
    blocks.push(source.slice(start, end));
  }
  return failed ? undefined : blocks.join("\n\n");
}

/**
 * The deepest navigation set (tab, menu, anchor, dropdown) holding every
 * operation, taken out of the documentation's navigation as the reference's
 * own. Its pages stay the documentation tab's, linked from the reference by
 * tab; it returns them so the documentation tab keeps loading them. Undefined
 * when no set holds every operation, such as operations spread over several.
 */
export function takeReferenceSection(groups: GroupConfig[], sets: ReadonlySet<GroupConfig>): { label: string; navigation: GroupConfig[]; pages: string[] } | undefined {
  const operations = (items: readonly NavigationItem[]): number =>
    items.reduce((count, item) => count + (typeof item !== "object" ? 0 : "operation" in item ? 1 : "group" in item ? operations(item.pages) : 0), 0);
  const total = operations(groups);
  let siblings: NavigationItem[] = groups;
  let section: GroupConfig | undefined;
  for (;;) {
    const holder = siblings.find((item): item is GroupConfig => typeof item === "object" && "group" in item && operations(item.pages) === total);
    if (!holder) break;
    if (sets.has(holder)) section = holder;
    siblings = holder.pages;
  }
  if (!section || !total) return undefined;
  const parent = findParent(groups, section);
  parent.splice(parent.indexOf(section), 1);
  const pages: string[] = [];
  const link = (items: readonly NavigationItem[]): NavigationItem[] =>
    items.map((item) => {
      if (typeof item === "string") {
        pages.push(item);
        return { page: item, tab: "docs" };
      }
      if ("group" in item) return { ...item, pages: link(item.pages) };
      if ("page" in item && !item.tab) {
        pages.push(item.page);
        return { ...item, tab: "docs" };
      }
      if ("page" in item) pages.push(item.page);
      return item;
    });
  return { label: section.group, navigation: topLevelGroups(link(section.pages)), pages };
}

function findParent(items: NavigationItem[], target: GroupConfig): NavigationItem[] {
  if (items.includes(target)) return items;
  for (const item of items) if (typeof item === "object" && "group" in item) {
    const found = findParent(item.pages, target);
    if (found.length) return found;
  }
  return [];
}

/** Each page navigation lists, by its first position. */
function navigationOrder(navigation: unknown): Map<string, number> {
  const order = new Map<string, number>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      const reference = node.replace(/^\/+/, "");
      if (!order.has(reference)) order.set(reference, order.size);
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  };
  visit(navigation);
  return order;
}
