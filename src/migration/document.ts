/**
 * Convert one MDX document to native Sourcey Markdown. Only constructs that
 * need conversion are edited; prose, code and formatting keep their bytes.
 */
import { posix } from "node:path";
import type { IconSet } from "../config.js";
import { escapeHtml, VOID_ELEMENTS } from "../utils/html.js";
import { indentColumns } from "../utils/indentation.js";
import type { JsonValue } from "../core/markdown-components.js";
import { HTML_ATTRIBUTE_NAMES, identityKey, styleText, type ComponentConverter, type ConverterTable, type ElementInput, type ElementReplacement } from "./components.js";
import type { Diagnostics } from "./diagnostics.js";
import { evaluate, exportedConstant, identifierName, scopeFromProgram, toJson, type CallValue, type ImportBinding, type JsonResult, type ModuleScope } from "./javascript.js";
import { childrenText, closingTagStart, openingTagEnd, span, textContent, walk, type EstreeNode, type JsxAttribute, type SyntaxNode } from "./mdx.js";
import type { ProjectFiles } from "./project-files.js";
import { applyEdits, lineAt, lineEnd, markdownText, type TextEdit } from "./text-edits.js";

export interface DocumentContext {
  project: ProjectFiles;
  diagnostics: Diagnostics;
  converters: ConverterTable;
  /**
   * `module#export` identities of MDX element overrides (`export const
   * components = ...`) whose behaviour native Markdown already provides.
   */
  elementOverrides: ReadonlySet<string>;
  /** Native group IDs by the public path of the page each group lands on. */
  sections?: ReadonlyMap<string, string>;
  /** The icon set the native project draws from. */
  icons: IconSet;
}

export interface ConvertedDocument {
  text: string;
  /** Whether conversion stopped on an unsupported construct. */
  failed: boolean;
}

/**
 * The document being converted: its file, where the native document will live
 * when it moves, its public path, and what its framework provides: global
 * components, calls whose value the site fixes, and the directories it serves
 * at its base path.
 */
export interface DocumentPlace {
  file: string;
  target?: string;
  route: string;
  dialect: {
    globals?: ReadonlyMap<string, string>;
    mdx1?: boolean;
    headingIds?: boolean;
    pageExports?: readonly string[];
    aliases?: Readonly<Record<string, string>>;
    calls?: ReadonlyMap<string, (args: readonly JsonValue[]) => JsonValue | undefined>;
    statics?: { base: string; directories: readonly string[] };
  };
}

/** An MDX document's imports and exports: MDX hoists them to the module wherever they are written, inside an element too. */
function moduleStatements(tree: SyntaxNode): SyntaxNode[] {
  return [...walk(tree)].map(({ node }) => node).filter((node) => node.type === "mdxjsEsm");
}

/** The module scope of an MDX document: its imports and constants. */
export async function documentScope(project: ProjectFiles, file: string, source: string, tree: SyntaxNode): Promise<ModuleScope> {
  const program: EstreeNode & { body: EstreeNode[] } = { type: "Program", body: [] };
  for (const node of moduleStatements(tree)) program.body.push(...(node.data?.estree?.body ?? []));
  return scopeFromProgram(project, file, source, program);
}

/** A value as JS reads it: `value` may be JS's undefined, as a missing property or argument is. */
type Read = { value: JsonValue | undefined };

/** Names a callback's or helper's parameters bind where an expression is written. */
type Bindings = ReadonlyMap<string, JsonValue | undefined>;

const NO_BINDINGS: Bindings = new Map();

/** Calls deep enough that a page's helpers are taken to recurse. */
const MAX_CALLS = 16;

/**
 * Methods of strings and arrays that only read their receiver, which static
 * data can be called with: `label.includes("Premium")`.
 */
const PURE_METHODS = new Map<string, (receiver: JsonValue | undefined, args: readonly (JsonValue | undefined)[]) => JsonValue | undefined>([
  ["includes", (receiver, [item]) => (typeof receiver === "string" && typeof item === "string") || (Array.isArray(receiver) && isPrimitive(item)) ? receiver.includes(item as never) : undefined],
  ["startsWith", (receiver, [prefix]) => (typeof receiver === "string" && typeof prefix === "string" ? receiver.startsWith(prefix) : undefined)],
  ["endsWith", (receiver, [suffix]) => (typeof receiver === "string" && typeof suffix === "string" ? receiver.endsWith(suffix) : undefined)],
  ["toLowerCase", (receiver) => (typeof receiver === "string" ? receiver.toLowerCase() : undefined)],
  ["toUpperCase", (receiver) => (typeof receiver === "string" ? receiver.toUpperCase() : undefined)],
  ["trim", (receiver) => (typeof receiver === "string" ? receiver.trim() : undefined)],
  ["join", (receiver, [separator]) => (Array.isArray(receiver) && receiver.every(isPrimitive) && (separator === undefined || typeof separator === "string") ? receiver.join(separator) : undefined)],
]);

function isPrimitive(value: JsonValue | undefined): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/**
 * Reads a document's expressions as far as they are static: literals and its
 * constants, constants it imports read from their module (through the
 * framework's aliases), calls to framework functions whose value the site
 * fixes, such as `useBaseUrl("/img/a.png")`, and calls to the page's own
 * helpers and to pure string and array methods with static arguments.
 * Anything else, and any expression naming one, is not static.
 */
interface StaticReader {
  /** An expression's value, with the parameters in scope where it is written. */
  read(node: EstreeNode, bindings?: Bindings, calls?: number): Promise<Read | undefined>;
  /** The operand a conditional expression comes to, or its value where that is its test's (`a && b` with `a` falsy). */
  chosen(node: EstreeNode, bindings: Bindings, calls: number): Promise<{ operand: EstreeNode } | Read | undefined>;
  /** The page's own component of this name, `export const Badge = () => <span>…</span>`, which shows the JSX it returns. */
  component(name: string): EstreeNode | undefined;
}

