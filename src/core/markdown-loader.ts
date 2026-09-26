import { readFile as readFileAsync } from "node:fs/promises";
import { basename, extname, relative } from "node:path";
import { load as parseYaml } from "js-yaml";
import { normalizeChangelog } from "./changelog-normalizer.js";
import { htmlId } from "../utils/html-id.js";
import { escapeAttr, safeUrl } from "../utils/html.js";
import { renderIcon } from "../utils/icons.js";
import {
  renderCodeBlock,
  renderMarkdown,
  renderMarkdownInline,
  extractHeadings,
  extractFirstParagraph,
  stripMarkdownLinks,
  type PageHeading,
} from "../utils/markdown.js";
import type { NormalizedChangelog } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarkdownPage {
  kind: "markdown";
  /** Page title from frontmatter */
  title: string;
  /** Page description from frontmatter */
  description: string;
  /** Short navigation label, independent of the article title. */
  navTitle?: string;
  /** URL slug for this page (derived from filename) */
  slug: string;
  /** Rendered HTML body */
  html: string;
  /** Extracted h2/h3 headings for table of contents */
  headings: PageHeading[];
  /** Original file path (for error messages and dev server watching) */
  sourcePath: string;
  /** Optional repo-relative path used for "Edit this page" links. Null disables the link. */
  editPath?: string | null;
  /** Optional base path override for this page's edit link. Undefined uses the site default. */
  editBasePath?: string | null;
  /** Optional page-local entries that should be indexed in addition to headings. */
  searchEntries?: PageSearchEntry[];
  /** Optional source root used to rewrite source-format-relative assets. */
  sourceRoot?: string;
}

export interface PageSearchEntry {
  title: string;
  content: string;
  anchor?: string;
  category: string;
  symbolKind?: string;
  owner?: string;
  ownerKind?: string;
  namespace?: string;
  qualifiedName?: string;
}

export interface ChangelogPage {
  kind: "changelog";
  title: string;
  description: string;
  slug: string;
  headings: PageHeading[];
  sourcePath: string;
  editPath?: string | null;
  changelog: NormalizedChangelog;
  rawBody: string;
  /** Set on generated per-version pages; undefined for the full changelog page. */
  permalinkVersionId?: string;
}

export type DocsPage = MarkdownPage | ChangelogPage;

export type { PageHeading } from "../utils/markdown.js";

interface Frontmatter {
  title?: string;
  description?: string;
  order?: number;
  navTitle?: string;
  layout?: string;
  [key: string]: unknown;
}

export interface LoadDocsPageOptions {
  changelog?: boolean;
  repoUrl?: string;
  sourceRoot?: string;
  preprocess?: MarkdownPreprocessor[];
}

export interface MarkdownPreprocessContext {
  filePath: string;
  sourceRoot?: string;
}

export type MarkdownPreprocessor = (body: string, context: MarkdownPreprocessContext) => string;

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const meta = (parseYaml(match[1]) as Frontmatter) ?? {};
  return { meta, body: match[2] };
}

const FENCED_BLOCK_TOKEN = "@@SOURCEY_FENCED_BLOCK_";
const INLINE_CODE_TOKEN = "@@SOURCEY_INLINE_CODE_";

/** Current page's protected fence blocks — used to restore placeholders in JSX children. */
let activeFenceBlocks: string[] = [];
/** Current page's protected inline code spans — used to restore placeholders in JSX children. */
let activeInlineSpans: string[] = [];

