import { decodeHTML } from "entities";
import { slug as githubSlug } from "github-slugger";
import { Marked, Lexer, type Links, type Token, type Tokens } from "marked";
import { highlightCode } from "./highlighter.js";
import { COPY_ICON_SVG } from "./copy-svg.js";
import { slugify } from "./slug.js";
import { escapeAttr, escapeHtml, safeUrl, sanitizeRenderedHtml } from "./html.js";
import { ALERT, CALLOUTS, alertBody, alertCallout, renderCallout } from "./callouts.js";
import { english, type UiMessages } from "../core/messages.js";
import type { IconSet } from "../config.js";

/**
 * Shared code block renderer used by all markdown rendering.
 * Outputs the prose-code-block wrapper with copy button and Shiki highlighting.
 */
export interface CodeFenceMetadata {
  language: string;
  title?: string;
  highlight: number[];
  focus: number[];
  add: number[];
  remove: number[];
}
export function parseCodeFenceInfo(info = ""): CodeFenceMetadata {
  const metadata: CodeFenceMetadata = { language: "", highlight: [], focus: [], add: [], remove: [] };
  let remaining = info.trim();
  const language = remaining.match(/^[\w+#.-]+/);
  if (language) { metadata.language = language[0]; remaining = remaining.slice(language[0].length).trimStart(); }
  function lines(value: string): number[] {
    const result = new Set<number>();
    for (const range of value.split(",")) {
      const match = range.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!match) throw new Error(`Invalid code line range: ${range}`);
      const start = Number(match[1]), end = Number(match[2] ?? match[1]);
      if (start < 1 || end < start || end - start > 10000) throw new Error(`Invalid code line range: ${range}`);
      for (let line = start; line <= end; line++) result.add(line);
    }
    return [...result];
  }
  const used = new Set<string>();
  while (remaining) {
    const title = remaining.match(/^title=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
    const annotation = remaining.match(/^(?:(highlight|focus|add|remove)=)?\{([^}]+)\}/);
    const key = title ? "title" : annotation ? annotation[1] ?? "highlight" : undefined;
    if (!key) throw new Error(`Unknown code metadata: ${remaining}`);
    if (used.has(key)) throw new Error(`Duplicate code metadata: ${key}`);
    used.add(key);
    if (title) { metadata.title = title[1].slice(1, -1).replace(/\\(["'\\])/g, "$1"); remaining = remaining.slice(title[0].length).trimStart(); }
    else { metadata[key as "highlight" | "focus" | "add" | "remove"] = lines(annotation![2]); remaining = remaining.slice(annotation![0].length).trimStart(); }
  }
  return metadata;
}
export function renderCodeBlock(text: string, info?: string, metadata = parseCodeFenceInfo(info), copyLabel = "Copy code"): string {
  const lineCount = text.split("\n").length;
  for (const line of [...metadata.highlight, ...metadata.focus, ...metadata.add, ...metadata.remove]) if (line > lineCount) throw new Error(`Code annotation refers to missing line ${line}`);
  const shiki = highlightCode(text, metadata.language, metadata);
  // A block names its language, so a theme can label it.
  const language = metadata.language ? ` data-language="${escapeAttr(metadata.language.toLowerCase())}"` : "";
  return `<div class="prose-code-block not-prose"${language}>${metadata.title ? `<div class="prose-code-title">${escapeHtml(metadata.title)}</div>` : ""}
<div class="prose-code-copy"><button aria-label="${escapeAttr(copyLabel)}" class="copy-btn" type="button" data-copy-source="code">${COPY_ICON_SVG}</button></div>
<div class="prose-code-content">${shiki}</div>
</div>`;
}

/** Heading info collected during render. */
export interface PageHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/* ── Shared directive helpers ─────────────────────────────────────── */

function parseDirectiveAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, k, v] of raw.matchAll(/(\w+)="([^"]*)"/g)) attrs[k] = v;
  return attrs;
}

/* ── Video directive ──────────────────────────────────────────────── */

interface VideoToken extends Tokens.Generic {
  type: "video";
  raw: string;
  url: string;
  title: string;
}

function parseVideoUrl(
  url: string,
): { src: string; type: "iframe" | "video"; mime?: string } | null {
  const webUrl = safeUrl(url, {
    allowedProtocols: ["http:", "https:"],
    allowRelative: false,
    allowAnchor: false,
  });
  if (webUrl) {
    const parsed = new URL(webUrl);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      const id = parsed.searchParams.get("v");
      if (id && /^[\w-]+$/.test(id)) {
        return { src: `https://www.youtube-nocookie.com/embed/${id}`, type: "iframe" };
      }
    }
    if (hostname === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id && /^[\w-]+$/.test(id)) {
        return { src: `https://www.youtube-nocookie.com/embed/${id}`, type: "iframe" };
      }
    }
    if (hostname === "vimeo.com" || hostname.endsWith(".vimeo.com")) {
      const id = parsed.pathname
        .split("/")
        .filter(Boolean)
        .find((segment) => /^\d+$/.test(segment));
      if (id) return { src: `https://player.vimeo.com/video/${id}`, type: "iframe" };
    }
  }

  const rawVideoUrl = safeUrl(url, {
    allowedProtocols: ["http:", "https:"],
    allowRelative: true,
    allowAnchor: false,
  });
  if (!rawVideoUrl) return null;
  const ext = rawVideoUrl.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
  const mime = ext === "webm" ? "video/webm" : "video/mp4";
  return { src: rawVideoUrl, type: "video", mime };
}

