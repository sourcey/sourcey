/**
 * An API description read through the engine's own loader, parser and
 * normaliser, so a converter maps the source's URLs and fragments onto what
 * the native reference publishes.
 */
import { loadSpec } from "../core/loader.js";
import { normalizeSpec } from "../core/normalizer.js";
import { parseSourceSpec, parseSpec } from "../core/parser.js";
import { operationAnchors, operationKey } from "../core/reference-identity.js";
import type { NormalizedOperation, SecurityScheme } from "../core/types.js";
import type { ProjectFiles } from "./project-files.js";
import { isAbsoluteHttpUrl } from "../site-url.js";

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

type SourceObject = Record<string, unknown>;

export interface ReferenceOperation {
  /** Native document identity (`POST /translate`), which keys a tab's `routes` and `anchors`. */
  document: string;
  method: (typeof METHODS)[number];
  path: string;
  operationId?: string;
  /** Another method on the same path shares this operation's identifier. */
  duplicateId: boolean;
  /** The dereferenced operation and its path item, as the source document wrote them. */
  source: { operation: SourceObject; pathItem: SourceObject };
  /** The operation as the native reference reads it, when it publishes the operation. */
  native?: NormalizedOperation;
  /** Fragments the native operation page publishes. */
  anchors: string[];
}

export interface ApiReference {
  /** The dereferenced document in its own OpenAPI or Swagger version. */
  document: SourceObject;
  operations: ReferenceOperation[];
  /** Tags with their own description or external docs, which reference generators publish as pages. */
  describedTags: string[];
  webhooks: boolean;
  securitySchemes: Record<string, SecurityScheme>;
}

export async function readApiReference(project: ProjectFiles, spec: string): Promise<ApiReference> {
  const loaded = await loadSpec(isAbsoluteHttpUrl(spec) ? spec : project.absolute(spec));
  const parsed = await parseSourceSpec(loaded);
  const document = parsed.document as unknown as {
    paths?: Record<string, SourceObject | undefined>;
    tags?: { name: string; description?: string; externalDocs?: unknown }[];
    webhooks?: SourceObject;
  };
  const native = normalizeSpec(await parseSpec(loaded));
  const nativeOperations = new Map(native.operations.map((operation) => [operationKey(operation), operation]));
  const operations: ReferenceOperation[] = [];
  for (const [path, pathItem = {}] of Object.entries(document.paths ?? {})) {
    const ids = METHODS.map((method) => (pathItem[method] ? ((pathItem[method] as SourceObject).operationId ?? path) : undefined));
    for (const [index, method] of METHODS.entries()) {
      const operation = pathItem[method] as SourceObject | undefined;
      if (!operation) continue;
      const nativeOperation = nativeOperations.get(operationKey({ method, path }));
      operations.push({
        document: operationKey({ method, path }),
        method,
        path,
        operationId: typeof operation.operationId === "string" ? operation.operationId : undefined,
        duplicateId: ids.filter((id) => id === ids[index]).length > 1,
        source: { operation, pathItem },
        native: nativeOperation,
        anchors: nativeOperation ? operationAnchors(nativeOperation, native, true) : [],
      });
    }
  }
  return {
    document: parsed.document as unknown as SourceObject,
    operations,
    describedTags: (document.tags ?? []).filter((tag) => tag.description || tag.externalDocs).map((tag) => tag.name),
    webhooks: Object.keys(document.webhooks ?? {}).length > 0,
    securitySchemes: native.securitySchemes,
  };
}
