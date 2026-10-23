/**
 * Custom Astro documentation (pages or content collections rendered by the
 * project's own layouts) to native Sourcey. The project's routing and
 * navigation live in its code, so the one-time mapping declares them; this
 * module turns that declaration into native routes, navigation and edits.
 */
import { posix } from "node:path";
import type { GroupConfig, NavigationItem } from "../../config.js";
import { firstHeadingText } from "../../utils/markdown.js";
import type { ConfigValue } from "../config-writer.js";
import type { Diagnostics } from "../diagnostics.js";
import { raiseHeadings, titleHeadingLevel } from "../headings.js";
import { evaluate, parseModule, resolveModule, type Value } from "../javascript.js";
import { parseDocument, SourceSyntaxError, type Dialect } from "../mdx.js";
import type { AstroDocumentation, SourceDocumentInfo, SourceNavigationItem } from "../mapping.js";
import { groupIds, placeUnlisted, topLevelGroups } from "../navigation.js";
import { markdownSource, type NativePlan, type PlannedDocument, type SourceDialect } from "../plan.js";
import type { ProjectFiles } from "../project-files.js";
import { astroEntrySlug, type FragmentRule } from "../slugs.js";
import { readFrontmatter } from "../text-edits.js";
import type { AstroRoot } from "./project.js";

const DOCUMENT = /\.(md|mdx)$/;

interface Document extends SourceDocumentInfo {
  /** Native page reference inside the Markdown root. */
  reference: string;
  /** Native file location after any move. */
  target: string;
  body: string;
}

export interface CustomAstroContext {
  project: ProjectFiles;
  diagnostics: Diagnostics;
  root: AstroRoot;
  /** How this root's Astro version derived heading fragments. */
  fragments: FragmentRule;
  name?: string;
  documentation: AstroDocumentation[];
}

export async function convertCustomAstro(context: CustomAstroContext): Promise<{ plan: NativePlan; routeBase: string } | undefined> {
  const { project, diagnostics, root, documentation, name } = context;
  const single = documentation.length === 1;
  const routeBase = single ? normaliseRoute(documentation[0].route).replace(/(.)\/$/, "$1") : "/";
  const sections = new Map<string, string>();
  const documents: PlannedDocument[] = [];
  const tabs: ConfigValue[] = [];

  for (const source of documentation) {
    const base = normaliseRoute(source.route);
    const sourceDir = posix.join(root.dir, source.source);
    const markdownRoot = source.move ?? source.source;
    const found = await readDocuments(project, source, sourceDir, root.dir, base);
    if (!found.length) {
      diagnostics.error({ file: sourceDir, code: "astro-documentation", message: "No Markdown or MDX documents in this documentation source" });
      continue;
    }
    const navigation = await sourceNavigation(project, diagnostics, source, found);
    if (!navigation) continue;
    const { groups, labels } = convertNavigation(navigation, found, sections, diagnostics, sourceDir);
    // The tab sits at the mount for one source; several sources share the root and keep their own prefixes.
    const tabSlug = single ? "" : base.replace(/^\/|\/$/g, "");
    const published = found.map((document) => ({ document, reference: document.reference, path: document.route.slice(base.length).replace(/^\/|\/$/g, "") || "index" }));
    const markdown = markdownSource(markdownRoot, groups, published);
    for (const page of published) {
      const { document } = page;
      const landing = document.file === posix.join(root.dir, source.landing ?? "");
      const frontmatter = readFrontmatter(document.body);
      const dialect: SourceDialect = { fragments: context.fragments };
      const set: Record<string, string> = {};
      const slug = markdown.slugs.get(page);
      if (slug) set.slug = slug;
      const label = labels.get(document.route);
      // Without a title of its own, a page opening with its one top heading is titled by it, as its layout showed it.
      const level = typeof frontmatter.data.title === "string" ? undefined : await titleLevel(document, frontmatter.bodyStart, dialect);
      if (typeof frontmatter.data.title !== "string" && !level && !firstHeadingText(document.body.slice(frontmatter.bodyStart), 1) && label) set.title = label;
      documents.push({
        file: document.file,
        ...(document.target !== document.file ? { target: document.target } : {}),
        route: document.route,
        dialect,
        ...(level && level > 1 ? { after: (text: string) => raiseHeadings(document.file, text, dialect, level - 1) } : {}),
        // An Astro page names its layout; the native mount renders it.
        frontmatter: { set, remove: (source.kind === "pages" || landing) && frontmatter.data.layout !== undefined ? ["layout"] : [] },
      });
    }
    tabs.push({ tab: source.label ?? "Documentation", slug: tabSlug, source: markdown.source });
  }
  if (!documents.length) return undefined;

  return {
    routeBase,
    plan: {
      configDir: root.dir,
      config: {
        imports: [{ from: "sourcey", names: ["defineConfig", "markdown"] }],
        config: { name: name ?? "", prettyUrls: "slash", navigation: { tabs } },
      },
      documents,
      routes: [],
      sections,
      files: new Map(),
    },
  };
}

/** The level of a page's title heading; a page that does not parse is reported when it converts. */
async function titleLevel(document: Document, bodyStart: number, dialect: Dialect): Promise<number | undefined> {
  try {
    return titleHeadingLevel(document.body, await parseDocument(document.file, document.body, bodyStart, dialect));
  } catch (error) {
    if (error instanceof SourceSyntaxError) return undefined;
    throw error;
  }
}

