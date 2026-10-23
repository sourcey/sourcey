/**
 * MDX and Markdown syntax for one-time conversion. Normal builds never load
 * this module; it parses source so edits can target exact byte ranges.
 */

import type { Processor } from "unified";

export interface Point {
  line: number;
  column: number;
  offset: number;
}

export interface SyntaxNode {
  type: string;
  position?: { start: Point; end: Point };
  children?: SyntaxNode[];
  value?: string;
  name?: string | null;
  lang?: string | null;
  meta?: string | null;
  depth?: number;
  url?: string;
  alt?: string | null;
  attributes?: JsxAttribute[];
  /** MDX expression syntax, or a directive's label paragraph. */
  data?: { estree?: EstreeProgram; directiveLabel?: boolean };
}

export interface JsxAttribute {
  type: "mdxJsxAttribute" | "mdxJsxExpressionAttribute";
  name?: string;
  value?: string | null | { type: "mdxJsxAttributeValueExpression"; value: string; data?: { estree?: EstreeProgram } };
  position?: { start: Point; end: Point };
}

export interface EstreeNode {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

export interface EstreeProgram extends EstreeNode {
  body: EstreeNode[];
}

export class SourceSyntaxError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
  }
}

/** Blank the frontmatter so node offsets stay offsets into the original file. */
function maskFrontmatter(source: string, bodyStart: number): string {
  return source.slice(0, bodyStart).replace(/[^\n]/g, " ") + source.slice(bodyStart);
}

/** Syntax extensions the source framework enabled beyond CommonMark and GFM. */
export interface Dialect {
  /** Every document is MDX, whatever its extension (Docusaurus's default); otherwise only `.mdx` files are. */
  mdx?: boolean;
  /**
   * MDX 1 (Docusaurus 2): block JSX and imports as MDX reads them, and the rest
   * as CommonMark reads it: indented code, inline HTML and autolinks, braces
   * and a `<` that opens no tag (`<PROXY_IP>`) as characters.
   */
  mdx1?: boolean;
  /**
   * Container directives, `:::name[label]`, as Starlight parses them. Like
   * Starlight, text and leaf directives it does not handle read as their source text.
   */
  directives?: boolean;
  /** HTML comments in MDX, which Docusaurus reads and MDX alone rejects. */
  htmlComments?: boolean;
  /** A heading's `{#id}` in MDX, which Docusaurus reads as text before MDX parses it (`mdx1Compat.headingIds`). */
  headingIds?: boolean;
  /** Components the framework provides without imports, as `module#export` by tag name. */
  globals?: ReadonlyMap<string, string>;
}

export async function parseMarkdown(source: string, bodyStart: number, dialect: Dialect = {}): Promise<SyntaxNode> {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("remark-gfm"),
  ]);
  // MDX's JSX claims every `<` that starts a block, so comments are blanked (they show nothing) and code restored after.
  const comments = dialect.mdx && (dialect.htmlComments || dialect.mdx1) ? [...source.slice(bodyStart).matchAll(/<!--[\s\S]*?-->/g)] : [];
  let body = maskFrontmatter(source, bodyStart);
  for (const comment of comments) {
    const start = bodyStart + comment.index!;
    body = body.slice(0, start) + comment[0].replace(/[^\n]/g, " ") + body.slice(start + comment[0].length);
  }
  // A heading line's first unescaped `{#`, as `escapeMarkdownHeadingIds` finds it, is text: its brace is masked and comes back after.
  const maskedIds = dialect.mdx && dialect.headingIds && /(?:^|\n)#{1,6}(?!#).*(?<!\\)\{#/.test(body);
  if (maskedIds) body = body.replaceAll(/(?:^|\n)#{1,6}(?!#).*/g, (line) => line.replace(/(?<!\\)\{#/, `${HEADING_ID}#`));
  // MDX 1 read a block of HTML as raw markup, where JSX reads its contents as Markdown (indented lines as code).
  const blocks = dialect.mdx && dialect.mdx1 ? await htmlBlocks(body) : [];
  for (const offset of blocks) body = `${body.slice(0, offset)}${RAW}${body.slice(offset + 1)}`;
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (dialect.mdx) processor.use(dialect.mdx1 ? await remarkMdx1() : (await import("remark-mdx")).default);
  if (dialect.directives) processor.use((await import("remark-directive")).default);
  try {
    const tree = processor.parse(body) as SyntaxNode;
    if (dialect.directives) restoreInlineDirectives(tree, source);
    if (comments.length) restoreCode(tree, source, comments.map((comment) => ({ start: bodyStart + comment.index!, end: bodyStart + comment.index! + comment[0].length })));
    if (blocks.length) restoreHtmlBlocks(tree, source);
    if (maskedIds) restoreHeadingIds(tree);
    return tree;
  } catch (error) {
    const place = error as { message: string; line?: number; column?: number; reason?: string };
    throw new SourceSyntaxError(place.reason ?? place.message, place.line, place.column);
  }
}

