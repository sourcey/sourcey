import { STATIC_ASSET_EXTENSIONS, staticMediaAsset, type FigureOptions, type ImageVariant } from "./media.js";
import { isNavGroup, walkNavGroups, type SiteTab, type SiteNavGroup } from "./navigation.js";
import { rewriteMarkdownDestinations, rewriteMarkdownHtml } from "../utils/markdown-links.js";
import type { Links, Token, Tokens, TokensList } from "marked";
import { resolve, dirname, relative, isAbsolute, extname } from "node:path";
import { isAbsoluteHttpUrl, toPublicPath } from "../site-url.js";
import { createHash } from "node:crypto";
import { canonicalInputPath } from "./loader.js";
import type { InputReader } from "./loader.js";
import type { NormalizedSchema } from "./types.js";
import { escapeAttr, escapeHtml, safeUrl, rewriteHtmlUrls, sanitizeRenderedHtml } from "../utils/html.js";
import { escapeGeneratedMarkers, forEachToken, generatedMarker, renderMarkdown, renderMarkdownInline, renderCodeBlock, parseCodeFenceInfo, type CodeFenceMetadata, type MarkdownRenderOptions, type PageHeading, lexMarkdown, headingInfo, pageLinkHref, PAGE_CONTENT, withFootnotes, footnoteAnchors } from "../utils/markdown.js";
import { iconDrawing, iconSource, iconSvg, isImageIcon, type IconPresentation } from "../utils/icons.js";
import { ALERT, ALERT_TYPE, CALLOUTS, alertBody, alertCallout, isCallout, renderCallout, type CalloutKind } from "../utils/callouts.js";
import type { IconSet } from "../config.js";
import type { UiMessages } from "./messages.js";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { FieldRow } from "../components/schema/FieldRow.js";
import { slugify } from "../utils/slug.js";
import { dedent } from "../utils/indentation.js";
import { schemaRange } from "../utils/http.js";
import { inlineCodeEnd } from "../utils/markdown-syntax.js";
import { themePictureSources } from "../utils/theme-picture.js";
import type { ArtifactBody } from "./source-file.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type StaticAttributes = Readonly<Record<string, JsonValue>>;
export interface SourceLocation { file: string; offset: number }
/**
 * Content as a page holds it. A Markdown block or heading marked `links`
 * holds a link the site resolves once its routes exist; the rest are read as
 * written.
 */
export type ContentNode =
  | { kind: "markdown"; value: string; links?: true }
  | { kind: "heading"; level: number; text: string; id: string; aliases?: string[]; links?: true }
  | { kind: "label"; text: string; href?: string }
  | { kind: "section-index"; section?: string; layout: "cards" | "list" }
  | { kind: "code"; value: string; language: string; title?: string; metadata?: CodeFenceMetadata }
  | { kind: "component"; name: string; id: string; inline?: boolean; resolved: ResolvedComponent; definition: NativeComponentDefinition; client?: { entry: string; css: string[] };
      /** The spaces its line opens with, up to three: a component written in a list item's text stays in the item. */
      indent?: string };
export interface ResolvedComponent<Data = unknown> { content: readonly ContentNode[]; data?: Data; clientProps?: JsonValue }
export interface ComponentRenderHelpers {
  render(nodes: readonly ContentNode[]): string;
  escape(value: string): string;
  /** The level of the heading the component sits under: 1 above the page's first, beneath its title. */
  headingLevel: number;
}
export interface NativeContentContext {
  locale: string;
  lang: string;
  dir: "ltr" | "rtl";
  contentLocale: string;
  version: { id: string; label: string; revision?: string };
  versionScope: string;
  messages: UiMessages;
  /** The theme's icon set. */
  icons: IconSet;
}
export interface ComponentBuildContext {
  /** The language and version the content is read in. */
  context: Readonly<NativeContentContext>;
  /** The icon set this page draws from. */
  icons: IconSet;
  /** Where the component being resolved is written. */
  location: SourceLocation;
  /** An icon of the page's set, or a brand mark as `brand:<name>`, as inline SVG; a name neither has is an error at the component. */
  icon(name: string, presentation?: IconPresentation): string;
  source: string;
  root: string;
  readText(path: string): Promise<string>;
  readJson(path: string): Promise<unknown>;
  asset(path: string): Promise<string>;
  figure(path: string, options: FigureOptions): Promise<ImageVariant[]>;
  /** A diagram's drawing, one SVG for every theme */
  diagram(source: string): Promise<string>;
  parseMarkdown(markdown: string): Promise<readonly ContentNode[]>;
  id(label: string): string;
}
export interface NativeComponentDefinition<Props = StaticAttributes, Data = unknown> {
  /** Inline semantics, including when this component occupies its own line. */
  inline?: boolean;
  parseProps(attributes: StaticAttributes, location: SourceLocation): Props;
  resolve(input: { props: Props; children: readonly ContentNode[] }, context: ComponentBuildContext): ResolvedComponent<Data> | Promise<ResolvedComponent<Data>>;
  renderHtml?(resolved: ResolvedComponent<Data>, helpers: ComponentRenderHelpers): string;
  client?: { entry: string; css?: string[] };
}
export function defineComponent<P, D>(definition: NativeComponentDefinition<P, D>): NativeComponentDefinition<P, D> {
  if (typeof definition.parseProps !== "function" || typeof definition.resolve !== "function") throw new Error("A component requires parseProps and resolve");
  return definition;
}

interface ParseOptions {
  ids?: { prefix: string; sequence: number };
  /** Filled with the page's reference link definitions, as a page-wide lexing reads them. */
  definitions?: Links;
  normalize?: false;
  context: NativeContentContext;
  source: string; root: string; input: InputReader; baseUrl?: string;
  components?: Record<string, NativeComponentDefinition>;
  stack?: string[];
  dependent?: string;
  assets?: Map<string, ArtifactBody>;
}
const label = (text: string, href?: string): ContentNode => ({ kind: "label", text, href });
const text = (value: unknown): string => value == null ? "" : String(value);
const bodyNodes = (result: ResolvedComponent) => result.content.filter(n => n.kind !== "label");
const title = (result: ResolvedComponent) => result.content.find(n => n.kind === "label") as Extract<ContentNode, { kind: "label" }> | undefined;
/** A container's attributes, with the icon set its callout draws from and its card's drawn icon. */
interface ContainerData { props: StaticAttributes; icons?: IconSet; cardIcon?: string }
const pictureSources = (light: string, dark: string, type?: string, sizes?: string) => themePictureSources(light, dark).map(source => `<source${type ? ` type="${escapeAttr(type)}"` : ""} srcset="${escapeAttr(source.srcset)}"${sizes ? ` sizes="${escapeAttr(sizes)}"` : ""} data-light="${escapeAttr(source["data-light"])}" data-dark="${escapeAttr(source["data-dark"])}"${source.media ? ` media="${escapeAttr(source.media)}"` : ""} />`).join("");

/** An authored anchor: a fragment of letters, digits, underscores and hyphens. */
const FRAGMENT = /^[A-Za-z0-9][\w-]*$/;

type ComponentNode = Extract<ContentNode, { kind: "component" }>;
/** The built-in component of that name; a site's own component of the name is not it. */
const named = (node: ContentNode, name: string): node is ComponentNode => node.kind === "component" && node.definition === builtins[name];

/** A container's content, under the heading its title or label gives it, which links where its `href` leads. */
function headed(props: StaticAttributes, content: readonly ContentNode[], heading: JsonValue | undefined = props.title ?? props.label): ContentNode[] {
  return [...(heading ? [label(text(heading), text(props.href) || undefined)] : []), ...content];
}

/** A component holding content under its heading, drawn by `draw`. */
function container(draw: (result: ResolvedComponent, helpers: ComponentRenderHelpers) => string): NativeComponentDefinition {
  return defineComponent({
    parseProps: attributes => attributes,
    resolve: ({ props, children }) => ({ content: headed(props, children), data: { props } satisfies ContainerData }),
    renderHtml: draw,
  });
}

/** A container drawn as its content alone, as a tab or step outside its group is. */
const contentAlone = (result: ResolvedComponent, h: ComponentRenderHelpers) => h.render(bodyNodes(result));

/** A note, tip or warning set apart from the prose, headed by its title, or by its kind in the page's language. */
function callout(kind: CalloutKind): NativeComponentDefinition {
  return defineComponent({
    parseProps: attributes => attributes,
    resolve: ({ props, children }, context) => ({
      content: headed(props, children, props.title ?? props.label ?? context.context.messages[CALLOUTS[kind].label]),
      data: { props, icons: context.icons } satisfies ContainerData,
    }),
    renderHtml: (result, h) => renderCallout(kind, { title: renderMarkdownInline(title(result)?.text || kind), content: h.render(bodyNodes(result)), icons: (result.data as ContainerData).icons! }),
  });
}

