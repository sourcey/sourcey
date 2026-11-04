/** Decode a reference's URI fragment before interpreting its JSON Pointer tokens. */
export function schemaReferencePath(ref: string): string[] {
  const fragment = ref.includes("#") ? ref.slice(ref.indexOf("#") + 1) : ref;
  let decoded = fragment;
  try { decoded = decodeURIComponent(fragment); }
  catch { /* Naming must not reject a reference the resolver already accepted. */ }
  return decoded.replace(/^\//, "").split("/")
    .map(token => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}