/** Stands in for the `<` opening an HTML block, so JSX passes over it; the block returns as HTML. */
const RAW = "\uE000";
/** Stands in for the brace of a heading's `{#id}`, so MDX reads it as text; the brace returns after. */
const HEADING_ID = "\uE001";

function restoreHeadingIds(node: SyntaxNode): void {
  if (node.value?.includes(HEADING_ID)) node.value = node.value.replaceAll(HEADING_ID, "{");
  for (const child of node.children ?? []) restoreHeadingIds(child);
}
/** The containers block content stands in. */
const FLOW = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

/**
 * Each line-opening `<` of the blocks of lowercase HTML CommonMark finds
 * (components stay JSX); masked, a block reads as one paragraph.
 */
async function htmlBlocks(body: string): Promise<number[]> {
  const offsets: number[] = [];
  for (const { node, parents } of walk(await parseMarkdown(body, 0))) {
    // Block HTML sits in a flow container; HTML in a paragraph, heading or table cell is inline.
    if (node.type !== "html" || !node.position || !FLOW.has(parents.at(-1)?.type ?? "") || !/^<\/?[a-z]/.test((node.value ?? "").trimStart())) continue;
    const { start, end } = span(node);
    for (const line of body.slice(start, end).matchAll(/(?:^|\n)[ \t]*</g)) offsets.push(start + line.index! + line[0].length - 1);
  }
  return offsets;
}

/** A paragraph opening with the placeholder is the HTML block MDX 1 read as written. */
function restoreHtmlBlocks(node: SyntaxNode, source: string): void {
  for (const [index, child] of (node.children ?? []).entries()) {
    const first = child.children?.[0];
    if (child.type === "paragraph" && child.position && first?.type === "text" && first.value?.startsWith(RAW))
      node.children![index] = { type: "html", value: source.slice(child.position.start.offset, child.position.end.offset), position: child.position };
    else restoreHtmlBlocks(child, source);
  }
}

/** MDX 1's reading: MDX's block JSX and import/export syntax over CommonMark, without expressions in text. */
async function remarkMdx1() {
  const [{ mdxJsx }, { mdxjsEsm }, { mdxJsxFromMarkdown }, { mdxjsEsmFromMarkdown }, { Parser }, { default: acornJsx }] = await Promise.all([
    import("micromark-extension-mdx-jsx"),
    import("micromark-extension-mdxjs-esm"),
    import("mdast-util-mdx-jsx"),
    import("mdast-util-mdxjs-esm"),
    import("acorn"),
    import("acorn-jsx"),
  ]);
  const acorn = Parser.extend(acornJsx());
  const options = { acorn, acornOptions: { ecmaVersion: 2024 as const, sourceType: "module" as const }, addResult: true };
  return function (this: Processor) {
    const data = this.data();
    // Block JSX replaces block HTML; inline tags, autolinks and indented code stay CommonMark's.
    (data.micromarkExtensions ??= []).push(mdxjsEsm(options), { flow: mdxJsx(options).flow }, { disable: { null: ["htmlFlow"] } });
    (data.fromMarkdownExtensions ??= []).push(mdxjsEsmFromMarkdown(), mdxJsxFromMarkdown());
  };
}

