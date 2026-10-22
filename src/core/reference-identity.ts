import { slug as githubSlug } from "github-slugger";
import { createHash } from "node:crypto";
import type { NormalizedOperation, NormalizedParameter, NormalizedSchema, NormalizedSpec } from "./types.js";
import { omittedField, type SchemaUsage } from "./schema.js";
import { slugify } from "../utils/slug.js";

interface ReferenceAnchors {
  byOperation: ReadonlyMap<string, NormalizedOperation>;
  operations: ReadonlyMap<string, string>;
  schemas: ReadonlyMap<string, string>;
  tags: ReadonlyMap<string, string>;
}

export const operationKey = (operation: Pick<NormalizedOperation, "method" | "path">) =>
  `${operation.method.toUpperCase()} ${operation.path}`;

function allocate(entries: [string, string][]): ReadonlyMap<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const [key, preferred] of entries) {
    const group = groups.get(preferred) ?? new Set();
    group.add(key);
    groups.set(preferred, group);
  }
  const result = new Map<string, string>();
  for (const [preferred, keys] of groups) {
    const used = new Set<string>();
    for (const key of [...keys].sort()) {
      let anchor = preferred;
      if (keys.size > 1) {
        const digest = createHash("sha256").update(key).digest("hex");
        let length = 12;
        do {
          anchor = `${preferred}--${digest.slice(0, length++)}`;
        } while (used.has(anchor) && length <= digest.length);
        if (used.has(anchor)) throw new Error(`Reference identity collision: ${key}`);
      }
      used.add(anchor);
      result.set(key, anchor);
    }
  }
  return result;
}

// Normalized specs are immutable source snapshots. Reused snapshots share this
// derived allocation, and the weak key lets discarded compilations be collected.
const allocations = new WeakMap<NormalizedSpec, ReferenceAnchors>();
function anchors(spec: NormalizedSpec): ReferenceAnchors {
  let result = allocations.get(spec);
  if (!result) {
    result = {
      byOperation: new Map(spec.operations.map(operation => [operationKey(operation), operation])),
      operations: allocate(
        spec.operations.map((op) => [
          operationKey(op),
          `operation-${slugify(op.path)}-${slugify(op.method)}`,
        ]),
      ),
      schemas: allocate(
        Object.keys(spec.schemas).map((name) => [name, `definition-${slugify(name) || "item"}`]),
      ),
      tags: allocate(spec.tags.map((tag) => [tag.name, `tag-${slugify(tag.name) || "item"}`])),
    };
    allocations.set(spec, result);
  }
  return result;
}

/** Resolve the canonical operation identity within its owning immutable spec. */
export function referenceOperation(spec: NormalizedSpec, key: string): NormalizedOperation {
  const operation = anchors(spec).byOperation.get(key);
  if (!operation) throw new Error(`Reference is not in its owning spec: ${key}`);
  return operation;
}

function requireAnchor(map: ReadonlyMap<string, string>, key: string): string {
  const anchor = map.get(key);
  if (!anchor) throw new Error(`Reference is not in its owning spec: ${key}`);
  return anchor;
}
export function operationAnchor(
  operation: Pick<NormalizedOperation, "method" | "path">,
  spec: NormalizedSpec,
): string {
  return requireAnchor(anchors(spec).operations, operationKey(operation));
}
export function definitionAnchor(name: string, spec: NormalizedSpec): string {
  return requireAnchor(anchors(spec).schemas, name);
}
export function tagAnchor(name: string, spec: NormalizedSpec): string {
  return requireAnchor(anchors(spec).tags, name);
}

