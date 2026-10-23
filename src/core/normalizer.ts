import type {
  OpenApiDocument,
  ParsedSpec,
  NormalizedSpec,
  NormalizedTag,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  NormalizedSchema,
  NormalizedCallback,
  MediaTypeContent,
  EncodingObject,
  SecurityScheme,
  SecuritySchemeType,
  ServerDefinition,
  ServerVariable,
  HttpMethod,
  ExternalDocs,
  OAuthFlows,
  OAuthFlow,
  LinkObject,
  ExampleObject,
  CodeSample,
  DiscriminatorObject,
} from "./types.js";

const HTTP_METHODS: HttpMethod[] = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
  "query",
];

/**
 * Transform a fully dereferenced OpenAPI 3.x document into a NormalizedSpec.
 * This is the single point where spec-format-specific logic lives.
 */
export function normalizeSpec(parsed: ParsedSpec): NormalizedSpec {
  const doc = parsed.document;

  const components = (doc.components?.schemas ?? {}) as Components;
  let schemas, operations, webhooks;
  try {
    schemas = normalizeSchemas(components);
    operations = normalizeOperations(components, doc.paths, doc.security);
    webhooks = normalizeWebhooks(components, doc.webhooks);
  } finally {
    normalized.delete(components);
  }
  const securitySchemes = normalizeSecuritySchemes(doc.components?.securitySchemes);
  const servers = normalizeServers(doc.servers);
  const tags = normalizeTags(doc.tags, operations);

  return {
    sourceUrl: publicSourceUrl(parsed.source),
    info: normalizeInfo(doc),
    servers,
    tags,
    operations,
    schemas,
    securitySchemes,
    webhooks,
    externalDocs: normalizeExternalDocs(doc.externalDocs),
  };
}

