/**
 * The fragments Mintlify publishes, as native anchors. Mintlify spells a name
 * in kebab case: a lowercase letter or digit before a capital starts a word,
 * and anything else that is not a letter or digit separates words.
 *
 * An API page names each field by its place in the operation: `parameter-`
 * and the parameter's name, whatever its location; `authorization-` and what
 * carries the credentials (an API key's own name, otherwise `Authorization`);
 * `body-` or `response-` and the field's path in the schema. The path joins
 * property names, `items` for an array's items, `additionalProperties` for a
 * map's values, and `oneOf` and the index of the alternative of a union it
 * shows; `anyOf`, `oneOf`, a nullable typed schema and a list of types are all
 * unions, and `allOf` merges into one object.
 *
 * A page shows each union's first alternative, and a fresh visit to one of its
 * fragments opens the field's parents and reaches it. Another alternative's
 * fragments exist only once a reader picks it, so no link reaches them. The
 * response is the first the operation lists, and a body its first media type.
 */
import { operationFieldRoot, parameterFieldAnchor, referenceFieldPath } from "../../core/reference-identity.js";
import type { NormalizedSchema, SecurityScheme } from "../../core/types.js";
import { slugify } from "../../utils/slug.js";
import type { ReferenceOperation } from "../openapi.js";

export const mintlifySlug = (name: string) => slugify(name.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

/** Locations in the order Mintlify lists their parameters. */
const LOCATIONS = ["header", "path", "query", "cookie"];

export interface OperationAliases {
  /** Each original fragment, by the native section or field holding it. */
  aliases: Record<string, string>;
  /** Original fragments that name two fields; the first on the page, which a browser opens, keeps the fragment. */
  conflicts: string[];
  /** Original fragments whose field the native reference does not show, such as one nested deeper than it draws. */
  unresolved: string[];
}

export function operationAliases(operation: ReferenceOperation, schemes: Readonly<Record<string, SecurityScheme>>): OperationAliases {
  const result: OperationAliases = { aliases: {}, conflicts: [], unresolved: [] };
  const native = operation.native;
  if (!native) return result;
  const anchors = new Set(operation.anchors);
  const targets = new Map<string, string>();
  const add = (fragment: string, target: string) => {
    if (!anchors.has(target)) result.unresolved.push(fragment);
    else if (targets.has(fragment) || (anchors.has(fragment) && fragment !== target)) {
      if (targets.get(fragment) !== target) result.conflicts.push(fragment);
    } else {
      targets.set(fragment, target);
      if (fragment !== target) result.aliases[fragment] = target;
    }
  };

  for (const requirement of native.security) for (const name of Object.keys(requirement)) {
    const scheme = schemes[name];
    add(`authorization-${mintlifySlug(scheme?.type === "apiKey" && scheme.name ? scheme.name : "Authorization")}`, "authentication");
  }
  const root = operationFieldRoot(native);
  const parameters = referenceFieldPath(root, "parameters");
  for (const location of LOCATIONS) for (const parameter of native.parameters.filter((entry) => entry.in === location))
    add(`parameter-${mintlifySlug(parameter.name)}`, parameterFieldAnchor(parameters, parameter));
  const section = (prefix: string, content: Record<string, { schema?: NormalizedSchema }> | undefined, path: string) => {
    const [media, body] = Object.entries(content ?? {})[0] ?? [];
    if (media && body?.schema) fields(body.schema, [], referenceFieldPath(path, media), (key, target) => add(`${prefix}-${mintlifySlug(key.join("."))}`, target), 0);
  };
  section("body", native.requestBody?.content, referenceFieldPath(root, "request-body"));
  const [response] = native.responses;
  if (response) section("response", response.content, referenceFieldPath(root, "responses", response.statusCode, "content"));
  return result;
}

type Emit = (key: string[], target: string) => void;

/** How deep the walk follows fields, which bounds it on a schema that contains itself; a deeper fragment is not matched. */
const FIELD_DEPTH = 10;

/**
 * A schema's alternatives as Mintlify lists them, each with the native path
 * its fields hang from: nested unions flattened, and null last for a nullable
 * schema with a type (an untyped nullable schema is one field).
 */
function alternatives(schema: NormalizedSchema, path: string): { schema: NormalizedSchema; path: string }[] {
  const kind = schema.oneOf?.length ? "oneOf" : schema.anyOf?.length ? "anyOf" : undefined;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nothing = schema.nullable && (kind || types.length) ? [{ schema: { type: "null" }, path }] : [];
  if (kind) return [...schema[kind]!.flatMap((branch, index) => alternatives(branch, referenceFieldPath(path, kind, String(index)))), ...nothing];
  if (types.length > 1) return [...types.map((type) => ({ schema: { ...schema, type }, path })), ...nothing];
  return [{ schema, path }, ...nothing];
}

const isObject = (schema: NormalizedSchema) => schema.type === "object" || Boolean(schema.properties || schema.allOf?.length);

/**
 * The fields of the alternative a schema shows, under its key. With `row`, the
 * schema's own row first: a union of objects is one row whose fields follow
 * the alternative picked; any other union's row is the alternative it shows.
 */
function fields(schema: NormalizedSchema, key: string[], path: string, emit: Emit, depth: number, row = false): void {
  if (depth >= FIELD_DEPTH) return;
  const choices = alternatives(schema, path);
  const at = choices.length > 1 ? [...key, "oneOf", "0"] : key;
  if (row) emit(choices.every((choice) => isObject(choice.schema)) ? key : at, path);
  children(choices[0].schema, at, choices[0].path, emit, depth + 1);
}

/** The fields a schema shows below it: its items', or its own properties, its map's values and its merged parts' properties. */
function children(schema: NormalizedSchema, key: string[], path: string, emit: Emit, depth: number): void {
  if (schema.type === "array" && schema.items) return fields(schema.items, [...key, "items"], referenceFieldPath(path, "items"), emit, depth);
  // Required properties first, each group in the document's order, as Mintlify lists them.
  const properties = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required);
  for (const [name, property] of [...properties.filter(([name]) => required.has(name)), ...properties.filter(([name]) => !required.has(name))])
    fields(property, [...key, name], referenceFieldPath(path, "properties", name), emit, depth, true);
  if (typeof schema.additionalProperties === "object") fields(schema.additionalProperties, [...key, "additionalProperties"], referenceFieldPath(path, "additionalProperties"), emit, depth, true);
  schema.allOf?.forEach((part, index) => fields(part, key, referenceFieldPath(path, "allOf", String(index)), emit, depth));
}
