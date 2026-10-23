/**
 * Source-aware reading of JavaScript and TypeScript configuration. Values are
 * evaluated only where they are static; imported bindings keep their module
 * identity, and anything executable stays an explicit `dynamic` value with its
 * location. No project code runs here.
 */
import { posix } from "node:path";
import type { ProjectFiles } from "./project-files.js";
import type { EstreeNode } from "./mdx.js";
import type { JsonValue } from "../core/markdown-components.js";

export interface ImportBinding {
  /** Project-relative file for local modules, otherwise the package specifier. */
  module: string;
  /** `default`, a named export, or `*` for a namespace import. */
  export: string;
  local: string;
}

export type Value =
  | { kind: "literal"; value: string | number | boolean | null; node: EstreeNode }
  | { kind: "array"; items: Value[]; node: EstreeNode }
  | { kind: "object"; entries: Map<string, Value>; node: EstreeNode }
  | { kind: "call"; callee?: ImportBinding; calleeName: string; args: Value[]; node: EstreeNode }
  | { kind: "reference"; binding: ImportBinding; node: EstreeNode }
  | { kind: "spread"; value: Value; node: EstreeNode }
  | { kind: "dynamic"; reason: string; node: EstreeNode };

export interface ModuleScope {
  file: string;
  source: string;
  imports: Map<string, ImportBinding>;
  constants: Map<string, EstreeNode>;
  exports: Map<string, EstreeNode>;
  defaultExport?: EstreeNode;
  program: EstreeNode & { body: EstreeNode[] };
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".astro", ".mdx", ".md", ".json"];