export type OperationSection = "request-body" | "parameters" | "authentication" | "returns" | "responses" | `response-${string}`;
export function operationSectionAnchor(operation: NormalizedOperation, spec: NormalizedSpec, section: OperationSection, standalone: boolean): string {
  return standalone ? section : `${operationAnchor(operation, spec)}-${section}`;
}
/** The sections an operation has, in the order its page shows them. */
export function operationSections(operation: NormalizedOperation): ("request-body" | "parameters" | "returns" | "responses" | "authentication")[] {
  const sections: ReturnType<typeof operationSections> = [];
  if (operation.requestBody) sections.push("request-body");
  if (operation.parameters.length) sections.push("parameters");
  if (operation.mcpExtras?.outputSchema) sections.push("returns");
  if (!operation.mcpExtras && operation.responses.length) sections.push("responses");
  if (!operation.mcpExtras && operation.security.some(requirement => Object.keys(requirement).length)) sections.push("authentication");
  return sections;
}
export function operationAnchors(operation: NormalizedOperation, spec: NormalizedSpec, standalone: boolean): string[] {
  const sections = operationSections(operation).flatMap((section): OperationSection[] =>
    section === "responses" ? [section, ...operation.responses.map(response => `response-${slugify(response.statusCode)}` as const)] : [section]);
  return [operationAnchor(operation, spec), ...sections.map(section => operationSectionAnchor(operation, spec, section, standalone)), ...operationFieldAnchors(operation)];
}

/**
 * The schema view and its route inventory stop at the same display depth. A
 * named type never opens inside itself (schemaPlan), so only a chain of
 * distinct types reaches this far.
 */
export const REFERENCE_SCHEMA_MAX_DEPTH = 32;

/** Rows a schema draws in full; past this, schemaPlan draws each named type once. */
export const REFERENCE_SCHEMA_FULL_ROWS = 500;

/**
 * Append semantic path segments without losing case, punctuation or Unicode.
 * Escape UTF-16 units, including '~' itself, so even unusual JSON property
 * names and empty segments remain distinct. '/' separates structure only.
 */
export function referenceFieldPath(root: string, ...segments: string[]): string {
  return root + segments.map(segment => "/" + segment.replace(/[^A-Za-z0-9._-]/g, character => `~${character.charCodeAt(0).toString(16).padStart(4, "0")}`)).join("");
}

export function parameterFieldAnchor(root: string, parameter: Pick<NormalizedParameter, "in" | "name">): string {
  return referenceFieldPath(root, parameter.in, parameter.name);
}

/** Field IDs follow document identity, independent of layout and slug collisions. */
export function operationFieldRoot(operation: Pick<NormalizedOperation, "method" | "path">): string {
  return referenceFieldPath("fields", operation.method.toUpperCase(), operation.path);
}

export function definitionFieldRoot(name: string): string {
  return referenceFieldPath("fields", "schemas", name);
}

export function hasObjectFields(schema: NormalizedSchema): boolean {
  return !!(schema.properties || schema.additionalProperties && typeof schema.additionalProperties !== "boolean");
}

/** One row of an object's field list: a named property, or the type of a map's values. */
export interface ReferenceField {
  name: string;
  schema: NormalizedSchema;
  required: boolean;
  /** Its anchor's segments below the object's. */
  path: string[];
}

/** An object's rows, named properties then map values, less the fields that do not travel this way. */
export function objectFields(schema: NormalizedSchema, usage?: SchemaUsage, required: ReadonlySet<string> = new Set(schema.required)): ReferenceField[] {
  const fields: ReferenceField[] = Object.entries(schema.properties ?? {}).map(([name, property]) => ({ name, schema: property, required: required.has(name), path: ["properties", name] }));
  if (schema.additionalProperties && typeof schema.additionalProperties !== "boolean")
    fields.push({ name: "[key: string]", schema: schema.additionalProperties, required: false, path: ["additionalProperties"] });
  return fields.filter(field => !omittedField(field.schema, usage));
}

/** The field a row opens onto: an array's items, or the field itself. */
export function innerSchema(schema: NormalizedSchema): NormalizedSchema {
  return schema.type === "array" && schema.items ? schema.items : schema;
}

