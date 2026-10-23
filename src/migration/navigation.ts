/** Native navigation shapes every converter builds the same way. */
import { SOCIAL_NETWORKS, type GroupConfig, type NavbarEntry, type NavbarLink, type NavigationItem } from "../config.js";
import { slugify } from "../utils/slug.js";
import type { ConfigValue } from "./config-writer.js";

/**
 * A navbar link from a source's social icon name (`github`, `blueSky`, `x.com`,
 * `fontawesome/brands/x-twitter`). The source's label is kept unless it is only
 * the network's name: a link's text, or an icon's accessible name.
 */
export function navbarLink(icon: string, href: string, label?: string): NavbarLink {
  const name = (icon.split("/").pop() ?? "").toLowerCase();
  const network = name.replace(/^(x|x\.com|x-twitter)$/, "twitter");
  const type = SOCIAL_NETWORKS.find((known) => network === known || network.startsWith(`${known}-`)) ?? "link";
  const spoken = label?.replace(/[\s-]+/g, "").toLowerCase();
  const keep = label && (type === "link" || (spoken !== type && spoken !== name.replace(/-/g, "")));
  return { type, href, ...(keep ? { label } : {}) };
}

/** Hosts of the networks native links know, for sources that give a link's URL rather than its icon. */
const HOSTS: Record<string, NavbarLink["type"]> = {
  "github.com": "github", "discord.com": "discord", "discord.gg": "discord", "twitter.com": "twitter", "x.com": "twitter", "linkedin.com": "linkedin",
  "youtube.com": "youtube", "slack.com": "slack", "bsky.app": "bluesky", "reddit.com": "reddit", "npmjs.com": "npm",
};

/** The network a URL belongs to, as an icon name `navbarLink` reads. */
export function networkOf(href: string): string {
  const host = URL.canParse(href) ? new URL(href).hostname.replace(/^www\./, "") : "";
  return HOSTS[host] ?? HOSTS[host.split(".").slice(-2).join(".")] ?? "link";
}

/**
 * The footer links worth their place: those leading somewhere the header and
 * the sidebar do not. A source's footer often repeats its navbar's repository
 * link and lists the docs' own pages, which the native sidebar already shows.
 */
export function footerLinks(links: NavbarLink[], header: readonly NavbarLink[], isPage: (href: string) => boolean): { kept: NavbarLink[]; repeated: NavbarLink[] } {
  const bare = (href: string) => href.replace(/\/+$/, "") || "/";
  const shown = new Set(header.map((link) => bare(link.href)));
  const kept: NavbarLink[] = [], repeated: NavbarLink[] = [];
  for (const link of links) (shown.has(bare(link.href)) || isPage(link.href) ? repeated : kept).push(link);
  return { kept, repeated };
}

/** The `navbar` option for a list of links and menus, or nothing when there are none. */
export function navbarOption(links: NavbarEntry[]): ConfigValue {
  return links.length ? { links: links as unknown as ConfigValue } : undefined;
}

/**
 * Stable group IDs for one navigation, each under its parent and from the
 * source's label: siblings whose labels make the same ID, such as "C++" and
 * "C#", are numbered in the order they are listed.
 */
export function groupIds(): (parent: string, label: string, fallback: string) => string {
  const taken = new Set<string>();
  return (parent, label, fallback) => {
    const base = [parent, slugify(label) || fallback].filter(Boolean).join("/");
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  };
}

/**
 * Top-level navigation is a list of groups. Runs of top-level pages and links,
 * which source frameworks show without a heading, become unlabelled groups.
 */
export function topLevelGroups(items: readonly NavigationItem[]): GroupConfig[] {
  const groups: GroupConfig[] = [];
  let loose: NavigationItem[] = [];
  const flush = () => {
    if (loose.length) groups.push({ group: "", id: `ungrouped-${groups.length + 1}`, pages: loose });
    loose = [];
  };
  for (const item of items) {
    if (typeof item === "object" && "group" in item) {
      flush();
      groups.push(item);
    } else loose.push(item);
  }
  flush();
  return groups;
}

/**
 * Source frameworks publish documents their navigation leaves out; native
 * publishes what navigation references. Each unlisted page joins the group of
 * its nearest listed sibling without a menu entry, so breadcrumbs stay right.
 */
export function placeUnlisted(groups: GroupConfig[], paths: readonly string[]): void {
  for (const path of paths) {
    const directory = path.split("/").slice(0, -1);
    let best: { group: GroupConfig; score: number } | undefined;
    const visit = (group: GroupConfig) => {
      for (const child of group.pages) {
        if (typeof child === "object" && "group" in child) {
          visit(child);
          continue;
        }
        const ref = typeof child === "string" ? child : "page" in child ? child.page : undefined;
        if (ref === undefined) continue;
        const parts = ref.split("/").slice(0, -1);
        let score = 0;
        while (score < Math.min(parts.length, directory.length) && parts[score] === directory[score]) score += 1;
        if (!best || score > best.score) best = { group, score };
      }
    };
    for (const group of groups) visit(group);
    const target = best?.group ?? groups[0];
    const reference = { page: path, hidden: true };
    if (target) target.pages.push(reference);
    else groups.push({ group: "", id: "unlisted", pages: [reference] });
  }
}

/** Every group in a navigation, nested ones included. */
export function* groupsOf(items: readonly NavigationItem[]): Generator<GroupConfig> {
  for (const item of items) {
    if (typeof item !== "object" || !("group" in item)) continue;
    yield item;
    yield* groupsOf(item.pages);
  }
}