function protectFencedCodeBlocks(input: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const output: string[] = [];
  const lines = input.split("\n");
  let fence: { char: string; length: number } | null = null;
  let buffer: string[] = [];

  const pushProtectedBlock = () => {
    const index = blocks.push(buffer.join("\n")) - 1;
    output.push(`${FENCED_BLOCK_TOKEN}${index}@@`);
    buffer = [];
  };

  for (const line of lines) {
    const stripped = line.replace(/^ {1,3}/, "");
    const fenceMatch = stripped.match(/^(`{3,}|~{3,})(.*)$/);

    if (!fence) {
      if (!fenceMatch) {
        output.push(line);
        continue;
      }
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      buffer.push(line);
      continue;
    }

    buffer.push(line);
    if (
      fenceMatch &&
      fenceMatch[1][0] === fence.char &&
      fenceMatch[1].length >= fence.length &&
      !fenceMatch[2].trim()
    ) {
      pushProtectedBlock();
      fence = null;
    }
  }

  if (buffer.length > 0) {
    output.push(...buffer);
  }

  return { text: output.join("\n"), blocks };
}

// Restores take the saved text through a function, so a `$` in it is never read as
// a replacement pattern such as $` or $&.
function restoreFencedCodeBlocks(input: string, blocks: string[]): string {
  return blocks.reduce(
    (text, block, index) => text.replaceAll(`${FENCED_BLOCK_TOKEN}${index}@@`, () => block),
    input,
  );
}

function protectInlineCodeSpans(input: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  let output = "";
  let i = 0;

  while (i < input.length) {
    if (input[i] !== "`") {
      output += input[i];
      i += 1;
      continue;
    }

    let tickEnd = i + 1;
    while (tickEnd < input.length && input[tickEnd] === "`") tickEnd += 1;

    const delimiter = input.slice(i, tickEnd);
    const closeIndex = input.indexOf(delimiter, tickEnd);
    if (closeIndex === -1) {
      output += input.slice(i);
      break;
    }

    const span = input.slice(i, closeIndex + delimiter.length);
    // If the content between delimiters spans multiple lines, it's a fenced
    // code block (or block-level backticks), not an inline code span — skip it.
    const inner = input.slice(tickEnd, closeIndex);
    if (inner.includes("\n")) {
      output += input[i];
      i += 1;
      continue;
    }
    const index = spans.push(span) - 1;
    output += `${INLINE_CODE_TOKEN}${index}@@`;
    i = closeIndex + delimiter.length;
  }

  return { text: output, spans };
}

function restoreInlineCodeSpans(input: string, spans: string[]): string {
  return spans.reduce(
    (text, span, index) => text.replaceAll(`${INLINE_CODE_TOKEN}${index}@@`, () => span),
    input,
  );
}

function skipWhitespace(input: string, index: number): number {
  let i = index;
  while (i < input.length && /\s/.test(input[i])) i += 1;
  return i;
}

interface ParsedAttrValue {
  value: string;
  nextIndex: number;
}

function parseQuotedAttrValue(input: string, index: number): ParsedAttrValue | null {
  const quote = input[index];
  if (quote !== `"` && quote !== `'`) return null;

  let value = "";
  let i = index + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\") {
      if (i + 1 < input.length) {
        value += input[i + 1];
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === quote) {
      return { value, nextIndex: i + 1 };
    }
    value += ch;
    i += 1;
  }

  return null;
}

function parseBracedAttrValue(input: string, index: number): ParsedAttrValue | null {
  if (input[index] !== "{") return null;

  let depth = 1;
  let i = index + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === `"` || ch === `'`) {
      const quoted = parseQuotedAttrValue(input, i);
      if (!quoted) return null;
      i = quoted.nextIndex;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: input.slice(index + 1, i).trim(),
          nextIndex: i + 1,
        };
      }
    }
    i += 1;
  }

  return null;
}

function parseKeyValueAttrs(
  raw: string,
  options: { allowBraces: boolean },
): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;

  while (i < raw.length) {
    i = skipWhitespace(raw, i);
    if (i >= raw.length) break;

    const keyMatch = raw.slice(i).match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (!keyMatch) break;

    const key = keyMatch[1];
    i += key.length;
    i = skipWhitespace(raw, i);
    if (raw[i] !== "=") break;
    i += 1;
    i = skipWhitespace(raw, i);

    const parsedValue =
      raw[i] === "{" && options.allowBraces
        ? parseBracedAttrValue(raw, i)
        : parseQuotedAttrValue(raw, i);
    if (!parsedValue) break;

    attrs[key] = parsedValue.value;
    i = parsedValue.nextIndex;
  }

  return attrs;
}

// ---------------------------------------------------------------------------
// Component preprocessor: transforms MDX-style JSX components into HTML
// ---------------------------------------------------------------------------

type SupportedComponentTag =
  | "Steps"
  | "Step"
  | "CardGroup"
  | "Card"
  | "AccordionGroup"
  | "Accordion"
  | "Expandable"
  | "Tabs"
  | "Tab"
  | "CodeGroup"
  | "Note"
  | "Warning"
  | "Tip"
  | "Info"
  | "Video"
  | "Iframe";

const SUPPORTED_COMPONENT_TAGS = new Set<SupportedComponentTag>([
  "Steps",
  "Step",
  "CardGroup",
  "Card",
  "AccordionGroup",
  "Accordion",
  "Expandable",
  "Tabs",
  "Tab",
  "CodeGroup",
  "Note",
  "Warning",
  "Tip",
  "Info",
  "Video",
  "Iframe",
]);

const SELF_CLOSING_COMPONENT_TAGS = new Set<SupportedComponentTag>(["Video", "Iframe"]);

type ParsedComponentNode = ParsedTextNode | ParsedComponentElement;

interface ParsedTextNode {
  kind: "text";
  value: string;
}

interface ParsedComponentElement {
  kind: "component";
  name: SupportedComponentTag;
  attrs: Record<string, string>;
  children: ParsedComponentNode[];
  original: string;
}

interface ParsedComponentTagToken {
  name: SupportedComponentTag;
  kind: "open" | "close" | "self";
  attrs: Record<string, string>;
  raw: string;
  start: number;
  end: number;
}

interface ParsedComponentResult {
  nodes: ParsedComponentNode[];
  nextIndex: number;
  matchedClose?: ParsedComponentTagToken;
}

function escapeDirectiveAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildDirectiveAttrList(entries: Array<[string, string | undefined]>): string {
  const attrs = entries
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeDirectiveAttr(value!)}"`);
  return attrs.length > 0 ? `{${attrs.join(" ")}}` : "";
}

function isWhitespaceOnlyText(node: ParsedComponentNode): boolean {
  return node.kind === "text" && node.value.trim() === "";
}

function findComponentTagEnd(input: string, start: number): number | null {
  let quote: `"` | `'` | null = null;
  let braceDepth = 0;
  let i = start + 1;

  while (i < input.length) {
    const ch = input[i];
    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === `"` || ch === `'`) {
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === "{") {
      braceDepth += 1;
      i += 1;
      continue;
    }

    if (ch === "}" && braceDepth > 0) {
      braceDepth -= 1;
      i += 1;
      continue;
    }

    if (ch === ">" && braceDepth === 0) {
      return i + 1;
    }

    i += 1;
  }

  return null;
}

function tryParseComponentTag(input: string, start: number): ParsedComponentTagToken | null {
  if (input[start] !== "<") return null;

  const end = findComponentTagEnd(input, start);
  if (end === null) return null;

  const raw = input.slice(start, end);
  const inner = input.slice(start + 1, end - 1).trim();
  if (!inner) return null;

  if (inner.startsWith("/")) {
    const closeName = inner.slice(1).trim();
    if (!SUPPORTED_COMPONENT_TAGS.has(closeName as SupportedComponentTag)) return null;
    return {
      name: closeName as SupportedComponentTag,
      kind: "close",
      attrs: {},
      raw,
      start,
      end,
    };
  }

  const selfClosing = inner.endsWith("/");
  const content = selfClosing ? inner.slice(0, -1).trimEnd() : inner;
  const nameMatch = content.match(/^([A-Za-z][A-Za-z0-9]*)/);
  if (!nameMatch || !SUPPORTED_COMPONENT_TAGS.has(nameMatch[1] as SupportedComponentTag)) {
    return null;
  }

  const name = nameMatch[1] as SupportedComponentTag;
  const attrSource = content.slice(name.length);
  return {
    name,
    kind: selfClosing || SELF_CLOSING_COMPONENT_TAGS.has(name) ? "self" : "open",
    attrs: parseKeyValueAttrs(attrSource, { allowBraces: true }),
    raw,
    start,
    end,
  };
}

function parseComponentNodes(
  input: string,
  startIndex = 0,
  untilTag?: SupportedComponentTag,
): ParsedComponentResult {
  const nodes: ParsedComponentNode[] = [];
  let cursor = startIndex;

  while (cursor < input.length) {
    const nextTag = input.indexOf("<", cursor);
    if (nextTag === -1) {
      if (cursor < input.length) {
        nodes.push({ kind: "text", value: input.slice(cursor) });
      }
      return { nodes, nextIndex: input.length };
    }

    if (nextTag > cursor) {
      nodes.push({ kind: "text", value: input.slice(cursor, nextTag) });
    }

    const tag = tryParseComponentTag(input, nextTag);
    if (!tag) {
      nodes.push({ kind: "text", value: "<" });
      cursor = nextTag + 1;
      continue;
    }

    if (tag.kind === "close") {
      if (untilTag && tag.name === untilTag) {
        return {
          nodes,
          nextIndex: tag.end,
          matchedClose: tag,
        };
      }

      nodes.push({ kind: "text", value: tag.raw });
      cursor = tag.end;
      continue;
    }

    if (tag.kind === "self") {
      nodes.push({
        kind: "component",
        name: tag.name,
        attrs: tag.attrs,
        children: [],
        original: tag.raw,
      });
      cursor = tag.end;
      continue;
    }

    const childResult = parseComponentNodes(input, tag.end, tag.name);
    if (!childResult.matchedClose) {
      nodes.push({
        kind: "text",
        value: input.slice(nextTag, childResult.nextIndex),
      });
      cursor = childResult.nextIndex;
      continue;
    }

    nodes.push({
      kind: "component",
      name: tag.name,
      attrs: tag.attrs,
      children: childResult.nodes,
      original: input.slice(nextTag, childResult.nextIndex),
    });
    cursor = childResult.nextIndex;
  }

  return { nodes, nextIndex: cursor };
}

function renderParsedComponentNodes(nodes: ParsedComponentNode[]): string {
  return nodes.map(renderParsedComponentNode).join("");
}

function collectChildComponents(
  children: ParsedComponentNode[],
  expected: SupportedComponentTag,
): ParsedComponentElement[] | null {
  const matches: ParsedComponentElement[] = [];
  for (const child of children) {
    if (isWhitespaceOnlyText(child)) continue;
    if (child.kind !== "component" || child.name !== expected) {
      return null;
    }
    matches.push(child);
  }
  return matches;
}