/** A section that opens in place under its heading; an accordion's own anchor is the section's. */
function disclosure(result: ResolvedComponent, h: ComponentRenderHelpers, anchor?: JsonValue): string {
  return `<details class="accordion-item"${anchor !== undefined ? ` id="${escapeAttr(text(anchor))}"` : ""}><summary class="accordion-trigger">${renderMarkdownInline(title(result)?.text ?? "")}</summary><div class="accordion-content">${h.render(bodyNodes(result))}</div></details>`;
}
const Accordion = defineComponent({
  parseProps(attributes, location) {
    // An accordion can have its own anchor, which links open.
    if (attributes.anchor !== undefined && (typeof attributes.anchor !== "string" || !FRAGMENT.test(attributes.anchor)))
      throw new Error(`Accordion anchor must be a fragment such as billing-faq at ${location.file}:${location.offset}`);
    return attributes;
  },
  resolve: ({ props, children }) => ({ content: headed(props, children), data: { props } satisfies ContainerData }),
  renderHtml: (result, h) => disclosure(result, h, (result.data as ContainerData).props.anchor),
});
const Expandable = container((result, h) => disclosure(result, h));
const AccordionGroup = container((result, h) => `<div class="accordion-group not-prose">${h.render(bodyNodes(result))}</div>`);

const Card = defineComponent({
  parseProps: attributes => attributes,
  async resolve({ props, children }, context) {
    const data: ContainerData = { props, ...(props.icon !== undefined ? { cardIcon: await authoredIcon(text(props.icon), { class: "card-icon" }, context) } : {}) };
    return { content: headed(props, children), data };
  },
  renderHtml(result, h) {
    const { props, cardIcon } = result.data as ContainerData;
    const heading = title(result);
    const href = pageLinkHref(text(props.href));
    const headingHref = href || (heading?.href ? pageLinkHref(heading.href) : null);
    const headingHtml = renderMarkdownInline(heading?.text ?? "");
    const tag = `h${Math.min(6, h.headingLevel + 1)}`;
    return `<div class="card-item"><div class="card-item-inner">${cardIcon ?? ""}<${tag} class="card-item-title">${headingHref ? `<a class="card-item-link" href="${escapeAttr(headingHref)}">${headingHtml}</a>` : headingHtml}</${tag}><div class="card-item-content">${h.render(bodyNodes(result))}</div></div></div>`;
  },
});
/** Cards set side by side; content holding no card reads as written. */
const CardGroup = container((result, h) => {
  const content = h.render(bodyNodes(result));
  if (!bodyNodes(result).some(node => named(node, "Card"))) return content;
  return `<div class="card-group not-prose" data-cols="${escapeAttr(text((result.data as ContainerData).props.cols || 2))}">${content}</div>`;
});

const Step = container(contentAlone);
/** Numbered steps: its own `<Step>`s, or else the items of the ordered lists it holds. */
const Steps = defineComponent({
  parseProps: attributes => attributes,
  async resolve({ props, children }, context) {
    const content = children.some(node => named(node, "Step")) ? children : await listedSteps(children, context);
    return { content: headed(props, content), data: { props } satisfies ContainerData };
  },
  renderHtml(result, h) {
    if (!bodyNodes(result).some(node => named(node, "Step"))) return h.render(bodyNodes(result));
    let index = 0;
    return `<div role="list" class="steps not-prose">${bodyNodes(result).map(node => {
      if (!named(node, "Step")) return h.render([node]);
      return `<div role="listitem" class="step-item"><div class="step-number">${++index}</div><div class="step-body"><p class="step-title">${renderMarkdownInline(title(node.resolved)?.text ?? "")}</p><div class="step-content">${h.render(bodyNodes(node.resolved))}</div></div></div>`;
    }).join("")}</div>`;
  },
});
/** Each item of an ordered list as a step: its first line heads it, and the rest is its content. */
async function listedSteps(children: readonly ContentNode[], context: ComponentBuildContext): Promise<ContentNode[]> {
  const steps: ContentNode[] = [];
  for (const node of children) {
    if (node.kind !== "markdown") { steps.push(node); continue; }
    for (const token of lexMarkdown(node.value)) {
      if (token.type !== "list" || !(token as Tokens.List).ordered) { steps.push({ kind: "markdown", value: token.raw }); continue; }
      for (const item of (token as Tokens.List).items) {
        const lines = item.raw.split("\n");
        const heading = lines[0].replace(/^\s*\d+[.)]\s+/, "");
        const body = dedent(lines.slice(1).join("\n"));
        steps.push({ kind: "component", name: "Step", id: context.id("step"), definition: Step,
          resolved: { content: [label(heading), ...await context.parseMarkdown(body)], data: { props: {} } satisfies ContainerData } });
      }
    }
  }
  return steps;
}

/**
 * Panels behind a bar of tabs: a `<Tabs>`'s own `<Tab>`s, each named by its
 * heading, or a code group's blocks, each named by its title or language.
 * Content holding no panel reads as written.
 */
function drawTabs(result: ResolvedComponent, h: ComponentRenderHelpers, code: boolean): string {
  const panels = bodyNodes(result).filter(n => code ? n.kind === "code" : named(n, "Tab"));
  const outside = bodyNodes(result).filter(n => !panels.includes(n));
  if (!panels.length) return h.render(bodyNodes(result));
  const id = text((result.data as ContainerData).props.id);
  // A code group's tabs name its panels, so a panel's code carries no title of its own.
  const panel = (n: ContentNode) => n.kind === "component" ? h.render(bodyNodes(n.resolved)) : h.render([n.kind === "code" ? { ...n, title: undefined, metadata: n.metadata && { ...n.metadata, title: undefined } } : n]);
  return `${h.render(outside)}<div class="directive-tabs${code ? " directive-code-group" : ""} not-prose" data-sourcey-tabs><div class="directive-tab-bar" role="tablist">${panels.map((n, i) => {
    const name = n.kind === "component" ? title(n.resolved)?.text : n.kind === "code" ? n.title || n.language : "";
    return `<button type="button" role="tab" id="${id}-tab-${i}" aria-controls="${id}-panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" class="directive-tab${i === 0 ? " active" : ""}" data-tab-group="${id}" data-tab-index="${i}">${escapeHtml(name || `Example ${i + 1}`)}</button>`;
  }).join("")}</div>${panels.map((n, i) => `<section role="tabpanel" id="${id}-panel-${i}" aria-labelledby="${id}-tab-${i}" class="directive-tab-panel${i === 0 ? " active" : ""}" data-tab-group="${id}" data-tab-index="${i}">${panel(n)}</section>`).join("")}</div>`;
}
const Tab = container(contentAlone);
const Tabs = container((result, h) => drawTabs(result, h, false));
/** Code blocks behind tabs: each block it holds is a panel. */
const CodeGroup = defineComponent({
  parseProps: attributes => attributes,
  resolve: ({ props, children }, context) => ({
    content: headed(props, children.flatMap(node => node.kind !== "markdown" ? [node] : codeChildren(node.value, context.location))),
    data: { props } satisfies ContainerData,
  }),
  renderHtml: (result, h) => drawTabs(result, h, true),
});

const PageCards = defineComponent({
  parseProps(attributes) {
    if (attributes.section !== undefined && typeof attributes.section !== "string") throw new Error("PageCards section must be a navigation group ID");
    if (attributes.layout !== undefined && attributes.layout !== "cards" && attributes.layout !== "list") throw new Error("PageCards layout must be cards or list");
    return attributes;
  },
  resolve: ({ props }) => ({ content: [{ kind: "section-index", section: props.section as string | undefined, layout: props.layout === "list" ? "list" : "cards" }] }),
});

