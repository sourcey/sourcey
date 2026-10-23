import type { generate } from "moxygen";
import type { DoxygenIndexStyle, ResolvedDoxygenConfig } from "../config.js";
import {
  DEFAULT_CALLOUTS,
  renderMarkdown,
  siteMarkdownOptions,
  extractHeadings,
  extractFirstParagraph,
  htmlText,
  stripMarkdownLinks,
  type CalloutRenderOptions,
  type MarkdownRenderOptions,
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

  // The source location line is metadata above the prose, never its summary.
  const firstParagraph = extractFirstParagraph(markdown.replace(/^Defined in [^\n]+$/gm, ""));
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

/** C++ written as prose, such as a lambda in a usage note, can read as a link; it is code. */
export function rewriteGeneratedDoxygenHtmlLinks(html: string): string {
  return html
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
      htmlText(inner) === page.title.trim() ? `${anchor ?? ""}<a id="${id}"></a>\n` : match,
  );

  const description = page.description ? htmlText(page.description) : "";
  if (description) {
    const firstSection = out.search(/<h[2-6][\s>]/);
    const head = firstSection === -1 ? out : out.slice(0, firstSection);
    const repeated = head
      .match(/<p>((?:(?!<\/p>)[\s\S])*)<\/p>\n?/g)
      ?.find((p) => htmlText(p) === description);
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
  callouts: CalloutRenderOptions = DEFAULT_CALLOUTS,
): Promise<DoxygenResult> {
  const markdownOptions = siteMarkdownOptions(callouts.icons, callouts.messages);
  let generated: Awaited<ReturnType<typeof generate>>;
  try {
    const { generate } = await import("moxygen");
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
  let globals: GroupEntry | undefined;

  for (const page of generated) {
    if (!page.markdown.trim()) continue;

    const markdown = rewriteGeneratedDoxygenMarkdown(page.markdown);
    const description = normalizeDoxygenDescription(page.description, markdown);
    const html = polishGeneratedDoxygenHtml(
      rewriteGeneratedDoxygenHtmlLinks(renderMarkdown(markdown, markdownOptions)),
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

    // Members at global scope belong to no module; their page sits beside the overview.
    if (page.kind === "globals") {
      globals = { slug: page.slug, title: page.title, kind: page.kind };
      continue;
    }

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
        href: "",
        id: p.slug,
        documentId: p.slug,
      })),
    });
  }

  if (!pages.size) {
    throw new Error(`Doxygen XML at ${config.xml} has nothing to publish: it documents no group, namespace, type or global member.`);
  }

  // Generate index page
  const indexStyle = resolveIndexStyle(config.index, groupMap, pages);
  const globalsItem: SiteNavItem[] = globals
    ? [{ label: globals.title, href: "", id: globals.slug, documentId: globals.slug }]
    : [];

  if (indexStyle !== "none") {
    const indexSlug = "index";
    const indexHtml = buildIndexHtml(indexStyle, tabSlug, tabLabel, groupMap, pages, markdownOptions, globals);
    const indexHeadings = indexStyle === "rich" ? [] : extractHeadings(indexHtml);
    // The index names the largest unit the reference is organised by. C and C++ share
    // moxygen's templates, so it names no language.
    const entries = [...groupMap.values()].flat();
    const extent = ([["module", ["group"]], ["type", ["class", "struct", "union", "interface"]], ["namespace", ["namespace"]]] as const)
      .map(([noun, kinds]) => ({ noun, count: entries.filter((entry) => (kinds as readonly string[]).includes(entry.kind)).length }))
      .find(({ count }) => count > 0);

    pages.set(indexSlug, {
      kind: "markdown",
      title: tabLabel,
      description: extent
        ? `API reference across ${extent.count} ${extent.noun}${extent.count === 1 ? "" : "s"}.`
        : "API reference.",
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
      items: [{ label: "Overview", href: "", id: indexSlug, documentId: indexSlug }, ...globalsItem],
    });
  } else if (globalsItem.length) {
    groups.unshift({ label: tabLabel, items: globalsItem });
  }

  // Navigation names each page; the site's routes give it its address.
  return {
    pages,
    navTab: {
      label: tabLabel,
      slug: tabSlug,
      href: "",
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
  markdown: MarkdownRenderOptions,
  globals?: GroupEntry,
): string {
  if (style === "rich") return buildRichIndex(groupMap, pages, globals);
  const lead = globals ? `### ${globals.title}\n\n- [${globals.title}](${globals.slug}.html): ${stripMarkdownLinks(pages.get(globals.slug)?.description ?? "")}\n\n` : "";
  if (style === "structured") return buildStructuredIndex(groupMap, pages, markdown, lead);
  return buildFlatIndex(groupMap, markdown, lead);
}

/**
 * Rich: card grid with module name, description, and type count.
 * Uses sourcey's card-group/card-item CSS.
 */
function buildRichIndex(
  groupMap: Map<string, GroupEntry[]>,
  pages: Map<string, MarkdownPage>,
  globals?: GroupEntry,
): string {
  const cards: string[] = [];

  const globalsPage = globals && pages.get(globals.slug);
  if (globals && globalsPage) {
    cards.push(
      `<a href="${globals.slug}.html" class="card-item">` +
        `<div class="card-item-inner">` +
        `<h2 class="card-item-title">${escHtml(globalsPage.title)}</h2>` +
        `<div class="card-item-content"><p>${inlineCode(escHtml(stripMarkdownLinks(globalsPage.description || "")))}</p></div>` +
        `</div></a>`,
    );
  }

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
        ? `<p class="card-item-meta">${typeCount} type${typeCount !== 1 ? "s" : ""}</p>`
        : "";

    cards.push(
      `<a href="${href}" class="card-item">` +
        `<div class="card-item-inner">` +
        `<h2 class="card-item-title">${escHtml(page.title)}</h2>` +
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
        `<h2 class="card-item-title">${escHtml(key)}</h2>` +
        `<div class="card-item-content"><p class="card-item-meta">${typeCount} type${typeCount !== 1 ? "s" : ""}</p></div>` +
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
  markdown: MarkdownRenderOptions,
  lead: string,
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

  return renderMarkdown(lead + sections.join("\n\n"), markdown);
}

/**
 * Flat: alphabetical list categorized by kind.
 */
function buildFlatIndex(groupMap: Map<string, GroupEntry[]>, markdown: MarkdownRenderOptions, lead: string): string {
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

  return renderMarkdown(lead + sections.join("\n\n"), markdown);
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