/**
 * Render the raw text content of parsed component children through the full
 * markdown pipeline (component preprocessing → directive preprocessing →
 * markdown rendering).  Strips common leading whitespace first so that
 * indented JSX content (e.g. code fences inside <Step>) is handled correctly.
 */
function renderComponentChildrenToHtml(children: ParsedComponentNode[]): string {
  // Save outer protection maps — renderDirectiveMarkdown → preprocessComponents will overwrite them
  const savedFenceBlocks = activeFenceBlocks;
  const savedInlineSpans = activeInlineSpans;

  let raw = renderParsedComponentNodes(children);
  raw = restoreFencedCodeBlocks(raw, savedFenceBlocks);
  raw = restoreInlineCodeSpans(raw, savedInlineSpans);
  const result = renderDirectiveMarkdown(dedent(raw));

  // Restore outer maps for sibling components
  activeFenceBlocks = savedFenceBlocks;
  activeInlineSpans = savedInlineSpans;
  return result;
}

/**
 * Strip common leading whitespace from a block of text.
 */
function dedent(text: string): string {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return text;
  const indent = Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1].length ?? 0));
  if (indent === 0) return text;
  return lines.map((l) => l.slice(indent)).join("\n");
}

/**
 * Render an accordion from a parsed JSX component directly to HTML.
 */
function renderComponentAccordion(node: ParsedComponentElement): string {
  const title = renderMarkdownInline(node.attrs.title || "").trim();
  const body = renderComponentChildrenToHtml(node.children);
  return `<details class="accordion-item">
<summary class="accordion-trigger">${title}</summary>
<div class="accordion-content">
${body}
</div>
</details>`;
}

/**
 * Render a parsed JSX component directly to final HTML.
 * Returns null if the component structure is invalid (falls back to raw text).
 */
function renderParsedComponentElement(node: ParsedComponentElement): string | null {
  if (node.name === "Steps") {
    const steps = collectChildComponents(node.children, "Step");
    if (!steps) return null;

    const items = steps
      .map((step, index) => {
        const title = renderMarkdownInline(step.attrs.title || "").trim();
        const body = renderComponentChildrenToHtml(step.children);
        return `<div role="listitem" class="step-item">
<div class="step-number">${index + 1}</div>
<div class="step-body">
<p class="step-title">${title}</p>
<div class="step-content">
${body}
</div>
</div>
</div>`;
      })
      .join("\n");

    return `\n\n<div role="list" class="steps not-prose">\n${items}\n</div>\n`;
  }

  if (node.name === "CardGroup") {
    const cards = collectChildComponents(node.children, "Card");
    if (!cards) return null;
    const cols = node.attrs.cols || "2";

    const cardHtml = cards
      .map((card) => {
        const safeHref = card.attrs.href ? safeUrl(card.attrs.href) : null;
        const tag = safeHref ? "a" : "div";
        const href = safeHref ? ` href="${escapeHtmlAttr(safeHref)}"` : "";
        const iconHtml = renderIcon(card.attrs.icon || "");
        const title = renderMarkdownInline(card.attrs.title || "").trim();
        const body = renderComponentChildrenToHtml(card.children);
        return `<${tag}${href} class="card-item">
<div class="card-item-inner">
${iconHtml}
<h3 class="card-item-title">${title}</h3>
<div class="card-item-content">
${body}
</div>
</div>
</${tag}>`;
      })
      .join("\n");

    return `\n\n<div class="card-group not-prose" data-cols="${escapeHtmlAttr(cols)}">\n${cardHtml}\n</div>\n`;
  }

  if (node.name === "AccordionGroup") {
    const accordions = collectChildComponents(node.children, "Accordion");
    if (!accordions) return null;
    return `\n\n<div class="accordion-group not-prose">\n${accordions.map(renderComponentAccordion).join("\n")}\n</div>\n`;
  }

  if (node.name === "Accordion" || node.name === "Expandable") {
    return `\n\n${renderComponentAccordion(node)}\n`;
  }

  if (node.name === "Tabs") {
    const tabs = collectChildComponents(node.children, "Tab");
    if (!tabs) return null;

    const tabData = tabs.map((tab) => ({
      title: renderMarkdownInline(tab.attrs.title || "").trim(),
      body: renderComponentChildrenToHtml(tab.children),
    }));

    return `\n\n${buildTabbedHtml(tabData, nextId("tabs"))}\n`;
  }

  if (node.name === "CodeGroup") {
    let cgRaw = renderParsedComponentNodes(node.children);
    cgRaw = restoreFencedCodeBlocks(cgRaw, activeFenceBlocks);
    cgRaw = restoreInlineCodeSpans(cgRaw, activeInlineSpans);
    const codeBlocks = parseTitledCodeBlocks(dedent(cgRaw)).map((block) => ({
      title: renderMarkdownInline(block.title).trim(),
      body: renderCodeBlock(block.body, block.lang),
    }));
    if (codeBlocks.length === 0) return null;
    return `\n\n${buildTabbedHtml(codeBlocks, nextId("cg"), "directive-code-group")}\n`;
  }

  if (
    node.name === "Note" ||
    node.name === "Warning" ||
    node.name === "Tip" ||
    node.name === "Info"
  ) {
    const type = node.name.toLowerCase();
    const label = renderMarkdownInline(
      node.attrs.title?.trim() || node.name.charAt(0).toUpperCase() + node.name.slice(1),
    ).trim();
    const body = renderComponentChildrenToHtml(node.children);
    return `\n\n<div class="callout callout-${type} not-prose">
<div class="callout-title">${label}</div>
${body ? `<div class="callout-content">\n${body}\n</div>` : ""}
</div>\n`;
  }

  if (node.name === "Video") {
    const titleAttr = node.attrs.title ? `{title="${escapeDirectiveAttr(node.attrs.title)}"}` : "";
    return `::video[${node.attrs.src || ""}]${titleAttr}`;
  }

  if (node.name === "Iframe") {
    const attrString = buildDirectiveAttrList([
      ["title", node.attrs.title],
      ["height", node.attrs.height],
    ]);
    return `::iframe[${node.attrs.src || ""}]${attrString}`;
  }

  return null;
}