function publicSourceUrl(source: string): string | undefined {
  if (!/^https?:\/\//i.test(source)) return undefined;
  const url = new URL(source);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

// ── Info ───────────────────────────────────────────────────────────

function normalizeInfo(doc: OpenApiDocument) {
  const info = doc.info ?? {};
  return {
    title: str(info.title, "Untitled API"),
    summary: optStr(info.summary),
    version: str(info.version, "0.0.0"),
    description: optStr(info.description),
    termsOfService: optStr(info.termsOfService),
    contact: info.contact
      ? {
          name: optStr((info.contact as Record<string, unknown>).name),
          url: optStr((info.contact as Record<string, unknown>).url),
          email: optStr((info.contact as Record<string, unknown>).email),
        }
      : undefined,
    license: info.license
      ? {
          name: str((info.license as Record<string, unknown>).name, ""),
          url: optStr((info.license as Record<string, unknown>).url),
          identifier: optStr((info.license as Record<string, unknown>).identifier),
        }
      : undefined,
    logo: optStr((info as Record<string, unknown>)["x-logo"]),
  };
}

// ── Servers ────────────────────────────────────────────────────────

function normalizeServers(servers?: Record<string, unknown>[]): ServerDefinition[] {
  if (!servers?.length) return [{ url: "/" }];
  return servers.map((s) => ({
    url: str(s.url, "/"),
    description: optStr(s.description),
    variables: s.variables
      ? normalizeServerVariables(s.variables as Record<string, Record<string, unknown>>)
      : undefined,
  }));
}

function normalizeServerVariables(
  vars: Record<string, Record<string, unknown>>,
): Record<string, ServerVariable> {
  const result: Record<string, ServerVariable> = {};
  for (const [key, v] of Object.entries(vars)) {
    result[key] = {
      default: str(v.default, ""),
      description: optStr(v.description),
      enum: Array.isArray(v.enum) ? v.enum.map(String) : undefined,
    };
  }
  return result;
}

// ── Tags ───────────────────────────────────────────────────────────

function normalizeTags(
  rawTags: Record<string, unknown>[] | undefined,
  operations: NormalizedOperation[],
): NormalizedTag[] {
  // Build a map of defined tags
  const tagMap = new Map<string, NormalizedTag>();
  if (rawTags) {
    for (const t of rawTags) {
      const name = str(t.name, "");
      if (name) {
        tagMap.set(name, {
          name,
          summary: optStr(t.summary),
          description: optStr(t.description),
          parent: optStr(t.parent),
          kind: optStr(t.kind),
          externalDocs: normalizeExternalDocs(
            t.externalDocs as Record<string, unknown> | undefined,
          ),
          operations: [],
          hidden: t["x-sourcey-hide"] === true,
        });
      }
    }
  }

  // Assign operations to tags, creating implicit tags as needed
  for (const op of operations) {
    if (op.hidden) continue;
    const opTags = op.tags.length > 0 ? op.tags : ["default"];
    for (const tagName of opTags) {
      if (!tagMap.has(tagName)) {
        // Implicit tag creation (legacy behavior from preprocessor.js)
        tagMap.set(tagName, {
          name: tagName,
          operations: [],
        });
      }
      tagMap.get(tagName)!.operations.push(op);
    }
  }

  const referencedAsParent = new Set<string>();
  for (const tag of tagMap.values()) {
    if (tag.parent && tagMap.has(tag.parent)) {
      referencedAsParent.add(tag.parent);
    }
  }

  // Keep tags that contribute visible metadata or structure, even without operations.
  return sortTagsByHierarchy(
    Array.from(tagMap.values()).filter(
      (t) =>
        t.operations.length > 0 ||
        !!t.summary ||
        !!t.description ||
        !!t.kind ||
        referencedAsParent.has(t.name),
    ),
  );
}

function sortTagsByHierarchy(tags: NormalizedTag[]): NormalizedTag[] {
  const tagsByName = new Map(tags.map((tag) => [tag.name, tag]));
  const childrenByParent = new Map<string, NormalizedTag[]>();
  const roots: NormalizedTag[] = [];

  for (const tag of tags) {
    if (tag.parent && tag.parent !== tag.name && tagsByName.has(tag.parent)) {
      const siblings = childrenByParent.get(tag.parent) ?? [];
      siblings.push(tag);
      childrenByParent.set(tag.parent, siblings);
      continue;
    }

    roots.push(tag);
  }

  const sorted: NormalizedTag[] = [];
  const visited = new Set<string>();
  const visit = (tag: NormalizedTag) => {
    if (visited.has(tag.name)) return;
    visited.add(tag.name);
    sorted.push(tag);
    for (const child of childrenByParent.get(tag.name) ?? []) {
      visit(child);
    }
  };

  for (const tag of roots) visit(tag);
  for (const tag of tags) visit(tag);
  return sorted;
}

function normalizeOperations(
  components: Components,
  paths?: Record<string, Record<string, unknown>>,
  globalSecurity?: Record<string, string[]>[],
): NormalizedOperation[] {
  if (!paths) return [];
  const operations: NormalizedOperation[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    const pathParams = normalizeParameters(
      components,
      pathItem.parameters as Record<string, unknown>[] | undefined,
    );

    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method] as Record<string, unknown> | undefined;
      if (!opRaw) continue;

      const opParams = normalizeParameters(
        components,
        opRaw.parameters as Record<string, unknown>[] | undefined,
      );

      // Merge path-level + operation-level params, deduping by name+in
      const mergedParams = deduplicateParameters([...pathParams, ...opParams]);

      const op: NormalizedOperation = {
        operationId: optStr(opRaw.operationId),
        summary: optStr(opRaw.summary),
        description: optStr(opRaw.description),
        method,
        path,
        tags: Array.isArray(opRaw.tags) ? opRaw.tags.map(String) : [],
        parameters: mergedParams,
        requestBody: normalizeRequestBody(components, opRaw.requestBody as Record<string, unknown> | undefined),
        responses: normalizeResponses(
          components,
          opRaw.responses as Record<string, Record<string, unknown>> | undefined,
        ),
        security: normalizeSecurityRequirements(
          opRaw.security as Record<string, string[]>[] | undefined,
          globalSecurity,
        ),
        deprecated: opRaw.deprecated === true,
        servers:
          opRaw.servers || pathItem.servers
            ? normalizeServers((opRaw.servers ?? pathItem.servers) as Record<string, unknown>[])
            : undefined,
        externalDocs: normalizeExternalDocs(
          opRaw.externalDocs as Record<string, unknown> | undefined,
        ),
        callbacks: normalizeCallbacks(
          components,
          opRaw.callbacks as Record<string, Record<string, unknown>> | undefined,
        ),
        hidden: opRaw["x-sourcey-hide"] === true,
        codeSamples: normalizeCodeSamples(
          opRaw["x-sourcey-code-samples"] as Record<string, unknown>[] | undefined,
          opRaw["x-code-samples"] as Record<string, unknown>[] | undefined,
        ),
      };

      operations.push(op);
    }
  }

  return operations;
}

