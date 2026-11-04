import type { NormalizedSchema } from "./types.js";

export interface ValueIssue {
  field: string;
  message: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Blob);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const compositions = (schema: NormalizedSchema) => [
  ...(schema.allOf ?? []),
  ...(schema.anyOf ?? []),
  ...(schema.oneOf ?? []),
];

/** Inspect annotations conservatively across every possible composed branch. */
export function schemaHas(
  schema: NormalizedSchema | undefined,
  predicate: (schema: NormalizedSchema) => boolean,
  seen = new Set<NormalizedSchema>(),
): boolean {
  if (!schema || seen.has(schema)) return false;
  seen.add(schema);
  return predicate(schema) || compositions(schema).some((part) => schemaHas(part, predicate, seen));
}

/** Which way a schema travels. OpenAPI never sends a read-only field and never returns a write-only one. */
export type SchemaUsage = "request" | "response";

/** A field that does not travel in this direction; with no usage, every field stays. */
export function omittedField(schema: NormalizedSchema | undefined, usage: SchemaUsage | undefined): boolean {
  return !!usage && schemaHas(schema, (part) => (usage === "request" ? part.readOnly : part.writeOnly) === true);
}

/** All declarations of a field, including annotations in alternate branches. */
export function propertySchema(
  schema: NormalizedSchema | undefined,
  name: string,
  includeAdditional = true,
): NormalizedSchema | undefined {
  const declarations: NormalizedSchema[] = [];
  schemaHas(schema, (part) => {
    const field = part.properties?.[name];
    if (field) declarations.push(field);
    else if (includeAdditional && isRecord(part.additionalProperties))
      declarations.push(part.additionalProperties);
    return false;
  });
  return declarations.length > 1 ? { allOf: declarations } : declarations[0];
}

/** A form's structural view of allOf; validation always uses the original schema. */
export function effectiveSchema(schema: NormalizedSchema = {}): NormalizedSchema {
  if (!schema.allOf?.length) return schema;
  const { allOf, ...base } = schema;
  const parts = [base, ...allOf.map(effectiveSchema)];
  const merged: NormalizedSchema = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part))
      if (value !== undefined && !own(merged, key)) Object.assign(merged, { [key]: value });
  }
  const names = new Set(parts.flatMap((part) => Object.keys(part.properties ?? {})));
  if (names.size)
    merged.properties = Object.fromEntries(
      [...names].map((name) => [name, propertySchema(schema, name, false)!]),
    );
  merged.required = [...new Set(parts.flatMap((part) => part.required ?? []))];
  merged.readOnly = schemaHas(schema, (part) => part.readOnly === true);
  merged.writeOnly = schemaHas(schema, (part) => part.writeOnly === true);
  if (schemaHas(schema, (part) => part.format === "password")) merged.format = "password";
  return merged;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => own(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}

function matchesType(type: string, value: unknown, binary: boolean): boolean {
  if (type === "null") return value === null;
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string" && binary) return value instanceof Blob;
  return typeof value === type;
}

/**
 * Bounded request-input validation for the normalized contract: types/nullability,
 * enum/const, composition/not, numeric/string/array constraints and object fields.
 * Format annotations other than binary are presented by the form, not certified.
 */