/** Resolve an import specifier to a project file, or keep a package specifier as written. */
export async function resolveModule(project: ProjectFiles, from: string, specifier: string): Promise<string> {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return specifier;
  const base = specifier.startsWith("/") ? specifier.slice(1) : posix.join(posix.dirname(from), specifier);
  const normalised = posix.normalize(base);
  const stem = normalised.replace(/\.(m?js|jsx)$/, "");
  const candidates = [
    normalised,
    ...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${normalised}/index${extension}`),
  ];
  for (const candidate of candidates) {
    if (candidate.startsWith("..")) break;
    if (await project.isFileOnDisk(candidate)) return candidate;
  }
  return normalised;
}

export async function parseModule(project: ProjectFiles, file: string, source?: string): Promise<ModuleScope> {
  const text = source ?? (await project.readText(file));
  const { parse } = await import("@babel/parser");
  const typescript = /\.(m|c)?tsx?$/.test(file);
  const ast = parse(text, {
    sourceType: "module",
    plugins: ["estree", ...(typescript ? (["typescript"] as const) : []), ...(/x$/.test(file) ? (["jsx"] as const) : [])],
  }) as unknown as { program: EstreeNode & { body: EstreeNode[] } };
  return scopeFromProgram(project, file, text, ast.program);
}

export async function scopeFromProgram(
  project: ProjectFiles,
  file: string,
  source: string,
  program: EstreeNode & { body: EstreeNode[] },
): Promise<ModuleScope> {
  const scope: ModuleScope = { file, source, imports: new Map(), constants: new Map(), exports: new Map(), program };
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      if ((statement as { importKind?: string }).importKind === "type") continue;
      const module = await resolveModule(project, file, (statement.source as { value: string }).value);
      for (const specifier of statement.specifiers as EstreeNode[]) {
        const local = (specifier.local as { name: string }).name;
        const exportName =
          specifier.type === "ImportDefaultSpecifier"
            ? "default"
            : specifier.type === "ImportNamespaceSpecifier"
              ? "*"
              : identifierName(specifier.imported as EstreeNode);
        scope.imports.set(local, { module, export: exportName, local });
      }
    }
    const declaration =
      statement.type === "ExportNamedDeclaration" ? (statement.declaration as EstreeNode | null) : statement;
    if (declaration?.type === "VariableDeclaration" && declaration.kind === "const") {
      for (const declarator of declaration.declarations as EstreeNode[]) {
        const id = declarator.id as EstreeNode;
        if (id.type !== "Identifier" || !declarator.init) continue;
        scope.constants.set(identifierName(id), declarator.init as EstreeNode);
        if (statement.type === "ExportNamedDeclaration") scope.exports.set(identifierName(id), declarator.init as EstreeNode);
      }
    }
    if (statement.type === "ExportNamedDeclaration" && !statement.declaration) {
      for (const specifier of (statement.specifiers as EstreeNode[]) ?? []) {
        const local = identifierName(specifier.local as EstreeNode);
        const exported = identifierName(specifier.exported as EstreeNode);
        const init = scope.constants.get(local);
        if (init) scope.exports.set(exported, init);
      }
    }
    if (statement.type === "ExportDefaultDeclaration") scope.defaultExport = statement.declaration as EstreeNode;
  }
  return scope;
}

export function identifierName(node: EstreeNode): string {
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "Literal" || node.type === "StringLiteral") return String(node.value);
  throw new Error(`Expected an identifier, found ${node.type}`);
}

function unwrap(node: EstreeNode): EstreeNode {
  let current = node;
  while (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression", "TSTypeAssertion"].includes(current.type))
    current = current.expression as EstreeNode;
  return current;
}

/** Evaluate an expression as far as it is static. */
export function evaluate(node: EstreeNode, scope: ModuleScope, seen = new Set<EstreeNode>()): Value {
  const expression = unwrap(node);
  switch (expression.type) {
    case "Literal": {
      const value = expression.value;
      if (value === null || ["string", "number", "boolean"].includes(typeof value))
        return { kind: "literal", value: value as string | number | boolean | null, node: expression };
      return { kind: "dynamic", reason: "a regular expression or big integer", node: expression };
    }
    case "TemplateLiteral": {
      if ((expression.expressions as EstreeNode[]).length)
        return { kind: "dynamic", reason: "a template with interpolated expressions", node: expression };
      const quasi = (expression.quasis as { value: { cooked: string } }[])[0];
      return { kind: "literal", value: quasi.value.cooked, node: expression };
    }
    case "UnaryExpression":
      if (expression.operator === "-" && (expression.argument as EstreeNode).type === "Literal")
        return { kind: "literal", value: -Number((expression.argument as EstreeNode).value), node: expression };
      return { kind: "dynamic", reason: "a computed expression", node: expression };
    case "ArrayExpression":
      return {
        kind: "array",
        node: expression,
        items: (expression.elements as (EstreeNode | null)[]).map((element) =>
          element === null
            ? { kind: "dynamic", reason: "an array hole", node: expression }
            : element.type === "SpreadElement"
              ? { kind: "spread", value: evaluate(element.argument as EstreeNode, scope, seen), node: element }
              : evaluate(element, scope, seen),
        ),
      };
    case "ObjectExpression": {
      const entries = new Map<string, Value>();
      for (const property of expression.properties as EstreeNode[]) {
        if (property.type === "SpreadElement") {
          const spread = evaluate(property.argument as EstreeNode, scope, seen);
          if (spread.kind !== "object") return { kind: "dynamic", reason: "a spread of a non-static object", node: property };
          for (const [key, value] of spread.entries) entries.set(key, value);
          continue;
        }
        if (property.type !== "Property" || property.computed || property.kind !== "init" || property.method)
          return { kind: "dynamic", reason: "a computed, accessor or method property", node: property };
        entries.set(identifierName(property.key as EstreeNode), evaluate(property.value as EstreeNode, scope, seen));
      }
      return { kind: "object", entries, node: expression };
    }
    case "Identifier": {
      const name = expression.name as string;
      if (name === "undefined") return { kind: "literal", value: null, node: expression };
      const imported = scope.imports.get(name);
      if (imported) return { kind: "reference", binding: imported, node: expression };
      const init = scope.constants.get(name);
      if (init && !seen.has(init)) return evaluate(init, scope, new Set([...seen, init]));
      return { kind: "dynamic", reason: `the variable "${name}" is not a static constant`, node: expression };
    }
    case "CallExpression": {
      const callee = unwrap(expression.callee as EstreeNode);
      const calleeName = callee.type === "Identifier" ? (callee.name as string) : callee.type;
      return {
        kind: "call",
        callee: callee.type === "Identifier" ? scope.imports.get(calleeName) : undefined,
        calleeName,
        args: (expression.arguments as EstreeNode[]).map((argument) => evaluate(argument, scope, seen)),
        node: expression,
      };
    }
    default:
      return { kind: "dynamic", reason: `a ${expression.type}`, node: expression };
  }
}

export type JsonResult = { ok: true; value: JsonValue } | { ok: false; node: EstreeNode; reason: string };

/** A call the evaluator found, which a framework can know the value of. */
export type CallValue = Extract<Value, { kind: "call" }>;

/**
 * A fully static value as JSON, or the first part that is not static. `call`
 * gives the value of a call whose result the framework fixes, if it knows one.
 */
export function toJson(value: Value, call?: (value: CallValue) => JsonResult | undefined): JsonResult {
  switch (value.kind) {
    case "literal":
      return { ok: true, value: value.value };
    case "array": {
      const items: JsonValue[] = [];
      for (const item of value.items) {
        if (item.kind === "spread") {
          const spread = toJson(item.value, call);
          if (!spread.ok) return spread;
          if (!Array.isArray(spread.value)) return { ok: false, node: item.node, reason: "a spread of a non-array" };
          items.push(...spread.value);
          continue;
        }
        const result = toJson(item, call);
        if (!result.ok) return result;
        items.push(result.value);
      }
      return { ok: true, value: items };
    }
    case "object": {
      const object: Record<string, JsonValue> = {};
      for (const [key, entry] of value.entries) {
        const result = toJson(entry, call);
        if (!result.ok) return result;
        object[key] = result.value;
      }
      return { ok: true, value: object };
    }
    case "reference":
      return { ok: false, node: value.node, reason: `the imported binding "${value.binding.local}" from ${value.binding.module}` };
    case "call":
      return call?.(value) ?? { ok: false, node: value.node, reason: `a call to ${value.calleeName}()` };
    case "spread":
      return { ok: false, node: value.node, reason: "a spread outside an array" };
    case "dynamic":
      return { ok: false, node: value.node, reason: value.reason };
  }
}

/**
 * The static value of an exported constant in a project module, following
 * re-exported imports. Used for imported constant URLs written in content.
 */
export async function exportedConstant(
  project: ProjectFiles,
  binding: ImportBinding,
  depth = 0,
  aliases?: Readonly<Record<string, string>>,
): Promise<JsonResult | undefined> {
  const file = await aliasedModule(project, binding.module, aliases);
  if (depth > 8 || file.startsWith("@") || !/\.(m?[jt]sx?)$/.test(file)) return undefined;
  if (!(await project.exists(file))) return undefined;
  const scope = await parseModule(project, file);
  const init = binding.export === "default" ? scope.defaultExport : scope.exports.get(binding.export);
  if (!init) return undefined;
  const value = evaluate(init, scope);
  if (value.kind === "reference") return exportedConstant(project, value.binding, depth + 1, aliases);
  return toJson(value);
}

/**
 * The project file a module identity names through a framework's alias, such
 * as Docusaurus's `@site/` for the project root; other identities as they are.
 */
async function aliasedModule(project: ProjectFiles, module: string, aliases?: Readonly<Record<string, string>>): Promise<string> {
  for (const [alias, directory] of Object.entries(aliases ?? {}))
    if (module === alias || module.startsWith(`${alias}/`)) return resolveModule(project, "", `./${posix.join(directory, module.slice(alias.length))}`);
  return module;
}