function renderParsedComponentNode(node: ParsedComponentNode): string {
  if (node.kind === "text") return node.value;
  return renderParsedComponentElement(node) ?? node.original;
}

/**
 * Convert JSX-style components to directive syntax so they go through
 * a single rendering path in preprocessDirectives.
 */
function preprocessComponents(body: string): string {
  const { text: fencedText, blocks } = protectFencedCodeBlocks(body);
  activeFenceBlocks = blocks;
  const { text, spans } = protectInlineCodeSpans(fencedText);
  activeInlineSpans = spans;
  const parsed = parseComponentNodes(text);
  const restoredInline = restoreInlineCodeSpans(renderParsedComponentNodes(parsed.nodes), spans);
  return restoreFencedCodeBlocks(restoredInline, blocks);
}

// ---------------------------------------------------------------------------
// Directive preprocessor: transforms :::directive blocks into HTML
// ---------------------------------------------------------------------------

/** Parse {key="value" key2="value2"} attribute strings. */
function parseAttrs(raw: string): Record<string, string> {
  return parseKeyValueAttrs(raw, { allowBraces: false });
}

/** Deterministic tab-group ID; reset per page. */
let directiveCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++directiveCounter}`;
}

/** Reset counter between builds (called from loadMarkdownPage). */
function resetDirectiveCounter(): void {
  directiveCounter = 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttr(value: string): string {
  return escapeAttr(value);
}

function stripDirectiveIndent(line: string): string {
  return line.replace(/^ {0,3}/, "");
}

function isFenceStart(line: string): { char: string; length: number } | null {
  const match = stripDirectiveIndent(line).match(/^(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return { char: match[1][0], length: match[1].length };
}

function closesFence(line: string, fence: { char: string; length: number }): boolean {
  const match = stripDirectiveIndent(line).match(/^(`{3,}|~{3,})(.*)$/);
  return !!(
    match &&
    match[1][0] === fence.char &&
    match[1].length >= fence.length &&
    !match[2].trim()
  );
}

/** Build tabbed UI HTML (shared by :::tabs and :::code-group). */
function buildTabbedHtml(
  tabs: { title: string; body: string }[],
  id: string,
  extraClass?: string,
): string {
  const cls = extraClass ? `directive-tabs ${extraClass} not-prose` : "directive-tabs not-prose";
  const buttons = tabs
    .map(
      (t, i) =>
        `<button class="directive-tab${i === 0 ? " active" : ""}" data-tab-group="${id}" data-tab-index="${i}">${t.title}</button>`,
    )
    .join("\n");
  const panels = tabs
    .map(
      (t, i) =>
        `<div class="directive-tab-panel${i === 0 ? " active" : ""}" data-tab-group="${id}" data-tab-index="${i}">

${t.body}

</div>`,
    )
    .join("\n");
  return `<div class="${cls}">
<div class="directive-tab-bar">${buttons}</div>
${panels}
</div>`;
}

/**
 * Split content on `::child` markers, returning { attrs, body } for each.
 * Leading content before the first marker is discarded.
 */
function splitChildren(
  content: string,
  marker: string,
): { attrs: Record<string, string>; body: string }[] {
  const children: { attrs: Record<string, string>; body: string }[] = [];
  const lines = content.split("\n");
  const startRe = new RegExp(`^::${escapeRegExp(marker)}(?:\\{([^}]*)\\})?\\s*$`);
  let i = 0;

  while (i < lines.length) {
    const start = stripDirectiveIndent(lines[i]).trimEnd().match(startRe);
    if (!start) {
      i += 1;
      continue;
    }

    let fence: { char: string; length: number } | null = null;
    let depth = 1;
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (fence) {
        if (closesFence(line, fence)) fence = null;
        j += 1;
        continue;
      }

      const nextFence = isFenceStart(line);
      if (nextFence) {
        fence = nextFence;
        j += 1;
        continue;
      }

      const stripped = stripDirectiveIndent(line).trimEnd();
      if (startRe.test(stripped)) {
        depth += 1;
      } else if (/^::\s*$/.test(stripped)) {
        depth -= 1;
        if (depth === 0) break;
      }
      j += 1;
    }

    if (depth !== 0) {
      i += 1;
      continue;
    }

    children.push({
      attrs: parseAttrs(start[1] ?? ""),
      body: lines
        .slice(i + 1, j)
        .join("\n")
        .trim(),
    });
    i = j + 1;
  }

  return children;
}