/**
 * Where a block extension begins in the paragraph at the start of src. marked
 * asks so it can end that paragraph early, and a paragraph ends at the next
 * blank line regardless, so the search stops there rather than scanning the
 * rest of the document at every paragraph. `lineStart` finds the marker only
 * where a line begins.
 */
function blockStart(src: string, marker: string, lineStart = false): number | undefined {
  const blank = src.indexOf("\n\n");
  const paragraph = blank === -1 ? src : src.slice(0, blank);
  if (lineStart && paragraph.startsWith(marker)) return 0;
  const index = paragraph.indexOf(lineStart ? `\n${marker}` : marker);
  return index === -1 ? undefined : index + (lineStart ? 1 : 0);
}

/**
 * Visit every token of a lexed document, each before its children, as marked's
 * walkTokens does, but without growing an array per token, which made a large
 * document's walk quadratic.
 */
export function forEachToken(tokens: readonly Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token);
    if (token.type === "table") {
      const table = token as Tokens.Table;
      for (const cell of table.header) forEachToken(cell.tokens, visit);
      for (const row of table.rows) for (const cell of row) forEachToken(cell.tokens, visit);
    } else if (token.type === "list") forEachToken((token as Tokens.List).items, visit);
    else {
      const children = (token as Tokens.Generic).tokens;
      if (children) forEachToken(children, visit);
    }
  }
}

const videoExtension: import("marked").MarkedExtension = {
  extensions: [
    {
      name: "video",
      level: "block",
      start(src: string) {
        return blockStart(src, "::video[");
      },
      tokenizer(src: string): VideoToken | undefined {
        const match = src.match(/^::video\[([^\]]+)\](?:\{([^}]*)\})?/);
        if (!match) return undefined;
        const attrs = parseDirectiveAttrs(match[2] ?? "");
        return { type: "video", raw: match[0], url: match[1], title: attrs.title ?? "" };
      },
      renderer(token: Tokens.Generic): string {
        const { url, title } = token as VideoToken;
        const parsed = parseVideoUrl(url);
        if (!parsed) return `<p>[video: invalid URL]</p>\n`;
        const safeTitle = escapeAttr(title);
        if (parsed.type === "iframe") {
          return `<div class="prose-video not-prose">
<iframe src="${escapeAttr(parsed.src)}" title="${safeTitle}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
</div>\n`;
        }
        return `<div class="prose-video not-prose">
<video controls preload="metadata" title="${safeTitle}">
<source src="${escapeAttr(parsed.src)}" type="${escapeAttr(parsed.mime ?? "video/mp4")}" />
</video>
</div>\n`;
      },
    },
  ],
};

/* ── Iframe directive ─────────────────────────────────────────────── */

interface IframeToken extends Tokens.Generic {
  type: "iframe";
  raw: string;
  url: string;
  title: string;
  height: number;
}

