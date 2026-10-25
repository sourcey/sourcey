/**
 * MkDocs (Python-Markdown and pymdown-extensions) block syntax to native
 * Sourcey Markdown. These extensions are indentation-based line processors,
 * so conversion works line by line; lines it does not convert keep their bytes.
 * Fenced code is never converted, except a fence that only includes a file.
 */
import { posix } from "node:path";
import { VOID_ELEMENTS } from "../../utils/html.js";
import { firstHeadingText } from "../../utils/markdown.js";
import type { Diagnostics } from "../diagnostics.js";
import { siteFileUrls } from "../site-files.js";

/** The extensions a project enabled, which decide what its Markdown meant. */
export interface MkDocsExtensions {
  admonition: boolean;
  details: boolean;
  tabbed: boolean;
  /** pymdownx.snippets base paths, project-relative. */
  snippets?: string[];
  /** markdown_include base path, project-relative. */
  include?: string;
  attrList: boolean;
  mdInHtml: boolean;
  emoji: boolean;
  inlineHilite: boolean;
  /** GitHub alert blockquotes rendered as admonitions (the gh-admonitions plugin). */
  githubAlerts: boolean;
}

export interface SyntaxContext {
  /** Project-relative path of the document. */
  file: string;
  /** Public path MkDocs served the page at, which raw HTML URLs are relative to. */
  route: string;
  /** Project-relative `docs_dir`, which MkDocs copies to the site root. */
  docsDir: string;
  extensions: MkDocsExtensions;
  diagnostics: Diagnostics;
  /** Whether a project-relative file exists, for resolving include paths. */
  exists(path: string): Promise<boolean>;
}