/** Resolve section indexes against the compiled, ordered navigation, before any output projection. */
export function resolveSectionIndexes(nodes: readonly ContentNode[], navigation: SiteTab | undefined, documentId: string): ContentNode[] {
  return nodes.flatMap<ContentNode>(node => {
    if (node.kind === "component") return [{ ...node, resolved: { ...node.resolved, content: resolveSectionIndexes(node.resolved.content, navigation, documentId) } }];
    if (node.kind !== "section-index") return [node];
    if (!navigation) throw new Error("PageCards requires compiled site navigation");
    const group = node.section ? [...walkNavGroups(navigation.groups)].find(group => group.id === node.section) : undefined;
    if (node.section && !group) throw new Error(`Unknown PageCards section: ${node.section}`);
    const groups = group ? [group] : navigation.groups;
    function list(groups: readonly SiteNavGroup[], depth = 0): string {
      return groups.flatMap(group => group.items.flatMap(item => {
        if (isNavGroup(item)) return [`${"  ".repeat(depth)}- ${item.href ? `[${item.label}](${item.href})` : item.label}`, list([item], depth + 1)];
        return item.documentId === documentId ? [] : [`${"  ".repeat(depth)}- [${item.label}](${item.href})`];
      })).filter(Boolean).join("\n");
    }
    if (node.layout === "list") return [{ kind: "markdown", value: `\n\n${list(groups)}\n\n` }];
    const cards: ContentNode[] = groups.flatMap(group => group.items.flatMap(item => {
      if (!isNavGroup(item) && item.documentId === documentId) return [];
      return [{ kind: "component" as const, name: "Card", id: "", definition: Card,
        resolved: { data: { props: { href: isNavGroup(item) ? "" : item.href ?? "" } } satisfies ContainerData, content: [label(item.label, isNavGroup(item) ? item.href : undefined), ...(isNavGroup(item) ? [{ kind: "markdown" as const, value: list([item]) }] : [])] } }];
    }));
    return [{ kind: "component", name: "CardGroup", id: "", definition: CardGroup, resolved: { data: { props: { cols: 2 } } satisfies ContainerData, content: cards } }];
  });
}
export function sectionIndexDependencies(nodes: readonly ContentNode[], navigation: SiteTab, documentId: string): string {
  const sections: unknown[] = [];
  function visit(nodes: readonly ContentNode[]) {
    for (const node of nodes) {
      if (node.kind === "component") visit(node.resolved.content);
      if (node.kind === "section-index") sections.push(node.section ? [...walkNavGroups(navigation.groups)].find(group => group.id === node.section) : navigation.groups);
    }
  }
  visit(nodes);
  return sections.length ? JSON.stringify([documentId, sections]) : "";
}

/** An authored icon: a glyph of the page's set as inline SVG, or an image published as an asset. */
async function authoredIcon(value: string, presentation: IconPresentation, context: ComponentBuildContext): Promise<string> {
  if (!isImageIcon(value)) return context.icon(value, presentation);
  return `<img class="${escapeAttr(presentation.class ?? "")}" src="${escapeAttr(await context.asset(value))}" alt="${escapeAttr(presentation.label ?? "")}">`;
}

/** An icon in a sentence, sized to the text. Its label names what it shows; without one it is decorative and leaves readable output. */
const Icon = defineComponent({
  inline: true,
  parseProps(attributes, location) {
    const at = `${location.file}:${location.offset}`;
    const unknown = Object.keys(attributes).filter(key => !["id", "icon", "label"].includes(key));
    if (unknown.length) throw new Error(`Icon attribute ${unknown.join(", ")} is not supported at ${at}`);
    if (typeof attributes.icon !== "string" || !attributes.icon) throw new Error(`Icon requires an icon at ${at}`);
    if (attributes.label !== undefined && (typeof attributes.label !== "string" || !attributes.label.trim())) throw new Error(`Icon label must be text at ${at}`);
    return attributes;
  },
  async resolve({ props }, context) {
    const name = props.label === undefined ? undefined : text(props.label);
    return { content: name ? [label(name)] : [], data: await authoredIcon(text(props.icon), { class: "sourcey-inline-icon", label: name }, context) };
  },
  renderHtml: result => result.data as string,
});

const Badge = defineComponent({
  inline: true,
  parseProps: attributes => attributes,
  resolve: ({ props, children }) => ({ content: [...(props.text || props.label ? [label(text(props.text ?? props.label))] : []), ...children], data: props }),
  renderHtml: result => `<span class="sourcey-badge">${renderMarkdownInline(readableContent(result.content).trim())}</span>`,
});
/** An authored field: a name with its type, constraints and prose, drawn as the reference draws parameters. */
interface FieldData { id: string; explicit: boolean; name: string; type?: string; required: boolean; deprecated: boolean; default?: JsonValue; min?: number; max?: number }
const FIELD_ATTRIBUTES = new Set(["id", "name", "type", "required", "deprecated", "default", "min", "max", "anchor"]);
const Field = defineComponent({
  parseProps(attributes, location) {
    const at = `${location.file}:${location.offset}`;
    // `id` is the component's own identity, which every component receives.
    const unknown = Object.keys(attributes).filter(key => !FIELD_ATTRIBUTES.has(key));
    if (unknown.length) throw new Error(`Field attribute ${unknown.join(", ")} is not supported at ${at}`);
    if (typeof attributes.name !== "string" || !attributes.name.trim()) throw new Error(`Field requires a name at ${at}`);
    if (attributes.type !== undefined && (typeof attributes.type !== "string" || !attributes.type)) throw new Error(`Field type must be text at ${at}`);
    if (attributes.anchor !== undefined && (typeof attributes.anchor !== "string" || !FRAGMENT.test(attributes.anchor))) throw new Error(`Field anchor must be a fragment such as param-name at ${at}`);
    for (const key of ["required", "deprecated"]) if (attributes[key] !== undefined && typeof attributes[key] !== "boolean") throw new Error(`Field ${key} must be true or false at ${at}`);
    for (const key of ["min", "max"]) if (attributes[key] !== undefined && typeof attributes[key] !== "number") throw new Error(`Field ${key} must be a number at ${at}`);
    return attributes;
  },
  resolve({ props, children }) {
    const name = text(props.name), anchor = props.anchor === undefined ? undefined : text(props.anchor);
    const field: FieldData = {
      id: anchor ?? `field-${slugify(name)}`, explicit: anchor !== undefined, name,
      ...(props.type !== undefined ? { type: text(props.type) } : {}),
      required: props.required === true, deprecated: props.deprecated === true,
      ...(props.default !== undefined ? { default: props.default } : {}),
      ...(typeof props.min === "number" ? { min: props.min } : {}),
      ...(typeof props.max === "number" ? { max: props.max } : {}),
    };
    return { content: children, data: field };
  },
  renderHtml(result, helpers) {
    const field = result.data as FieldData;
    // Descriptions take the reference's own Markdown wrapper, so their spacing matches its parameters.
    const html = (nodes: readonly ContentNode[], prose = false) => {
      const rendered = helpers.render(nodes);
      return rendered.trim() ? h("div", { ...(prose ? { class: "prose prose-gray dark:prose-invert prose-sm" } : {}), dangerouslySetInnerHTML: { __html: rendered } }) : undefined;
    };
    // Child fields nest directly, or in titled groups (an `<Expandable>` per shape a field can take).
    const groups = result.content.filter(node => node.kind === "component" && node.definition === Expandable) as ComponentNode[];
    const nested = [
      ...(fieldsOf(result.content).length ? [{ content: html(fieldsOf(result.content)) }] : []),
      ...groups.map(group => ({ label: title(group.resolved)?.text, content: html(bodyNodes(group.resolved)) })),
    ];
    return renderToString(h(FieldRow, {
      name: field.name, id: field.id, schema: fieldSchema(field), required: field.required, deprecated: field.deprecated,
      description: html(result.content.filter(node => !isField(node) && !groups.includes(node as ComponentNode)), true), nested: nested.length ? nested : undefined,
    }));
  },
});
const isField = (node: ContentNode): boolean => node.kind === "component" && node.definition === Field;
const fieldsOf = (nodes: readonly ContentNode[]) => nodes.filter(isField) as ComponentNode[];
/** The field's facts in the reference's schema terms, so its row draws type, range and default the same way. */
function fieldSchema(field: FieldData): NormalizedSchema | undefined {
  if (field.type === undefined && field.default === undefined && field.min === undefined && field.max === undefined) return undefined;
  return { type: field.type, default: field.default, minimum: field.min, maximum: field.max };
}
/** A field as readable Markdown, in the form readable reference parameters take. */
function fieldMarkdown(node: ComponentNode, audience: Audience, links?: ContentLinks): string {
  const field = node.resolved.data as FieldData;
  const range = schemaRange({ minimum: field.min, maximum: field.max });
  const facts = [field.type, field.required ? "required" : "optional", field.default !== undefined ? `default \`${String(field.default)}\`` : undefined, range, field.deprecated ? "deprecated" : undefined].filter(Boolean);
  const indent = (value: string) => value.split("\n").map(line => line ? `  ${line}` : line).join("\n");
  const description = readableContent(node.resolved.content.filter(child => !isField(child)), audience, links).trim();
  const nested = fieldsOf(node.resolved.content).map(child => fieldMarkdown(child, audience, links)).join("\n");
  return [`- \`${field.name}\` (${facts.join(", ")})`, description && indent(description), nested && indent(nested)].filter(Boolean).join("\n");
}
/** Content only agents read: machine exports carry it, the page and human search never do. */
const ForAgents = defineComponent({
  parseProps(attributes, location) {
    const unknown = Object.keys(attributes).filter(key => key !== "id");
    if (unknown.length) throw new Error(`ForAgents attribute ${unknown.join(", ")} is not supported at ${location.file}:${location.offset}`);
    return attributes;
  },
  resolve: ({ children }) => ({ content: children }),
  renderHtml: () => "",
});
const forAgents = (node: ContentNode) => node.kind === "component" && node.definition === ForAgents;
/** Whether content holds agent-only blocks, so readers' projection differs from machines'. */
export function hasAgentContent(nodes: readonly ContentNode[]): boolean {
  return nodes.some(node => forAgents(node) || (node.kind === "component" && hasAgentContent(node.resolved.content)));
}