/** Whether a field has more beneath it: fields of its own, a composition's, or its items'. */
export function hasReferenceFields(schema: NormalizedSchema, usage?: SchemaUsage, depth = 0): boolean {
  if (depth >= REFERENCE_SCHEMA_MAX_DEPTH) return false;
  if (objectFields(schema, usage).length || schema.oneOf?.length || schema.anyOf?.length) return true;
  // A part that is no object shows its type; one that is fields shows only those that travel.
  if (schema.allOf?.length) return schema.allOf.some(part => !hasObjectFields(part) && !part.allOf?.length || hasReferenceFields(part, usage, depth + 1));
  return schema.type === "array" && !!schema.items && hasReferenceFields(schema.items, usage, depth + 1);
}

/** A part that adds fields and nothing else to read, so its rows join the list of the object it is part of. */
export function onlyFields(schema: NormalizedSchema): boolean {
  return (hasObjectFields(schema) || !!schema.allOf?.length)
    && !schema.oneOf?.length && !schema.anyOf?.length
    && !schema.description && schema.example === undefined && !schema.examples?.length;
}

/** Where a schema draws a named type: a row's or view's path below the schema, and how a reader names it. */
export interface SchemaHome { at: string; label: string }

/**
 * How a schema's rows are drawn. A row whose type is drawn elsewhere shows a
 * link there instead of opening onto its fields: always where the type is one
 * of the row's own ancestors, and, once the schema would draw more than
 * REFERENCE_SCHEMA_FULL_ROWS rows, wherever the type is drawn at a shallower
 * place, so each named type is drawn once. Paths are relative to the schema
 * (`""` is the schema itself); a field's anchor is its view's root anchor
 * followed by its path.
 */
export interface SchemaPlan {
  links: ReadonlyMap<string, SchemaHome>;
  /** Linked paths that are views rather than rows, so the view marks where it starts. */
  views: ReadonlySet<string>;
  /** Every row the plan draws. */
  rows: readonly string[];
}

/** A view of a schema: what the schema view draws at a path, and the rows and views beneath it. */
interface PlanView { schema: NormalizedSchema; at: string; depth: number; label: string; ancestors: ReadonlyMap<string, SchemaHome> }
interface PlanRow { at: string; name: string; inner: NormalizedSchema; innerAt: string; depth: number; opens: boolean }

function viewParts(view: PlanView, usage: SchemaUsage | undefined): { rows: PlanRow[]; views: Omit<PlanView, "label" | "ancestors">[] } {
  const { schema, at, depth } = view;
  const rows: PlanRow[] = [], views: Omit<PlanView, "label" | "ancestors">[] = [];
  if (depth >= REFERENCE_SCHEMA_MAX_DEPTH) return { rows, views };
  const fieldRows = (object: NormalizedSchema, root: string, level: number) => {
    for (const field of objectFields(object, usage)) {
      const id = referenceFieldPath(root, ...field.path);
      const inner = innerSchema(field.schema);
      rows.push({ at: id, name: field.name, inner, innerAt: inner === field.schema ? id : referenceFieldPath(id, "items"), depth: level, opens: hasReferenceFields(inner, usage) });
    }
  };
  if (schema.allOf?.length) {
    // An allOf's fields and its field-only parts' read as one list; a part with more to show is a view of its own.
    const collect = (composed: NormalizedSchema, root: string, level: number) => {
      if (level + 1 < REFERENCE_SCHEMA_MAX_DEPTH) fieldRows(composed, root, level + 1);
      composed.allOf!.forEach((part, index) => {
        const path = referenceFieldPath(root, "allOf", String(index));
        if (level + 1 >= REFERENCE_SCHEMA_MAX_DEPTH || !onlyFields(part)) views.push({ schema: part, at: path, depth: level + 1 });
        else if (part.allOf?.length) collect(part, path, level + 1);
        else fieldRows(part, path, level + 1);
      });
    };
    collect(schema, at, depth);
  } else if (schema.oneOf?.length || schema.anyOf?.length) {
    const kind = schema.oneOf ? "oneOf" : "anyOf";
    if (hasObjectFields(schema)) views.push({ schema: { ...schema, oneOf: undefined, anyOf: undefined, description: undefined, example: undefined, examples: undefined }, at, depth: depth + 1 });
    (schema.oneOf ?? schema.anyOf)!.forEach((variant, index) => views.push({ schema: variant, at: referenceFieldPath(at, kind, String(index)), depth: depth + 1 }));
  } else if (hasObjectFields(schema)) fieldRows(schema, at, depth);
  else if (schema.type === "array" && schema.items && hasReferenceFields(schema.items, usage)) views.push({ schema: schema.items, at: referenceFieldPath(at, "items"), depth: depth + 1 });
  return { rows, views };
}