/** Code shows comments as written: blanking them applies only where they are syntax. */
function restoreCode(node: SyntaxNode, source: string, comments: readonly { start: number; end: number }[], lines = source.split("\n")): void {
  // Only code a blanked comment falls in needs its source back; elsewhere the parsed value is right (a table's `\|` included).
  const blanked = node.position && comments.some((comment) => comment.start < node.position!.end.offset && node.position!.start.offset < comment.end);
  if (!blanked) {
    for (const child of node.children ?? []) restoreCode(child, source, comments, lines);
    return;
  }
  if (node.type === "code" && node.position && node.value !== undefined) {
    // Each value line is its source line without the indentation or container prefix.
    const fenced = /^(`{3,}|~{3,})/.test(source.slice(node.position.start.offset));
    const first = node.position.start.line - 1 + (fenced ? 1 : 0);
    node.value = node.value
      .split("\n")
      .map((line, index) => {
        const written = (lines[first + index] ?? "").replace(/\r$/, "");
        return written.slice(written.length - line.length);
      })
      .join("\n");
  } else if (node.type === "inlineCode" && node.position) {
    const written = source.slice(node.position.start.offset, node.position.end.offset);
    const ticks = written.match(/^`+/)?.[0].length ?? 0;
    const inner = written.slice(ticks, written.length - ticks).replace(/\r?\n/g, " ");
    node.value = /^ .* $/.test(inner) && inner.trim() ? inner.slice(1, -1) : inner;
  }
  for (const child of node.children ?? []) restoreCode(child, source, comments, lines);
}

function restoreInlineDirectives(node: SyntaxNode, source: string): void {
  for (const [index, child] of (node.children ?? []).entries()) {
    if ((child.type === "textDirective" || child.type === "leafDirective") && child.position) {
      const value = source.slice(child.position.start.offset, child.position.end.offset);
      node.children![index] = child.type === "textDirective" ? { type: "text", value, position: child.position } : { type: "paragraph", position: child.position, children: [{ type: "text", value, position: child.position }] };
    } else restoreInlineDirectives(child, source);
  }
}

/** Parse a source document as its framework does. */
export function parseDocument(file: string, source: string, bodyStart: number, dialect: Dialect = {}): Promise<SyntaxNode> {
  return parseMarkdown(source, bodyStart, { ...dialect, mdx: dialect.mdx ?? file.endsWith(".mdx") });
}

export function* walk(node: SyntaxNode, parents: SyntaxNode[] = []): Generator<{ node: SyntaxNode; parents: SyntaxNode[] }> {
  yield { node, parents };
  for (const child of node.children ?? []) yield* walk(child, [...parents, node]);
}

export function span(node: { position?: { start: Point; end: Point } }): { start: number; end: number } {
  if (!node.position) throw new Error("Syntax node without a position");
  return { start: node.position.start.offset, end: node.position.end.offset };
}

/** Offset just past the `>` of an element's opening tag. */
export function openingTagEnd(source: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "`" && depth > 0) quote = "`";
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) return index + 1;
  }
  throw new Error(`Unterminated tag at offset ${start}`);
}

/** Offset of the `<` of an element's closing tag, or undefined for a self-closing element. */
export function closingTagStart(source: string, start: number, end: number): number | undefined {
  const opening = openingTagEnd(source, start);
  if (/\/\s*>$/.test(source.slice(start, opening))) return undefined;
  const index = source.lastIndexOf("</", end - 1);
  if (index < opening) throw new Error(`Missing closing tag for element at offset ${start}`);
  return index;
}

/** The plain-text content a reader sees for a subtree, for comparisons and labels. */
export function textContent(node: SyntaxNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "code") return node.value ?? "";
  if (node.type === "break") return "\n";
  return (node.children ?? []).map(textContent).join("");
}

/** Text and its formatting, which hold no element or expression. */
const PHRASING = new Set(["text", "emphasis", "strong", "delete", "inlineCode", "link", "linkReference", "break"]);

/**
 * The text a reader sees in an element whose children are only text, as MDX
 * reads it: its line, or its paragraphs one after another. Undefined when the
 * children hold an element, an expression or another kind of block.
 */
export function childrenText(node: SyntaxNode): string | undefined {
  const plain = (child: SyntaxNode): boolean => PHRASING.has(child.type) && (child.children ?? []).every(plain);
  const children = node.children ?? [];
  if (node.type !== "mdxJsxFlowElement") return children.every(plain) ? textContent(node) : undefined;
  return children.every((child) => child.type === "paragraph" && (child.children ?? []).every(plain)) ? children.map(textContent).join("\n\n") : undefined;
}