/** Whether the content's first paragraph holds a component in its text, such as a badge or an icon, which a plain description cannot show. */
export function openingHasComponent(nodes: readonly ContentNode[]): boolean {
  let text = "";
  for (const node of nodes) {
    if (node.kind === "heading" && !text.trim()) continue;
    if (node.kind !== "markdown") return node.kind === "component" && Boolean(node.inline);
    text += node.value;
    // The paragraph ends at the first blank line after its text.
    if (/\S[\s\S]*?\n[^\S\n]*\n/.test(text)) return false;
  }
  return false;
}
const FileTree = defineComponent({
  parseProps: attributes => attributes,
  resolve: ({ children }) => ({ content: children }),
  renderHtml: (result, helpers) => `<div class="sourcey-file-tree">${helpers.render(result.content)}</div>`,
});
/**
 * Media embedded where it is written, its files published as the site's own
 * assets, drawn by `draw` from its attributes as published. A video may give
 * its sources in place of one file.
 */
function embedded(name: string, sourced: boolean, draw: (media: StaticAttributes, result: ResolvedComponent, helpers: ComponentRenderHelpers) => string): NativeComponentDefinition {
  return defineComponent({
    parseProps(attributes) {
      if (!safeUrl(text(attributes.src)) && !(sourced && Array.isArray(attributes.sources) && attributes.sources.length)) throw new Error(`${name} requires a safe src or video sources`);
      if (attributes.sources !== undefined && (!Array.isArray(attributes.sources) || attributes.sources.some(source => !source || typeof source !== "object" || Array.isArray(source) || !safeUrl(text(source.src))))) throw new Error("Video sources require safe src values");
      return attributes;
    },
    async resolve({ props, children }, context) {
      const src = props.src ? await context.asset(text(props.src)) : undefined;
      const poster = props.poster ? await context.asset(text(props.poster)) : undefined;
      const sources = Array.isArray(props.sources) ? await Promise.all(props.sources.map(async value => {
        const source = value as Record<string, JsonValue>;
        return { src: await context.asset(text(source.src)), type: text(source.type) };
      })) : [];
      return { content: [label(text(props.title) || name, src), ...sources.map(source => label(source.type || "Video", source.src)), ...children], data: { ...props, src, poster, sources } };
    },
    renderHtml: (result, helpers) => draw(result.data as StaticAttributes, result, helpers),
  });
}
const Video = embedded("Video", true, (media, result, helpers) => {
  const sources = media.sources as { src: string; type: string }[];
  if (!sources.length && /(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(text(media.src))) return renderMarkdown(`::video[${text(media.src)}]{title="${text(media.title).replace(/"/g, "&quot;")}"}`);
  const flags = ["muted", "loop", "autoplay", "playsinline"].filter(key => media[key] === true).join(" ");
  return `<video controls preload="metadata" ${flags}${media.src ? ` src="${escapeAttr(text(media.src))}"` : ""}${media.poster ? ` poster="${escapeAttr(text(media.poster))}"` : ""} aria-label="${escapeAttr(text(media.title) || "Video")}">${sources.map(source => `<source src="${escapeAttr(source.src)}"${source.type ? ` type="${escapeAttr(source.type)}"` : ""}>`).join("")}${helpers.render(bodyNodes(result))}</video>`;
});
// A frame shows a page from the web or this site, never a script or inline document.
const Iframe = embedded("Iframe", false, media => `<iframe loading="lazy" src="${escapeAttr(safeUrl(text(media.src), { allowedProtocols: ["http:", "https:"] }) ?? "about:blank")}" title="${escapeAttr(text(media.title) || "Embedded content")}" height="${escapeAttr(text(media.height) || "400")}" allowfullscreen></iframe>`);

/** Another file's content, as part of the page that includes it. The parser reads the file, where the chain of files including it is known. */
const Include = defineComponent({
  parseProps: a => { if (typeof a.src !== "string") throw new Error("Include requires src"); return a; },
  resolve: ({ children }) => ({ content: children }),
});

/** A figure's picture in each scheme, as published, with its text. */
interface FigureData { light: ImageVariant[]; dark: ImageVariant[]; alt: string; caption: string; loading: "eager" | "lazy" }
const Figure = defineComponent({
  parseProps(a) {
    if (typeof a.src !== "string" || typeof a.alt !== "string") throw new Error("Figure requires src and alt");
    if (a.width !== undefined && !(Number(a.width) > 0)) throw new Error("Figure width must be positive");
    return a;
  },
  async resolve({ props: a, children }, context): Promise<ResolvedComponent<FigureData>> {
    const transform = { width: a.width ? Number(a.width) : undefined, quality: a.quality ? Number(a.quality) : undefined,
      densities: a.densities as number[] | undefined, formats: a.formats as ("avif"|"webp"|"png")[] | undefined };
    const light = await context.figure(text(a.src), transform);
    const dark = a.darkSrc ? await context.figure(text(a.darkSrc), transform) : light;
    return { content: [{ kind: "markdown", value: `![${text(a.alt)}](${light[0].src})` }, ...(a.caption ? [label(text(a.caption))] : []), ...children], data: { light, dark, alt: text(a.alt), caption: text(a.caption), loading: a.loading === "eager" ? "eager" : "lazy" } };
  },
  renderHtml({ data }) {
    const { light, dark, alt, caption, loading } = data!;
    const source = (images: ImageVariant[], format: string) => images.filter(i => i.format === format).map(i => `${i.src} ${i.width}w`).join(", ");
    const fallback = light.find(i => i.format === "png") ?? light[0];
    // The image shows at its own width, or the viewport's when narrower; without
    // sizes a browser assumes the full viewport and fetches the 2x file at 1x.
    const sizes = `min(${fallback.width}px, 100vw)`;
    return `<figure class="sourcey-figure"><picture data-sourcey-picture>${[...new Set(light.map(i => i.format))].map(format => pictureSources(source(light, format), source(dark, format), `image/${format}`, sizes)).join("")}<img src="${fallback.src}" width="${fallback.width}" height="${fallback.height}" alt="${escapeAttr(alt)}" loading="${loading}" decoding="async" /></picture>${caption ? `<figcaption>${renderMarkdownInline(caption)}</figcaption>` : ""}</figure>`;
  },
});
/** A drawn diagram, or why the renderer could not draw it and where it is written. */
type DiagramData = { svg: string } | { failure: string; location: SourceLocation; explanation: string };
/** The family a diagram's text is set and measured in. */
export const DIAGRAM_FONT = "Inter";
/**
 * A drawing sits in a shadow root of its own, so its marker ids and its style
 * stay its own, while the page's fonts, colours and color-scheme reach it.
 */
const DIAGRAM_SHADOW_STYLE = ":host{display:block}svg{display:block;width:100%;height:auto}";
/** How far a wide drawing shrinks to fit the column before it scrolls instead: its text stays legible. */
const DIAGRAM_LEAST_SCALE = 0.8;
/** A drawing's width: its own at most, the column's where that is narrower, but never under the least scale. */
function diagramSize(svg: string): string {
  const width = Number(svg.match(/^<svg[^>]*\swidth="([\d.]+)"/)?.[1]);
  return Number.isFinite(width) && width > 0 ? ` style="max-width:${width}px;min-width:${Math.round(width * DIAGRAM_LEAST_SCALE)}px"` : "";
}
const Diagram = defineComponent({
  parseProps: a => a,
  async resolve({ children }, context): Promise<ResolvedComponent<DiagramData>> {
    const code = readableContent(children).replace(/^\s*```mermaid\s*\n|\n```\s*$/g, "");
    const content: ContentNode[] = [{ kind: "code", language: "mermaid", value: code }];
    try {
      return { content, data: { svg: await context.diagram(code) } };
    } catch (error) {
      // A type the renderer does not draw, or invalid syntax: the source stays, without a picture claiming otherwise.
      if ((error as Error).name !== "DiagramSourceError") throw error;
      return { content, data: { failure: (error as Error).message, location: context.location, explanation: context.context.messages.diagramUnrendered } };
    }
  },
  renderHtml: ({ data, content }, helpers) => "failure" in data! ? `<figure class="sourcey-diagram sourcey-diagram-unrendered"><figcaption>${escapeHtml(data.explanation)}</figcaption>${helpers.render(content)}</figure>` : `<figure class="sourcey-diagram"><div class="sourcey-diagram-scroll" tabindex="0" aria-label="Diagram"><div class="sourcey-diagram-drawing"${diagramSize(data!.svg)} role="img" aria-label="Diagram; its source is available below"><template shadowrootmode="open"><style>${DIAGRAM_SHADOW_STYLE}</style>${data!.svg}</template></div></div><details class="sourcey-diagram-source"><summary>Diagram source</summary>${helpers.render(content)}</details></figure>`,
});

/** Sourcey's own components, by the name a page writes them by; a site's components of the same name take their place. */
const builtins: Readonly<Record<string, NativeComponentDefinition>> = {
  ...Object.fromEntries(Object.keys(CALLOUTS).map(kind => [kind, callout(kind as CalloutKind)])),
  Tabs, Tab, Steps, Step, CardGroup, Card, AccordionGroup, Accordion, Expandable, CodeGroup,
  PageCards, Icon, Badge, Field, ForAgents, FileTree, Video, Iframe, Include, Figure, Diagram,
};

/** Only literals are accepted. Foreign executable expressions must be converted once. */
export function parseStaticAttributes(source: string, location: SourceLocation): StaticAttributes {
  const result: Record<string, JsonValue> = {};
  let rest = source.trim();
  while (rest) {
    const key = rest.match(/^([\w-]+)/);
    if (!key) throw new Error(`Invalid component attributes at ${location.file}:${location.offset}`);
    rest = rest.slice(key[0].length).trimStart();
    let value: JsonValue = true;
    if (rest.startsWith("=")) {
      rest = rest.slice(1).trimStart();
      const quoted = rest.match(/^(["'])((?:\\.|(?!\1)[\s\S])*?)\1/);
      if (quoted) { value = quoted[2].replace(/\\(["'\\])/g, "$1"); rest = rest.slice(quoted[0].length); }
      else if (rest.startsWith("{")) {
        let end = 1, depth = 1, quote = "";
        for (; end < rest.length && depth; end++) {
          const c = rest[end];
          if (quote) { if (c === "\\") end++; else if (c === quote) quote = ""; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === "{") depth++;
          else if (c === "}") depth--;
        }
        if (depth) throw new Error(`Unclosed attribute at ${location.file}`);
        const literal = rest.slice(1, end - 1).trim();
        try { value = literal.startsWith("'") && literal.endsWith("'") ? literal.slice(1, -1) : JSON.parse(literal); }
        catch { throw new Error(`Executable attribute ${key[1]} requires conversion at ${location.file}:${location.offset}`); }
        rest = rest.slice(end);
      } else {
        const raw = rest.match(/^\S+/)![0]; value = raw; rest = rest.slice(raw.length);
      }
    }
    result[key[1]] = value; rest = rest.trimStart();
  }
  return result;
}

/**
 * CommonMark indented code, as the native Markdown lexer reads it: each block
 * from the start of its first line to the end of its last, keyed by its start.
 * Only text with an indented line holding a tag or directive needs the lexer.
 */
function indentedCode(input: string): ReadonlyMap<number, number> {
  const blocks = new Map<number, number>();
  if (!/^(?: {4}|\t)[^\n]*(?:<[A-Z]|:{2})/m.test(input)) return blocks;
  let from = 0;
  forEachToken(lexMarkdown(input), token => {
    if (token.type !== "code" || (token as Tokens.Code).codeBlockStyle !== "indented") return;
    let start: number | undefined, end = from;
    // The lexer gives each code line without its indentation; it stands in the source after only whitespace.
    for (const line of (token as Tokens.Code).text.split("\n").filter(line => line.trim())) {
      let at = input.indexOf(line, end);
      while (at >= 0 && /\S/.test(input.slice(input.lastIndexOf("\n", at - 1) + 1, at))) at = input.indexOf(line, at + 1);
      if (at < 0) return;
      start ??= input.lastIndexOf("\n", at - 1) + 1;
      end = at + line.length;
    }
    if (start !== undefined) { blocks.set(start, end); from = end; }
  });
  return blocks;
}

/** Code examples are opaque to native tag matching, including nested matching tags. */
function opaqueCodeEnd(input: string, cursor: number, indented: ReadonlyMap<number, number>): number | undefined {
  const block = indented.get(cursor);
  if (block !== undefined) return block;
  const fence = (cursor === 0 || input[cursor - 1] === "\n") && input.slice(cursor).match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n/);
  if (fence) {
    const after = cursor + fence[0].length;
    const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},} *$`, "m").exec(input.slice(after));
    return closing ? after + closing.index + closing[0].length : input.length;
  }
  return inlineCodeEnd(input, cursor);
}
function closingComponent(input: string, start: number, name: string, indented: ReadonlyMap<number, number>): { start: number; end: number } | undefined {
  let depth = 1;
  for (let cursor = start; cursor < input.length;) {
    const opaque = opaqueCodeEnd(input, cursor, indented);
    if (opaque !== undefined) { cursor = opaque; continue; }
    if (input.startsWith("<!--", cursor)) {
      const end = input.indexOf("-->", cursor + 4);
      cursor = end < 0 ? input.length : end + 3; continue;
    }
    if (input[cursor] === "\\") { cursor += 2; continue; }
    const tag = input[cursor] === "<" && input.slice(cursor).match(/^<(\/?)([A-Z][\w]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/);
    if (tag) {
      if (tag[2] === name && (tag[1] || !/\/\s*$/.test(tag[3]))) depth += tag[1] ? -1 : 1;
      if (!depth) return { start: cursor, end: cursor + tag[0].length };
      cursor += tag[0].length;
    } else cursor++;
  }
  return undefined;
}

/** The component each `:::name` directive opens. */
const DIRECTIVES: ReadonlyMap<string, string> = new Map(Object.entries({
  note: "Note", warning: "Warning", tip: "Tip", info: "Info", caution: "Caution", danger: "Danger", tabs: "Tabs", tab: "Tab", steps: "Steps",
  "code-group": "CodeGroup", "card-group": "CardGroup", card: "Card", accordion: "Accordion", expandable: "Expandable",
}));

function closingDirective(input: string, start: number, marker: string, indented: ReadonlyMap<number, number>): { start: number; end: number } | undefined {
  let depth = 1;
  for (let cursor = start; cursor < input.length;) {
    const opaque = opaqueCodeEnd(input, cursor, indented);
    if (opaque !== undefined) { cursor = opaque; if (input[cursor] === "\n") cursor++; continue; }
    const newline = input.indexOf("\n", cursor), end = newline < 0 ? input.length : newline;
    const line = input.slice(cursor, end);
    if (new RegExp(`^ {0,3}${marker}[\\w-]`).test(line)) depth++;
    if (line.trim() === marker && --depth === 0) return { start: cursor, end };
    cursor = end + 1;
  }
  return undefined;
}
function codeRegion(content: string, requested: string, file: string): string {
  const stack: { name: string; body: number }[] = [], matches: string[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    const marker = line.match(/#(end)?region(?:[ \t]+(.*))?$/);
    const name = (marker?.[2] ?? "").replace(/(?:-->|\*\/)[ \t\r]*$/, "").trim();
    if (marker && !marker[1]) stack.push({ name, body: offset + line.length + 1 });
    else if (marker) {
      const open = stack.pop();
      if (!open || name && name !== open.name) throw new Error(`Mismatched region marker in ${file}`);
      if (open.name === requested) matches.push(content.slice(open.body, offset));
    }
    offset += line.length + 1;
  }
  if (stack.length) throw new Error(`Unclosed region marker in ${file}`);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous region ${requested} in ${file}`);
  return matches[0];
}

export async function parseComponents(markdown: string, options: ParseOptions): Promise<ContentNode[]> {
  options.root = await canonicalInputPath(options.root);
  options.source = await canonicalInputPath(options.source);
  options.dependent ??= options.source;
  const definitions = { ...builtins, ...options.components };
  const stack = options.stack ?? [options.source];
  const ids = options.ids ??= { prefix: createHash("sha256").update(relative(options.root, options.dependent)).digest("hex").slice(0, 10), sequence: 0 };
  const root = resolve(options.root);
  async function local(file: string): Promise<string> {
    const target = await canonicalInputPath(resolve(dirname(options.source), file));
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Component input outside allowed root: ${file}`);
    return target;
  }
  /** An included file's content, whole or one region of it: code in the language named, or Markdown parsed as part of this page. */
  async function included(attrs: StaticAttributes): Promise<ContentNode[]> {
    const file = await local(text(attrs.src));
    if (stack.includes(file)) throw new Error(`Include cycle: ${[...stack, file].join(" -> ")}`);
    let content = await options.input.readText(file, options.dependent);
    if (attrs.region) content = codeRegion(content, text(attrs.region), file);
    return attrs.language ? [{ kind: "code", value: content, language: text(attrs.language) }] : parseComponents(content, { ...options, source: file, stack: [...stack, file], normalize: false });
  }
  const icons = options.context.icons;
  function icon(value: string, presentation: IconPresentation | undefined, offset?: number): string {
    const { source, name } = iconSource(icons, value);
    const drawing = iconDrawing(source, name);
    if (!drawing) throw new Error(`Icon "${value}" is not in ${source === "brands" ? "Font Awesome's brand marks" : `the ${icons} set (theme.icons)`} at ${options.source}${offset === undefined ? "" : `:${offset}`}`);
    return iconSvg(drawing, presentation);
  }
  const context: ComponentBuildContext = {
    source: options.source, root, context: options.context, icons, location: { file: options.source, offset: 0 },
    icon: (name, presentation) => icon(name, presentation),
    readText: async file => options.input.readText(isAbsoluteHttpUrl(file) ? file : await local(file), options.dependent),
    async readJson(file) { return JSON.parse(await context.readText(file)); },
    async asset(file) {
      if (/^(https?:|data:|\/)/.test(file)) return file;
      const asset = await staticMediaAsset(await local(file), options.input, options.dependent!);
      options.assets?.set(asset.path, asset.body); return toPublicPath(asset.path, options.baseUrl);
    },
    async figure(file, transform) {
      const { imageVariants } = await import("./media.js");
      const images = await imageVariants(await local(file), transform, options.input, options.dependent!);
      for (const image of images) options.assets?.set(image.src, image.body);
      return images.map(image => ({ ...image, src: toPublicPath(image.src, options.baseUrl) }));
    },
    async diagram(source) {
      const { diagramSvg } = await import("./diagrams.js");
      return diagramSvg(source);
    },
    parseMarkdown: value => parseComponents(value, { ...options, stack, normalize: false }),
    id: value => `sourcey-${ids.prefix}-${value.replace(/[^\w-]/g, "-")}-${++ids.sequence}`,
  };
  async function component(name: string, attrs: StaticAttributes, children: ContentNode[], offset: number): Promise<ContentNode> {
    const definition = definitions[name];
    if (!definition) throw new Error(`Unknown component <${name}> at ${options.source}:${offset}`);
    const id = context.id(name);
    const props = definition.parseProps({ ...attrs, id }, { file: options.source, offset });
    if (definition === Include) children = await included(attrs);
    const resolved = await definition.resolve({ props, children }, { ...context, location: { file: options.source, offset }, icon: (name, presentation) => icon(name, presentation, offset) });
    if (!Array.isArray(resolved.content)) throw new Error(`Component ${name} must return semantic content`);
    let client: { entry: string; css: string[] } | undefined;
    if (definition.client) {
      assertJson(resolved.clientProps ?? null);
      const { buildComponentAssets } = await import("../renderer/assets.js");
      const bundle = await buildComponentAssets(definition.client, options.input, options.dependent!, options.root);
      for (const [path, body] of bundle.files) options.assets?.set(path, body);
      client = { entry: bundle.entry, css: bundle.css };
    }
    return { kind: "component", name, id, definition, resolved, client };
  }
  async function parse(input: string): Promise<ContentNode[]> {
    const nodes: ContentNode[] = [];
    let cursor = 0, plain = "";
    const flush = () => { if (plain) { nodes.push({ kind: "markdown", value: plain }); plain = ""; } };
    const indented = indentedCode(input);
    while (cursor < input.length) {
      // Code is opaque, including examples which contain component/directive syntax.
      const block = indented.get(cursor);
      if (block !== undefined) { plain += input.slice(cursor, block); cursor = block; continue; }
      const fence = (cursor === 0 || input[cursor - 1] === "\n") && input.slice(cursor).match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n/);
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},} *$`, "m");
        const after = cursor + fence[0].length, end = input.slice(after).search(close);
        const length = end < 0 ? input.length - cursor : after + end + input.slice(after + end).split("\n", 1)[0].length - cursor;
        const raw = input.slice(cursor, cursor + length);
        if (/^ {0,3}(`{3,}|~{3,})mermaid\s*\n/.test(raw)) {
          flush(); const value = raw.replace(/^.*\n/, "").replace(/\n[^\n]*$/, "");
          nodes.push(await component("Diagram", {}, [{ kind: "code", language: "mermaid", value }], cursor));
        } else plain += raw;
        cursor += length; continue;
      }
      // An escaped character is text, so `Handle\<T\>` opens no component.
      if (input[cursor] === "\\") { plain += input.slice(cursor, cursor + 2); cursor += 2; continue; }
      if (input[cursor] === "`") {
        const end = inlineCodeEnd(input, cursor);
        if (end !== undefined) { plain += input.slice(cursor, end); cursor = end; continue; }
      }
      const alert = (cursor === 0 || input[cursor - 1] === "\n") && input.slice(cursor).match(ALERT);
      if (alert) {
        flush(); const callout = alertCallout(alert[1], options.context.messages);
        nodes.push(await component(callout.kind, callout.title ? { title: callout.title } : {}, await parse(alertBody(alert[2])), cursor));
        cursor += alert[0].length; continue;
      }
      const embedded = (cursor === 0 || input[cursor - 1] === "\n") && input.slice(cursor).match(/^::(video|iframe)\[([^\]]+)\](?:\{([^}]*)\})?[^\S\n]*(?:\n|$)/);
      if (embedded) {
        flush(); nodes.push(await component(embedded[1] === "video" ? "Video" : "Iframe", { src: embedded[2], ...parseStaticAttributes(embedded[3] ?? "", { file: options.source, offset: cursor }) }, [], cursor));
        cursor += embedded[0].length; continue;
      }
      const directive = (cursor === 0 || input[cursor - 1] === "\n") && input.slice(cursor).match(/^ {0,3}(:{2,})([\w-]+)([^\n]*)\n/);
      if (directive) {
        const name = DIRECTIVES.get(directive[2]);
        if (!name) throw new Error(`Unknown directive ${directive[2]} at ${options.source}:${cursor}`);
        const marker = directive[1], after = cursor + directive[0].length;
        const closing = closingDirective(input, after, marker, indented);
        if (!closing) { plain += directive[0]; cursor = after; continue; }
        const rawMeta = directive[3].trim();
        const attrs = rawMeta.startsWith("{") ? parseStaticAttributes(rawMeta.slice(1, -1), { file: options.source, offset: cursor }) : rawMeta ? { title: rawMeta.replace(/^\[|\]$/g, "") } : {};
        const children = await parse(dedent(input.slice(after, closing.start)));
        const indent = directive[0].match(/^ */)![0];
        flush(); const node = await component(name, attrs, children, cursor);
        nodes.push(indent && node.kind === "component" ? { ...node, indent } : node);
        cursor = closing.end; continue;
      }
      const tag = input[cursor] === "<" && input.slice(cursor).match(/^<([A-Z][\w]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/);
      if (tag) {
        const name = tag[1], self = /\/\s*$/.test(tag[2]);
        const attrs = parseStaticAttributes(tag[2].replace(/\/\s*$/, ""), { file: options.source, offset: cursor });
        let end = cursor + tag[0].length, body = "";
        if (!self) {
          const closing = closingComponent(input, end, name, indented);
          if (!closing) { plain += tag[0]; cursor = end; continue; }
          body = input.slice(end, closing.start); end = closing.end;
        }
        const before = input.slice(input.lastIndexOf("\n", cursor - 1) + 1, cursor);
        const after = input.slice(end, input.indexOf("\n", end) < 0 ? input.length : input.indexOf("\n", end));
        const inline = definitions[name]?.inline || /\S/.test(before) || /\S/.test(after);
        flush();
        const node = await component(name, attrs, await parse(dedent(body)), cursor);
        nodes.push(node.kind === "component" ? { ...node, inline, ...(!inline && /^ {1,3}$/.test(before) ? { indent: before } : {}) } : node);
        cursor = end; continue;
      }
      plain += input[cursor++];
    }
    flush(); return nodes;
  }
  const nodes = await parse(markdown);
  // Markdown kept as written is lexed once: headings and links are then read from the same tokens.
  const lexed = options.normalize === false ? undefined : new Map<ContentNode, Token[]>();
  const linkDefinitions: Links = {};
  async function assets(nodes: readonly ContentNode[]): Promise<ContentNode[]> {
    const result: ContentNode[] = [];
    for (const node of nodes) {
      if (node.kind === "component") { result.push({ ...node, resolved: { ...node.resolved, content: await assets(node.resolved.content) } }); continue; }
      if (node.kind !== "markdown") { result.push(node); continue; }
      const images = new Set<string>();
      let html = false;
      const tokens = lexMarkdown(node.value);
      // The first definition of a name is the page's, as one lexing of the page reads it.
      for (const [name, definition] of Object.entries((tokens as TokensList).links)) if (!Object.hasOwn(linkDefinitions, name)) linkDefinitions[name] = definition;
      forEachToken(tokens, token => {
        if (token.type === "html") html = true;
        if (token.type !== "image" && token.type !== "link") return;
        const href = (token as Tokens.Image | Tokens.Link).href;
        if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(href)) return;
        if (token.type === "image" || STATIC_ASSET_EXTENSIONS.has(extname(href.split(/[?#]/)[0]).toLowerCase())) images.add(href);
      });
      // Most Markdown names no local file and holds no HTML, and is kept as written.
      if (!images.size && !html) { lexed?.set(node, tokens); result.push(node); continue; }
      async function mediaUrl(href: string, link: boolean): Promise<string> {
        if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(href)) return href;
        const [, path, suffix] = href.match(/^([^?#]*)(.*)$/s)!;
        if (link && !STATIC_ASSET_EXTENSIONS.has(extname(path).toLowerCase())) return href;
        return await context.asset(decodeURIComponent(path)) + (suffix ?? "");
      }
      const urls = new Map<string, string>();
      for (const image of images) urls.set(image, await mediaUrl(image, false));
      const linked = urls.size ? rewriteMarkdownDestinations(node.value, href => urls.get(href) ?? href) : node.value;
      const value = html ? await rewriteMarkdownHtml(linked, html => rewriteHtmlUrls(html, (href, tag) => mediaUrl(href, tag === "a"))) : linked;
      result.push({ ...node, value });
    }
    return result;
  }
  const withAssets = await assets(nodes);
  if (!lexed) return withAssets;
  if (options.definitions) Object.assign(options.definitions, linkDefinitions);
  // A link can be named by a definition anywhere on the page: where one resolves, any block with a bracket may use it.
  const defined = Object.values(linkDefinitions).some(({ href }) => resolvable(href));
  return normalizeHeadings(withAssets, node => lexed.get(node) ?? lexMarkdown(node.value), token => defined && token.raw.includes("[") || linksIn(token));
}

function codeChildren(markdown: string, location: SourceLocation): ContentNode[] {
  return lexMarkdown(markdown).map(token => {
    if (token.type !== "code") return { kind: "markdown", value: token.raw };
    const code = token as Tokens.Code;
    let metadata: CodeFenceMetadata;
    try { metadata = parseCodeFenceInfo(code.lang); }
    catch (error) { throw new Error(`${(error as Error).message} at ${location.file}:${location.offset}`, { cause: error }); }
    return { kind: "code", language: metadata.language, title: metadata.title, metadata, value: code.text };
  });
}

/** Who a readable projection is for: machine exports carry agent-only content, readers' surfaces do not. */
export type Audience = "agents" | "people";
/**
 * How a page's export resolves its links once the site's routes exist:
 * `markdown` rewrites a block or heading the page marked as holding one;
 * `text` rewrites any other text, a title or a label, only where it could.
 */
export interface ContentLinks { markdown(text: string): string; text(text: string): string }
export function readableContent(nodes: readonly ContentNode[], audience: Audience = "agents", links?: ContentLinks): string {
  const read = (children: readonly ContentNode[]) => readableContent(children, audience, links);
  const prose = (value: string) => (links ? links.text(value) : value);
  const marked = (value: string, linked?: true) => (links && linked ? links.markdown(value) : value);
  // A component written in a list item's text keeps its indentation, so it reads as part of the item.
  return nodes.map(node => node.kind === "component" && node.indent ? readNode(node).replace(/\n(?=[^\n])/g, `\n${node.indent}`) : readNode(node)).join("");
  function readNode(node: ContentNode): string {
    if (forAgents(node)) return audience === "agents" ? `\n\n${read((node as ComponentNode).resolved.content)}\n\n` : "";
    if (named(node, "Steps")) {
      const steps = node.resolved.content.filter(child => named(child, "Step"));
      if (steps.length) return "\n\n" + steps.map((step, index) => `${index + 1}. **${prose(title(step.resolved)?.text ?? "")}**\n\n${read(bodyNodes(step.resolved)).trim().split("\n").map(line => "   " + line).join("\n")}`).join("\n\n") + "\n\n";
    }
    if (node.kind === "component" && isField(node)) return `\n\n${fieldMarkdown(node, audience, links)}\n\n`;
    // A callout reads as the GitHub alert Markdown readers know, so it is never taken for the page's prose; a title of its own leads it.
    if (node.kind === "component" && isCallout(node.name) && named(node, node.name)) {
      const { props } = node.resolved.data as ContainerData;
      const own = prose(text(props.title ?? props.label));
      const body = `${own ? `**${own}**\n\n` : ""}${read(bodyNodes(node.resolved)).trim()}`;
      return `\n\n> [!${ALERT_TYPE[node.name]}]\n${body.split("\n").map(line => (line ? `> ${line}` : ">")).join("\n")}\n\n`;
    }
    // An intrinsically inline component stays in its sentence, as text.
    if (node.kind === "component" && node.definition.inline) return node.resolved.content.map(child => child.kind === "label" ? prose(child.text) : read([child])).join("").replace(/\s+/g, " ").trim();
    if (node.kind === "section-index") return "";
    if (node.kind === "markdown") return marked(node.value, node.links);
    if (node.kind === "heading") return `\n${"#".repeat(node.level)} ${marked(node.text, node.links)} {#${node.id}}\n`;
    if (node.kind === "label") return `\n\n**${prose(node.href ? `[${node.text}](${node.href})` : node.text)}**\n\n`;
    if (node.kind === "code") return `\n\n${node.title ? `**${prose(node.title)}**\n\n` : ""}\`\`\`${node.language}\n${node.value}\n\`\`\`\n\n`;
    return `\n\n${read(node.resolved.content)}\n\n`;
  }
}
const renderOptions = new WeakMap<UiMessages, MarkdownRenderOptions>();
let builtinDefinitions: ReadonlySet<NativeComponentDefinition> | undefined;
/** Sourcey's own components, which draw their HTML from escaped and checked values. */
const isBuiltin = (definition: NativeComponentDefinition) => (builtinDefinitions ??= new Set(Object.values(builtins))).has(definition);

/** A document's content as HTML, its footnotes numbered across all of it. */
export function renderContent(nodes: readonly ContentNode[], messages: UiMessages, headingLevel = 1): string {
  return withFootnotes(messages, () => drawContent(nodes, messages, headingLevel));
}

function drawContent(nodes: readonly ContentNode[], messages: UiMessages, headingLevel: number): string {
  let options = renderOptions.get(messages);
  if (!options) { options = { ...PAGE_CONTENT, copyLabel: messages.copyCode }; renderOptions.set(messages, options); }
  // Components learn the level of the heading they sit under, read in document order.
  let level = headingLevel;
  // What the build draws itself goes in as markers, so Markdown never reads it again.
  const generated: string[] = [];
  const block = (html: string, indent = "") => `\n\n${indent}${generatedMarker(generated.push(html) - 1)}\n\n`;
  const markdown = nodes.map(node => {
    if (node.kind === "section-index") throw new Error("Unresolved section index reached the HTML renderer");
    if (node.kind === "markdown") return escapeGeneratedMarkers(node.value);
    if (node.kind === "heading") {
      level = node.level;
      return block(`<h${node.level} id="${escapeAttr(node.id)}">${(node.aliases ?? []).map(alias => `<span id="${escapeAttr(alias)}" aria-hidden="true"></span>`).join("")}${renderMarkdownInline(node.text)}</h${node.level}>`);
    }
    if (node.kind === "label") return block(`<p>${node.href ? `<a href="${escapeAttr(safeUrl(node.href) ?? "#")}">${escapeHtml(node.text)}</a>` : escapeHtml(node.text)}</p>`);
    if (node.kind === "code") return block(renderCodeBlock(node.value, node.language, node.metadata, options?.copyLabel));
    const under = level;
    // A component placed in a sentence draws its children as part of the sentence.
    const helpers: ComponentRenderHelpers = { render: children => node.inline ? phrasing(renderContent(children, messages, under)) : renderContent(children, messages, under), escape: escapeHtml, headingLevel: under };
    const html = node.definition.renderHtml ? node.definition.renderHtml(node.resolved, helpers) : renderContent(node.resolved.content, messages, under);
    const wrapper = node.inline ? "span" : "div";
    // A component the site defines draws HTML of its own making, sanitized as an author's is.
    const drawn = isBuiltin(node.definition) ? html : sanitizeRenderedHtml(html, ["operation"]);
    const rendered = node.client ? `<${wrapper} data-sourcey-component="${escapeAttr(node.id)}" data-sourcey-module="${escapeAttr(node.client.entry)}" data-sourcey-props="${escapeAttr(JSON.stringify(node.resolved.clientProps ?? null))}">${drawn}</${wrapper}>` : drawn;
    return node.inline ? generatedMarker(generated.push(rendered) - 1) : block(rendered, node.indent);
  }).join("");
  return renderMarkdown(markdown, options, generated);
}

/** One paragraph's text without the paragraph; anything else as it is. */
function phrasing(html: string): string {
  const paragraph = /^\s*<p>([\s\S]*)<\/p>\s*$/.exec(html);
  return paragraph && !/<\/?p[\s>]/.test(paragraph[1]) ? paragraph[1] : html;
}

function assertJson(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || seen.has(value) || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Component clientProps must be finite, acyclic JSON values");
  seen.add(value);
  for (const item of Object.values(value)) assertJson(item, seen);
  seen.delete(value);
}
/** Content a build should report: diagrams the renderer could not draw, whose source the page shows instead. */
export function contentDiagnostics(nodes: readonly ContentNode[]): { severity: "warning"; code: "diagram"; file: string; message: string }[] {
  return nodes.flatMap(node => {
    if (node.kind !== "component" || forAgents(node)) return [];
    const data = node.definition === Diagram ? node.resolved.data as DiagramData : undefined;
    const own = data && "failure" in data ? [{ severity: "warning" as const, code: "diagram" as const, file: data.location.file, message: `${data.location.file} at offset ${data.location.offset}: the diagram could not be drawn (${data.failure}); the page shows its source instead` }] : [];
    return [...own, ...contentDiagnostics(node.resolved.content)];
  });
}
/** The anchors a page's content gives it: headings, fields, accordions and footnotes. */
export function contentAnchors(nodes: readonly ContentNode[]): string[] {
  return [...nodeAnchors(nodes), ...footnoteAnchors(markdownOf(nodes))];
}
function nodeAnchors(nodes: readonly ContentNode[]): string[] {
  return nodes.flatMap(node => forAgents(node) ? [] : node.kind === "heading" ? [node.id, ...(node.aliases ?? [])] : node.kind === "component" ? [...(isField(node) ? [(node.resolved.data as FieldData).id] : []), ...accordionAnchor(node), ...nodeAnchors(node.resolved.content)] : []);
}
/** The Markdown a page's content was written in, a component's included, apart from text for agents alone. */
function markdownOf(nodes: readonly ContentNode[]): string[] {
  return nodes.flatMap(node => forAgents(node) ? [] : node.kind === "markdown" ? [node.value] : node.kind === "component" ? markdownOf(node.resolved.content) : []);
}
/** An accordion's own anchor, as a list of none or one. */
function accordionAnchor(node: ComponentNode): string[] {
  const anchor = node.definition === Accordion ? (node.resolved.data as ContainerData).props.anchor : undefined;
  return anchor === undefined ? [] : [text(anchor)];
}
/** The font families a page's content is drawn in beyond its theme's: Inter, for its diagrams. */
export function contentFonts(nodes: readonly ContentNode[]): string[] {
  return [...new Set(nodes.flatMap(node => node.kind === "component" ? [...(node.definition === Diagram && !("failure" in (node.resolved.data as DiagramData)) ? [DIAGRAM_FONT] : []), ...contentFonts(node.resolved.content)] : []))];
}
export function componentStyles(nodes: readonly ContentNode[]): string[] {
  return [...new Set(nodes.flatMap(node => node.kind === "component" ? [...(node.client?.css ?? []), ...componentStyles(node.resolved.content)] : []))];
}

/** A destination the site resolves: none on the web, in the page, or to mail. */
const resolvable = (href: string) => !/^(?:https?:\/\/|#|mailto:)/.test(href);
/** Whether a token holds a link or image the site resolves. */
function linksIn(token: Token): boolean {
  let found = false;
  forEachToken([token], inner => { if ((inner.type === "link" || inner.type === "image") && resolvable((inner as Tokens.Link).href)) found = true; });
  return found;
}

/** Resolve heading and field identity once, in document order, before any output is rendered. */
function normalizeHeadings(nodes: readonly ContentNode[], lex: (node: Extract<ContentNode, { kind: "markdown" }>) => Token[], linked: (token: Token) => boolean): ContentNode[] {
  const pending: { node: { id: string; aliases?: string[] }; automatic: boolean; previousId?: string }[] = [];
  function expand(nodes: readonly ContentNode[], within = false): ContentNode[] {
    return nodes.flatMap<ContentNode>(node => {
      // Agent-only headings never take part, so they cannot renumber the page's visible anchors.
      if (forAgents(node)) return [node];
      if (node.kind === "component") {
        let data = node.resolved.data;
        if (isField(node)) { const field = { ...(node.resolved.data as FieldData) }; pending.push({ node: field, automatic: !field.explicit }); data = field; }
        for (const id of accordionAnchor(node)) pending.push({ node: { id }, automatic: false });
        return [{ ...node, resolved: { ...node.resolved, data, content: expand(node.resolved.content, true) } }];
      }
      if (node.kind === "heading") {
        const copy = { ...node }; pending.push({ node: copy, automatic: false }); return [copy];
      }
      if (node.kind !== "markdown") return [node];
      // A page's blocks are each a node, so its export rewrites only those holding a link. A component's
      // Markdown stays whole between the headings it names, so its renderHtml arranges the nodes it returned.
      const blocks: ContentNode[] = [];
      let run: Token[] = [];
      const flush = () => {
        if (run.length) blocks.push({ kind: "markdown", value: run.map(token => token.raw).join(""), ...(run.some(linked) && { links: true as const }) });
        run = [];
      };
      for (const token of lex(node)) {
        if (token.type !== "heading") { run.push(token); if (!within) flush(); continue; }
        flush();
        const heading = headingInfo(token as Tokens.Heading);
        const named: Extract<ContentNode, { kind: "heading" }> = { kind: "heading", level: (token as Tokens.Heading).depth, text: heading.markdown, id: heading.id, ...(linked(token) && { links: true as const }) };
        pending.push({ node: named, automatic: !heading.explicit, previousId: heading.explicit ? undefined : heading.previousId });
        blocks.push(named);
      }
      flush();
      return blocks;
    });
  }
  const result = expand(nodes), primary = new Set<string>(), aliases = new Set<string>();
  for (const { node, automatic } of pending) {
    const preferred = node.id;
    if (!automatic && primary.has(preferred)) throw new Error(`Duplicate explicit anchor: ${preferred}`);
    let suffix = 0;
    while (primary.has(node.id)) node.id = `${preferred}-${++suffix}`;
    primary.add(node.id);
  }
  // An old spelling may never steal another heading's current identity.
  for (const { node, previousId } of pending) {
    const explicit = node.aliases ?? [];
    for (const alias of explicit) {
      if (primary.has(alias) || aliases.has(alias)) throw new Error(`Duplicate heading alias: ${alias}`);
      aliases.add(alias);
    }
    if (previousId && !primary.has(previousId) && !aliases.has(previousId)) {
      node.aliases = [...explicit, previousId]; aliases.add(previousId);
    }
  }
  return result;
}

export function contentHeadings(nodes: readonly ContentNode[]): PageHeading[] {
  return nodes.flatMap(node => forAgents(node) ? [] : node.kind === "component" ? contentHeadings(node.resolved.content) : node.kind === "heading" && (node.level === 2 || node.level === 3) ? [{ level: node.level as 2 | 3, text: headingInfo({ type: "heading", raw: "", depth: node.level, text: node.text, tokens: [] }).text, id: node.id }] : []);
}
