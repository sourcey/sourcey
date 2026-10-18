import type { ParsedSpec } from "./types.js";

/**
 * Convert a Swagger 2.0 spec to OpenAPI 3.0 format.
 * If the spec is already OpenAPI 3.x, returns it as-is.
 *
 * Expects the spec to already be dereferenced (all $refs resolved).
 */
export async function convertToOpenApi3(parsed: ParsedSpec): Promise<ParsedSpec> {
  const doc = parsed.document;

  // Already OpenAPI 3.x — return as-is
  if (typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) {
    return parsed;
  }

  // Swagger 2.0 — convert to OpenAPI 3.0
  const { convertObj } = await import("swagger2openapi");

  // Break circular references (from dereferencing) before converting,
  // and enable anchors mode so swagger2openapi handles any remaining ones.
  const cleanDoc = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  const result = await convertObj(cleanDoc, {
    patch: true,
    warnOnly: true,
    direct: true,
    anchors: true,
  });

  return {
    document: result as ParsedSpec["document"],
    source: parsed.source,
    publicDocument: parsed.publicDocument,
  };
}