function staticReader(project: ProjectFiles, scope: ModuleScope, dialect: DocumentPlace["dialect"]): StaticReader {
  const frameworkCall = (call: CallValue): JsonResult | undefined => {
    const evaluated = call.callee && dialect.calls?.get(identityKey(call.callee.module, call.callee.export));
    if (!evaluated) return undefined;
    const args: JsonValue[] = [];
    for (const argument of call.args) {
      const json = toJson(argument, frameworkCall);
      if (!json.ok) return json;
      args.push(json.value);
    }
    const value = evaluated(args);
    return value === undefined ? undefined : { ok: true, value };
  };
  /** A constant of the page that is an arrow function, and so returns what its body reads. */
  const helper = (name: string): EstreeNode | undefined => {
    const init = scope.constants.get(name);
    return init?.type === "ArrowFunctionExpression" && (init.body as EstreeNode).type !== "BlockStatement" ? init : undefined;
  };
  const isJsx = (node: EstreeNode) => node.type === "JSXElement" || node.type === "JSXFragment";
  const reader: StaticReader = {
    async read(node, bindings = NO_BINDINGS, calls = 0) {
      switch (node.type) {
        case "Identifier":
          if (bindings.has(identifierName(node))) return { value: bindings.get(identifierName(node)) };
          break;
        case "MemberExpression": {
          const object = await reader.read(node.object as EstreeNode, bindings, calls);
          const key = node.computed ? await reader.read(node.property as EstreeNode, bindings, calls) : { value: identifierName(node.property as EstreeNode) };
          if (!object || !key || (typeof key.value !== "string" && typeof key.value !== "number")) return undefined;
          const container = object.value;
          if (typeof container === "string" && key.value === "length") return { value: container.length };
          if (!container || typeof container !== "object") return undefined;
          return { value: Object.hasOwn(container, key.value) ? (container as Record<string, JsonValue>)[key.value] : undefined };
        }
        case "TemplateLiteral": {
          let text = "";
          const quasis = node.quasis as { value: { cooked: string } }[];
          for (const [index, quasi] of quasis.entries()) {
            text += quasi.value.cooked;
            const expression = (node.expressions as EstreeNode[])[index];
            if (!expression) continue;
            const part = await reader.read(expression, bindings, calls);
            if (!part || (part.value !== null && typeof part.value === "object")) return undefined;
            text += String(part.value);
          }
          return { value: text };
        }
        case "ObjectExpression": {
          const object: Record<string, JsonValue> = {};
          for (const property of node.properties as EstreeNode[]) {
            if (property.type === "SpreadElement") {
              const spread = await reader.read(property.argument as EstreeNode, bindings, calls);
              if (!spread || (spread.value !== null && typeof spread.value !== "object") || Array.isArray(spread.value)) return undefined;
              Object.assign(object, spread.value);
              continue;
            }
            if (property.type !== "Property" || property.computed || property.kind !== "init" || property.method) return undefined;
            const value = await reader.read(property.value as EstreeNode, bindings, calls);
            if (!value) return undefined;
            if (value.value !== undefined) object[identifierName(property.key as EstreeNode)] = value.value;
          }
          return { value: object };
        }
        case "ArrayExpression": {
          const items: JsonValue[] = [];
          for (const element of node.elements as (EstreeNode | null)[]) {
            if (!element) return undefined;
            const spread = element.type === "SpreadElement";
            const value = await reader.read(spread ? (element.argument as EstreeNode) : element, bindings, calls);
            if (!value || value.value === undefined || (spread && !Array.isArray(value.value))) return undefined;
            if (spread) items.push(...(value.value as JsonValue[]));
            else items.push(value.value);
          }
          return { value: items };
        }
        case "BinaryExpression": {
          const [left, right] = [await reader.read(node.left as EstreeNode, bindings, calls), await reader.read(node.right as EstreeNode, bindings, calls)];
          if (!left || !right || !isPrimitive(left.value ?? null) || !isPrimitive(right.value ?? null)) return undefined;
          if (node.operator === "===") return { value: left.value === right.value };
          if (node.operator === "!==") return { value: left.value !== right.value };
          if (node.operator !== "+") return undefined;
          return { value: typeof left.value === "number" && typeof right.value === "number" ? left.value + right.value : `${left.value}${right.value}` };
        }
        case "UnaryExpression": {
          const argument = await reader.read(node.argument as EstreeNode, bindings, calls);
          if (!argument) return undefined;
          if (node.operator === "!") return { value: !argument.value };
          return node.operator === "-" && typeof argument.value === "number" ? { value: -argument.value } : undefined;
        }
        case "LogicalExpression":
        case "ConditionalExpression": {
          const chosen = await reader.chosen(node, bindings, calls);
          return chosen && "operand" in chosen ? (isJsx(chosen.operand) ? undefined : reader.read(chosen.operand, bindings, calls)) : chosen;
        }
        case "CallExpression": {
          const callee = node.callee as EstreeNode;
          const args: (JsonValue | undefined)[] = [];
          for (const argument of node.arguments as EstreeNode[]) {
            const value = argument.type === "SpreadElement" ? undefined : await reader.read(argument, bindings, calls);
            if (!value) return undefined;
            args.push(value.value);
          }
          if (callee.type === "MemberExpression" && !callee.computed) {
            const method = PURE_METHODS.get(identifierName(callee.property as EstreeNode));
            const receiver = method && (await reader.read(callee.object as EstreeNode, bindings, calls));
            const value = receiver ? method!(receiver.value, args) : undefined;
            return value === undefined ? undefined : { value };
          }
          if (callee.type !== "Identifier" || bindings.has(identifierName(callee))) return undefined;
          const name = identifierName(callee);
          const own = helper(name);
          if (own) {
            if (calls >= MAX_CALLS || isJsx(own.body as EstreeNode)) return undefined;
            const parameters = new Map<string, JsonValue | undefined>();
            for (const [index, param] of (own.params as EstreeNode[]).entries()) if (!bindParameter(param, args[index], parameters)) return undefined;
            return reader.read(own.body as EstreeNode, parameters, calls + 1);
          }
          const binding = scope.imports.get(name);
          const evaluated = binding && dialect.calls?.get(identityKey(binding.module, binding.export));
          if (!evaluated || args.some((arg) => arg === undefined)) return undefined;
          const value = evaluated(args as JsonValue[]);
          return value === undefined ? undefined : { value };
        }
      }
      // The module's scope does not hold the parameters, so an expression naming one is not static here.
      if (names(node).some((name) => bindings.has(name))) return undefined;
      const value = evaluate(node, scope);
      const json = value.kind === "reference" ? await exportedConstant(project, value.binding, 0, dialect.aliases) : toJson(value, frameworkCall);
      return json?.ok ? { value: json.value } : undefined;
    },
    async chosen(node, bindings, calls) {
      if (node.type === "ConditionalExpression") {
        const test = await reader.read(node.test as EstreeNode, bindings, calls);
        return test && { operand: (test.value ? node.consequent : node.alternate) as EstreeNode };
      }
      if (node.type !== "LogicalExpression") return reader.read(node, bindings, calls);
      const left = await reader.read(node.left as EstreeNode, bindings, calls);
      if (!left) return undefined;
      const right = node.operator === "&&" ? !!left.value : node.operator === "||" ? !left.value : left.value === null || left.value === undefined;
      return right ? { operand: node.right as EstreeNode } : left;
    },
    component(name) {
      const own = helper(name);
      return own && isJsx(own.body as EstreeNode) && (own.params as EstreeNode[]).length <= 1 ? own : undefined;
    },
  };
  return reader;
}

