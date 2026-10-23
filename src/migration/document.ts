/**
 * Convert one MDX document to native Sourcey Markdown. Only constructs that
 * need conversion are edited; prose, code and formatting keep their bytes.
 */
import { posix } from "node:path";
import type { IconSet } from "../config.js";
import { indentColumns } from "../utils/indentation.js";
import type { JsonValue } from "../core/markdown-components.js";
import { identityKey, type ComponentConverter, type ConverterTable, type ElementInput, type ElementReplacement } from "./components.js";
import type { Diagnostics } from "./diagnostics.js";
import { evaluate, exportedConstant, scopeFromProgram, toJson, type CallValue, type ImportBinding, type JsonResult, type ModuleScope } from "./javascript.js";
import { childrenText, closingTagStart, openingTagEnd, span, walk, type EstreeNode, type JsxAttribute, type SyntaxNode } from "./mdx.js";
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

const HTML_ATTRIBUTE_NAMES: Record<string, string> = { className: "class", htmlFor: "for" };

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

  const edits: TextEdit[] = [];
  const replaced: { start: number; end: number }[] = [];
  const inside = (offset: number) => replaced.some((range) => offset >= range.start && offset < range.end);

  for (const node of moduleStatements(tree)) {
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type === "ImportDeclaration") continue;
      if (statement.type === "ExportNamedDeclaration" && (isElementOverride(statement, scope, context.elementOverrides) || isPartialOutline(statement, scope))) continue;
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
      const close = closingTagStart(source, start, end)!;
      edits.push({ start, end: openingTagEnd(source, start), text: "" }, { start: close, end, text: "" });
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
    const opening = openingTagEnd(source, start);
    const close = closingTagStart(source, start, end);
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
      const close = closingTagStart(source, element.start, element.end);
      if (close !== undefined) {
        edits.push(...unwrapParagraph(source, element, openingTagEnd(source, element.start), close));
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

  /** A static value, following imported constants to their authoritative module and evaluating the framework's fixed calls. */
  async function staticValue(node: EstreeNode): Promise<JsonValue | undefined> {
    const value = evaluate(node, scope);
    const json = value.kind === "reference" ? await exportedConstant(project, value.binding) : toJson(value, frameworkCall);
    return json?.ok ? json.value : undefined;
  }

  /** A call to a framework function whose value the site fixes, with static arguments: `useBaseUrl("/img/a.png")`. */
  function frameworkCall(call: CallValue): JsonResult | undefined {
    const evaluated = call.callee && document.dialect.calls?.get(identityKey(call.callee.module, call.callee.export));
    if (!evaluated) return undefined;
    const args: JsonValue[] = [];
    for (const argument of call.args) {
      const json = toJson(argument, frameworkCall);
      if (!json.ok) return json;
      args.push(json.value);
    }
    const value = evaluated(args);
    return value === undefined ? undefined : { ok: true, value };
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
  if (!document.dialect.mdx1) edits.push(...paragraphIndents(tree, source).filter((edit) => !inside(edit.end)));
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
    const base = parent.type === "root" ? 0 : bodyIndent(source, span(parent));
    if (/^[ \t]*$/.test(prefix) && indentColumns(prefix) >= base + 4) edits.push({ start: line, end: start, text: " ".repeat(base) });
  }
  return edits;
}

/** The indentation a component's body lines share, in columns. */
function bodyIndent(source: string, element: { start: number; end: number }): number {
  const close = closingTagStart(source, element.start, element.end);
  if (close === undefined) return 0;
  const body = source.slice(openingTagEnd(source, element.start), close).split("\n").slice(1).filter((text) => text.trim());
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
  const contentStart = blank(opening, lineEnd(source, opening)) ? lineEnd(source, opening) : opening;
  const before = openAlone && openLine > 0 && !blank(lineStart(openLine - 1), openLine - 1) ? "\n" : "";
  edits.push({ start: openAlone ? openLine : element.start, end: contentStart, text: openAlone ? before : "\n\n" });

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
    const indent = source.slice(line).match(/^[ \t]+/)?.[0].length ?? 0;
    if (indent && line + indent <= contentEnd) edits.push({ start: line, end: line + indent, text: "" });
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

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function styleText(style: Record<string, JsonValue>): string {
  return Object.entries(style)
    .map(([property, value]) => `${property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value}`)
    .join("; ");
}