export function validateValue(
  schema: NormalizedSchema | undefined,
  value: unknown,
  field: string,
  depth = 0,
): ValueIssue[] {
  if (!schema || value === undefined) return [];
  const issue = (message: string): ValueIssue[] => [{ field, message }];
  if (depth > 24) return issue("This value is too deeply nested for the console.");
  const issues: ValueIssue[] = [];
  for (const part of schema.allOf ?? [])
    issues.push(...validateValue(part, value, field, depth + 1));
  for (const [kind, choices] of [
    ["oneOf", schema.oneOf],
    ["anyOf", schema.anyOf],
  ] as const) {
    if (!choices) continue;
    const matches = choices.filter(
      (part) => !validateValue(part, value, field, depth + 1).length,
    ).length;
    if (!matches || (kind === "oneOf" && matches !== 1))
      issues.push(
        ...issue(
          `The value must match ${kind === "oneOf" ? "exactly one" : "at least one"} of the declared alternatives.`,
        ),
      );
  }
  if (schema.not && !validateValue(schema.not, value, field, depth + 1).length)
    issues.push(...issue("This value matches an excluded schema."));
  if (schema.enum && !schema.enum.some((candidate) => equal(candidate, value)))
    issues.push(...issue("Choose one of the listed values."));
  if (schema.const !== undefined && !equal(schema.const, value))
    issues.push(...issue("Use the declared constant value."));
  const types =
    schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null && schema.nullable) return issues;
  if (types.length && !types.some((type) => matchesType(type, value, schema.format === "binary"))) {
    const message =
      types.length > 1
        ? "The value does not match an allowed type."
        : types[0] === "integer"
          ? "Enter a whole number."
          : types[0] === "number"
            ? "Enter a number."
            : types[0] === "boolean"
              ? "Choose true or false."
              : types[0] === "array"
                ? "Enter a list."
                : types[0] === "object"
                  ? "Enter an object."
                  : schema.format === "binary"
                    ? "Choose a file."
                    : "Enter text.";
    return [...issues, ...issue(message)];
  }
  if (schema.format === "binary" && !(value instanceof Blob))
    return [...issues, ...issue("Choose a file.")];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(...issue("Enter a finite number."));
    if (schema.minimum !== undefined && value < schema.minimum)
      issues.push(...issue(`Minimum: ${schema.minimum}.`));
    if (schema.maximum !== undefined && value > schema.maximum)
      issues.push(...issue(`Maximum: ${schema.maximum}.`));
    const low =
      typeof schema.exclusiveMinimum === "number"
        ? schema.exclusiveMinimum
        : schema.exclusiveMinimum
          ? schema.minimum
          : undefined;
    const high =
      typeof schema.exclusiveMaximum === "number"
        ? schema.exclusiveMaximum
        : schema.exclusiveMaximum
          ? schema.maximum
          : undefined;
    if (low !== undefined && value <= low) issues.push(...issue(`Must be greater than ${low}.`));
    if (high !== undefined && value >= high) issues.push(...issue(`Must be less than ${high}.`));
    if (schema.multipleOf !== undefined) {
      const quotient = value / schema.multipleOf;
      if (
        !(schema.multipleOf > 0) ||
        Math.abs(quotient - Math.round(quotient)) > 1e-10 * Math.max(1, Math.abs(quotient))
      )
        issues.push(...issue(`Use a multiple of ${schema.multipleOf}.`));
    }
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      issues.push(...issue(`Use at least ${schema.minLength} characters.`));
    if (schema.maxLength !== undefined && length > schema.maxLength)
      issues.push(...issue(`Use no more than ${schema.maxLength} characters.`));
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern, "u").test(value))
          issues.push(...issue("The value does not match the required pattern."));
      } catch {
        issues.push(...issue("The API schema contains an invalid text pattern."));
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      issues.push(...issue(`Add at least ${schema.minItems} items.`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      issues.push(...issue(`Use no more than ${schema.maxItems} items.`));
    if (
      schema.uniqueItems &&
      value.some((item, i) => value.slice(0, i).some((other) => equal(item, other)))
    )
      issues.push(...issue("Each item must be unique."));
    value.forEach((item, i) =>
      issues.push(
        ...(item === undefined
          ? [{ field: `${field}.${i}`, message: "Enter a value or remove this item." }]
          : validateValue(schema.items, item, `${field}.${i}`, depth + 1)),
      ),
    );
  }
  if (isRecord(value)) {
    for (const name of schema.required ?? [])
      if (
        !omittedField(propertySchema(schema, name), "request") &&
        (!own(value, name) || value[name] === undefined)
      )
        issues.push({ field: `${field}.${name}`, message: "This field is required." });
    for (const [name, item] of Object.entries(value)) {
      if (own(schema.properties ?? {}, name))
        issues.push(
          ...validateValue(schema.properties![name], item, `${field}.${name}`, depth + 1),
        );
      else if (schema.additionalProperties === false)
        issues.push({ field: `${field}.${name}`, message: "This field is not allowed." });
      else if (typeof schema.additionalProperties === "object")
        issues.push(
          ...validateValue(schema.additionalProperties, item, `${field}.${name}`, depth + 1),
        );
    }
  }
  return issues;
}

/** The reference and editable alternatives describe the same normalized type. */
export function formatSchemaType(schema: NormalizedSchema, ancestors: ReadonlySet<NormalizedSchema> = new Set()): string {
  if (schema.not && Object.keys(schema.not).length === 0) return "never";
  if (ancestors.has(schema)) return schema.refName ?? schema.name ?? "recursive";
  const branch = new Set([...ancestors, schema]);
  const parts = schema.allOf?.length ? schema.allOf : schema.oneOf?.length ? schema.oneOf : schema.anyOf;
  if (parts?.length) return [...new Set(parts.map(sub => formatSchemaType(sub, branch)))].join(schema.allOf?.length ? " & " : " | ");
  if (schema.type === "array" && schema.items) return `Array<${schema.items.refName ?? formatSchemaType(schema.items, branch)}>`;
  if (schema.refName) return schema.refName;
  if (schema.name && (schema.type === "object" || schema.properties)) return schema.name;
  return (Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type) ?? "any";
}