/**
 * The page's lists drawn with `.map()` over static data and its own
 * components, written where the page shows them as the JSX they make: a
 * list's callback for each item, a component's JSX for its props, each
 * expression in it as the value it reads, conditional JSX as the branch it
 * takes, `key` left out. One that reads anything not static stays as written.
 */
export async function expandStaticJsx(document: DocumentPlace, source: string, tree: SyntaxNode, project: ProjectFiles): Promise<string> {
  const reader = staticReader(project, await documentScope(project, document.file, source, tree), document.dialect);
  const edits: TextEdit[] = [];
  for (const { node } of walk(tree)) {
    if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
      const body = node.data?.estree?.body ?? [];
      const call = body.length === 1 && body[0].type === "ExpressionStatement" ? mapCall(body[0].expression as EstreeNode) : undefined;
      const made = call && (await eachItem(call, source, NO_BINDINGS, reader));
      if (!made) continue;
      const start = span(node).start;
      const indent = source.slice(source.lastIndexOf("\n", start - 1) + 1, start).match(/^[ \t]*/)![0];
      edits.push({ ...span(node), text: made.join(`\n${indent}`) });
    } else if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name && reader.component(node.name)) {
      if ((node.children ?? []).some((child) => !(child.type === "text" && !child.value?.trim()))) continue;
      const props: Record<string, JsonValue> = {};
      let read = true;
      for (const attribute of node.attributes ?? []) {
        const written = attribute.value;
        const expression = typeof written === "object" && written ? written.data?.estree?.body?.[0]?.expression : undefined;
        const value = attribute.type !== "mdxJsxAttribute" ? undefined : written === null || written === undefined ? { value: true } : typeof written === "string" ? { value: written } : expression ? await reader.read(expression as EstreeNode) : undefined;
        if (!value) read = false;
        else if (value.value !== undefined) props[attribute.name!] = value.value;
      }
      const text = read ? await componentJsx(reader.component(node.name)!, props, source, reader) : undefined;
      if (text !== undefined) edits.push({ ...span(node), text });
    }
  }
  return applyEdits(source, edits);
}

/** An expression that is `array.map((item) => <JSX />)`. */
function mapCall(expression: EstreeNode): EstreeNode | undefined {
  const callee = expression.type === "CallExpression" ? (expression.callee as EstreeNode) : undefined;
  if (callee?.type !== "MemberExpression" || callee.computed || identifierName(callee.property as EstreeNode) !== "map") return undefined;
  const callback = (expression.arguments as EstreeNode[])[0];
  if (callback?.type !== "ArrowFunctionExpression" || (callback.params as EstreeNode[]).length > 2) return undefined;
  const result = (callback.body as EstreeNode).type;
  return result === "JSXElement" || result === "JSXFragment" ? expression : undefined;
}

/** A `.map()` call's JSX for each item of the array it reads, or undefined where the array or any item's JSX is not static. */
async function eachItem(call: EstreeNode, source: string, outer: Bindings, reader: StaticReader, depth = 0): Promise<string[] | undefined> {
  const items = await reader.read((call.callee as EstreeNode).object as EstreeNode, outer);
  if (!Array.isArray(items?.value)) return undefined;
  const callback = (call.arguments as EstreeNode[])[0];
  const [param, indexParam] = callback.params as EstreeNode[];
  const made: string[] = [];
  for (const [index, item] of items.value.entries()) {
    const bindings = new Map(outer);
    if (!bindParameter(param, item, bindings)) return undefined;
    if (indexParam?.type === "Identifier") bindings.set(identifierName(indexParam), index);
    const text = await instantiate(callback.body as EstreeNode, source, bindings, reader, depth + 1);
    if (text === undefined) return undefined;
    made.push(text);
  }
  return made;
}

