import { generate } from "moxygen";
import type { DoxygenIndexStyle, ResolvedDoxygenConfig } from "../config.js";
import {
  renderMarkdown,
  extractHeadings,
  extractFirstParagraph,
  stripMarkdownLinks,
} from "../utils/markdown.js";
import type { MarkdownPage } from "./markdown-loader.js";
import type { SiteTab, SiteNavGroup, SiteNavItem } from "./navigation.js";

// ---------------------------------------------------------------------------
// Load Doxygen XML via Moxygen and produce MarkdownPage[]
// ---------------------------------------------------------------------------

export interface DoxygenResult {
  pages: Map<string, MarkdownPage>;
  navTab: SiteTab;
}

export function normalizeDoxygenDescription(description: string, markdown: string): string {
  if (!description) return "";
  if (!description.includes("{#ref ")) return stripMarkdownLinks(description);

  const firstParagraph = extractFirstParagraph(markdown);
  return stripMarkdownLinks(firstParagraph || description);
}

export function rewriteGeneratedDoxygenIncludePath(includePath: string): string {
  const normalized = includePath.replace(/\\/g, "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) {
    return includePath;
  }

  const includeMarker = "/include/";
  const includeIndex = normalized.lastIndexOf(includeMarker);
  if (includeIndex !== -1) {
    return normalized.slice(includeIndex + includeMarker.length);
  }

  const srcMarker = "/src/";
  const srcIndex = normalized.indexOf(srcMarker);
  if (srcIndex !== -1) {
    return normalized.slice(srcIndex + 1);
  }

  const basename = normalized.split("/").pop();
  return basename || includePath;
}

export function rewriteGeneratedDoxygenMarkdown(markdown: string): string {
  return markdown.replace(
    /^#include ([<"])([^>\n"]+)([>"])$/gm,
    (_match, open: string, includePath: string, close: string) => {
      return `#include ${open}${rewriteGeneratedDoxygenIncludePath(includePath)}${close}`;
    },
  );
}

export function rewriteGeneratedDoxygenHref(href: string): string {
  const [path, hash] = href.split("#", 2);
  if (!path.startsWith("api_") || !path.endsWith(".md")) return href;

  const slug = path.slice("api_".length, -".md".length).replace(/--/g, "-");

  return `${slug}.html${hash ? `#${hash}` : ""}`;
}

export function rewriteGeneratedDoxygenHtmlLinks(html: string): string {
  return html
    .replace(/href="(api_[^"]+?\.md(?:#[^"]*)?)"/g, (_match, href: string) => {
      return `href="${rewriteGeneratedDoxygenHref(href)}"`;
    })
    .replace(
      /<code>\[([^\]]+)\]\((api_[^)]+?\.md(?:#[^)]+)?)\)<\/code>/g,
      (_match, label: string, href: string) => {
        return `<a href="${rewriteGeneratedDoxygenHref(href)}"><code>${label}</code></a>`;
      },
    )
    .replace(/<a href="\[([^\]"]+)\]\([^"]+"><\/a>/g, (_match, label: string) => {
      return `<code>${label}</code>`;
    })
    .replace(
      /<a href="([A-Za-z][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+)">([^<]+)<\/a>/g,
      (_match, _href: string, label: string) => {
        return `<code>${label}</code>`;
      },
    );
}