const iframeExtension: import("marked").MarkedExtension = {
  extensions: [
    {
      name: "iframe",
      level: "block",
      start(src: string) {
        return blockStart(src, "::iframe[");
      },
      tokenizer(src: string): IframeToken | undefined {
        const match = src.match(/^::iframe\[([^\]]+)\](?:\{([^}]*)\})?/);
        if (!match) return undefined;
        const attrs = parseDirectiveAttrs(match[2] ?? "");
        const height = parseInt(attrs.height ?? "", 10);
        return {
          type: "iframe",
          raw: match[0],
          url: match[1],
          title: attrs.title ?? "",
          height: Number.isFinite(height) ? height : 400,
        };
      },
      renderer(token: Tokens.Generic): string {
        const { url, title, height } = token as IframeToken;
        const iframeUrl = safeUrl(url, {
          allowedProtocols: ["http:", "https:"],
          allowRelative: false,
          allowAnchor: false,
        });
        if (!iframeUrl) return `<p>[iframe: invalid URL]</p>\n`;
        return `<div class="prose-iframe not-prose" style="height:${height}px">
<iframe src="${escapeAttr(iframeUrl)}" title="${escapeAttr(title)}" frameborder="0" loading="lazy" allowfullscreen></iframe>
</div>\n`;
      },
    },
  ],
};

/** How GitHub alerts render: the site's icon set and its locale's callout titles. */
export interface CalloutRenderOptions {
  icons: IconSet;
  messages: UiMessages;
}

/** A GitHub alert (`> [!NOTE]` and its quoted lines) renders as the native callout; other blockquotes stay blockquotes. */
function alertExtension(callouts: CalloutRenderOptions): import("marked").MarkedExtension {
  return {
    extensions: [
      {
        name: "alert",
        level: "block",
        start: (src: string) => blockStart(src, "> [!", true),
        tokenizer(src: string) {
          const match = src.match(ALERT);
          if (!match) return undefined;
          const token = { type: "alert", raw: match[0], alert: match[1], tokens: [] as Token[] };
          this.lexer.blockTokens(alertBody(match[2]), token.tokens);
          return token;
        },
        renderer(token: Tokens.Generic): string {
          const { kind, title } = alertCallout(token.alert, callouts.messages);
          return `${renderCallout(kind, { title: escapeHtml(title ?? callouts.messages[CALLOUTS[kind].label]), content: this.parser.parse(token.tokens ?? []), icons: callouts.icons })}\n`;
        },
      },
    ],
  };
}

/** Callouts outside a site: Heroicons and English titles. */
export const DEFAULT_CALLOUTS: CalloutRenderOptions = { icons: "heroicons", messages: english };

const PLAIN: MarkdownRenderOptions = {};
const siteOptions = new WeakMap<MarkdownRenderOptions, WeakMap<UiMessages, Partial<Record<IconSet, MarkdownRenderOptions>>>>();

/**
 * Render options for a site's Markdown: its callouts over a renderer's own
 * options, one object per combination so each parser is built once.
 */
export function siteMarkdownOptions(icons: IconSet, messages: UiMessages, base: MarkdownRenderOptions = PLAIN): MarkdownRenderOptions {
  const byMessages = siteOptions.get(base) ?? new WeakMap<UiMessages, Partial<Record<IconSet, MarkdownRenderOptions>>>();
  siteOptions.set(base, byMessages);
  const byIcons = byMessages.get(messages) ?? {};
  byMessages.set(messages, byIcons);
  return (byIcons[icons] ??= { ...base, callouts: { icons, messages } });
}

export interface MarkdownRenderOptions {
  /** Alerts without options draw Heroicons with English titles. */
  callouts?: CalloutRenderOptions;
  copyLabel?: string;
  code?: (token: Tokens.Code) => string;
  headingOffset?: number;
  headingPrefix?: string;
  /**
   * Maps a link destination to its URL: a string replaces it, null renders the
   * link's text alone, undefined keeps the destination as written.
   */
  resolveHref?: (href: string) => string | null | undefined;
  /** Keep `operation:` destinations for the build to point at the operation's published address. */
  operationLinks?: boolean;
}

/**
 * Whether the Markdown being rendered holds HTML its author wrote. Everything
 * else a parser writes is escaped as it is written, with its links and images
 * checked, so only authored HTML needs the sanitizer.
 */
let authoredHtml = false;

/**
 * HTML the build drew itself, such as a heading, highlighted code or a
 * component, stands in the Markdown rendered around it as a marker that
 * renders as that HTML. The Markdown still reads as one document, but the
 * build's own HTML is never read again as Markdown, or sanitized as an
 * author's would be.
 */