/** A value bound to a parameter: to its name, to the names it destructures, with defaults where the value has none. */
function bindParameter(param: EstreeNode, value: JsonValue | undefined, bindings: Map<string, JsonValue | undefined>): boolean {
  switch (param.type) {
    case "Identifier":
      bindings.set(identifierName(param), value);
      return true;
    case "AssignmentPattern": {
      const fallback = param.right as EstreeNode;
      if (fallback.type !== "Literal" || !isPrimitive(fallback.value as JsonValue)) return false;
      return bindParameter(param.left as EstreeNode, value === undefined ? (fallback.value as JsonValue) : value, bindings);
    }
    case "ObjectPattern": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      for (const property of param.properties as EstreeNode[]) {
        if (property.type !== "Property" || property.computed) return false;
        const key = identifierName(property.key as EstreeNode);
        if (!bindParameter(property.value as EstreeNode, Object.hasOwn(value, key) ? value[key] : undefined, bindings)) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/** A page component's JSX for these props, or undefined where it reads anything not static. */
async function componentJsx(component: EstreeNode, props: Record<string, JsonValue>, source: string, reader: StaticReader, depth = 0): Promise<string | undefined> {
  const bindings = new Map<string, JsonValue | undefined>();
  const [param] = component.params as EstreeNode[];
  if (depth >= MAX_CALLS || (param && !bindParameter(param, props, bindings))) return undefined;
  return instantiate(component.body as EstreeNode, source, bindings, reader, depth + 1);
}

/** JSX as written, with these bindings: each expression as the value it reads, or undefined where one is not static. */
async function instantiate(jsx: EstreeNode, source: string, bindings: Bindings, reader: StaticReader, depth = 0): Promise<string | undefined> {
  const origin = jsx.start as number;
  const edits: TextEdit[] = [];
  const range = (node: EstreeNode, from = node.start as number) => ({ start: from - origin, end: (node.end as number) - origin });
  /** What a child expression shows: the JSX it comes to, or its value. */
  const shown = async (node: EstreeNode): Promise<{ jsx: EstreeNode } | Read | undefined> => {
    if (node.type === "JSXElement" || node.type === "JSXFragment") return { jsx: node };
    const chosen = await reader.chosen(node, bindings, 0);
    return chosen && "operand" in chosen ? shown(chosen.operand) : chosen;
  };
  const visit = async (node: EstreeNode, attribute?: EstreeNode): Promise<boolean> => {
    if (node.type === "JSXElement") {
      const opening = node.openingElement as EstreeNode;
      const name = (opening.name as EstreeNode).type === "JSXIdentifier" ? ((opening.name as EstreeNode).name as string) : undefined;
      const component = name && !bindings.has(name) ? reader.component(name) : undefined;
      if (component) {
        // The page's own component shows the JSX it returns for its props.
        if ((node.children as EstreeNode[]).some((child) => !(child.type === "JSXText" && !(child.value as string).trim()))) return false;
        const props: Record<string, JsonValue> = {};
        for (const prop of opening.attributes as EstreeNode[]) {
          const key = prop.type === "JSXAttribute" && (prop.name as EstreeNode).type === "JSXIdentifier" ? ((prop.name as EstreeNode).name as string) : undefined;
          const written = prop.value as EstreeNode | null;
          const value = !key ? undefined : !written ? { value: true } : written.type === "Literal" ? { value: written.value as JsonValue } : written.type === "JSXExpressionContainer" ? await reader.read(written.expression as EstreeNode, bindings) : undefined;
          if (!value) return false;
          if (value.value !== undefined) props[key!] = value.value;
        }
        const text = await componentJsx(component, props, source, reader, depth);
        if (text === undefined) return false;
        edits.push({ ...range(node), text });
        return true;
      }
    }
    if (node.type === "JSXAttribute") {
      if ((node.name as EstreeNode).name === "key") {
        edits.push({ ...range(node, spaceBefore(source, node.start as number)), text: "" });
        return true;
      }
      return node.value ? visit(node.value as EstreeNode, node) : true;
    }
    if (node.type === "JSXSpreadAttribute") return false;
    if (node.type === "JSXExpressionContainer") {
      const expression = node.expression as EstreeNode;
      if (expression.type === "JSXEmptyExpression") {
        edits.push({ ...range(node), text: "" });
        return true;
      }
      // An expression naming none of the parameters reads the same outside, so it stays as written for the conversion to read.
      if (!names(expression).some((name) => bindings.has(name))) return true;
      if (attribute) {
        const value = await reader.read(expression, bindings);
        if (!value) return false;
        // An attribute JS leaves undefined is not set.
        if (value.value === undefined) edits.push({ ...range(attribute, spaceBefore(source, attribute.start as number)), text: "" });
        else edits.push({ ...range(node), text: `{${JSON.stringify(value.value)}}` });
        return true;
      }
      // A list the item holds is each of its items' JSX in turn.
      const list = mapCall(expression);
      if (list) {
        const made = await eachItem(list, source, bindings, reader, depth);
        if (!made) return false;
        edits.push({ ...range(node), text: made.join("") });
        return true;
      }
      const child = await shown(expression);
      if (!child) return false;
      if ("jsx" in child) {
        const text = await instantiate(child.jsx, source, bindings, reader, depth);
        if (text === undefined) return false;
        edits.push({ ...range(node), text });
        return true;
      }
      // A child is text; React writes nothing for undefined, null or a flag.
      if (child.value !== null && typeof child.value === "object") return false;
      edits.push({ ...range(node), text: child.value === undefined || child.value === null || typeof child.value === "boolean" ? "" : `{${JSON.stringify(String(child.value))}}` });
      return true;
    }
    for (const key of ["openingElement", "closingElement", "attributes", "children", "openingFragment", "closingFragment"]) {
      const child = node[key] as EstreeNode | EstreeNode[] | null | undefined;
      for (const item of Array.isArray(child) ? child : child ? [child] : []) if (!(await visit(item))) return false;
    }
    return true;
  };
  if (depth >= MAX_CALLS || !(await visit(jsx))) return undefined;
  return applyEdits(source.slice(origin, jsx.end as number), edits);
}

/** Where the whitespace before an offset starts, so an attribute left out takes the space before it. */
function spaceBefore(source: string, offset: number): number {
  while (offset > 0 && /\s/.test(source[offset - 1])) offset--;
  return offset;
}

/** Elements of SVG and MathML, which close with `/>` as JSX does. */
function foreignElements(tree: SyntaxNode): Set<SyntaxNode> {
  const foreign = new Set<SyntaxNode>();
  for (const { node, parents } of walk(tree)) if (["svg", "math"].includes(node.name ?? "") || parents.some((parent) => ["svg", "math"].includes(parent.name ?? ""))) foreign.add(node);
  return foreign;
}

/** Names a document uses as values: other than declaring them, calling them or showing them as an element. */
function valueNames(tree: SyntaxNode): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown, parent?: EstreeNode, key?: string): void => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, parent, key));
    if (!value || typeof value !== "object") return;
    const node = value as EstreeNode;
    if (node.type === "Identifier" && !(parent?.type === "CallExpression" && key === "callee") && !(parent?.type === "VariableDeclarator" && key === "id")) found.add(node.name as string);
    for (const [child, nested] of Object.entries(node)) if (child !== "loc" && child !== "range") visit(nested, node, child);
  };
  for (const { node } of walk(tree)) {
    visit(node.data?.estree);
    for (const attribute of node.attributes ?? []) visit((typeof attribute.value === "object" ? attribute.value : (attribute as { data?: SyntaxNode["data"] }))?.data?.estree);
  }
  return found;
}

/** Every name an expression or JSX uses. */
function names(node: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const child = value as EstreeNode;
      if (child.type === "Identifier" || child.type === "JSXIdentifier") found.push(child.name as string);
      for (const [key, nested] of Object.entries(child)) if (key !== "loc" && key !== "range" && key !== "position") visit(nested);
    }
  };
  visit(node);
  return found;
}

/** The import a component element names: the document's own, else the framework's global component of that name. */
export function elementBinding(name: string, scope: ModuleScope, globals?: ReadonlyMap<string, string>): ImportBinding | undefined {
  if (name.includes(".")) return undefined;
  const global = globals?.get(name);
  return scope.imports.get(name) ?? (global ? { module: global.split("#")[0], export: global.split("#")[1], local: name } : undefined);
}