/**
 * Deduplicate parameters by (name, in) — operation-level params
 * override path-level params with the same identity.
 */
function deduplicateParameters(params: NormalizedParameter[]): NormalizedParameter[] {
  const seen = new Map<string, NormalizedParameter>();
  // Process in order: path-level first, then operation-level.
  // Later entries (operation-level) override earlier ones (path-level).
  for (const p of params) {
    seen.set(`${p.in}:${p.name}`, p);
  }
  return Array.from(seen.values());
}

function normalizeParameters(components: Components, params?: Record<string, unknown>[]): NormalizedParameter[] {
  if (!params) return [];
  return params.map((p) => ({
    name: str(p.name, ""),
    in: str(p.in, "query") as NormalizedParameter["in"],
    description: optStr(p.description),
    required: p.required === true,
    deprecated: p.deprecated === true,
    style: optStr(p.style),
    explode: typeof p.explode === "boolean" ? p.explode : undefined,
    allowReserved: p.allowReserved === true,
    schema: p.schema ? normalizeSchema(p.schema as Record<string, unknown>, components) : undefined,
    content: p.content
      ? normalizeContent(components, p.content as Record<string, Record<string, unknown>>)
      : undefined,
    example: p.example,
    examples: p.examples
      ? normalizeExamples(p.examples as Record<string, Record<string, unknown>>)
      : undefined,
  }));
}

function normalizeRequestBody(components: Components, body?: Record<string, unknown>): NormalizedRequestBody | undefined {
  if (!body) return undefined;
  return {
    description: optStr(body.description),
    required: body.required === true,
    content: normalizeContent(components, body.content as Record<string, Record<string, unknown>> | undefined),
  };
}

function normalizeContent(
  components: Components,
  content?: Record<string, Record<string, unknown>>,
): Record<string, MediaTypeContent> {
  if (!content) return {};
  const result: Record<string, MediaTypeContent> = {};
  for (const [mediaType, value] of Object.entries(content)) {
    result[mediaType] = {
      schema: value.schema ? normalizeSchema(value.schema as Record<string, unknown>, components) : undefined,
      example: value.example,
      examples: value.examples
        ? normalizeExamples(value.examples as Record<string, Record<string, unknown>>)
        : undefined,
      encoding: isRecord(value.encoding)
        ? normalizeEncodingMap(components, value.encoding as Record<string, unknown>)
        : undefined,
      prefixEncoding: Array.isArray(value.prefixEncoding)
        ? value.prefixEncoding
            .filter(isRecord)
            .map((entry) => normalizeEncodingObject(components, entry as Record<string, unknown>))
        : undefined,
      itemEncoding: isRecord(value.itemEncoding)
        ? normalizeEncodingObject(components, value.itemEncoding as Record<string, unknown>)
        : undefined,
    };
  }
  return result;
}

function normalizeEncodingMap(components: Components, encodings: Record<string, unknown>): Record<string, EncodingObject> {
  const result: Record<string, EncodingObject> = {};
  for (const [name, encoding] of Object.entries(encodings)) {
    if (!isRecord(encoding)) continue;
    result[name] = normalizeEncodingObject(components, encoding);
  }
  return result;
}