/** The type a view or row opens onto, by the name its document gave it. */
const namedType = (schema: NormalizedSchema) => schema.refName ?? schema.name;

/**
 * Walk a schema's views breadth first, so a type's first drawing is its
 * shallowest. Stops early once more than `limit` rows are drawn.
 */
function walkPlan(schema: NormalizedSchema, usage: SchemaUsage | undefined, once: boolean, limit = Infinity): SchemaPlan {
  const links = new Map<string, SchemaHome>(), views = new Set<string>(), rows: string[] = [];
  const homes = new Map<string, SchemaHome>();
  // Homes that are views (the schema itself, or a part drawn on its own) rather than rows.
  const viewHomes = new WeakSet<SchemaHome>();
  const rootType = namedType(schema);
  const root: SchemaHome = { at: "", label: rootType ?? "" };
  viewHomes.add(root);
  const queue: PlanView[] = [{ schema, at: "", depth: 0, label: "", ancestors: rootType ? new Map([[rootType, root]]) : new Map() }];
  if (rootType) homes.set(rootType, root);
  for (let next = 0; next < queue.length && rows.length <= limit; next++) {
    const view = queue[next];
    const parts = viewParts(view, usage);
    for (const row of parts.rows) {
      rows.push(row.at);
      const label = view.label ? `${view.label}.${row.name}` : row.name;
      const type = namedType(row.inner);
      // A type that recurs is a named stub without fields of its own (the normalizer stops it there); it links to the drawing it is inside.
      const home = type ? view.ancestors.get(type) ?? (once && row.opens ? homes.get(type) : undefined) : undefined;
      if (!row.opens && !home) continue;
      if (home) {
        links.set(row.at, home);
        if (viewHomes.has(home)) views.add(home.at);
        continue;
      }
      const drawn: SchemaHome = { at: row.at, label };
      if (type && !homes.has(type)) homes.set(type, drawn);
      queue.push({ schema: row.inner, at: row.innerAt, depth: row.depth + 1, label, ancestors: type ? new Map(view.ancestors).set(type, drawn) : view.ancestors });
    }
    for (const part of parts.views) {
      // A part that is a named type of its own is where that type is drawn.
      const type = namedType(part.schema);
      const owns = type && !view.ancestors.has(type);
      const drawn: SchemaHome = { at: part.at, label: type ?? view.label };
      if (owns) {
        viewHomes.add(drawn);
        if (!homes.has(type)) homes.set(type, drawn);
      }
      queue.push({ ...part, label: view.label, ancestors: owns ? new Map(view.ancestors).set(type, drawn) : view.ancestors });
    }
  }
  return { links, views, rows };
}

const plans = new WeakMap<NormalizedSchema, Map<string, SchemaPlan>>();
/** The schema's plan for the way it travels, shared by the view, its anchors and its examples. */
export function schemaPlan(schema: NormalizedSchema, usage?: SchemaUsage): SchemaPlan {
  const byUsage = plans.get(schema) ?? new Map<string, SchemaPlan>();
  plans.set(schema, byUsage);
  let plan = byUsage.get(usage ?? "");
  if (!plan) {
    const full = walkPlan(schema, usage, false, REFERENCE_SCHEMA_FULL_ROWS);
    plan = full.rows.length > REFERENCE_SCHEMA_FULL_ROWS ? walkPlan(schema, usage, true) : full;
    byUsage.set(usage ?? "", plan);
  }
  return plan;
}