export async function convertMdxDocument(document: DocumentPlace, source: string, tree: SyntaxNode, context: DocumentContext): Promise<ConvertedDocument> {
  const { diagnostics, project } = context;
  const { file, route } = document;
  const nativeFile = document.target ?? file;
  const before = diagnostics.errors.length;
  const fail = (message: string, offset?: number, suggestion?: string) => {
    diagnostics.error({ file, line: lineAt(source, offset), code: "mdx", message, suggestion });
  };

  const scope = await documentScope(project, file, source, tree);
  const reader = staticReader(project, scope, document.dialect);
  const staticValue = async (node: EstreeNode) => (await reader.read(node))?.value;
  let values: Set<string> | undefined;
  let foreign: Set<SyntaxNode> | undefined;

  const edits: TextEdit[] = [];
  const replaced: { start: number; end: number }[] = [];
  const inside = (offset: number) => replaced.some((range) => offset >= range.start && offset < range.end);

  for (const node of moduleStatements(tree)) {
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type === "ImportDeclaration") continue;
      if (statement.type === "ExportNamedDeclaration" && (isElementOverride(statement, scope, context.elementOverrides) || isPartialOutline(statement, scope) || (await pageData(statement)))) continue;
      fail(
        statement.type.startsWith("Export")
          ? "This export runs code when the page renders, which native Markdown does not execute"
          : `Top-level ${statement.type} is executable MDX`,
        statement.start,
        statement.type === "ExportNamedDeclaration"
          ? "If it supplies Markdown element components that native rendering covers, list its import under `markdown` in the --mapping file."
          : undefined,
      );
    }
    edits.push(removeBlock(source, span(node)));
  }

  // `inHtml`: inside a plain HTML element, whose one raw HTML block holds its children.
  // `parent`: the nearest component around the node, as its converter read it.
  // `alone`: an element on its own lines in its paragraph, which can stand as a block does.
  const visit = async (node: SyntaxNode, inTable = false, inHtml = false, parent?: ElementInput["parent"], alone = false): Promise<void> => {
    if (node.position && inside(node.position.start.offset)) return;
    const jsx = node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
    let within = parent;
    if (jsx) {
      const handled = await element(node, inTable, inHtml, parent, alone);
      if (handled === "whole") return;
      if (handled !== "tags") within = handled;
    } else if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
      await expression(node);
      return;
    }
    const html = inHtml || (jsx && !!node.name && /^[a-z]/.test(node.name) && !node.name.includes("."));
    const lines = node.type === "paragraph" ? ownLines(node) : undefined;
    for (const child of node.children ?? []) await visit(child, inTable || node.type === "table", html, within, !!lines?.has(child));
  };

  /**
   * Returns "whole" when the element and its descendants were replaced
   * together, and a component whose children stay to be converted as their parent.
   */
  async function element(node: SyntaxNode, inTable: boolean, inHtml: boolean, parent: ElementInput["parent"], alone: boolean): Promise<"whole" | "tags" | NonNullable<ElementInput["parent"]>> {
    const { start, end } = span(node);
    const name = node.name;
    if (!name) {
      // A fragment only groups its children.
      const close = closingTagStart(source, node)!;
      edits.push({ start, end: openingTagEnd(source, node), text: "" }, { start: close, end, text: "" });
      return "tags";
    }
    if (/^[a-z]/.test(name) && !name.includes(".")) return htmlElement(node, inTable, inHtml);
    const binding = elementBinding(name, scope, document.dialect.globals);
    if (!binding) {
      fail(`<${name}> is not imported in this file`, start, "Import it explicitly, or map it in the --mapping file.");
      return "whole";
    }
    const converter = context.converters.get(identityKey(binding.module, binding.export)) ?? partialInclude(binding);
    if (!converter) {
      fail(
        `<${name}> (${binding.module}#${binding.export}) has no native conversion`,
        start,
        `Author a native component for it and map "${binding.module}" export "${binding.export}" under \`components\` in the --mapping file.`,
      );
      return "whole";
    }
    const props: Record<string, JsonValue> = {};
    const dynamic: string[] = [];
    const bindings: Record<string, string> = {};
    for (const attribute of node.attributes ?? []) {
      const value = await attributeValue(attribute);
      if (!attribute.name) dynamic.push("{...spread}");
      else if (value !== undefined) props[attribute.name] = value;
      else {
        dynamic.push(attribute.name);
        const binding = attributeBinding(attribute);
        if (binding) bindings[attribute.name] = binding;
      }
    }
    const opening = openingTagEnd(source, node);
    const close = closingTagStart(source, node);
    const input: ElementInput = {
      name,
      module: binding.module,
      export: binding.export,
      props,
      dynamic,
      bindings,
      children: close === undefined ? "" : source.slice(opening, close),
      childValue: await childValue(node),
      childText: childrenText(node),
      ...(inHtml && { html: true }),
      ...(parent && { parent }),
      route,
      section: (path) => context.sections?.get(path.replace(/\/?$/, "/")),
      project: {
        icons: context.icons,
        exists: (path) => project.exists(path),
        readText: (path) => project.readText(path),
        imageSize: (path) => project.imageSize(path),
        staticFile: async (url) => {
          const statics = document.dialect.statics;
          if (!statics || !url.startsWith(statics.base)) return undefined;
          let path: string;
          try {
            path = decodeURIComponent(url.slice(statics.base.length).replace(/[?#].*$/, ""));
          } catch {
            return undefined;
          }
          for (const directory of statics.directories) {
            const file = posix.join(directory, path);
            if (!/^\.\.(\/|$)/.test(posix.relative(directory, file)) && (await project.exists(file))) return file;
          }
          return undefined;
        },
        relative: (path) => {
          const relative = posix.relative(posix.dirname(nativeFile), path);
          return relative.startsWith(".") ? relative : `./${relative}`;
        },
      },
      file,
      line: node.position!.start.line,
    };
    let result: Awaited<ReturnType<typeof converter>>;
    try {
      result = await converter(input);
    } catch (error) {
      result = { error: `The ${binding.module}#${binding.export} mapping failed: ${(error as Error).message}` };
    }
    if ("error" in result) {
      fail(result.error, start, result.suggestion);
      return "whole";
    }
    const self = { module: binding.module, export: binding.export, props };
    if ("keep" in result) return self;
    if ("remove" in result) {
      diagnostics.review({ file, line: input.line, code: "component", message: `<${name}> is removed: ${result.remove}` });
      edits.push({ start, end, text: "" });
      replaced.push({ start, end });
      return "whole";
    }
    if (result.review) diagnostics.review({ file, line: input.line, code: "component", message: result.review });
    if ("component" in result && result.children !== undefined && input.children.trim()) {
      fail(`<${name}> has children that its native replacement would discard`, start);
      return "whole";
    }
    const replacement = replace(node, result, start, end, opening, close, alone);
    return replacement === "tags" ? self : replacement;
  }

  function replace(
    node: SyntaxNode,
    result: Exclude<ElementReplacement, { remove: string } | { keep: true }>,
    start: number,
    end: number,
    opening: number,
    close: number | undefined,
    alone: boolean,
  ): "whole" | "tags" {
    if ("markdown" in result) {
      edits.push({ start, end, text: result.markdown });
      replaced.push({ start, end });
      return "whole";
    }
    if ("fence" in result) {
      if (node.type !== "mdxJsxFlowElement" && !alone) {
        fail(`<${node.name}> becomes a fenced block, so it must stand on its own lines`, start);
        return "whole";
      }
      // Lines after the first continue the container the element stands in: a list item's indent, a quote's marker.
      const indent = source.slice(source.lastIndexOf("\n", start - 1) + 1, start).replace(/[^\s>]/g, " ");
      const fence = "`".repeat(Math.max(3, longestRun(result.fence.code, "`") + 1));
      const info = [result.fence.language, result.fence.meta].filter(Boolean).join(" ");
      const body = [`${fence}${info}`, ...result.fence.code.split("\n"), fence].join(`\n${indent}`);
      edits.push({ start, end, text: body });
      replaced.push({ start, end });
      return "whole";
    }
    if ("unwrap" in result) {
      if (close !== undefined) edits.push({ start, end: opening, text: "" }, { start: close, end, text: "" });
      else edits.push({ start, end, text: "" });
      return "tags";
    }
    const tag = `<${result.component}${formatProps(result.props ?? {})}`;
    if (result.children !== undefined) {
      edits.push({ start, end, text: `${tag}>${result.children}</${result.component}>` });
      replaced.push({ start, end });
      return "whole";
    }
    if (close === undefined) {
      edits.push({ start, end, text: `${tag} />` });
      return "whole";
    }
    edits.push({ start, end: opening, text: `${tag}>` }, { start: close, end, text: `</${result.component}>` });
    return "tags";
  }

  async function htmlElement(node: SyntaxNode, inTable: boolean, inHtml: boolean): Promise<"tags"> {
    // MDX reads Markdown inside `<p>`; CommonMark prints it as raw HTML. A plain
    // `<p>` means a paragraph, so it becomes one (a table cell keeps its line).
    if (node.name === "p" && !node.attributes?.length && !inTable) {
      const element = span(node);
      const close = closingTagStart(source, node);
      if (close !== undefined) {
        edits.push(...unwrapParagraph(source, element, openingTagEnd(source, node), close));
        return "tags";
      }
    }
    // MDX ends a block HTML element at its closing tag; CommonMark continues the
    // HTML block to the next blank line and would swallow Markdown that follows.
    // Inside another element the block is the parent's, and a blank line would end it.
    if (node.type === "mdxJsxFlowElement" && !inHtml) {
      const after = lineEnd(source, span(node).end);
      if (after < source.length && source.slice(span(node).end, after).trim() === "" && source.slice(after, lineEnd(source, after)).trim())
        edits.push({ start: after, end: after, text: "\n" });
      if (startsHtmlBlock(source, node)) edits.push(...rawBlockMarkdown(source, node));
    }
    for (const attribute of node.attributes ?? []) {
      if (!attribute.position) continue;
      const range = span(attribute);
      if (!attribute.name) {
        fail(`<${node.name}> spreads attributes from an expression`, range.start);
        continue;
      }
      const name = HTML_ATTRIBUTE_NAMES[attribute.name] ?? attribute.name;
      if (attribute.value === null || typeof attribute.value === "string") {
        if (name !== attribute.name) edits.push({ start: range.start, end: range.start + attribute.name.length, text: name });
        continue;
      }
      const value = await attributeValue(attribute);
      if (value === undefined) {
        fail(`<${node.name}> attribute "${attribute.name}" is an executable expression`, range.start);
        continue;
      }
      const text = name === "style" && value && typeof value === "object" && !Array.isArray(value) ? styleText(value) : value;
      if (typeof text !== "string" && typeof text !== "number" && typeof text !== "boolean") {
        fail(`<${node.name}> attribute "${attribute.name}" is not a plain value`, range.start);
        continue;
      }
      edits.push({ start: range.start, end: range.end, text: text === true ? name : `${name}="${escapeAttribute(String(text))}"` });
    }
    // JSX closes any element with `/>`, HTML only a void one: another, such as `<iframe />`, would hold the rest of the page.
    const end = openingTagEnd(source, node);
    if (closingTagStart(source, node) === undefined && source.slice(end - 2, end) === "/>" && !VOID_ELEMENTS.has(node.name!.toLowerCase()) && !(foreign ??= foreignElements(tree)).has(node)) {
      // A tag that closes on a line of its own keeps the line.
      const space = spaceBefore(source, end - 2);
      edits.push({ start: source.slice(space, end - 2).includes("\n") ? end - 2 : space, end, text: `></${node.name}>` });
    }
    return "tags";
  }

  async function expression(node: SyntaxNode): Promise<void> {
    const { start, end } = span(node);
    const body = node.data?.estree?.body ?? [];
    if (!body.length) {
      // A comment renders nothing; drop its line when it stands alone.
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const standalone = node.type === "mdxFlowExpression" && !source.slice(lineStart, start).trim();
      edits.push(standalone ? removeBlock(source, { start: lineStart, end }) : { start, end, text: "" });
      return;
    }
    const value = body.length === 1 && body[0].type === "ExpressionStatement" ? await staticText(body[0].expression as EstreeNode) : undefined;
    if (value === undefined) {
      fail("This expression is evaluated when the page renders", start, "Replace it with its literal value, or move it into a native component.");
      return;
    }
    edits.push({ start, end, text: markdownText(value) });
  }

  /**
   * `export const name = value` of a static value the framework does not read
   * from a page: page data, which the page's uses read where they are.
   */
  async function pageData(statement: EstreeNode): Promise<boolean> {
    const declaration = statement.declaration as EstreeNode | null;
    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") return false;
    for (const declarator of declaration.declarations as EstreeNode[]) {
      const id = declarator.id as EstreeNode;
      if (id.type !== "Identifier" || !declarator.init || document.dialect.pageExports?.includes(identifierName(id))) return false;
      // The page's own helper is read where the page calls it or shows it, and a use that cannot be stops there;
      // one the page passes on as a value would still run.
      if ((declarator.init as EstreeNode).type === "ArrowFunctionExpression") {
        values ??= valueNames(tree);
        if (values.has(identifierName(id))) return false;
      } else if ((await staticValue(declarator.init as EstreeNode)) === undefined) return false;
    }
    return true;
  }

  /** The static value of children that are one expression, such as a code block's template literal. */
  async function childValue(node: SyntaxNode): Promise<JsonValue | undefined> {
    const children = (node.children ?? []).filter((child) => !(child.type === "text" && !child.value?.trim()));
    const only = children.length === 1 ? children[0] : undefined;
    const inner = only?.type === "paragraph" && only.children?.length === 1 ? only.children[0] : only;
    if (inner?.type !== "mdxFlowExpression" && inner?.type !== "mdxTextExpression") return undefined;
    const body = inner.data?.estree?.body ?? [];
    return body.length === 1 && body[0].type === "ExpressionStatement" ? staticValue(body[0].expression as EstreeNode) : undefined;
  }

  async function staticText(node: EstreeNode): Promise<string | undefined> {
    const value = await staticValue(node);
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  }

  /** `module#export` when an attribute's value is exactly an imported binding. */
  function attributeBinding(attribute: JsxAttribute): string | undefined {
    if (typeof attribute.value !== "object" || !attribute.value) return undefined;
    const statement = attribute.value.data?.estree?.body?.[0];
    const value = statement?.type === "ExpressionStatement" ? evaluate(statement.expression as EstreeNode, scope) : undefined;
    return value?.kind === "reference" ? identityKey(value.binding.module, value.binding.export) : undefined;
  }

  async function attributeValue(attribute: JsxAttribute): Promise<JsonValue | undefined> {
    if (attribute.type === "mdxJsxExpressionAttribute") return undefined;
    if (attribute.value === null || attribute.value === undefined) return true;
    if (typeof attribute.value === "string") return attribute.value;
    const statement = attribute.value.data?.estree?.body?.[0];
    return statement?.type === "ExpressionStatement" ? staticValue(statement.expression as EstreeNode) : undefined;
  }

  for (const child of tree.children ?? []) await visit(child);
  // Docusaurus reads a heading line's first `{#`, escaped or not, as where its id starts (`escapeMarkdownHeadingIds`); native reads it unescaped.
  if (document.dialect.headingIds)
    for (const { node } of walk(tree)) {
      if (node.type !== "heading" || !node.position || inside(node.position.start.offset)) continue;
      const start = node.position.start.offset;
      const line = source.slice(start, lineEnd(source, start));
      const at = line.indexOf("{#");
      if (line.startsWith("#") && at > 0 && line[at - 1] === "\\") edits.push({ start: start + at - 1, end: start + at, text: "" });
    }
  if (!document.dialect.mdx1) edits.push(...[...paragraphIndents(tree, source), ...tableRowIndents(tree, source)].filter((edit) => !inside(edit.end)));
  if (diagnostics.errors.length > before) return { text: source, failed: true };
  return { text: applyEdits(source, edits), failed: false };
}

/**
 * MDX reads no indented code, so a paragraph that starts four columns past its
 * container's text would become code in native Markdown, where component bodies
 * and pages keep CommonMark's indented code. Its first line moves back to the
 * container's indentation; continuation lines may stay indented.
 */
/** The elements of a paragraph that stand on their own lines: only line breaks part them from the text before and after. */
function ownLines(paragraph: SyntaxNode): Set<SyntaxNode> {
  const children = paragraph.children ?? [];
  const blank = (child: SyntaxNode) => child.type === "text" && !child.value?.trim();
  const lines = new Set<SyntaxNode>();
  children.forEach((child, index) => {
    if (child.type !== "mdxJsxTextElement") return;
    const before = children[index - 1], after = children[index + 1];
    const opens = children.slice(0, index).every(blank) || (before.type === "text" && /\n[ \t]*$/.test(before.value ?? ""));
    const closes = children.slice(index + 1).every(blank) || (after.type === "text" && /^[ \t]*\n/.test(after.value ?? ""));
    if (opens && closes) lines.add(child);
  });
  return lines;
}

function paragraphIndents(tree: SyntaxNode, source: string): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const { node, parents } of walk(tree)) {
    const parent = parents.at(-1);
    if (node.type !== "paragraph" || !node.position || !parent || (parent.type !== "root" && parent.type !== "mdxJsxFlowElement")) continue;
    const start = node.position.start.offset;
    const line = source.lastIndexOf("\n", start - 1) + 1;
    const prefix = source.slice(line, start);
    const base = parent.type === "root" ? 0 : bodyIndent(source, parent);
    if (/^[ \t]*$/.test(prefix) && indentColumns(prefix) >= base + 4) edits.push({ start: line, end: start, text: " ".repeat(base) });
  }
  return edits;
}