/** Native callout for each admonition type Material documents, and the title MkDocs shows by default. */
const CALLOUTS: Record<string, string> = {
  note: "note", seealso: "note", example: "note", quote: "note", cite: "note",
  abstract: "info", summary: "info", tldr: "info", info: "info", todo: "info", question: "info", help: "info", faq: "info",
  tip: "tip", hint: "tip", important: "tip", success: "tip", check: "tip", done: "tip",
  warning: "warning", attention: "warning", caution: "caution",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
};
const GITHUB_ALERTS: Record<string, [string, string]> = {
  NOTE: ["note", "Note"], TIP: ["tip", "Tip"], IMPORTANT: ["info", "Important"], WARNING: ["warning", "Warning"], CAUTION: ["danger", "Caution"],
};
const ADMONITION = /^(\s*)(!!!|\?\?\?\+?)[ \t]+([\w-]+)(?:[ \t]+"([^"]*)")?[ \t]*$/;
const TAB = /^(\s*)===(!?)\+?[ \t]+"([^"]*)"[ \t]*$/;
const ALERT = /^(\s*)>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/;
const SNIPPET = /^(\s*)--8<--[ \t]+"([^"]+)"[ \t]*$/;
const INCLUDE = /^(\s*)\{!([^!]+)!\}[ \t]*$/;
/** attr_list after an inline element (link, image, code, emphasis), at the end of a heading, or alone as a block's last line. */
const INLINE_ATTRIBUTES = /(?<=[\])`*_])\{(:?)[ \t]*([^{}\n]*?)[ \t]*\}(?!\})/g;
const HEADING_ATTRIBUTES = /^(#{1,6}[ \t].*?)[ \t]+\{:?[ \t]*([^{}\n]*?)[ \t]*\}[ \t]*$/;
const BLOCK_ATTRIBUTES = /^[ \t]*\{(:?)[ \t]*([^{}\n]*?)[ \t]*\}[ \t]*$/;
const MARKDOWN_ATTRIBUTE = /\s+markdown(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=\s|>|$)/i;
/** Material icon shortcodes, with the attribute list that styles them. */
const ICON_SHORTCODE = /:(?:material|octicons|fontawesome|simple)-[a-z0-9-]+:(?:\{[^{}\n]*\})?[ \t]?/g;
const INLINE_HILITE = /`#!([A-Za-z0-9_+.-]+)[ \t]+([^`]+)`/g;
/** CommonMark autolinks any `<scheme:...>`; Python-Markdown only web and mail addresses, showing the rest as text. */
const NON_WEB_AUTOLINK = /<(?!(?:https?|ftps?|mailto):)([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/g;
const ATTRIBUTE = /^(?:#[\w-]+|\.[\w-]+|[\w:-]+=(?:"[^"]*"|'[^']*'|[^\s"'}]+)|[\w:-]+)$/;

/**
 * Convert a document, then prove nothing was lost: every original line, minus
 * the block syntax rewritten here, must appear in the result.
 */
export async function convertMkDocsMarkdown(source: string, context: SyntaxContext): Promise<string> {
  const lines = context.extensions.attrList ? annotationsAsFootnotes(source.split("\n")) : source.split("\n");
  const converted = (await convertBlock(lines, context, 0)).join("\n");
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const result = flat(converted);
  const fenced = new Map<number, boolean>();
  for (const [start, end] of fences(lines)) {
    // A fence that only includes a file is replaced whole; its lines are not expected to survive.
    const include = end === start + 2 && !!includedPath(lines[start + 1], context);
    for (let index = start; index <= end; index += 1) fenced.set(index, include);
  }
  for (const [index, line] of lines.entries()) {
    let kept: string;
    if (fenced.has(index)) kept = fenced.get(index) ? "" : line;
    else if (includedPath(line, context) || ALERT.test(line) || (context.extensions.attrList && BLOCK_ATTRIBUTES.test(line))) kept = "";
    else if (ADMONITION.test(line)) kept = line.match(ADMONITION)![4] ?? "";
    else if (TAB.test(line)) kept = line.match(TAB)![3];
    else if (htmlStartTag(line)) kept = line.replace(MARKDOWN_ATTRIBUTE, "");
    else kept = await convertLine(line.replace(/^(\s*)>[ ]?/, "$1"), context, () => undefined);
    kept = flat(kept);
    if (kept && !result.includes(kept))
      context.diagnostics.error({ file: context.file, line: index + 1, code: "mkdocs-content", message: `This line did not survive conversion: "${kept.length > 70 ? `${kept.slice(0, 67)}...` : kept}"` });
  }
  return converted;
}

/**
 * Material's annotations as footnotes: a block marked `{ .annotate }` shows
 * each `(1)` in its text as a note, and the numbered list after it holds the
 * notes in order. Each marker becomes a reference and each item its note,
 * numbered on through the page as Material numbers them.
 */
function annotationsAsFootnotes(source: string[]): string[] {
  const lines = [...source];
  // Labels of the page's own footnotes stay clear of the annotations'.
  const own = lines.some((line) => /\[\^[^\]\s]+\]/.test(line));
  let count = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const attributes = lines[index].match(BLOCK_ATTRIBUTES);
    const entries = attributes?.[2].split(/\s+/) ?? [];
    if (!entries.includes(".annotate") || !lines[index - 1].trim()) continue;
    const indent = lines[index].match(/^[ \t]*/)![0];
    let start = index;
    while (start > 0 && lines[start - 1].trim()) start -= 1;
    const labels = new Map<string, string>();
    for (let at = start; at < index; at += 1) {
      const code = [...lines[at].matchAll(/(`+)(?:(?!\1)[^`]|`(?!\1))*?\1/g)].map((match) => [match.index!, match.index! + match[0].length]);
      lines[at] = lines[at].replace(/[ \t]?\((\d+)\)/g, (match, number: string, offset: number) => {
        if (code.some(([open, close]) => offset >= open && offset < close)) return match;
        if (!labels.has(number)) labels.set(number, own ? `annotation-${++count}` : String(++count));
        return `[^${labels.get(number)}]`;
      });
    }
    if (!labels.size) continue;
    const rest = entries.filter((entry) => entry !== ".annotate");
    if (rest.length) lines[index] = `${indent}{${attributes![1]} ${rest.join(" ")} }`;
    else lines.splice(index--, 1);
    let at = index + 1;
    while (at < lines.length && !lines[at].trim()) at += 1;
    const item = new RegExp(`^${escapeRegExp(indent)}(\\d+)\\.[ \\t]+(.*)$`);
    const after = (from: number) => {
      while (from < lines.length && !lines[from].trim()) from += 1;
      return from;
    };
    for (let entry = item.exec(lines[at] ?? ""); entry && labels.has(entry[1]); at = after(at), entry = item.exec(lines[at] ?? "")) {
      lines[at] = `${indent}[^${labels.get(entry[1])}]: ${entry[2]}`;
      // An item's further lines, indented under it, are its note's, indented as a note's are.
      for (let next = after(at + 1); next < lines.length && lines[next].startsWith(`${indent} `); next = after(next + 1)) {
        lines[next] = `${indent}    ${lines[next].trimStart()}`;
        at = next;
      }
      at += 1;
    }
  }
  return lines;
}

/** Fenced code blocks at any indent, as [first line, last line] pairs; an unclosed fence runs to the end. */
function fences(lines: string[]): [number, number][] {
  const blocks: [number, number][] = [];
  let open: { char: string; length: number; start: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (open) {
      if (marker && marker[1][0] === open.char && marker[1].length >= open.length && !marker[2].trim()) {
        blocks.push([open.start, index]);
        open = undefined;
      }
    } else if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      open = { char: marker[1][0], length: marker[1].length, start: index };
    }
  }
  if (open) blocks.push([open.start, lines.length - 1]);
  return blocks;
}

/** A pymdownx.tabbed header: `=== "Label"`, with `===!` starting a new tab set. */
function tabHeader(line: string | undefined, indent?: string): { indent: string; newSet: boolean; label: string } | undefined {
  const match = line?.match(TAB);
  if (!match || (indent !== undefined && match[1] !== indent)) return undefined;
  return { indent: match[1], newSet: match[2] === "!", label: match[3] };
}

/** Lines indented under a block opener: the indented run, with interior blank lines, minus trailing blanks. */
function indentedBody(lines: string[], start: number, indent: string): { body: string[]; end: number } {
  const inner = `${indent}    `;
  let end = start;
  let last = start;
  while (end < lines.length && (!lines[end].trim() || lines[end].startsWith(inner) || lines[end].startsWith(`${indent}\t`))) {
    if (lines[end].trim()) last = end + 1;
    end += 1;
  }
  const body = lines.slice(start, last).map((line) => (line.startsWith(inner) ? line.slice(inner.length) : line.startsWith(`${indent}\t`) ? line.slice(indent.length + 1) : line.trim() ? line : ""));
  return { body, end: last };
}

async function convertBlock(lines: string[], context: SyntaxContext, line: number): Promise<string[]> {
  const { extensions, diagnostics, file } = context;
  const blocks = new Map(fences(lines));
  const output: string[] = [];
  const review = (offset: number, message: string) => diagnostics.review({ file, line: line + offset + 1, code: "mkdocs", message });

  for (let index = 0; index < lines.length; ) {
    const text = lines[index];
    const fenceEnd = blocks.get(index);
    if (fenceEnd !== undefined) {
      const include = fenceEnd === index + 2 ? await fencedInclude(lines, index, context, line) : undefined;
      output.push(...(include ? [include] : lines.slice(index, fenceEnd + 1)));
      index = fenceEnd + 1;
      continue;
    }

    const admonition = (extensions.admonition || extensions.details) && text.match(ADMONITION);
    if (admonition) {
      const [, indent, marker, type, title] = admonition;
      const { body, end } = indentedBody(lines, index + 1, indent);
      const converted = await convertBlock(body, context, line + index + 1);
      const native = CALLOUTS[type.toLowerCase()] ?? "note";
      const shown = title ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, " ");
      if (title === "") review(index, `The untitled ${type} admonition gets the native default title`);
      if (!CALLOUTS[type.toLowerCase()]) review(index, `Admonition type "${type}" has no native colour; it becomes a note`);
      const directive = marker === "!!!" ? native : "accordion";
      if (marker !== "!!!") review(index, `The collapsible ${type} becomes an accordion${marker === "???+" ? "; it no longer starts open" : ""}`);
      const label = directive === "accordion" || title || shown.toLowerCase() !== native ? `[${shown}]` : "";
      output.push(`${indent}:::${directive}${label}`, ...converted.map((item) => (item ? `${indent}${item}` : item)), `${indent}:::`);
      index = end;
      continue;
    }

    const tab = extensions.tabbed ? tabHeader(text) : undefined;
    if (tab) {
      const { indent } = tab;
      output.push(`${indent}:::tabs`);
      let header: ReturnType<typeof tabHeader> = tab;
      while (header) {
        const { body, end } = indentedBody(lines, index + 1, indent);
        const converted = await convertBlock(body, context, line + index + 1);
        output.push(`${indent}:::tab[${header.label}]`, ...converted.map((item) => (item ? `${indent}${item}` : item)), `${indent}:::`);
        index = end;
        // Blank lines may separate the tabs of one set; `===!` starts the next set.
        let next = index;
        while (next < lines.length && !lines[next].trim()) next += 1;
        header = tabHeader(lines[next], indent);
        if (header?.newSet) header = undefined;
        if (header) index = next;
      }
      output.push(`${indent}:::`);
      continue;
    }

    const alert = text.match(ALERT);
    // Native Markdown reads an alert written `> [!NOTE]` at the start of a line, as GitHub does.
    if (alert && text.startsWith("> [!")) {
      // Without gh-admonitions, MkDocs showed the marker as text.
      output.push(extensions.githubAlerts ? text : text.replace("[!", "\\[!"));
      index += 1;
      continue;
    }
    if (alert && extensions.githubAlerts) {
      const indent = alert[1];
      const [native, title] = GITHUB_ALERTS[alert[2]];
      let end = index + 1;
      const body: string[] = [];
      while (end < lines.length && new RegExp(`^${escapeRegExp(indent)}>`).test(lines[end])) {
        body.push(lines[end].slice(indent.length).replace(/^>[ ]?/, ""));
        end += 1;
      }
      const converted = await convertBlock(body, context, line + index + 1);
      const label = title.toLowerCase() === native ? "" : `[${title}]`;
      output.push(`${indent}:::${native}${label}`, ...converted.map((item) => (item ? `${indent}${item}` : item)), `${indent}:::`);
      index = end;
      continue;
    }

    const snippet = extensions.snippets && text.match(SNIPPET);
    const included = extensions.include !== undefined && text.match(INCLUDE);
    if (snippet || included) {
      const [, indent, path] = (snippet || included) as RegExpMatchArray;
      const target = await includeTarget(path, context, line + index);
      output.push(target ? `${indent}<Include src="${target}" />` : text);
      index += 1;
      continue;
    }
    if ((extensions.snippets && /--8<--/.test(text)) || (extensions.include !== undefined && /\{![^!]+!\}/.test(text))) {
      diagnostics.error({ file, line: line + index + 1, code: "mkdocs-include", message: "This include form (inline, sectioned or multi-file) has no native conversion" });
      output.push(text);
      index += 1;
      continue;
    }

    const blockAttributes = extensions.attrList && index > 0 && lines[index - 1].trim() && text.match(BLOCK_ATTRIBUTES);
    if (blockAttributes && isAttributeList(blockAttributes[2], blockAttributes[1] === ":")) {
      review(index, "A block attribute list (classes or attributes) was removed");
      index += 1;
      continue;
    }
    output.push(await convertLine(text, context, () => review(index, "Presentation attributes, icons or inline highlight markers were removed")));
    index += 1;
  }
  return extensions.mdInHtml ? openMarkdownHtml(output) : output;
}

/** A fence whose only line includes a file becomes a native code include. */
async function fencedInclude(lines: string[], index: number, context: SyntaxContext, line: number): Promise<string | undefined> {
  const [indent, language] = lines[index].match(/^(\s*)(?:`{3,}|~{3,})[ \t]*([\w+-]*)/)!.slice(1);
  const path = includedPath(lines[index + 1], context);
  if (!path) return undefined;
  const target = await includeTarget(path, context, line + index + 1);
  return target && `${indent}<Include src="${target}"${language ? ` language="${language}"` : ""} />`;
}

/** The file a whole-line snippet or markdown_include names, when that extension is enabled. */
function includedPath(line: string, context: SyntaxContext): string | undefined {
  return (context.extensions.snippets && line.match(SNIPPET)?.[2]) || (context.extensions.include !== undefined && line.match(INCLUDE)?.[2]) || undefined;
}

/** An include path relative to the including document, resolved against the extension's base paths. */
async function includeTarget(path: string, context: SyntaxContext, line: number): Promise<string | undefined> {
  const bases = context.extensions.snippets ?? (context.extensions.include !== undefined ? [context.extensions.include] : []);
  for (const base of [...bases, posix.dirname(context.file)]) {
    const candidate = posix.normalize(posix.join(base, path));
    if (candidate.startsWith("..")) continue;
    if (await context.exists(candidate)) {
      const relative = posix.relative(posix.dirname(context.file), candidate);
      return relative.startsWith(".") ? relative : `./${relative}`;
    }
  }
  context.diagnostics.error({ file: context.file, line: line + 1, code: "mkdocs-include", message: `Included file "${path}" was not found inside the project` });
  return undefined;
}

/** One prose line as native Markdown: inline syntax, then asset URLs. */
async function convertLine(text: string, context: SyntaxContext, reportRemoval: () => void): Promise<string> {
  // MkDocs leaves raw HTML alone, so its URLs are relative to the page URL; `/x` reaches docs_dir.
  return siteFileUrls(convertProse(text, context, reportRemoval), { file: context.file, route: context.route, root: context.docsDir, exists: context.exists });
}

/** The page's first H1 as Python-Markdown reads it, which MkDocs takes as the page title. */
export function pageHeading(markdown: string): string | undefined {
  return firstHeadingText(markdown.split("\n").map(headingSpace).join("\n"), 1);
}

/**
 * Python-Markdown reads every line that opens with `#` as a heading and strips
 * Unicode spaces from its text (`#Install`, `#\u00a0Prune`); CommonMark needs a
 * space or tab after the hashes.
 */
function headingSpace(text: string): string {
  const hashes = text.match(/^(#{1,6})(?!#)(\s*)(?=\S)/);
  return hashes && !/^[ \t]+$/.test(hashes[2]) ? `${hashes[1]} ${text.slice(hashes[0].length)}` : text;
}

/** Inline syntax on a prose line: heading IDs from attr_list stay native, presentation-only markup goes. */
function convertProse(line: string, context: SyntaxContext, reportRemoval: () => void): string {
  const { extensions } = context;
  const text = headingSpace(line);
  const heading = extensions.attrList && text.match(HEADING_ATTRIBUTES);
  if (heading && isAttributeList(heading[2], true)) {
    const entries = heading[2].split(/\s+/);
    const id = entries.find((entry) => entry.startsWith("#"));
    if (entries.some((entry) => !entry.startsWith("#"))) reportRemoval();
    return id ? `${heading[1]} {${id}}` : heading[1];
  }
  const code = [...text.matchAll(/(`+)(?:(?!\1)[^`]|`(?!\1))*?\1/g)].map((match) => [match.index!, match.index! + match[0].length]);
  const outside = (offset: number) => !code.some(([start, end]) => offset >= start && offset < end);
  let result = text;
  if (extensions.attrList)
    result = result.replace(INLINE_ATTRIBUTES, (match, colon: string, content: string, offset: number) =>
      outside(offset) && isAttributeList(content, colon === ":") ? "" : match,
    );
  if (extensions.emoji) result = result.replace(ICON_SHORTCODE, (match, offset: number) => (outside(offset) ? "" : match));
  if (extensions.inlineHilite) result = result.replace(INLINE_HILITE, "`$2`");
  if (result !== text) reportRemoval();
  return result.replace(NON_WEB_AUTOLINK, (match, target: string, offset: number) => (outside(offset) ? `\\<${target}>` : match));
}

/** Python-Markdown's attr_list: every entry is an attribute, and one names an id, class or value (or it opens with `:`). */
function isAttributeList(content: string, colon = false): boolean {
  const entries = content.match(/[^\s=]+=(?:"[^"]*"|'[^']*'|\S+)|\S+/g) ?? [];
  if (!entries.length || !entries.every((entry) => ATTRIBUTE.test(entry))) return false;
  return colon || entries.some((entry) => /^[#.]|=/.test(entry));
}

/** An HTML start tag alone on its line: indent, tag name and attributes. */
function htmlStartTag(line: string): { indent: string; tag: string; attributes: string } | undefined {
  const match = line.match(/^(\s*)<([a-z][\w-]*)\b([^>]*)>\s*$/i);
  if (!match || match[3].trim().endsWith("/") || VOID_ELEMENTS.has(match[2].toLowerCase())) return undefined;
  return { indent: match[1], tag: match[2], attributes: match[3] };
}

/**
 * md_in_html renders Markdown inside an HTML block marked `markdown`.
 * CommonMark does the same once blank lines separate the content from its
 * tags, so add them and drop the attribute.
 */
function openMarkdownHtml(lines: string[]): string[] {
  const output: string[] = [];
  const open: { tag: string; markdown: boolean }[] = [];
  const fenced = new Set(fences(lines).flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, offset) => start + offset)));
  for (const [index, line] of lines.entries()) {
    if (fenced.has(index)) {
      output.push(line);
      continue;
    }
    const start = htmlStartTag(line);
    if (start) {
      const plain = start.attributes.replace(MARKDOWN_ATTRIBUTE, "");
      const markdown = plain !== start.attributes;
      if (markdown || open.length) open.push({ tag: start.tag.toLowerCase(), markdown });
      output.push(...(markdown ? [`${start.indent}<${start.tag}${plain}>`, ""] : [line]));
      continue;
    }
    const end = line.match(/^\s*<\/([a-z][\w-]*)>\s*$/i);
    if (end && open.at(-1)?.tag === end[1].toLowerCase()) {
      output.push(...(open.pop()!.markdown ? ["", line] : [line]));
      continue;
    }
    output.push(line);
  }
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