let generatedHtml: readonly string[] = [];
const GENERATED_OPEN = "\uE000", GENERATED_CLOSE = "\uE001";
// A block marker may open its line with up to three spaces, as a component written in a list item's text does.
const GENERATED_BLOCK = /^ {0,3}\uE000(\d+)\uE001(?:\n+|$)/;
const GENERATED_BLOCK_START = /(^|\n) {0,3}\uE000\d+\uE001(?:\n|$)/;
const GENERATED_INLINE = /^\uE000(\d+)\uE001/;
const GENERATED_MARKER = /\uE000(\d+)\uE001/g;

/** The marker for the `index`th piece of generated HTML passed to `renderMarkdown`. */
export function generatedMarker(index: number): string {
  return `${GENERATED_OPEN}${index}${GENERATED_CLOSE}`;
}

/** Authored text keeps any marker characters it holds as characters. */
export function escapeGeneratedMarkers(markdown: string): string {
  return /[\uE000\uE001]/.test(markdown) ? markdown.replace(/[\uE000\uE001]/g, (char) => `&#x${char.charCodeAt(0).toString(16)};`) : markdown;
}

interface GeneratedToken extends Tokens.Generic { index: number }
const generatedExtension = {
  extensions: [
    {
      name: "generated",
      level: "block" as const,
      // A block marker stands on a line of its own; one inside a sentence is inline.
      start: (src: string) => { const match = GENERATED_BLOCK_START.exec(src); return match ? match.index + match[1].length : undefined; },
      tokenizer(src: string) {
        const match = GENERATED_BLOCK.exec(src);
        if (match) return { type: "generated", raw: match[0], index: Number(match[1]) };
      },
      renderer: (token: Tokens.Generic) => generatedHtml[(token as GeneratedToken).index] ?? "",
    },
    {
      name: "generatedInline",
      level: "inline" as const,
      start: (src: string) => { const at = src.indexOf(GENERATED_OPEN); return at < 0 ? undefined : at; },
      tokenizer(src: string) {
        const match = GENERATED_INLINE.exec(src);
        if (match) return { type: "generatedInline", raw: match[0], index: Number(match[1]) };
      },
      renderer: (token: Tokens.Generic) => generatedHtml[(token as GeneratedToken).index] ?? "",
    },
  ],
};