/**
 * GFM reads a table row indented four columns past its table as a row, as
 * GitHub and MDX do; native ends the table there and reads the row as code.
 * Such a row is written at its table's indentation.
 */
function tableRowIndents(tree: SyntaxNode, source: string): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const { node } of walk(tree)) {
    if (node.type !== "table" || !node.position) continue;
    const start = node.position.start.offset;
    const base = indentColumns(source.slice(source.lastIndexOf("\n", start - 1) + 1, start).replace(/[^\t]/g, " "));
    for (const row of (node.children ?? []).slice(1)) {
      if (!row.position) continue;
      const at = row.position.start.offset;
      const line = source.lastIndexOf("\n", at - 1) + 1;
      const prefix = source.slice(line, at);
      if (/^[ \t]*$/.test(prefix) && indentColumns(prefix) >= base + 4) edits.push({ start: line, end: at, text: " ".repeat(base) });
    }
  }
  return edits;
}

/** The indentation a component's body lines share, in columns. */
function bodyIndent(source: string, element: SyntaxNode): number {
  const close = closingTagStart(source, element);
  if (close === undefined) return 0;
  const body = source.slice(openingTagEnd(source, element), close).split("\n").slice(1).filter((text) => text.trim());
  return body.length ? Math.min(...body.map((text) => indentColumns(text.match(/^[ \t]*/)![0]))) : 0;
}

