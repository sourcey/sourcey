/** Docusaurus theme components as native components, by module and export identity. */
import type { JsonValue } from "../../core/markdown-components.js";
import { inlineText, lexMarkdown } from "../../utils/markdown.js";
import type { Tokens } from "marked";
import { attributeText, identityKey, rejectDynamic, tabSelectionReview, unsupportedAttributes, type ConverterTable } from "../components.js";
import { markdownText } from "../text-edits.js";
import { nativeCallout } from "./markdown.js";

const NATIVE_CALLOUTS: Record<string, string> = { note: "Note", tip: "Tip", info: "Info", warning: "Warning", danger: "Danger", caution: "Caution" };

export function docusaurusConverters(): ConverterTable {
  const table: ConverterTable = new Map();

  table.set(identityKey("@theme/Tabs", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["groupId", "queryString", "defaultValue", "className", "lazy", "values"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    if (element.props.values !== undefined) {
      const listed = tabValues(element.props.values);
      if (!listed) return { error: `<${element.name}> attribute values must list each tab as { value, label }` };
      // Docusaurus shows the tabs in the order `values` lists them; native tabs show them as written.
      const written = writtenTabValues(element.children);
      const order = [...listed.keys()].filter((value) => written.includes(value));
      if (order.some((value, index) => value !== written.filter((item) => listed.has(item))[index]))
        return { error: `<${element.name}> lists its tabs in values in another order than it writes them`, suggestion: "Write the tab items in the order values lists them." };
    }
    return { component: "Tabs", review: tabSelectionReview(element, ["groupId", "queryString", "defaultValue"]) };
  });

  // A tab without a label shows the label its tabs' values give it, else its value.
  table.set(identityKey("@theme/TabItem", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["value", "label", "default", "className"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const value = attributeText(element.props.value);
    const tabs = element.parent && identityKey(element.parent.module, element.parent.export) === identityKey("@theme/Tabs", "default") ? element.parent : undefined;
    const listed = value === undefined ? undefined : tabValues(tabs?.props.values)?.get(value);
    return {
      component: "Tab",
      props: { title: attributeText(element.props.label) ?? listed ?? value ?? "" },
      review: tabSelectionReview(element, ["default"]),
    };
  });

  table.set(identityKey("@theme/Admonition", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["type", "title"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const callout = nativeCallout(attributeText(element.props.type) ?? "note");
    const title = attributeText(element.props.title) ?? callout.title;
    return { component: NATIVE_CALLOUTS[callout.type], ...(title ? { props: { title } } : {}) };
  });

  // Written `<DocCardList items={useCurrentSidebarCategory().items} />` or bare: the pages of the category this page lands.
  table.set(identityKey("@theme/DocCardList", "default"), (element) => {
    const extra = unsupportedAttributes(element, ["items", "className"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const section = element.section(element.route);
    if (!section) return { error: `<${element.name}> lists a category, and ${element.route} is not a category's own page` };
    return { component: "PageCards", props: { section } };
  });

  table.set(identityKey("@docusaurus/Link", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["to", "href"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const href = attributeText(element.props.to) ?? attributeText(element.props.href);
    if (!href) return { error: `<${element.name}> has no destination` };
    return { markdown: `[${element.children.trim() || markdownText(href)}](${href})` };
  });

  // Docusaurus highlights a code block whose children are a string; children written as lines are a paragraph it shows
  // in the block with its line breaks. Either is the fenced block's code, read as Docusaurus reads it.
  table.set(identityKey("@theme/CodeBlock", "default"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["language", "className", "title", "metastring", "showLineNumbers"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const classes = attributeText(element.props.className)?.split(" ").filter(Boolean) ?? [];
    const styled = classes.filter((name) => !name.startsWith("language-"));
    if (styled.length) return { error: `<${element.name}> class ${styled.join(" ")} has no native equivalent` };
    const code = typeof element.childValue === "string" ? element.childValue.replace(/\r?\n$/, "") : paragraphLines(element.children);
    if (code === undefined) return { error: `<${element.name}> children must be one string or lines of text` };
    // As Docusaurus decides them: the language attribute, else the class, else plain text; a title in the metastring wins.
    const language = (attributeText(element.props.language) ?? classes.find((name) => name.startsWith("language-"))?.slice(9) ?? "text").toLowerCase();
    const metastring = attributeText(element.props.metastring);
    const title = /title=(["'])(.*?)\1/.test(metastring ?? "") ? undefined : attributeText(element.props.title);
    const numbered = element.props.showLineNumbers !== undefined && element.props.showLineNumbers !== false;
    return {
      fence: { language, code, meta: [title === undefined ? "" : `title=${JSON.stringify(title)}`, metastring ?? ""].filter(Boolean).join(" ") },
      ...(numbered ? { review: `<${element.name}> converts without showLineNumbers: native code blocks do not number their lines` } : {}),
    };
  });

  // Docusaurus shows the picture for the reader's colour scheme; a native figure has both.
  table.set(identityKey("@theme/ThemedImage", "default"), async (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["sources", "alt"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent` };
    const sources = element.props.sources;
    if (!sources || typeof sources !== "object" || Array.isArray(sources) || typeof sources.light !== "string" || typeof sources.dark !== "string")
      return { error: `<${element.name}> sources must give a light and a dark picture` };
    const [light, dark] = await Promise.all([sources.light, sources.dark].map((url) => element.project.staticFile(url)));
    if (!light || !dark)
      return { error: `<${element.name}> picture ${!light ? sources.light : sources.dark} is not a file in the site's static directories` };
    return { component: "Figure", props: { src: element.project.relative(light), darkSrc: element.project.relative(dark), alt: attributeText(element.props.alt) ?? "" } };
  });

  return table;
}

/**
 * Children written as lines of text, as MDX reads them: paragraphs whose lines
 * lose their indentation and whose Markdown is read as text. Undefined when
 * they hold anything but paragraphs, such as elements, expressions or a list.
 */
function paragraphLines(children: string): string | undefined {
  if (/[{}]|<[A-Za-z/!]/.test(children)) return undefined;
  const paragraphs = children.split(/\r?\n/).map((line) => line.trim()).join("\n").split(/\n{2,}/).filter(Boolean);
  const text: string[] = [];
  for (const paragraph of paragraphs) {
    const blocks = lexMarkdown(paragraph).filter((token) => token.type !== "space");
    if (blocks.length !== 1 || blocks[0].type !== "paragraph") return undefined;
    text.push(inlineText((blocks[0] as Tokens.Paragraph).tokens));
  }
  return text.length ? text.join("\n\n") : undefined;
}

/** A tabs element's `values`, `[{ value, label }]`, as each value's label (a value without one shows itself); undefined in any other shape. */
function tabValues(values: JsonValue | undefined): Map<string, string> | undefined {
  if (!Array.isArray(values)) return undefined;
  const labels = new Map<string, string>();
  for (const entry of values) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.value !== "string") return undefined;
    labels.set(entry.value, typeof entry.label === "string" ? entry.label : entry.value);
  }
  return labels;
}

/** The `value` of each component written directly in a tabs element's children, in order: its items. */
function writtenTabValues(children: string): string[] {
  const values: string[] = [];
  let depth = 0;
  for (const [, closing, attributes, selfClosing] of children.matchAll(/<(\/?)[A-Z][\w.]*\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    if (closing) {
      depth--;
      continue;
    }
    const value = depth === 0 ? /\bvalue=(?:"([^"]*)"|'([^']*)')/.exec(attributes) : null;
    if (value) values.push(value[1] ?? value[2]);
    if (!selfClosing) depth++;
  }
  return values;
}
