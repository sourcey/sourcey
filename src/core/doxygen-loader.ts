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
  return (
    markdown
      .replace(
        /^#include ([<"])([^>\n"]+)([>"])$/gm,
        (_match, open: string, includePath: string, close: string) => {
          return `#include ${open}${rewriteGeneratedDoxygenIncludePath(includePath)}${close}`;
        },
      )
      // The include and the declaration read as one snippet, not two cards.
      .replace(/^```cpp\n(#include [^\n]+)\n```\n\n```cpp\n/m, "```cpp\n$1\n\n")
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

/** Member badges moxygen emits: access, specifiers and trailing qualifiers. */
const QUALIFIER =
  /^(?:public|protected|private|virtual|static|const|inline|explicit|nodiscard|constexpr|consteval|override|final|noexcept(?:\(.*\))?|&|&amp;|&&|&amp;&amp;|-&gt; .+)$/;

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function qualifierSpans(codes: string): string {
  return codes.replace(/<code>([^<]+)<\/code>/g, '<span class="api-qualifier">$1</span>');
}

/**
 * Shapes moxygen's generic Markdown into a reference page:
 * - the leading h1 repeats the page title the layout already shows, so it
 *   goes, keeping its anchor, and so does a body paragraph that repeats the
 *   description shown beneath the title;
 * - "Inherits" and "Subclassed by" become a relations list, not a quotation;
 * - "Defined in path:line" becomes a quiet metadata line;
 * - member badges (`virtual`, `const`) become quiet labels, in member
 *   sections and in table cells, rather than full code chips.
 */
export function polishGeneratedDoxygenHtml(
  html: string,
  page: { title: string; description?: string },
): string {
  let out = html.replace(
    /^\s*(<p><a id="[^"]+"><\/a><\/p>\n)?<h1 id="([^"]+)">([\s\S]*?)<\/h1>\n?/,
    (match, anchor: string | undefined, id: string, inner: string) =>
      plainText(inner) === page.title.trim() ? `${anchor ?? ""}<a id="${id}"></a>\n` : match,
  );

  const description = page.description ? plainText(page.description) : "";
  if (description) {
    const firstSection = out.search(/<h[2-6][\s>]/);
    const head = firstSection === -1 ? out : out.slice(0, firstSection);
    const repeated = head
      .match(/<p>((?:(?!<\/p>)[\s\S])*)<\/p>\n?/g)
      ?.find((p) => plainText(p) === description);
    if (repeated) out = out.replace(repeated, "");
  }

  out = out.replace(
    /<blockquote>\n<p>(<strong>[^<]+:<\/strong>[\s\S]*?)<\/p>\n<\/blockquote>/g,
    (match, body: string) => {
      const rows = [
        ...body.matchAll(
          /<strong>([^<]+):<\/strong>\s*([\s\S]*?)(?=\n?<strong>[^<]+:<\/strong>|$)/g,
        ),
      ];
      if (!rows.length) return match;
      return (
        '<dl class="api-relations">' +
        rows
          .map(([, label, value]) => `<div><dt>${label}</dt><dd>${value.trim()}</dd></div>`)
          .join("") +
        "</dl>"
      );
    },
  );

  out = out.replace(
    /<p>((?:<a [^>]*>)?Defined in [^<]+(?:<\/a>)?)<\/p>/g,
    '<p class="api-defined-in">$1</p>',
  );

  out = out.replace(/<p>((?:<code>[^<]+<\/code> ?)+)<\/p>/g, (match, codes: string) => {
    const labels = [...codes.matchAll(/<code>([^<]+)<\/code>/g)].map(([, label]) => label);
    return labels.every((label) => QUALIFIER.test(label))
      ? `<p class="api-qualifiers">${qualifierSpans(codes.trim())}</p>`
      : match;
  });

  return out.replace(
    /(<td>(?:<a [^>]*>)?<code>[^<]+<\/code>(?:<\/a>)?)((?: <code>[^<]+<\/code>)+)(?=<\/td>)/g,
    (match, name: string, badges: string) => {
      const labels = [...badges.matchAll(/<code>([^<]+)<\/code>/g)].map(([, label]) => label);
      return labels.every((label) => QUALIFIER.test(label)) ? name + qualifierSpans(badges) : match;
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
    throw new Error(`Failed to load Doxygen XML from ${config.xml}: ${message}`, { cause: error });
  }

  const pages = new Map<string, MarkdownPage>();
  const groupMap = new Map<string, GroupEntry[]>();

  for (const page of generated) {
    if (!page.markdown.trim()) continue;

    const markdown = rewriteGeneratedDoxygenMarkdown(page.markdown);
    const description = normalizeDoxygenDescription(page.description, markdown);
    const html = polishGeneratedDoxygenHtml(
      rewriteGeneratedDoxygenHtmlLinks(renderMarkdown(markdown)),
      { title: page.title, description },
    );
    const headings = extractHeadings(markdown);

    pages.set(page.slug, {
      kind: "markdown",
      title: page.title,
      description,
      slug: page.slug,
      html,
      markdown,
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
      items: sorted.map((p): SiteNavItem => ({
        label: p.kind === "group" ? "Overview" : p.title,
        href: `${tabSlug}/${p.slug}.html`,
        id: p.slug,
      })),
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
      markdown: [...pages.values()]
        .map(
          (page) =>
            `- [${page.title}](${page.slug}.html)${page.description ? `: ${page.description}` : ""}`,
        )
        .join("\n"),
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
          ? `<div class="card-item-content"><p>${inlineCode(escHtml(desc))}</p>${meta}</div>`
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

/** Render `code` spans in escaped text. */
function inlineCode(escaped: string): string {
  return escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
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