/** An imported Markdown or MDX file used as a component is a native include. */
function partialInclude(binding: { module: string; export: string }): ComponentConverter | undefined {
  if (binding.export !== "default" || !/\.mdx?$/.test(binding.module) || binding.module.startsWith("@")) return undefined;
  return ({ props, dynamic, children, project }) =>
    Object.keys(props).length || dynamic.length || children.trim()
      ? { error: "A partial with props or children has no native include form", suggestion: "Inline the content, or move the variables into the partial." }
      : { component: "Include", props: { src: project.relative(binding.module) } };
}

function isElementOverride(statement: EstreeNode, scope: ModuleScope, overrides: ReadonlySet<string>): boolean {
  const declaration = statement.declaration as EstreeNode | null;
  if (declaration?.type !== "VariableDeclaration") return false;
  return (declaration.declarations as EstreeNode[]).every((declarator) => {
    const id = declarator.id as EstreeNode;
    const init = declarator.init as EstreeNode | null;
    if (id.type !== "Identifier" || id.name !== "components" || init?.type !== "Identifier") return false;
    const binding = scope.imports.get(init.name as string);
    return !!binding && overrides.has(identityKey(binding.module, binding.export));
  });
}

/**
 * `export const toc = PartialTOC`, which lends a page an included partial's
 * headings (Docusaurus); a native `<Include>` puts them in the page outline itself.
 */
function isPartialOutline(statement: EstreeNode, scope: ModuleScope): boolean {
  const declaration = statement.declaration as EstreeNode | null;
  if (declaration?.type !== "VariableDeclaration") return false;
  return (declaration.declarations as EstreeNode[]).every((declarator) => {
    const id = declarator.id as EstreeNode;
    const init = declarator.init as EstreeNode | null;
    const binding = init?.type === "Identifier" ? scope.imports.get(init.name as string) : undefined;
    return id.type === "Identifier" && id.name === "toc" && binding?.export === "toc" && /\.mdx?$/.test(binding.module);
  });
}

/**
 * Edits that turn `<p>...</p>` into a Markdown paragraph: tags standing on their
 * own lines go with those lines, content lines lose their indentation (four
 * spaces would start code), and one blank line separates it from what surrounds it.
 */