function normalizeEncodingObject(components: Components, encoding: Record<string, unknown>): EncodingObject {
  return {
    contentType: optStr(encoding.contentType),
    headers: isRecord(encoding.headers)
      ? normalizeResponseHeaders(components, encoding.headers as Record<string, Record<string, unknown>>)
      : undefined,
    style: optStr(encoding.style),
    explode: typeof encoding.explode === "boolean" ? encoding.explode : undefined,
    allowReserved: typeof encoding.allowReserved === "boolean" ? encoding.allowReserved : undefined,
    prefixEncoding: Array.isArray(encoding.prefixEncoding)
      ? encoding.prefixEncoding
          .filter(isRecord)
          .map((entry) => normalizeEncodingObject(components, entry as Record<string, unknown>))
      : undefined,
    itemEncoding: isRecord(encoding.itemEncoding)
      ? normalizeEncodingObject(components, encoding.itemEncoding as Record<string, unknown>)
      : undefined,
  };
}

function normalizeResponses(
  components: Components,
  responses?: Record<string, Record<string, unknown>>,
): NormalizedResponse[] {
  if (!responses) return [];
  return Object.entries(responses).map(([statusCode, r]) => ({
    statusCode,
    summary: optStr(r.summary),
    description: str(r.description, ""),
    content: r.content
      ? normalizeContent(components, r.content as Record<string, Record<string, unknown>>)
      : undefined,
    headers: r.headers
      ? normalizeResponseHeaders(components, r.headers as Record<string, Record<string, unknown>>)
      : undefined,
    links: r.links ? normalizeLinks(r.links as Record<string, Record<string, unknown>>) : undefined,
  }));
}

function normalizeResponseHeaders(
  components: Components,
  headers: Record<string, Record<string, unknown>>,
): Record<string, NormalizedParameter> {
  const result: Record<string, NormalizedParameter> = {};
  for (const [name, h] of Object.entries(headers)) {
    result[name] = {
      name,
      in: "header",
      description: optStr(h.description),
      required: h.required === true,
      deprecated: h.deprecated === true,
      schema: h.schema ? normalizeSchema(h.schema as Record<string, unknown>, components) : undefined,
      content: h.content
        ? normalizeContent(components, h.content as Record<string, Record<string, unknown>>)
        : undefined,
    };
  }
  return result;
}

function normalizeLinks(
  links: Record<string, Record<string, unknown>>,
): Record<string, LinkObject> {
  const result: Record<string, LinkObject> = {};
  for (const [name, l] of Object.entries(links)) {
    result[name] = {
      operationId: optStr(l.operationId),
      operationRef: optStr(l.operationRef),
      description: optStr(l.description),
      parameters: l.parameters as Record<string, unknown> | undefined,
      requestBody: l.requestBody,
      server: l.server ? normalizeServers([l.server as Record<string, unknown>])[0] : undefined,
    };
  }
  return result;
}

function normalizeCallbacks(
  components: Components,
  callbacks?: Record<string, Record<string, unknown>>,
): Record<string, NormalizedCallback> | undefined {
  if (!callbacks) return undefined;
  const result: Record<string, NormalizedCallback> = {};
  for (const [expression, pathItem] of Object.entries(callbacks)) {
    result[expression] = {
      expression,
      operations: normalizeOperations(components, { [expression]: pathItem }),
    };
  }
  return result;
}

function normalizeSecurityRequirements(
  opSecurity?: Record<string, string[]>[],
  globalSecurity?: Record<string, string[]>[],
): Record<string, string[]>[] {
  // Operation security overrides global
  return (opSecurity ?? globalSecurity ?? []) as Record<string, string[]>[];
}

function normalizeCodeSamples(
  sourceySamples?: Record<string, unknown>[],
  genericSamples?: Record<string, unknown>[],
): CodeSample[] | undefined {
  const samples = sourceySamples ?? genericSamples;
  if (!samples?.length) return undefined;
  return samples.map((s) => ({
    lang: str(s.lang, "text"),
    label: optStr(s.label),
    source: str(s.source, ""),
  }));
}

// ── Schemas ────────────────────────────────────────────────────────

/** Component schemas, for the references the parser leaves in place where a component recurs. */
type Components = Record<string, Record<string, unknown>>;

