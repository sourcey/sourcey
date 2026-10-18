/**
 * Convert a string into a URL-safe HTML id attribute value.
 * Matches the legacy htmlId Handlebars helper behavior.
 */
export function htmlId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function operationAnchor(operation: { path: string; method: string }): string {
  return `operation-${htmlId(operation.path)}-${htmlId(operation.method)}`;
}

export function definitionAnchor(name: string): string {
  return `definition-${htmlId(name)}`;
}