function unwrapParagraph(source: string, element: { start: number; end: number }, opening: number, close: number): TextEdit[] {
  const lineStart = (offset: number) => source.lastIndexOf("\n", offset - 1) + 1;
  const blank = (from: number, to: number) => !source.slice(from, to).trim();
  const edits: TextEdit[] = [];

  const openLine = lineStart(element.start);
  const openAlone = blank(openLine, element.start);
  // The paragraph keeps the column its element stands at, as the content around it does: a component's
  // children are read at their common indentation, where a paragraph moved out of it would read the rest as code.
  const indent = openAlone ? source.slice(openLine, element.start) : "";
  const contentStart = blank(opening, lineEnd(source, opening)) ? lineEnd(source, opening) : opening;
  const before = openAlone && openLine > 0 && !blank(lineStart(openLine - 1), openLine - 1) ? "\n" : "";
  edits.push({ start: openAlone ? openLine : element.start, end: contentStart, text: openAlone ? before + (contentStart === opening ? indent : "") : "\n\n" });

  const closeLine = lineStart(close);
  const closeAlone = blank(closeLine, close) && closeLine >= contentStart;
  const afterLine = lineEnd(source, element.end);
  const restBlank = blank(element.end, afterLine);
  // A following plain `<p>` separates itself, so it is treated as a blank line.
  const nextLine = source.slice(afterLine, lineEnd(source, afterLine));
  const nextBlank = afterLine >= source.length || !nextLine.trim() || /^\s*<p>/.test(nextLine);
  if (closeAlone && restBlank) edits.push({ start: closeLine, end: afterLine, text: nextBlank ? "" : "\n" });
  else edits.push({ start: close, end: restBlank ? afterLine : element.end, text: restBlank ? (nextBlank ? "\n" : "\n\n") : "\n\n" });

  const contentEnd = closeAlone && restBlank ? closeLine : close;
  for (let line = lineStart(contentStart); line < contentEnd; line = lineEnd(source, line)) {
    if (line < contentStart) continue;
    const own = source.slice(line).match(/^[ \t]*/)![0].length;
    if (line + own < contentEnd && source[line + own] !== "\n" && source.slice(line, line + own) !== indent) edits.push({ start: line, end: line + own, text: indent });
  }
  return edits;
}

/**
 * Remove whole lines from `range.start` to the end of the line holding
 * `range.end`, with one following blank line when a blank line precedes them,
 * so removed imports and comments leave no doubled gap.
 */
function removeBlock(source: string, range: { start: number; end: number }): TextEdit {
  let end = lineEnd(source, range.end);
  const before = source.slice(0, range.start);
  const precededByBlank = !before.trim() || /\n[ \t]*\n$/.test(before);
  const blank = source.slice(end).match(/^[ \t]*\n/);
  if (precededByBlank && blank) end += blank[0].length;
  // A block ending the document takes the blank lines before it.
  const trailing = !source.slice(end).trim() && before.match(/\n(?:[ \t]*\n)+$/);
  return { start: trailing ? range.start - trailing[0].length + 1 : range.start, end, text: "" };
}

function longestRun(text: string, character: string): number {
  let longest = 0;
  let current = 0;
  for (const item of text) {
    current = item === character ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function formatProps(props: Record<string, JsonValue>): string {
  return Object.entries(props)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => {
      if (value === true) return ` ${name}`;
      if (typeof value === "string" && !/["\\]/.test(value)) return ` ${name}="${value}"`;
      if (typeof value === "string" && !value.includes("'") && !value.includes("\\")) return ` ${name}='${value}'`;
      return ` ${name}={${JSON.stringify(value)}}`;
    })
    .join("");
}

/** CommonMark's HTML block tags: a line opening with one starts a block read as raw HTML to the next blank line. */
const HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col", "colgroup", "dd", "details", "dialog",
  "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option",
  "p", "param", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul",
]);

/** Whether CommonMark reads an HTML element starting a line as an HTML block: a block tag, or any tag alone on its line. */
function startsHtmlBlock(source: string, element: SyntaxNode): boolean {
  if (HTML_BLOCK_TAGS.has(element.name!.toLowerCase())) return true;
  const opening = openingTagEnd(source, element);
  return !source.slice(opening, lineEnd(source, opening)).trim();
}

/**
 * MDX reads Markdown inside an HTML element; CommonMark prints an HTML
 * block's lines, from its first tag to a blank line, as raw HTML. Inline
 * Markdown on those lines is written as the HTML MDX made of it: code spans,
 * emphasis, strikethrough, links and backslash escapes. Components keep
 * their own conversion.
 */
function rawBlockMarkdown(source: string, element: SyntaxNode): TextEdit[] {
  const { start, end } = span(element);
  const blank = /\n[ \t]*\n/.exec(source.slice(start, end));
  const rawEnd = blank ? start + blank.index : end;
  const edits: TextEdit[] = [];
  const TAGS: Record<string, string> = { emphasis: "em", strong: "strong", delete: "del" };
  const visit = (node: SyntaxNode): void => {
    for (const child of node.children ?? []) {
      if (!child.position) continue;
      const at = span(child);
      if (at.start >= rawEnd) return;
      const written = source.slice(at.start, at.end);
      if (child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement") {
        if (child.name && /^[a-z]/.test(child.name) && !child.name.includes(".")) visit(child);
      } else if (child.type === "inlineCode") {
        edits.push({ start: at.start, end: at.end, text: `<code>${escapeHtml(child.value ?? "")}</code>` });
      } else if (child.type in TAGS || child.type === "link") {
        const inner = child.children?.filter((item) => item.position) ?? [];
        const open = child.type === "link" ? `<a href="${escapeAttribute(child.url ?? "")}"${child.title ? ` title="${escapeAttribute(child.title)}"` : ""}>` : `<${TAGS[child.type]}>`;
        const close = child.type === "link" ? "</a>" : `</${TAGS[child.type]}>`;
        // A bare address GFM links has no delimiters: the whole of it is the link's text.
        if (!inner.length || (child.type === "link" && !written.startsWith("["))) edits.push({ start: at.start, end: at.end, text: `${open}${escapeHtml(textContent(child))}${close}` });
        else {
          edits.push({ start: at.start, end: span(inner[0]).start, text: open }, { start: span(inner.at(-1)!).end, end: at.end, text: close });
          visit(child);
        }
      } else if (child.type === "text") {
        // A brace is a character reference, which MDX and HTML both read as the brace.
        for (const escape of written.matchAll(/\\([!-/:-@[-`{-~])/g))
          edits.push({ start: at.start + escape.index, end: at.start + escape.index + 2, text: escape[1] === "{" ? "&#123;" : escape[1] === "}" ? "&#125;" : escapeHtml(escape[1]) });
      } else visit(child);
    }
  };
  visit(element);
  return edits;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