/**
 * The anchors the reference schema view renders, in document order: each
 * field, including alternate branches, and the start of each view a row links to.
 */
export function schemaFieldAnchors(schema: NormalizedSchema, root: string, usage?: SchemaUsage): string[] {
  const plan = schemaPlan(schema, usage);
  const order = new Set<string>();
  // Depth first, as the view draws: each row before the rows it opens onto, an object's rows before its parts and variants.
  const visit = (view: Omit<PlanView, "label" | "ancestors">) => {
    if (plan.views.has(view.at)) order.add(view.at);
    const parts = viewParts({ ...view, label: "", ancestors: new Map() }, usage);
    for (const row of parts.rows) {
      order.add(row.at);
      if (row.opens && !plan.links.has(row.at)) visit({ schema: row.inner, at: row.innerAt, depth: row.depth + 1 });
    }
    for (const part of parts.views) visit(part);
  };
  visit({ schema, at: "", depth: 0 });
  return [...order].map(at => root + at);
}

const fieldAllocations = new WeakMap<NormalizedOperation, string[]>();
export function operationFieldAnchors(operation: NormalizedOperation): string[] {
  const root = operationFieldRoot(operation);
  let result = fieldAllocations.get(operation);
  if (!result) {
    result = operation.parameters.map(parameter => parameterFieldAnchor(referenceFieldPath(root, "parameters"), parameter));
    for (const [media, content] of Object.entries(operation.requestBody?.content ?? {}))
      if (content.schema) result.push(...schemaFieldAnchors(content.schema, referenceFieldPath(root, "request-body", media), "request"));
    if (operation.mcpExtras?.outputSchema)
      result.push(...schemaFieldAnchors(operation.mcpExtras.outputSchema, referenceFieldPath(root, "returns"), "response"));
    if (!operation.mcpExtras) for (const response of operation.responses) {
      const responseRoot = referenceFieldPath(root, "responses", response.statusCode);
      result.push(...Object.values(response.headers ?? {}).map(parameter => parameterFieldAnchor(referenceFieldPath(responseRoot, "headers"), parameter)));
      for (const [media, content] of Object.entries(response.content ?? {}))
        if (content.schema) result.push(...schemaFieldAnchors(content.schema, referenceFieldPath(responseRoot, "content", media), "response"));
    }
    fieldAllocations.set(operation, result);
  }
  return result;
}

export function definitionAnchors(name: string, spec: NormalizedSpec): string[] {
  const id = definitionAnchor(name, spec);
  return [id, `/definitions/${name}`, ...schemaFieldAnchors(spec.schemas[name], definitionFieldRoot(name))];
}

/** Native operation page paths; source-specific URL rules are converted once into this pattern. */
export function operationPagePath(operation: NormalizedOperation, spec: NormalizedSpec, pattern?: string): string {
  if (pattern === undefined) return `operations/${operationAnchor(operation, spec)}`;
  const values: Record<string, string | undefined> = { operation: operation.operationId ?? operation.path, operationId: operation.operationId, method: operation.method, path: operation.path };
  return pattern.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown operation route placeholder: ${key}`);
    const value = values[key];
    if (!value) throw new Error(`Operation route requires ${key}: ${operationKey(operation)}`);
    const slug = githubSlug(value);
    if (!slug) throw new Error(`Operation route has an empty ${key}: ${operationKey(operation)}`);
    return slug;
  });
}
export function schemaPagePath(name: string, spec: NormalizedSpec): string {
  return `models/${definitionAnchor(name, spec).slice("definition-".length)}`;
}
