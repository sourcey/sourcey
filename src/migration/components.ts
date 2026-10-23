import type { IconSet } from "../config.js";
import type { JsonValue } from "../core/markdown-components.js";

/** A component element as written in the source, with its import resolved. */
export interface ElementInput {
  /** Tag name as written, which may be a renamed local binding. */
  name: string;
  /** Module identity: a project-relative file or a package specifier. */
  module: string;
  /** Export name: `default`, a named export, or `*` member access. */
  export: string;
  /** Statically known attribute values. */
  props: Record<string, JsonValue>;
  /** Attributes whose values are executable expressions. */
  dynamic: string[];
  /** Attributes whose value is an imported binding, as `module#export` (e.g. an icon object). */
  bindings: Record<string, string>;
  /** Source text of the children, exactly as written. */
  children: string;
  /** The nearest component around this one, as its converter read it: Docusaurus's tabs label their items. */
  parent?: { module: string; export: string; props: Record<string, JsonValue> };
  /** Public path the document is published at. */
  route: string;
  /** The native navigation group whose landing page is at this public path, for section indexes. */
  section(route: string): string | undefined;
  /** Read-only project facts for mappings that decide from files. Paths are project-relative. */
  project: {
    /** The icon set the native project draws from (`theme.icons`). */
    icons: IconSet;
    exists(path: string): Promise<boolean>;
    readText(path: string): Promise<string>;
    imageSize(path: string): Promise<{ width: number; height: number }>;
    /** A project path as the native document refers to it (relative to where the document will live). */
    relative(path: string): string;
  };
  file: string;
  line: number;
}

export type ElementReplacement =
  /** Already native as written; the element and its attributes keep their bytes. */
  | { keep: true }
  /** A native component tag; `children` keeps the original children unless text replaces them. */
  | { component: string; props?: Record<string, JsonValue>; children?: string; review?: string }
  /** Replace the whole element with Markdown. */
  | { markdown: string; review?: string }
  /** A fenced block, such as a Mermaid diagram. */
  | { fence: { language: string; code: string }; review?: string }
  /** Keep the children and drop the wrapper. */
  | { unwrap: true; review?: string }
  /** Remove the element, giving the reason; only for content-free elements whose meaning native output already carries. */
  | { remove: string };

export interface ConversionFailure {
  error: string;
  suggestion?: string;
}

export type ComponentConverter = (element: ElementInput) => ElementReplacement | ConversionFailure | Promise<ElementReplacement | ConversionFailure>;

/** Converters keyed by `module#export`. */
export type ConverterTable = Map<string, ComponentConverter>;

export function identityKey(module: string, exportName: string): string {
  return `${module}#${exportName}`;
}

/** An attribute value as text, or undefined when it is absent. */
export function attributeText(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : value === undefined || value === null ? undefined : String(value);
}

/** Attributes an element sets beyond those a converter understands. */
export function unsupportedAttributes(element: ElementInput, allowed: string[]): string[] {
  return Object.keys(element.props)
    .concat(element.dynamic)
    .filter((name) => !allowed.includes(name) && !name.startsWith("client:"));
}

export function rejectDynamic(element: ElementInput): ConversionFailure | undefined {
  const dynamic = element.dynamic.filter((name) => !name.startsWith("client:"));
  if (!dynamic.length) return undefined;
  return {
    error: `<${element.name}> attribute ${dynamic.map((name) => `"${name}"`).join(", ")} is an executable expression`,
    suggestion: "Replace it with a literal value before migrating, or convert the component in the --mapping file.",
  };
}

/** Tab selection behaviour native tabs do not have; the tabs still convert, so the report names what changes. */
export function tabSelectionReview(element: ElementInput, attributes: string[]): string | undefined {
  const set = attributes.filter((name) => element.props[name] !== undefined);
  if (!set.length) return undefined;
  return `<${element.name}> converts without ${set.join(", ")}: native tabs open on their first tab, are chosen per set and do not keep the choice in the URL.`;
}

/** A diagram component whose chart is a literal string becomes a Mermaid fence. */
export function mermaidConverters(): ConverterTable {
  const mermaid: ComponentConverter = (element) => {
    const chart = element.props.chart;
    if (element.dynamic.filter((name) => !name.startsWith("client:")).length || typeof chart !== "string")
      return { error: `<${element.name}> chart must be a literal string or template without expressions` };
    const extra = unsupportedAttributes(element, ["chart", "config"]);
    if (extra.length || element.props.config !== undefined)
      return { error: `<${element.name}> attribute ${[...extra, ...(element.props.config !== undefined ? ["config"] : [])].join(", ")} has no native equivalent` };
    return { fence: { language: "mermaid", code: chart.replace(/^\s*\n/, "").replace(/\s+$/, "") } };
  };
  return new Map([
    [identityKey("mdx-mermaid/lib/Mermaid", "Mermaid"), mermaid],
    [identityKey("mdx-mermaid", "Mermaid"), mermaid],
  ]);
}