export async function loadDoxygenTab(
  config: ResolvedDoxygenConfig,
  tabSlug: string,
  tabLabel: string,
  titleSeparator: string,
): Promise<DoxygenResult> {
  let generated: Awaited<ReturnType<typeof generate>>;
  try {
    generated = await generate({
      directory: config.xml,
      language: config.language,
      sourceUrl: config.sourceUrl,
      titleSeparator,
      quiet: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load Doxygen XML from ${config.xml}: ${message}`);
  }

  const pages = new Map<string, MarkdownPage>();
  const groupMap = new Map<string, GroupEntry[]>();

  for (const page of generated) {
    if (!page.markdown.trim()) continue;

    const markdown = rewriteGeneratedDoxygenMarkdown(page.markdown);
    const description = normalizeDoxygenDescription(page.description, markdown);
    const html = rewriteGeneratedDoxygenHtmlLinks(renderMarkdown(markdown));
    const headings = extractHeadings(markdown);

    pages.set(page.slug, {
      kind: "markdown",
      title: page.title,
      description,
      slug: page.slug,
      html,
      headings,
      sourcePath: `api/${page.slug}.md`,
      editPath: page.kind === "group" ? `api/${page.slug}.md` : null,
      searchEntries: page.searchEntries,
    });

    // Group by the last segment of namespace (e.g. "icy::http" -> "http")
    const groupKey = page.module ?? lastSegment(page.namespace) ?? "API";
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, []);
    }
    groupMap.get(groupKey)!.push({ slug: page.slug, title: page.title, kind: page.kind });
  }

  // Build navigation: namespace index pages first, then classes alphabetically
  const groups: SiteNavGroup[] = [];

  for (const [key, items] of groupMap) {
    const groupPage = items.find((i) => i.kind === "group");
    const label = groupPage?.title ?? key;
    const sorted = items.sort((a, b) => {
      if (a.kind === "group" && b.kind !== "group") return -1;
      if (a.kind !== "group" && b.kind === "group") return 1;
      if (a.kind === "namespace" && b.kind !== "namespace") return -1;
      if (a.kind !== "namespace" && b.kind === "namespace") return 1;
      return a.title.localeCompare(b.title);
    });

    groups.push({
      label,
      items: sorted.map(
        (p): SiteNavItem => ({
          label: p.kind === "group" ? "Overview" : p.title,
          href: `${tabSlug}/${p.slug}.html`,
          id: p.slug,
        }),
      ),
    });
  }

  // Generate index page
  const indexStyle = resolveIndexStyle(config.index, groupMap, pages);

  if (indexStyle !== "none") {
    const indexSlug = "index";
    const indexHtml = buildIndexHtml(indexStyle, tabSlug, tabLabel, groupMap, pages);
    const indexHeadings = indexStyle === "rich" ? [] : extractHeadings(indexHtml);

    pages.set(indexSlug, {
      kind: "markdown",
      title: tabLabel,
      description: "",
      slug: indexSlug,
      html: indexHtml,
      headings: indexHeadings,
      sourcePath: `api/${indexSlug}.md`,
      editPath: null,
    });

    groups.unshift({
      label: tabLabel,
      items: [{ label: "Overview", href: `${tabSlug}/${indexSlug}.html`, id: indexSlug }],
    });
  }

  const firstItem = groups[0]?.items[0];

  return {
    pages,
    navTab: {
      label: tabLabel,
      slug: tabSlug,
      href: firstItem?.href ?? `${tabSlug}/`,
      kind: "docs",
      groups,
    },
  };
}

// ---------------------------------------------------------------------------
// Index page generation
// ---------------------------------------------------------------------------

interface GroupEntry {
  slug: string;
  title: string;
  kind: string;
}

/**
 * Resolve "auto" to a concrete style based on the data we have.
 */
function resolveIndexStyle(
  configured: DoxygenIndexStyle,
  groupMap: Map<string, GroupEntry[]>,
  pages: Map<string, MarkdownPage>,
): Exclude<DoxygenIndexStyle, "auto"> {
  if (configured !== "auto") return configured;

  // Tiny projects — no index needed
  if (pages.size < 5) return "none";

  // Check if we have groups with descriptions
  const groupsWithDesc = [...groupMap.values()]
    .map((items) => items.find((i) => i.kind === "group"))
    .filter((g): g is GroupEntry => !!g)
    .filter((g) => pages.get(g.slug)?.description);

  if (groupsWithDesc.length >= 2) return "rich";

  // Check if we have meaningful grouping (multiple groups/namespaces)
  if (groupMap.size >= 2) return "structured";

  return "flat";
}

/**
 * Build index page HTML using sourcey's existing component markup.
 */
function buildIndexHtml(
  style: "rich" | "structured" | "flat",
  _tabSlug: string,
  _tabLabel: string,
  groupMap: Map<string, GroupEntry[]>,
  pages: Map<string, MarkdownPage>,
): string {
  if (style === "rich") return buildRichIndex(groupMap, pages);
  if (style === "structured") return buildStructuredIndex(groupMap, pages);
  return buildFlatIndex(groupMap);
}

/**
 * Rich: card grid with module name, description, and type count.
 * Uses sourcey's card-group/card-item CSS.
 */
function buildRichIndex(
  groupMap: Map<string, GroupEntry[]>,
  pages: Map<string, MarkdownPage>,
): string {
  const cards: string[] = [];

  for (const [, items] of groupMap) {
    const groupEntry = items.find((i) => i.kind === "group");
    if (!groupEntry) continue;

    const page = pages.get(groupEntry.slug);
    if (!page) continue;

    const typeCount = items.filter((i) => i.kind !== "group" && i.kind !== "namespace").length;
    const href = `${groupEntry.slug}.html`;
    const desc = stripMarkdownLinks(page.description || "");
    const meta =
      typeCount > 0
        ? `<p style="margin:0.5rem 0 0;font-size:0.8rem;opacity:0.5">${typeCount} type${typeCount !== 1 ? "s" : ""}</p>`
        : "";

    cards.push(
      `<a href="${href}" class="card-item">` +
        `<div class="card-item-inner">` +
        `<h3 class="card-item-title">${escHtml(page.title)}</h3>` +
        (desc
          ? `<div class="card-item-content"><p>${escHtml(desc)}</p>${meta}</div>`
          : `<div class="card-item-content">${meta}</div>`) +
        `</div></a>`,
    );
  }

  // Also include groups without a group page (orphan namespaces)
  for (const [key, items] of groupMap) {
    const hasGroup = items.some((i) => i.kind === "group");
    if (hasGroup) continue;

    const typeCount = items.filter((i) => i.kind !== "namespace").length;
    if (typeCount === 0) continue;
    const firstItem = items[0];
    const href = `${firstItem.slug}.html`;

    cards.push(
      `<a href="${href}" class="card-item">` +
        `<div class="card-item-inner">` +
        `<h3 class="card-item-title">${escHtml(key)}</h3>` +
        `<div class="card-item-content"><p style="margin:0;font-size:0.8rem;opacity:0.5">${typeCount} type${typeCount !== 1 ? "s" : ""}</p></div>` +
        `</div></a>`,
    );
  }

  if (cards.length === 0) return "";

  const cols = cards.length <= 2 ? "2" : "3";
  return `<div class="card-group not-prose" data-cols="${cols}">\n${cards.join("\n")}\n</div>`;
}

/**
 * Structured: grouped list of types by module/namespace.
 * Rendered as markdown headings with link lists.
 */
function buildStructuredIndex(
  groupMap: Map<string, GroupEntry[]>,
  pages: Map<string, MarkdownPage>,
): string {
  const sections: string[] = [];

  for (const [key, items] of groupMap) {
    const groupEntry = items.find((i) => i.kind === "group");
    const title = groupEntry ? (pages.get(groupEntry.slug)?.title ?? key) : key;
    const types = items.filter((i) => i.kind !== "group" && i.kind !== "namespace");
    if (types.length === 0 && !groupEntry) continue;

    const links: string[] = [];
    if (groupEntry) {
      links.push(`- [Overview](${groupEntry.slug}.html)`);
    }
    for (const t of types) {
      links.push(`- [${t.title}](${t.slug}.html)`);
    }

    sections.push(`### ${title}\n\n${links.join("\n")}`);
  }

  return renderMarkdown(sections.join("\n\n"));
}

/**
 * Flat: alphabetical list categorized by kind.
 */
function buildFlatIndex(groupMap: Map<string, GroupEntry[]>): string {
  const byKind = new Map<string, GroupEntry[]>();

  for (const [, items] of groupMap) {
    for (const item of items) {
      if (item.kind === "group" || item.kind === "namespace") continue;
      const label = kindLabel(item.kind);
      if (!byKind.has(label)) byKind.set(label, []);
      byKind.get(label)!.push(item);
    }
  }

  const sections: string[] = [];
  for (const [label, items] of byKind) {
    const sorted = items.sort((a, b) => a.title.localeCompare(b.title));
    const links = sorted.map((i) => `- [${i.title}](${i.slug}.html)`).join("\n");
    sections.push(`### ${label}\n\n${links}`);
  }

  return renderMarkdown(sections.join("\n\n"));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function lastSegment(name?: string): string | undefined {
  if (!name) return undefined;
  const parts = name.split("::");
  return parts[parts.length - 1] || name;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "class":
      return "Classes";
    case "struct":
      return "Structs";
    case "enum":
      return "Enums";
    case "union":
      return "Unions";
    case "typedef":
      return "Type Aliases";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1) + "s";
  }
}
