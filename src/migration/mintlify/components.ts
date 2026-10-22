/**
 * Mintlify's components, which pages use without imports. Most are native
 * Sourcey components already; each keeps its bytes when native reads every
 * attribute it sets, and otherwise keeps what native reads and reports the rest.
 */
import { posix } from "node:path";
import type { Tokens } from "marked";
import type { JsonValue } from "../../core/markdown-components.js";
import { slugify } from "../../utils/slug.js";
import { hasIcon, isImageIcon } from "../../utils/icons.js";
import { headingInfo, lexMarkdown } from "../../utils/markdown.js";
import { attributeText, identityKey, rejectDynamic, unsupportedAttributes, type ComponentConverter, type ConversionFailure, type ConverterTable, type ElementInput } from "../components.js";
import { mintlifySlug } from "./fragments.js";
import { isAbsoluteHttpUrl } from "../../site-url.js";

/** The module identity Mintlify's global components resolve to. */
const MINTLIFY = "mintlify";

interface Shape {
  /** The native component; the same name unless it differs. */
  native?: string;
  /** Attributes native reads. */
  keep?: string[];
  /** Presentation native does not carry; reported, not an error. */
  presentation?: string[];
}

const CALLOUT: Shape = { keep: ["title"], presentation: ["type", "icon", "color"] };
const SHAPES: Record<string, Shape> = {
  Note: CALLOUT,
  Warning: CALLOUT,
  Info: CALLOUT,
  Tip: CALLOUT,
  Danger: CALLOUT,
  Check: { ...CALLOUT, native: "Tip" },
  Steps: { presentation: ["titleSize"] },
  Step: { keep: ["title"], presentation: ["icon", "iconType", "titleSize"] },
  Tabs: {},
  Tab: { keep: ["title"], presentation: ["icon", "iconType", "id"] },
  CardGroup: { keep: ["cols"] },
  Card: { keep: ["title", "href", "icon"], presentation: ["iconType", "horizontal", "color", "arrow", "cta"] },
  AccordionGroup: {},
  Expandable: { keep: ["title"] },
  CodeGroup: {},
  Badge: { presentation: ["color", "size", "shape", "icon", "stroke", "disabled"] },
};

/** Components a Mintlify page uses without importing them, as `module#export` by tag name. */
export const MINTLIFY_GLOBALS: ReadonlyMap<string, string> = new Map(
  [...Object.keys(SHAPES), "Accordion", "Frame", "Snippet", "ParamField", "ResponseField", "RequestExample", "ResponseExample", "View", "Update", "Tooltip", "Icon", "Columns", "Tile", "Tree", "Latex", "Panel", "Color", "Prompt", "Visibility"].map(
    (name) => [name, identityKey(MINTLIFY, name)],
  ),
);

/**
 * An icon as native names it: a URL as written, an image as the page's own
 * path to it (Mintlify paths start at the project root), a Font Awesome brand
 * (`iconType="brands"`) as `brand:<name>`, or a name in the project's icon set;
 * `missing` when the set has no icon of that name.
 */
async function nativeIcon(element: ElementInput, icon: string): Promise<{ icon: string } | { missing: true } | ConversionFailure> {
  if (isAbsoluteHttpUrl(icon)) return { icon };
  if (attributeText(element.props.iconType) === "brands") return hasIcon("brands", icon) ? { icon: `brand:${icon}` } : { missing: true };
  if (!isImageIcon(icon)) return hasIcon(element.project.icons, icon) ? { icon } : { missing: true };
  const path = posix.normalize(icon.replace(/^\/+/, ""));
  if (path.startsWith("..") || !(await element.project.exists(path))) return { error: `<${element.name}> icon ${icon} is not a file in the project` };
  return { icon: element.project.relative(path) };
}

/**
 * Mintlify anchors each accordion at its `id`, or its title in lowercase kebab
 * case, so links open it; native keeps that as the accordion's `anchor`. An
 * anchor the page already has, from a heading or an earlier accordion, stays
 * with that, as a browser found it first.
 */
function accordionConverter(): ComponentConverter {
  const pages = new Map<string, Promise<Set<string>>>();
  const presentation = ["icon", "iconType", "defaultOpen", "query"];
  return async (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["title", "id", ...presentation]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    const title = attributeText(element.props.title) ?? "";
    const anchor = attributeText(element.props.id) ?? slugify(title);
    if (!pages.has(element.file)) pages.set(element.file, element.project.readText(element.file).then(headingAnchors));
    const taken = await pages.get(element.file)!;
    const kept = Boolean(anchor) && !taken.has(anchor);
    if (kept) taken.add(anchor);
    const dropped = presentation.filter((attribute) => element.props[attribute] !== undefined);
    const notes = [...(dropped.length ? [`${dropped.join(", ")} is not carried over`] : []), ...(anchor && !kept ? [`its anchor #${anchor} stays with the page's earlier heading or accordion`] : [])];
    return { component: "Accordion", props: { title, ...(kept ? { anchor } : {}) }, review: notes.length ? `<${element.name}> "${title}": ${notes.join("; ")}` : undefined };
  };
}