function normalizeSchemas(schemas: Components): Record<string, NormalizedSchema> {
  const result: Record<string, NormalizedSchema> = {};
  for (const [name, s] of Object.entries(schemas)) {
    result[name] = normalizeSchema(s, schemas, name);
  }
  return result;
}

/**
 * Schemas already normalized for a document. The parser shares one object for
 * every use of a component, and a schema normalizes the same wherever it has
 * the same name and the same components on its way that it could meet again
 * below it (its own, the references it leaves in place and theirs), so each
 * such place is normalized once and its result shared, rather than a type
 * used across a large API copied at every use. Normalized schemas are never
 * changed afterwards.
 */
interface NormalizedDocument {
  places: WeakMap<object, Map<string, NormalizedSchema>>;
  reach: WeakMap<object, ReadonlySet<string>>;
}
const normalized = new WeakMap<Components, NormalizedDocument>();

/** What the normalizer descends into, as `normalizeSchemaAt` does. */
function schemaChildren(schema: Record<string, unknown>): unknown[] {
  const children: unknown[] = [];
  if (schema.properties && typeof schema.properties === "object") children.push(...Object.values(schema.properties));
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") children.push(schema.additionalProperties);
  if (schema.items) children.push(schema.items);
  for (const key of ["allOf", "anyOf", "oneOf"] as const) if (Array.isArray(schema[key])) children.push(...(schema[key] as unknown[]));
  if (schema.not) children.push(schema.not);
  return children;
}

function recurringTarget(schema: Record<string, unknown>): string | undefined {
  const recurring = typeof schema.$ref === "string" ? /^#\/components\/schemas\/([^/]+)$/.exec(schema.$ref)?.[1] : undefined;
  return recurring && decodeURIComponent(recurring).replace(/~1/g, "/").replace(/~0/g, "~");
}

/** The names a schema's own tree consults, and the references in it the normalizer may follow. */
const localNames = new WeakMap<object, { names: Set<string>; targets: Set<string> }>();
function namesWithin(schema: Record<string, unknown>): { names: Set<string>; targets: Set<string> } {
  let found = localNames.get(schema);
  if (found) return found;
  found = { names: new Set(), targets: new Set() };
  const own = optStr(schema["x-ref-name"]);
  if (own) found.names.add(own);
  const target = recurringTarget(schema);
  if (target) { found.names.add(target); found.targets.add(target); }
  for (const child of schemaChildren(schema)) {
    if (!child || typeof child !== "object") continue;
    const within = namesWithin(child as Record<string, unknown>);
    for (const name of within.names) found.names.add(name);
    for (const name of within.targets) found.targets.add(name);
  }
  localNames.set(schema, found);
  return found;
}