function parseTitledCodeBlocks(content: string): { title: string; body: string; lang: string }[] {
  const blocks: { title: string; body: string; lang: string }[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = stripDirectiveIndent(lines[i]).trimEnd();
    const open = line.match(/^(`{3,}|~{3,})(\S+)?(?:\s+title="([^"]*)"|\s+(.+?))?\s*$/);
    if (!open) {
      i += 1;
      continue;
    }

    const fence = { char: open[1][0], length: open[1].length };
    let j = i + 1;
    while (j < lines.length && !closesFence(lines[j], fence)) j += 1;
    if (j >= lines.length) break;

    blocks.push({
      title: open[3] ?? open[4] ?? "",
      lang: open[2] ?? "",
      body: lines.slice(i + 1, j).join("\n"),
    });
    i = j + 1;
  }

  return blocks;
}

type SupportedDirective =
  | "note"
  | "warning"
  | "tip"
  | "info"
  | "steps"
  | "tabs"
  | "code-group"
  | "card-group"
  | "accordion";

const SUPPORTED_DIRECTIVES = new Set<SupportedDirective>([
  "note",
  "warning",
  "tip",
  "info",
  "steps",
  "tabs",
  "code-group",
  "card-group",
  "accordion",
]);

function matchDirectiveStart(line: string): { type: SupportedDirective; meta: string } | null {
  const match = stripDirectiveIndent(line)
    .trimEnd()
    .match(/^:::(\w[\w-]*)(.*)$/);
  if (!match || !SUPPORTED_DIRECTIVES.has(match[1] as SupportedDirective)) return null;
  return {
    type: match[1] as SupportedDirective,
    meta: match[2].trim(),
  };
}

function isAnyDirectiveStart(line: string): boolean {
  return /^:::\w[\w-]*(?:\{[^}]*\}|.*)?$/.test(stripDirectiveIndent(line).trimEnd());
}

function renderDirectiveMarkdown(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return renderMarkdown(preprocessDirectives(preprocessComponents(trimmed))).trim();
}

function collectDirectiveBlock(
  lines: string[],
  startIndex: number,
): { content: string; nextLine: number } | null {
  let fence: { char: string; length: number } | null = null;
  let depth = 1;
  let i = startIndex + 1;

  while (i < lines.length) {
    const line = lines[i];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      i += 1;
      continue;
    }

    const nextFence = isFenceStart(line);
    if (nextFence) {
      fence = nextFence;
      i += 1;
      continue;
    }

    const stripped = stripDirectiveIndent(line).trimEnd();
    if (isAnyDirectiveStart(stripped)) {
      depth += 1;
    } else if (/^:::\s*$/.test(stripped)) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: lines.slice(startIndex + 1, i).join("\n"),
          nextLine: i + 1,
        };
      }
    }
    i += 1;
  }

  return null;
}

function renderDirectiveBlock(type: SupportedDirective, meta: string, content: string): string {
  if (type === "note" || type === "warning" || type === "tip" || type === "info") {
    const label = renderMarkdownInline(
      meta.trim() || type.charAt(0).toUpperCase() + type.slice(1),
    ).trim();
    const body = renderDirectiveMarkdown(content);
    return `\n\n<div class="callout callout-${type} not-prose">
<div class="callout-title">${label}</div>
${body ? `<div class="callout-content">\n${body}\n</div>` : ""}
</div>\n`;
  }

  if (type === "steps") {
    const lines = content.trim().split("\n");
    const steps: { title: string; body: string[] }[] = [];
    let fence: { char: string; length: number } | null = null;

    for (const line of lines) {
      if (fence) {
        if (closesFence(line, fence)) fence = null;
      } else {
        const nextFence = isFenceStart(line);
        if (nextFence) {
          fence = nextFence;
        }
      }

      const stripped = line.replace(/^ {1,3}/, "");
      const stepMatch = !fence && line.match(/^\d+\.\s+(.+)/);
      if (stepMatch) {
        steps.push({ title: stepMatch[1], body: [] });
      } else if (steps.length > 0) {
        steps[steps.length - 1].body.push(stripped);
      }
    }

    if (steps.length === 0) return renderDirectiveMarkdown(content);

    const items = steps
      .map((step, index) => {
        const title = renderMarkdownInline(step.title).trim();
        const body = renderDirectiveMarkdown(step.body.join("\n").trim());
        return `<div role="listitem" class="step-item">
<div class="step-number">${index + 1}</div>
<div class="step-body">
<p class="step-title">${title}</p>
<div class="step-content">
${body}
</div>
</div>
</div>`;
      })
      .join("\n");

    return `\n\n<div role="list" class="steps not-prose">\n${items}\n</div>\n`;
  }

  if (type === "tabs") {
    const tabs = splitChildren(content, "tab").map((child) => ({
      title: renderMarkdownInline(child.attrs.title || "").trim(),
      body: renderDirectiveMarkdown(child.body),
    }));
    if (tabs.length === 0) return renderDirectiveMarkdown(content);
    return `\n\n${buildTabbedHtml(tabs, nextId("tabs"))}\n`;
  }

  if (type === "code-group") {
    const codeBlocks = parseTitledCodeBlocks(content).map((block) => ({
      title: renderMarkdownInline(block.title).trim(),
      body: renderCodeBlock(block.body, block.lang),
    }));
    if (codeBlocks.length === 0) return renderDirectiveMarkdown(content);
    return `\n\n${buildTabbedHtml(codeBlocks, nextId("cg"), "directive-code-group")}\n`;
  }

  if (type === "card-group") {
    const cols = parseAttrs(meta.match(/^\{([^}]*)\}$/)?.[1] ?? "").cols || "2";
    const cards = splitChildren(content, "card").map((child) => {
      const safeHref = child.attrs.href ? safeUrl(child.attrs.href) : null;
      const tag = safeHref ? "a" : "div";
      const href = safeHref ? ` href="${escapeHtmlAttr(safeHref)}"` : "";
      const iconHtml = renderIcon(child.attrs.icon || "");
      const title = renderMarkdownInline(child.attrs.title || "").trim();
      const body = renderDirectiveMarkdown(child.body);
      return `<${tag}${href} class="card-item">
<div class="card-item-inner">
${iconHtml}
<h3 class="card-item-title">${title}</h3>
<div class="card-item-content">
${body}
</div>
</div>
</${tag}>`;
    });
    if (cards.length === 0) return renderDirectiveMarkdown(content);
    return `\n\n<div class="card-group not-prose" data-cols="${escapeHtmlAttr(cols)}">\n${cards.join("\n")}\n</div>\n`;
  }

  const title = renderMarkdownInline(
    parseAttrs(meta.match(/^\{([^}]*)\}$/)?.[1] ?? "").title || "",
  ).trim();
  const body = renderDirectiveMarkdown(content);
  return `\n\n<details class="accordion-item">
<summary class="accordion-trigger">${title}</summary>
<div class="accordion-content">
${body}
</div>
</details>\n`;
}

/**
 * Process :::directive blocks. Handles callouts, steps, tabs,
 * code-group, card-group, and accordion.
 *
 * Matching strategy: process one block type at a time. Each regex
 * matches a specific `:::type` opener so closing `:::` markers
 * from other directive types cannot collide.
 */
function preprocessDirectives(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let i = 0;
  let fence: { char: string; length: number } | null = null;

  while (i < lines.length) {
    if (fence) {
      out.push(lines[i]);
      if (closesFence(lines[i], fence)) fence = null;
      i += 1;
      continue;
    }

    const nextFence = isFenceStart(lines[i]);
    if (nextFence) {
      fence = nextFence;
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const start = matchDirectiveStart(lines[i]);
    if (!start) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    if (start.type === "accordion") {
      const accordions: string[] = [];
      let nextLine = i;

      while (true) {
        const accordionStart = matchDirectiveStart(lines[nextLine]);
        if (!accordionStart || accordionStart.type !== "accordion") break;

        const accordionBlock = collectDirectiveBlock(lines, nextLine);
        if (!accordionBlock) break;

        accordions.push(
          renderDirectiveBlock("accordion", accordionStart.meta, accordionBlock.content),
        );
        nextLine = accordionBlock.nextLine;

        let scan = nextLine;
        while (scan < lines.length && /^\s*$/.test(lines[scan])) scan += 1;

        const nextAccordion = scan < lines.length ? matchDirectiveStart(lines[scan]) : null;
        if (!nextAccordion || nextAccordion.type !== "accordion") break;
        nextLine = scan;
      }

      if (accordions.length > 1) {
        out.push(`\n\n<div class="accordion-group not-prose">\n${accordions.join("\n")}\n</div>\n`);
        i = nextLine;
        continue;
      }
    }

    const block = collectDirectiveBlock(lines, i);
    if (!block) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    out.push(renderDirectiveBlock(start.type, start.meta, block.content));
    i = block.nextLine;
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a single markdown file and return a MarkdownPage.
 */
export async function loadMarkdownPage(filePath: string, slug: string): Promise<MarkdownPage> {
  const raw = await readFileAsync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(raw);

  return loadMarkdownPageFromBody(filePath, slug, body, meta);
}

export async function loadDocsPage(
  filePath: string,
  slug: string,
  options: LoadDocsPageOptions = {},
): Promise<DocsPage> {
  const raw = await readFileAsync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(raw);

  if (shouldTreatAsChangelog(filePath, meta, options)) {
    const sourcePath = relative(process.cwd(), filePath);
    const changelog = normalizeChangelog(body, {
      title: typeof meta.title === "string" ? meta.title : undefined,
      description: typeof meta.description === "string" ? meta.description : undefined,
      repoUrl: options.repoUrl,
    });
    const description =
      typeof meta.description === "string" ? meta.description : (changelog.description ?? "");

    return {
      kind: "changelog",
      title: changelog.title,
      description,
      slug,
      headings: changelog.versions.map((version) => ({
        level: 2 as const,
        text: version.version ?? "Unreleased",
        id: version.id,
      })),
      sourcePath,
      editPath: sourcePath,
      changelog,
      rawBody: body,
    };
  }

  return loadMarkdownPageFromBody(filePath, slug, body, meta, options);
}

function shouldTreatAsChangelog(
  filePath: string,
  meta: Frontmatter,
  options: LoadDocsPageOptions,
): boolean {
  if (options.changelog === false) return false;
  if (typeof meta.layout === "string" && meta.layout.toLowerCase() === "changelog") return true;
  return basename(filePath).toLowerCase() === "changelog.md";
}

function loadMarkdownPageFromBody(
  filePath: string,
  slug: string,
  body: string,
  meta: Frontmatter,
  options: LoadDocsPageOptions = {},
): MarkdownPage {
  resetDirectiveCounter();
  const sourcePreprocessed = preprocessSourceMarkdown(body, filePath, options);
  const componentPreprocessed = preprocessComponents(sourcePreprocessed);
  const preprocessed = preprocessDirectives(componentPreprocessed);
  const headings = extractHeadings(componentPreprocessed);
  const html = renderMarkdown(preprocessed);

  const title = meta.title ?? extractFirstHeading(componentPreprocessed) ?? slug;
  const description = normalizeMarkdownDescription(meta.description, componentPreprocessed);

  // Strip leading h1 from rendered HTML when it duplicates the page title
  const cleanHtml = html.replace(/^\s*<h1[^>]*>(.*?)<\/h1>\s*/i, (_m, inner) =>
    inner.replace(/<[^>]+>/g, "").trim() === title ? "" : _m,
  );

  const sourcePath = relative(process.cwd(), filePath);
  return {
    kind: "markdown",
    navTitle: typeof meta.navTitle === "string" ? meta.navTitle : undefined,
    title,
    description,
    slug,
    html: cleanHtml,
    headings,
    sourcePath,
    editPath: sourcePath,
    sourceRoot: options.sourceRoot ? relative(process.cwd(), options.sourceRoot) : undefined,
  };
}

function normalizeMarkdownDescription(description: unknown, markdown: string): string {
  if (typeof description === "string" && description.trim()) {
    return description;
  }
  return stripMarkdownLinks(extractFirstParagraph(markdown)).replace(/\s+/g, " ").trim();
}

/**
 * Extract the first # heading from markdown as a fallback title.
 */
function extractFirstHeading(md: string): string | undefined {
  const match = md.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

/**
 * Derive a URL slug from a page path.
 * Preserves directory structure to avoid collisions:
 * "getting-started.md" → "getting-started"
 * "run/index"          → "run/index"
 * "run/install.md"     → "run/install"
 */
export function slugFromPath(filePath: string): string {
  const ext = extname(filePath);
  const stripped = ext ? filePath.slice(0, -ext.length) : filePath;
  return stripped
    .split("/")
    .map((s) => slugSegmentFromPath(s))
    .join("/");
}

function slugSegmentFromPath(segment: string): string {
  const normalized = segment
    .replace(/^operator=$/, "operator-assign")
    .replace(/^~(.+)$/, "destructor-$1")
    .replace(/<=>/g, "-spaceship")
    .replace(/<=/g, "-le")
    .replace(/>=/g, "-ge")
    .replace(/==/g, "-eq")
    .replace(/!=/g, "-ne")
    .replace(/\[\]/g, "-array")
    .replace(/\+=/g, "-plus-eq")
    .replace(/\/=/g, "-slash-eq")
    .replace(/\//g, "-slash")
    .replace(/=/g, "-eq")
    .replace(/\+/g, "-plus")
    .replace(/</g, "-lt")
    .replace(/>/g, "-gt");
  return htmlId(normalized);
}

function preprocessSourceMarkdown(
  body: string,
  filePath: string,
  options: LoadDocsPageOptions,
): string {
  let current = body;
  for (const preprocess of options.preprocess ?? []) {
    current = preprocess(current, {
      filePath,
      sourceRoot: options.sourceRoot,
    });
  }
  return current;
}
