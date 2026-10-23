/**
 * Mintlify's `docs.json` navigation as native groups. Mintlify's navigation
 * sets (tabs, menus, anchors, dropdowns, products) switch the sidebar over one
 * URL space, where native tabs prefix their routes; until native models sets
 * over a shared space, each set becomes a section of one navigation.
 */
import type { GroupConfig, NavigationItem } from "../../config.js";
import { groupIds, placeUnlisted, topLevelGroups } from "../navigation.js";

type Node = Record<string, unknown>;

/** Navigation sets by key, with the field naming each entry. */
const SETS: Record<string, string> = { tabs: "tab", menu: "item", anchors: "anchor", dropdowns: "dropdown", products: "product" };

/** A page as navigation references it. */
export interface MintlifyPage {
  /** Native page reference inside the docs root. */
  reference: string;
  /** Sidebar label, when the page names one. */
  label?: string;
  /** An external link the page stands for (`url` frontmatter). */
  url?: string;
  /** Mintlify generates this page from an API operation (`openapi` frontmatter). */
  operation?: string;
}

export interface MintlifyNavigation {
  groups: GroupConfig[];
  /** Pages navigation lists without a file, which Mintlify leaves out. */
  missing: string[];
  /** Pages navigation lists, by path. */
  listed: Set<string>;
  /** Set names that became sections. */
  sections: string[];
  /** The groups navigation sets became. */
  sets: Set<GroupConfig>;
}

export function convertNavigation(
  navigation: Node,
  pages: ReadonlyMap<string, MintlifyPage>,
  route: (path: string) => string,
  fail: (message: string) => void,
  /** The entry for a page Mintlify generates from an operation; without one, such pages stay out. */
  operation?: (reference: string) => NavigationItem,
): MintlifyNavigation {
  const listed = new Set<string>();
  const sections: string[] = [];
  const sets = new Set<GroupConfig>();
  const missing: string[] = [];

  const page = (path: string): NavigationItem | undefined => {
    const found = pages.get(path.replace(/^\/+/, ""));
    if (!found) {
      missing.push(path);
      return undefined;
    }
    listed.add(path.replace(/^\/+/, ""));
    if (found.url) return { href: found.url, label: found.label ?? path };
    return found.operation ? operation?.(found.reference) : found.reference;
  };

  const groupId = groupIds();
  const group = (node: Node, parent: string, nested: boolean): NavigationItem | undefined => {
    const label = String(node.group ?? "");
    const id = groupId(parent, label, "group");
    const items = contents(node, id, true);
    const root = typeof node.root === "string" ? page(node.root) : undefined;
    if (typeof root === "string") items.unshift({ page: root, hidden: true });
    if (!items.length) return undefined;
    return {
      group: label,
      id,
      ...(typeof root === "string" ? { href: route(root) } : {}),
      ...(nested && node.expanded !== true ? { collapsed: true } : {}),
      pages: items,
    };
  };

  const contents = (node: Node, parent: string, nested: boolean): NavigationItem[] => {
    for (const unsupported of ["versions", "languages"])
      if (node[unsupported] !== undefined) fail(`Navigation ${unsupported} switch the sidebar while pages keep one URL; native ${unsupported} give each its own URLs, so they do not convert`);
    if (node.openapi !== undefined) fail(`Navigation generates a page for every operation of ${JSON.stringify(node.openapi)}; native converts Mintlify's API pages written with openapi frontmatter`);
    const items: NavigationItem[] = [];
    for (const [key, field] of Object.entries(SETS)) {
      const entries = (node[key] ?? []) as Node[];
      // One entry of a set is just its content.
      if (entries.length === 1 && !entries[0].href) {
        items.push(...contents(entries[0], parent, nested));
        continue;
      }
      for (const entry of entries) {
        const label = String(entry[field] ?? "");
        if (typeof entry.href === "string") {
          items.push({ href: entry.href, label });
          continue;
        }
        sections.push(label);
        const id = groupId(parent, label, key);
        // A set's own groups are its section headings, open like Mintlify's.
        const inner = contents(entry, id, false);
        if (!inner.length) continue;
        const set: GroupConfig = { group: label, id, ...(nested ? { collapsed: true } : {}), pages: inner };
        sets.add(set);
        items.push(set);
      }
    }
    for (const entry of (node.groups ?? []) as Node[]) {
      const item = group(entry, parent, nested);
      if (item) items.push(item);
    }
    for (const entry of (node.pages ?? []) as (string | Node)[]) {
      const item = typeof entry === "string" ? page(entry) : group(entry, parent, true);
      if (item) items.push(item);
    }
    return items;
  };

  const groups = topLevelGroups(contents(navigation, "", false));
  placeUnlisted(groups, [...pages].filter(([path, entry]) => !listed.has(path) && !entry.url && !entry.operation).map(([, entry]) => entry.reference));
  return { groups, missing, listed, sections, sets };
}