/** Every component name the path could matter for below this schema, following references left in place. */
function reachOf(schema: Record<string, unknown>, components: Components, document: NormalizedDocument): ReadonlySet<string> {
  let reach = document.reach.get(schema);
  if (reach) return reach;
  const { names, targets } = namesWithin(schema);
  const all = new Set(names);
  const queue = [...targets], seen = new Set(queue);
  for (let target = queue.pop(); target !== undefined; target = queue.pop()) {
    const component = components[target];
    if (!component || typeof component !== "object") continue;
    const within = namesWithin(component);
    for (const name of within.names) all.add(name);
    for (const next of within.targets) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  document.reach.set(schema, (reach = all));
  return reach;
}

/**
 * `path` names the components on the way to this schema. A reference the
 * parser left in place (a recurring component) expands like any other off
 * that path, and stays a named link where the component would repeat.
 */
function normalizeSchema(schema: Record<string, unknown>, components: Components, name?: string, path: readonly string[] = name ? [name] : []): NormalizedSchema {
  // A schema that is not an object (OpenAPI 3.1 allows `true`) has nothing to share.
  if (!schema || typeof schema !== "object") return normalizeSchemaAt(schema, components, name, path);
  let document = normalized.get(components);
  if (!document) normalized.set(components, (document = { places: new WeakMap(), reach: new WeakMap() }));
  let byPlace = document.places.get(schema);
  if (!byPlace) document.places.set(schema, (byPlace = new Map()));
  const reach = reachOf(schema, components, document);
  const place = JSON.stringify([name ?? null, path.filter(step => reach.has(step)).sort()]);
  let result = byPlace.get(place);
  if (!result) byPlace.set(place, (result = normalizeSchemaAt(schema, components, name, path)));
  return result;
}

function normalizeSchemaAt(schema: Record<string, unknown>, components: Components, name: string | undefined, path: readonly string[]): NormalizedSchema {
  const target = recurringTarget(schema);
  if (target && components[target] && !path.includes(target)) {
    const expanded = normalizeSchema(components[target], components, undefined, [...path, target]);
    return { ...expanded, description: optStr(schema.description) ?? expanded.description, refName: target };
  }
  // A reference left in place, where its component would repeat, is named by its own pointer:
  // a resolver need not mark it, and json-schema-ref-parser 16.0.5 does not.
  const own = optStr(schema["x-ref-name"]) ?? (target && components[target] ? target : undefined);
  const inner = own && !path.includes(own) ? [...path, own] : path;
  const child = (value: unknown) => normalizeSchema(value as Record<string, unknown>, components, undefined, inner);
  // Handle nullable: OpenAPI 3.0 uses x-nullable or nullable,
  // OpenAPI 3.1 uses type: ["string", "null"]
  let type = schema.type as string | string[] | undefined;
  let nullable = schema.nullable === true || schema["x-nullable"] === true;

  if (Array.isArray(type)) {
    const nonNullTypes = type.filter((t) => t !== "null");
    if (nonNullTypes.length < type.length) {
      nullable = true;
    }
    type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
  }

  const result: NormalizedSchema = {
    name,
    type,
    format: optStr(schema.format),
    title: optStr(schema.title),
    description: optStr(schema.description),
    default: schema.default,
    enum: Array.isArray(schema.enum) ? schema.enum : undefined,
    enumNames: Array.isArray(schema["x-enumNames"] ?? schema["x-enum-varnames"])
      ? ((schema["x-enumNames"] ?? schema["x-enum-varnames"]) as unknown[]).map(String)
      : undefined,
    enumDescriptions: Array.isArray(schema["x-enumDescriptions"])
      ? (schema["x-enumDescriptions"] as unknown[]).map(String)
      : undefined,
    const: schema.const,
    nullable,
    readOnly: schema.readOnly === true,
    writeOnly: schema.writeOnly === true,
    deprecated: schema.deprecated === true,
    example: schema.example,
    examples: Array.isArray(schema.examples) ? schema.examples : undefined,
    // A component is its own named type, referenced from elsewhere or not.
    refName: own ?? name,
  };

  // Object properties
  if (schema.properties) {
    result.properties = {};
    for (const [key, val] of Object.entries(
      schema.properties as Record<string, Record<string, unknown>>,
    )) {
      result.properties[key] = child(val);
    }
  }
  if (schema.additionalProperties !== undefined) {
    result.additionalProperties =
      typeof schema.additionalProperties === "boolean"
        ? schema.additionalProperties
        : child(schema.additionalProperties);
  }
  if (Array.isArray(schema.required)) {
    result.required = schema.required.map(String);
  }

  // Array items
  if (schema.items) {
    result.items = child(schema.items);
  }
  if (schema.minItems !== undefined) result.minItems = Number(schema.minItems);
  if (schema.maxItems !== undefined) result.maxItems = Number(schema.maxItems);
  if (schema.uniqueItems === true) result.uniqueItems = true;

  // Numeric constraints
  if (schema.minimum !== undefined) result.minimum = Number(schema.minimum);
  if (schema.maximum !== undefined) result.maximum = Number(schema.maximum);
  if (schema.exclusiveMinimum !== undefined) {
    result.exclusiveMinimum = schema.exclusiveMinimum as number | boolean;
  }
  if (schema.exclusiveMaximum !== undefined) {
    result.exclusiveMaximum = schema.exclusiveMaximum as number | boolean;
  }
  if (schema.multipleOf !== undefined) result.multipleOf = Number(schema.multipleOf);

  // String constraints
  if (schema.minLength !== undefined) result.minLength = Number(schema.minLength);
  if (schema.maxLength !== undefined) result.maxLength = Number(schema.maxLength);
  if (schema.pattern !== undefined) result.pattern = String(schema.pattern);

  // Composition
  if (Array.isArray(schema.allOf)) {
    result.allOf = schema.allOf.map(child);
  }
  if (Array.isArray(schema.anyOf)) {
    result.anyOf = schema.anyOf.map(child);
  }
  if (Array.isArray(schema.oneOf)) {
    result.oneOf = schema.oneOf.map(child);
  }
  if (schema.not) {
    result.not = child(schema.not);
  }
  if (schema.discriminator) {
    const d = schema.discriminator as Record<string, unknown>;
    result.discriminator = {
      propertyName: str(d.propertyName, ""),
      mapping: d.mapping as Record<string, string> | undefined,
    } satisfies DiscriminatorObject;
  }

  // External docs
  if (schema.externalDocs) {
    result.externalDocs = normalizeExternalDocs(schema.externalDocs as Record<string, unknown>);
  }

  return result;
}

// ── Security Schemes ───────────────────────────────────────────────

function normalizeSecuritySchemes(
  schemes?: Record<string, unknown>,
): Record<string, SecurityScheme> {
  if (!schemes) return {};
  const result: Record<string, SecurityScheme> = {};
  for (const [name, s] of Object.entries(schemes)) {
    const raw = s as Record<string, unknown>;
    result[name] = {
      type: str(raw.type, "apiKey") as SecuritySchemeType,
      name: optStr(raw.name),
      description: optStr(raw.description),
      in: optStr(raw.in) as SecurityScheme["in"],
      scheme: optStr(raw.scheme),
      bearerFormat: optStr(raw.bearerFormat),
      flows: raw.flows
        ? normalizeOAuthFlows(raw.flows as Record<string, Record<string, unknown>>)
        : undefined,
      openIdConnectUrl: optStr(raw.openIdConnectUrl),
      oauth2MetadataUrl: optStr(raw.oauth2MetadataUrl),
      deprecated: raw.deprecated === true,
    };
  }
  return result;
}

function normalizeOAuthFlows(flows: Record<string, Record<string, unknown>>): OAuthFlows {
  const result: OAuthFlows = {};
  for (const flowType of [
    "implicit",
    "password",
    "clientCredentials",
    "authorizationCode",
    "deviceAuthorization",
  ] as const) {
    if (flows[flowType]) {
      result[flowType] = normalizeOAuthFlow(flows[flowType]);
    }
  }
  return result;
}

function normalizeOAuthFlow(flow: Record<string, unknown>): OAuthFlow {
  return {
    authorizationUrl: optStr(flow.authorizationUrl),
    deviceAuthorizationUrl: optStr(flow.deviceAuthorizationUrl),
    tokenUrl: optStr(flow.tokenUrl),
    refreshUrl: optStr(flow.refreshUrl),
    scopes: (flow.scopes ?? {}) as Record<string, string>,
  };
}

// ── Webhooks ───────────────────────────────────────────────────────

function normalizeWebhooks(
  components: Components,
  webhooks?: Record<string, Record<string, unknown>>,
): NormalizedOperation[] {
  if (!webhooks) return [];
  return normalizeOperations(components, webhooks);
}

// ── Shared ─────────────────────────────────────────────────────────

function normalizeExternalDocs(docs?: Record<string, unknown>): ExternalDocs | undefined {
  if (!docs?.url) return undefined;
  return {
    url: str(docs.url, ""),
    description: optStr(docs.description),
  };
}

function normalizeExamples(
  examples: Record<string, Record<string, unknown>>,
): Record<string, ExampleObject> {
  const result: Record<string, ExampleObject> = {};
  for (const [name, e] of Object.entries(examples)) {
    result[name] = {
      summary: optStr(e.summary),
      description: optStr(e.description),
      value: e.value,
      externalValue: optStr(e.externalValue),
    };
  }
  return result;
}

// ── Utility helpers ────────────────────────────────────────────────

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