/** A route prefix as `/name/`, or `/` for the root. */
function normaliseRoute(route: string): string {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/** The declared navigation, reading a project data module statically when that is how it is declared. */
async function sourceNavigation(project: ProjectFiles, diagnostics: Diagnostics, source: AstroDocumentation, documents: Document[]): Promise<SourceNavigationItem[] | undefined> {
  const declared = source.navigation;
  if (Array.isArray(declared)) return declared;
  if (typeof declared === "function") return declared(documents.map(({ file, path, route, frontmatter }) => ({ file, path, route, frontmatter })));
  const file = await resolveModule(project, "mapping", declared.module);
  const scope = await parseModule(project, file);
  const init = scope.exports.get(declared.export) ?? scope.constants.get(declared.export);
  const fail = (message: string) => {
    diagnostics.error({ file, code: "astro-navigation", message });
    return undefined;
  };
  if (!init) return fail(`No exported constant "${declared.export}"`);
  const read = (value: Value): SourceNavigationItem[] | undefined => {
    if (value.kind !== "array") return undefined;
    const items: SourceNavigationItem[] = [];
    for (const item of value.items) {
      if (item.kind !== "object") return undefined;
      const field = (name: string | undefined) => (name ? item.entries.get(name) : undefined);
      const label = field(declared.fields.label);
      const link = field(declared.fields.link);
      if (label?.kind !== "literal" || link?.kind !== "literal") return undefined;
      const children = field(declared.fields.children);
      const nested = children ? read(children) : [];
      if (!nested) return undefined;
      items.push({ label: String(label.value), link: String(link.value), ...(nested.length ? { children: nested } : {}) });
    }
    return items;
  };
  return read(evaluate(init, scope)) ?? fail(`"${declared.export}" is not a static list of entries with ${declared.fields.label} and ${declared.fields.link}`);
}

/** Documentation files, with the routes the project published them at and their native references. */
async function readDocuments(project: ProjectFiles, source: AstroDocumentation, sourceDir: string, rootDir: string, base: string): Promise<Document[]> {
  const documents: Document[] = [];
  for (const file of await project.list(sourceDir, (path) => DOCUMENT.test(path) && !posix.basename(path).startsWith("_"))) {
    const inside = file.slice(sourceDir.length + 1);
    const path = inside.replace(DOCUMENT, "");
    const body = await project.readText(file);
    const frontmatter = readFrontmatter(body).data;
    const slug =
      source.kind === "pages"
        ? path.replace(/(^|\/)index$/, "")
        : typeof frontmatter.slug === "string"
          ? frontmatter.slug.replace(/^\/+|\/+$/g, "")
          : await astroEntrySlug(inside);
    documents.push({
      file,
      path,
      route: slug ? `${base}${slug}/` : base,
      frontmatter,
      reference: path.replace(/\/index$/, "") || "index",
      target: source.move ? posix.join(rootDir, source.move, inside) : file,
      body,
    });
  }
  if (source.landing) {
    const file = posix.join(rootDir, source.landing);
    const body = await project.readText(file);
    documents.push({
      file,
      path: "index",
      route: base,
      frontmatter: readFrontmatter(body).data,
      reference: "index",
      target: posix.join(rootDir, source.move ?? source.source, `index${posix.extname(file)}`),
      body,
    });
  }
  return documents;
}

/**
 * The project's navigation as native groups. An entry with children is a
 * group landing on its own page; its children follow. Documents no entry
 * lists are still published, next to their nearest listed sibling.
 */
function convertNavigation(
  navigation: SourceNavigationItem[],
  documents: Document[],
  sections: Map<string, string>,
  diagnostics: Diagnostics,
  sourceDir: string,
): { groups: GroupConfig[]; labels: Map<string, string> } {
  const byRoute = new Map(documents.map((document) => [document.route, document]));
  const labels = new Map<string, string>();
  const listed = new Set<string>();
  const groupId = groupIds();
  const entry = (item: SourceNavigationItem, parent: string): NavigationItem | undefined => {
    const document = item.link ? byRoute.get(item.link.replace(/\/?$/, "/").replace(/^(?!\/)/, "/")) : undefined;
    if (document) {
      listed.add(document.route);
      labels.set(document.route, item.label);
    }
    if (item.children?.length) {
      const id = groupId(parent, item.label, "group");
      if (document) sections.set(document.route, id);
      const pages = item.children.map((child) => entry(child, id)).filter((child): child is NavigationItem => !!child);
      // The group's own page is published and reached from its label, not listed twice.
      if (document) pages.unshift({ page: document.reference, hidden: true });
      return { group: item.label, id, ...(document ? { href: document.route } : {}), pages };
    }
    if (document) return { page: document.reference, label: item.label };
    if (item.link && /^[a-z]+:/i.test(item.link)) return { href: item.link, label: item.label };
    diagnostics.error({ file: sourceDir, code: "astro-navigation", message: `Navigation entry "${item.label}" links to ${item.link ?? "nothing"}, which is no documentation page` });
    return undefined;
  };
  const groups = topLevelGroups(navigation.map((item) => entry(item, "")).filter((item): item is NavigationItem => !!item));
  placeUnlisted(groups, documents.filter((document) => !listed.has(document.route)).map((document) => document.reference));
  return { groups, labels };
}