/** Keep adapter rendering on the same Markdown, links and sanitization path. */
function createMarkdownParser(options: MarkdownRenderOptions = {}): Marked {
  return new Marked(generatedExtension, videoExtension, iframeExtension, alertExtension(options.callouts ?? DEFAULT_CALLOUTS), {
    walkTokens(token: Token) {
      if (token.type === "html") authoredHtml = true;
    },
    renderer: {
      code(token: Tokens.Code): string {
        return options.code ? options.code(token) : renderCodeBlock(token.text, token.lang, undefined, options.copyLabel);
      },
      heading({ tokens, depth, text }: Tokens.Heading): string {
        const explicit = text.match(/\s+\{#([^}]+)\}\s*$/);
        if (explicit) tokens = Lexer.lexInline(text.slice(0, explicit.index));
        const id = `${options.headingPrefix ?? ""}${explicit?.[1] ?? slugify(headingSource(tokens))}`;
        const level = Math.min(6, depth + (options.headingOffset ?? 0));
        return `<h${level} id="${escapeAttr(id)}">${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      table(token: Tokens.Table): string {
        // A header row's empty corner heads nothing, so it is a plain cell.
        const header = token.header
          .map((cell) => cell.text.trim() ? `<th>${this.parser.parseInline(cell.tokens)}</th>` : "<td></td>")
          .join("");
        const body = token.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`,
          )
          .join("\n");
        return `<div class="table-wrap" tabindex="0"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
      },
      html(token: Tokens.HTML | Tokens.Tag): string {
        // A component written inside an author's HTML, such as an icon in a <div>, stands there as its marker.
        return (token.block ? wrapAuthoredTables(token.text) : token.text).replace(GENERATED_MARKER, (_, index: string) => generatedHtml[Number(index)] ?? "");
      },
      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        const resolved = options.resolveHref?.(href);
        if (resolved === null) return text;
        const linkUrl = options.operationLinks ? pageLinkHref(resolved ?? href) : safeUrl(resolved ?? href);
        if (!linkUrl) return text;
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        const isExternal = linkUrl.startsWith("http://") || linkUrl.startsWith("https://");
        const target = isExternal ? ' target="_blank" rel="noopener"' : "";
        return `<a href="${escapeAttr(linkUrl)}"${titleAttr}${target}>${text}</a>`;
      },
      image({ href, title, text, tokens }: Tokens.Image): string {
        const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
        // An image from anywhere but the web or this site keeps its text alone, as a link does.
        const src = safeUrl(href, { allowedProtocols: ["http:", "https:"], allowAnchor: false });
        if (!src) return escapeHtml(alt);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${titleAttr}>`;
      },
    },
  });
}

/**
 * An author's tables in a block of HTML scroll in place, as a Markdown
 * table does, where the page is narrower than they are. A block whose table
 * does not close within it is left as written.
 */
function wrapAuthoredTables(html: string): string {
  if (!/<table[\s>]/i.test(html)) return html;
  let wrapped = "", depth = 0, from = 0;
  for (const tag of html.matchAll(/<(\/?)table\b[^>]*>/gi)) {
    if (!tag[1]) {
      if (depth++ === 0) {
        wrapped += `${html.slice(from, tag.index)}<div class="table-wrap" tabindex="0">`;
        from = tag.index;
      }
    } else if (depth > 0 && --depth === 0) {
      const end = tag.index + tag[0].length;
      wrapped += `${html.slice(from, end)}</div>`;
      from = end;
    }
  }
  return depth ? html : wrapped + html.slice(from);
}

/** Render, sanitizing only where an author's own HTML is in what was rendered. */
function rendered(render: () => string, operationLinks: boolean | undefined, generated: readonly string[] = []): string {
  const outer = authoredHtml, outerGenerated = generatedHtml;
  authoredHtml = false;
  generatedHtml = generated;
  try {
    const html = render();
    return authoredHtml ? sanitizeRenderedHtml(html, operationLinks ? ["operation"] : []) : html;
  } finally {
    // A nested render, such as a component's content, leaves its parent's as it was.
    authoredHtml = outer;
    generatedHtml = outerGenerated;
  }
}

const marked = createMarkdownParser();

/**
 * Lex markdown into tokens using the shared Sourcey Marked instance.
 * This keeps directive support and heading parsing aligned with rendering.
 * `definitions`, a page's reference link definitions, are read with a part
 * of it lexed alone, so its `[text][name]` links resolve as on the page.
 */
export function lexMarkdown(input?: string, definitions?: Links): Token[] {
  if (!input) return [];
  if (!definitions) return marked.lexer(input);
  const lexer = new Lexer(marked.defaults);
  Object.assign(lexer.tokens.links, definitions);
  return lexer.lex(input);
}

/**
 * Lex a document's blocks now, and a block's inline content only when
 * `inline` asks for it: what finds a page's first heading and paragraph,
 * without reading the rest of its prose.
 */
export function lexBlocks(input: string): { tokens: Token[]; inline(token: Token): void } {
  const lexer = new Lexer(marked.defaults);
  const tokens = lexer.blockTokens(input.replace(/\r\n|\r/g, "\n"), lexer.tokens);
  const queued = new Map(lexer.inlineQueue.map(({ src, tokens }) => [tokens, src]));
  lexer.inlineQueue = [];
  return {
    tokens,
    inline(token) {
      const children = (token as { tokens?: Token[] }).tokens, src = children && queued.get(children);
      if (src === undefined) return;
      queued.delete(children!);
      lexer.inlineTokens(src, children);
    },
  };
}

/**
 * A heading's source text: nested link and emphasis tokens contribute their
 * own text, so a linked code span reads `Stateful`, not `` `Stateful` ``.
 * Heading ids derive from it, so it keeps inline HTML and entities as written.
 */
function headingSource(tokens: Token[]): string {
  return tokens
    .map((token) => {
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested?.length) return headingSource(nested);
      return "text" in token ? (token as { text: string }).text : token.raw;
    })
    .join("");
}

/**
 * Inline Markdown's text as a reader sees it, for a table of contents, a title
 * or a search entry: inline HTML tags dropped, entities decoded, and code as
 * written, since a code span shows its entities as text.
 */
