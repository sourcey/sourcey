/**
 * Docusaurus Markdown: the text rewrites its MDX loader applies before
 * parsing (`preprocessContent` in @docusaurus/mdx-loader 3), and its
 * admonition keywords as the native callouts they render as.
 */
import { parseMarkdown, walk } from "../mdx.js";
import type { Rewrite } from "../plan.js";
import { applyEdits, lineAt, lineMap, type TextEdit } from "../text-edits.js";

/** Docusaurus's default admonition keywords; `admonitions.keywords` extends them. */
export const DEFAULT_ADMONITIONS = ["secondary", "info", "success", "danger", "note", "tip", "warning", "important", "caution"];

/**
 * The native callout each keyword renders as. The theme's legacy aliases show
 * their own name as the title; a keyword the theme does not know falls back to info.
 */
const CALLOUTS: Record<string, { type: string; title?: string }> = {
  note: { type: "note" },
  tip: { type: "tip" },
  info: { type: "info" },
  warning: { type: "warning" },
  danger: { type: "danger" },
  caution: { type: "caution" },
  secondary: { type: "note", title: "Secondary" },
  important: { type: "info", title: "Important" },
  success: { type: "tip", title: "Success" },
};

export function nativeCallout(keyword: string): { type: string; title?: string } {
  return CALLOUTS[keyword] ?? { type: "info" };
}

/**
 * ` ```mdx-code-block ` fences hold live MDX, which Docusaurus unwraps before
 * parsing by dropping the fence lines; `line` gives a line of the text it then
 * reads as the line of the content it was.
 */
function unwrapMdxCodeBlocks(content: string): Rewrite {
  const unwrap = (text: string, pattern: RegExp) => {
    // The source lines each fence took, in order.
    const dropped: number[] = [];
    const unwrapped = text.replaceAll(pattern, (...args: unknown[]) => {
      const groups = args.at(-1) as Record<string, string>;
      const opening = lineAt(text, (args.at(-3) as number) + groups.begin.length)!;
      dropped.push(opening, opening + groups.children.split("\n").length + 1);
      return `${groups.begin}${groups.children}${groups.end}`;
    });
    return { text: unwrapped, line: (line: number) => dropped.reduce((at, fence) => (fence <= at ? at + 1 : at), line) };
  };
  const three = unwrap(content, /(?<begin>^|\r?\n)(?<indentStart>\x20*)```(?<spaces>\x20*)mdx-code-block\r?\n(?<children>.*?)\r?\n(?<indentEnd>\x20*)```(?<end>\r?\n|$)/gs);
  const four = unwrap(three.text, /(?<begin>^|\r?\n)(?<indentStart>\x20*)````(?<spaces>\x20*)mdx-code-block\r?\n(?<children>.*?)\r?\n(?<indentEnd>\x20*)````(?<end>\r?\n|$)/gs);
  return { text: four.text, line: (line) => three.line(four.line(line)) };
}

/** The legacy `:::note Title` form as a directive label, `:::note[Title]`, everywhere Docusaurus rewrites it (code included). */
function admonitionLabels(content: string, keywords: readonly string[]): string {
  const pattern = new RegExp(`^(?<quote>(> ?)*)(?<indentation>( +|\\t+))?(?<directive>:{3,}(${keywords.join("|")})) +(?<title>.*)$`, "gm");
  return content.replaceAll(pattern, (...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    return `${groups.quote ?? ""}${groups.indentation ?? ""}${groups.directive}[${groups.title}]`;
  });
}

/** The site's `markdown.preprocessor`, which Docusaurus runs on a document before anything else reads it. */
export type SitePreprocessor = (file: string, content: string) => string;

/**
 * A document's text after the site's preprocessor, and the line of the
 * source each of its lines was: a line the preprocessor put in is the line
 * it took the place of.
 */
function sitePreprocessed(preprocessor: SitePreprocessor | undefined, file: string, content: string): Rewrite {
  const text = preprocessor ? preprocessor(file, content) : content;
  return { text, line: lineMap(content, text) };
}

/**
 * How Docusaurus reads a document's text before parsing it, in
 * `preprocessContent`'s order: the site's preprocessor, then its own. Its
 * heading ids are the dialect's (`headingIds`), which reads them where they are written.
 */
export function docusaurusPreprocess(keywords: readonly string[], compat: Mdx1Compat, preprocessor?: SitePreprocessor): (file: string) => (source: string) => string {
  return (file) => (source) => {
    const unwrapped = unwrapMdxCodeBlocks(sitePreprocessed(preprocessor, file, source).text).text;
    return compat.admonitions ? admonitionLabels(unwrapped, keywords) : unwrapped;
  };
}

/** The MDX 1 syntax Docusaurus 3 reads before parsing, as `markdown.mdx1Compat` turns it on. */
export interface Mdx1Compat {
  headingIds: boolean;
  admonitions: boolean;
}

/**
 * The conversion's rewrites around parsing a document: before, the site's
 * preprocessor and the code blocks Docusaurus unwraps; after, admonitions as
 * native callouts.
 */
export function docusaurusConversion(keywords: readonly string[], compat: Mdx1Compat, preprocessor?: SitePreprocessor): (file: string) => { before(source: string): Rewrite; after(text: string): Promise<string> } {
  return (file) => ({
    before: (source) => {
      const preprocessed = sitePreprocessed(preprocessor, file, source);
      const unwrapped = unwrapMdxCodeBlocks(preprocessed.text);
      return { text: unwrapped.text, line: (line) => preprocessed.line(unwrapped.line(line)) };
    },
    after: (text) => nativeAdmonitions(text, keywords, compat),
  });
}

/**
 * Admonitions as native callouts: the label form, then each keyword native
 * Markdown does not read renamed to the callout it rendered as, titled as it was.
 */
async function nativeAdmonitions(text: string, keywords: readonly string[], compat: Mdx1Compat): Promise<string> {
  const labelled = compat.admonitions ? admonitionLabels(text, keywords) : text;
  const edits: TextEdit[] = [];
  for (const { node } of walk(await parseMarkdown(labelled, 0, { directives: true }))) {
    if (node.type !== "containerDirective" || !node.name || !keywords.includes(node.name) || !node.position) continue;
    const callout = nativeCallout(node.name);
    if (callout.type === node.name) continue;
    const start = labelled.indexOf(node.name, node.position.start.offset);
    const label = node.children?.[0]?.data?.directiveLabel;
    edits.push({ start, end: start + node.name.length, text: `${callout.type}${!label && callout.title ? `[${callout.title}]` : ""}` });
  }
  return applyEdits(labelled, edits);
}