/** The anchors a page's headings have natively, current and earlier spellings. */
function headingAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  for (const token of lexMarkdown(source)) {
    if (token.type !== "heading") continue;
    const { id, previousId } = headingInfo(token as Tokens.Heading);
    let numbered = id;
    for (let suffix = 1; anchors.has(numbered); suffix += 1) numbered = `${id}-${suffix}`;
    anchors.add(numbered).add(previousId);
  }
  return anchors;
}

function shaped(name: string, shape: Shape): ComponentConverter {
  return async (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const keep = shape.keep ?? [];
    const presentation = shape.presentation ?? [];
    const extra = unsupportedAttributes(element, [...keep, ...presentation]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    const written = keep.includes("icon") ? attributeText(element.props.icon) : undefined;
    const icon = written === undefined ? undefined : await nativeIcon(element, written);
    if (icon && "error" in icon) return icon;
    // A name outside the project's set would stop the build; the card keeps its content without it.
    const missing = icon !== undefined && "missing" in icon;
    // A brand's icon type is in its native name.
    const styled = presentation.filter((attribute) => element.props[attribute] !== undefined && !(attribute === "iconType" && icon && "icon" in icon && icon.icon.startsWith("brand:")));
    const dropped = [...styled, ...(missing ? [`icon "${written}"`] : [])];
    const component = shape.native ?? name;
    const moved = icon !== undefined && "icon" in icon && icon.icon !== written;
    if (!dropped.length && !moved && component === element.name) return { keep: true };
    const props: Record<string, JsonValue> = {};
    // In the order the source wrote them.
    for (const [attribute, value] of Object.entries(element.props)) {
      if (!keep.includes(attribute)) continue;
      if (attribute !== "icon") props[attribute] = value;
      else if (icon && "icon" in icon) props.icon = icon.icon;
    }
    return { component, props, review: dropped.length ? `<${element.name}> ${dropped.join(", ")} is not carried over` : undefined };
  };
}

function missing(element: ElementInput) {
  return { error: `<${element.name}> has no native equivalent yet`, suggestion: "Convert it in the --mapping file's components, or wait for the native component." };
}

/** The attribute that names each Mintlify field; a `ParamField` names it by where the parameter goes. */
const FIELD_NAMES: Record<string, string[]> = { ParamField: ["path", "query", "body", "header"], ResponseField: ["name"] };

/**
 * Mintlify fields as native `Field`s, keeping the anchor Mintlify gave each:
 * `param-` and the name in Mintlify's kebab case, numbered `-1`, `-2` when a
 * page repeats it.
 * `optional` is the absence of `required`; Mintlify does not show the location.
 */
function fieldConverter(locations: string[], anchors: Map<string, Map<string, number>>): ComponentConverter {
  return (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const named = locations.filter((attribute) => element.props[attribute] !== undefined);
    if (named.length !== 1) return { error: `<${element.name}> must name its field with one of ${locations.join(", ")}` };
    const extra = unsupportedAttributes(element, [...locations, "type", "required", "optional", "default", "min", "max", "deprecated"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    const bounds: Record<string, number> = {};
    for (const bound of ["min", "max"]) {
      const value = element.props[bound];
      if (value === undefined) continue;
      const number = typeof value === "number" ? value : Number(attributeText(value));
      if (!Number.isFinite(number) || attributeText(value)?.trim() === "") return { error: `<${element.name}> ${bound} must be a number` };
      bounds[bound] = number;
    }
    const name = attributeText(element.props[named[0]])!;
    const seen = anchors.get(element.file) ?? new Map<string, number>();
    anchors.set(element.file, seen);
    const anchor = `param-${mintlifySlug(name)}`;
    const repeat = seen.get(anchor) ?? 0;
    seen.set(anchor, repeat + 1);
    const props: Record<string, JsonValue> = {
      name,
      ...(element.props.type !== undefined ? { type: attributeText(element.props.type)! } : {}),
      ...(element.props.required === true ? { required: true } : {}),
      ...(element.props.deprecated === true ? { deprecated: true } : {}),
      ...(element.props.default !== undefined ? { default: element.props.default } : {}),
      ...bounds,
      anchor: repeat ? `${anchor}-${repeat}` : anchor,
    };
    return { component: "Field", props };
  };
}

export function mintlifyConverters(): ConverterTable {
  const table: ConverterTable = new Map();
  for (const [name, shape] of Object.entries(SHAPES)) table.set(identityKey(MINTLIFY, name), shaped(name, shape));
  const anchors = new Map<string, Map<string, number>>();
  for (const [name, locations] of Object.entries(FIELD_NAMES)) table.set(identityKey(MINTLIFY, name), fieldConverter(locations, anchors));
  // A frame borders its content; a captioned frame around one image is a native figure.
  table.set(identityKey(MINTLIFY, "Frame"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["caption"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    const caption = attributeText(element.props.caption);
    if (caption === undefined) return { unwrap: true, review: "The frame around this content is not carried over" };
    const image = element.children.trim().match(/^(?:<img\s+(?=[^>]*\bsrc="([^"]+)")(?=(?:[^>]*\balt="([^"]*)")?)[^>]*\/?>|!\[([^\]]*)\]\(([^)\s]+)\))$/);
    if (!image) return { error: `<${element.name}> caption frames one image as a native figure; this frame holds other content` };
    const [src, alt] = image[1] ? [image[1], image[2] ?? ""] : [image[4], image[3]];
    return { markdown: `<Figure src="${src}" alt="${alt.replace(/"/g, "&quot;")}" caption="${caption.replace(/"/g, "&quot;")}" />` };
  });
  table.set(identityKey(MINTLIFY, "Accordion"), accordionConverter());
  // An icon in a sentence is native's inline icon. Mintlify draws it with no name for assistive technology.
  table.set(identityKey(MINTLIFY, "Icon"), async (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["icon", "iconType", "size", "color"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    const written = attributeText(element.props.icon);
    if (!written) return { error: `<${element.name}> names its icon with icon="..."` };
    const icon = await nativeIcon(element, written);
    if ("error" in icon) return icon;
    if ("missing" in icon) return { error: `<${element.name}> icon "${written}" is not in ${attributeText(element.props.iconType) === "brands" ? "Font Awesome's brand marks" : `the project's ${element.project.icons} set`}`, suggestion: "Name an icon the set has, or an image file." };
    const dropped = ["iconType", "size", "color"].filter((attribute) => element.props[attribute] !== undefined && !(attribute === "iconType" && icon.icon.startsWith("brand:")));
    return {
      component: "Icon",
      props: { icon: icon.icon },
      review: `<${element.name}> "${written}" has no label, so the page's Markdown and assistive technology read the sentence without it; add label="..." to name what it shows${dropped.length ? `. ${dropped.join(", ")} is not carried over` : ""}`,
    };
  });
  // Columns of cards are a card group.
  table.set(identityKey(MINTLIFY, "Columns"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["cols"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    if (element.children.replace(/<Card\b[^>]*\/>|<Card\b[\s\S]*?<\/Card>/g, "").trim()) return { error: `<${element.name}> holds content other than cards, which native columns do not lay out` };
    const props: Record<string, JsonValue> = element.props.cols === undefined ? {} : { cols: Number(attributeText(element.props.cols)) };
    return { component: "CardGroup", props };
  });
  // Views are a page's alternatives under one switcher; native shows each as a titled section the reader opens.
  table.set(identityKey(MINTLIFY, "View"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const extra = unsupportedAttributes(element, ["title", "icon"]);
    if (extra.length) return { error: `<${element.name}> attribute ${extra.join(", ")} has no native equivalent yet` };
    return { component: "Accordion", props: { title: attributeText(element.props.title) ?? "" }, review: `<${element.name}> "${attributeText(element.props.title) ?? ""}" becomes a section the reader opens; native has no page-wide view switcher` };
  });
  // Content for people shows on the page; content for agents is native's agent-only block.
  table.set(identityKey(MINTLIFY, "Visibility"), (element) => {
    const failure = rejectDynamic(element);
    if (failure) return failure;
    const audience = attributeText(element.props.for);
    if (unsupportedAttributes(element, ["for"]).length || (audience !== "humans" && audience !== "agents")) return { error: `<${element.name}> names its audience with for="humans" or for="agents"` };
    if (audience === "agents") return { component: "ForAgents", review: `<${element.name} for="agents"> stays in the page's Markdown export for agents and out of the page, as <ForAgents>` };
    return { unwrap: true, review: `<${element.name} for="humans"> content is also in the page's Markdown export, which agents read` };
  });
  table.set(identityKey(MINTLIFY, "Snippet"), (element) => {
    const file = attributeText(element.props.file);
    if (!file || rejectDynamic(element) || unsupportedAttributes(element, ["file"]).length) return { error: `<${element.name}> must name only its file` };
    return { component: "Include", props: { src: element.project.relative(`snippets/${file}`) } };
  });
  for (const name of MINTLIFY_GLOBALS.keys()) if (!table.has(identityKey(MINTLIFY, name))) table.set(identityKey(MINTLIFY, name), missing);
  return table;
}