export function inlineText(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "html") return "";
      if (token.type === "codespan") return (token as Tokens.Codespan).text;
      if (token.type === "br") return " ";
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested?.length) return inlineText(nested);
      return decodeEntities("text" in token ? (token as { text: string }).text : token.raw);
    })
    .join("");
}

/**
 * A fragment of rendered HTML as a reader reads it, where only the HTML is at
 * hand, as when a drawn heading is compared with a title: tags dropped,
 * entities decoded, spaces collapsed.
 */
export function htmlText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Decode readable HTML entities through the same standards-complete owner. */
export const decodeEntities = decodeHTML;

export function headingInfo(heading: Tokens.Heading) {
  const explicit = heading.text.match(/\s+\{#([^}]+)\}\s*$/);
  const markdown = explicit ? heading.text.slice(0, explicit.index) : heading.text;
  const inline = Lexer.lexInline(markdown);
  const text = inlineText(inline);
  const source = headingSource(inline);
  const id = explicit?.[1] ?? (githubSlug(text) || "section");
  return { id, text, markdown, explicit: !!explicit, previousId: slugify(source) };
}

/**
 * Extract h2/h3 headings from a markdown string by lexing the token tree.
 * No rendering needed; pure token walk.
 */
export function extractHeadings(input: string): PageHeading[] {
  const tokens = lexMarkdown(input);
  const headings: PageHeading[] = [];
  for (const token of tokens) {
    if (token.type === "heading") {
      const depth = (token as Tokens.Heading).depth;
      if (depth === 2 || depth === 3) {
        const heading = token as Tokens.Heading;
        const explicit = heading.text.match(/\s+\{#([^}]+)\}\s*$/);
        const text = inlineText(heading.tokens).replace(/\s+\{#[^}]+\}\s*$/, "");
        headings.push({ level: depth as 2 | 3, text, id: explicit?.[1] ?? slugify(headingSource(heading.tokens)) });
      }
    }
  }
  return headings;
}

/** Plain text of the first top-level heading at `depth`, if there is one, in Markdown or its tokens. */
export function firstHeadingText(input: string | Token[], depth: number): string | undefined {
  const heading = (typeof input === "string" ? lexMarkdown(input) : input).find(
    (token): token is Tokens.Heading => token.type === "heading" && token.depth === depth,
  );
  return heading ? headingInfo(heading).text.trim() || undefined : undefined;
}

/**
 * The summary text of the first paragraph that has any, in Markdown or its
 * tokens, for a page's description when it sets none. `inline` reads a
 * paragraph's inline content where the tokens left it unread.
 */
export function extractFirstParagraph(input?: string | Token[], inline?: (token: Token) => void): string {
  if (!input) return "";
  for (const token of typeof input === "string" ? lexMarkdown(input) : input) {
    if (token.type === "paragraph") {
      inline?.(token);
      // A row of badges or navigation links, joined by separators such as
      // &ensp; or ·, has no prose of its own and is not a summary.
      const prose = textOutsideLinks(token.tokens ?? []).replace(/&#?\w+;/g, "");
      const summary = summaryText(token.tokens ?? []).replace(/\s+/g, " ").trim();
      // A paragraph ending in a colon ("See also:") introduces the block after it, not the page.
      if (/[\p{L}\p{N}]/u.test(prose) && !summary.endsWith(":")) return summary;
    }
  }
  return "";
}

function textOutsideLinks(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "link" || token.type === "image" || token.type === "html") return "";
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested) return textOutsideLinks(nested);
      return "text" in token ? (token as { text: string }).text : "";
    })
    .join("");
}

/**
 * A paragraph as summary text: code spans and links kept as Markdown, emphasis
 * reduced to its text. Images and inline HTML drop out, since a logo's alt text
 * or a row of badges never describes the page.
 */
function summaryText(tokens: Token[]): string {
  // Inline HTML arrives one tag per token: a script, style or template hides
  // the tokens until it closes, and a <br> is a space.
  let hidden = 0;
  return tokens
    .map((token) => {
      if (token.type === "html") {
        const was = hidden;
        hidden = Math.max(0, hidden + (token.raw.match(/<(script|style|template)\b/gi)?.length ?? 0) - (token.raw.match(/<\/(script|style|template)\b/gi)?.length ?? 0));
        return !was && !hidden && /^<br\b/i.test(token.raw) ? " " : "";
      }
      if (hidden) return "";
      if (token.type === "codespan") return token.raw;
      if (token.type === "image") return "";
      if (token.type === "br") return " ";
      if (token.type === "link") {
        const label = summaryText(token.tokens ?? []).trim();
        return label ? `[${label}](${token.href})` : "";
      }
      const nested = (token as { tokens?: Token[] }).tokens;
      if (nested) return summaryText(nested);
      return "text" in token ? (token as { text: string }).text : token.raw;
    })
    .join("");
}

/**
 * Replace markdown links with their visible labels.
 * Useful when rendering inside an existing clickable container.
 */
export function stripMarkdownLinks(input?: string): string {
  if (!input) return "";
  let output = "";
  let index = 0;

  while (index < input.length) {
    const isImage = input[index] === "!" && input[index + 1] === "[";
    const isLink = input[index] === "[";
    const labelStart = isImage ? index + 2 : isLink ? index + 1 : -1;

    if (labelStart !== -1) {
      const labelEnd = findMarkdownLabelEnd(input, labelStart);
      if (labelEnd !== -1 && input[labelEnd + 1] === "(") {
        const hrefEnd = findMarkdownHrefEnd(input, labelEnd + 2);
        if (hrefEnd !== -1) {
          output += input.slice(labelStart, labelEnd);
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    output += input[index];
    index += 1;
  }

  return output;
}

function findMarkdownLabelEnd(input: string, start: number): number {
  let inCode = false;
  for (let i = start; i < input.length; i += 1) {
    const char = input[i];
    if (char === "`") inCode = !inCode;
    if (char === "\n") return -1;
    if (char === "]" && !inCode) return i;
  }
  return -1;
}

function findMarkdownHrefEnd(input: string, start: number): number {
  for (let i = start; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\n") return -1;
    if (char === ")") return i;
  }
  return -1;
}

const parsersByOptions = new WeakMap<MarkdownRenderOptions, Marked>();

/** The parser for a set of options: a shared options object, such as an adapter's, builds its parser once. */
function markdownParser(options?: MarkdownRenderOptions): Marked {
  if (!options) return marked;
  let parser = parsersByOptions.get(options);
  if (!parser) parsersByOptions.set(options, (parser = createMarkdownParser(options)));
  return parser;
}

/**
 * Render Markdown to HTML. `generated` is HTML the build drew, placed in
 * `input` by `generatedMarker`.
 */
export function renderMarkdown(input?: string, options?: MarkdownRenderOptions, generated?: readonly string[]): string {
  if (!input) return "";
  const parser = markdownParser(options);
  return rendered(() => parser.parse(input, { async: false }) as string, options?.operationLinks, generated);
}

/** A page's link to an operation by name, as navigation names one: `operation:GET /pets`. */
export const OPERATION_LINK = "operation:";
/** Rendering for a page's own content, whose links the build resolves once routes exist. */
export const PAGE_CONTENT: MarkdownRenderOptions = { operationLinks: true };

/** A page's link destination: an operation by name, kept for the build, or a safe URL. */
export function pageLinkHref(value: string): string | null {
  return value.startsWith(OPERATION_LINK) ? encodeURI(value) : safeUrl(value);
}

/**
 * Render Markdown to inline HTML (strip wrapping <p> tags).
 */
export function renderMarkdownInline(input?: string, options?: MarkdownRenderOptions): string {
  return input ? renderInlineMarkdown(input, options).html : "";
}

/**
 * Inline Markdown rendered from one lexing, with the tokens it was rendered
 * from, so its text is read with `inlineText` rather than taken back out of
 * the HTML. The steps are Marked's own `parseInline`: lex, walk, render.
 */
export function renderInlineMarkdown(input: string, options?: MarkdownRenderOptions): { html: string; tokens: Token[] } {
  const parser = markdownParser(options);
  const settings = { ...parser.defaults };
  const tokens = parser.Lexer.lexInline(input, settings);
  const html = rendered(() => {
    if (settings.walkTokens) parser.walkTokens(tokens, settings.walkTokens);
    return parser.Parser.parseInline(tokens, settings);
  }, options?.operationLinks);
  return { html, tokens };
}
