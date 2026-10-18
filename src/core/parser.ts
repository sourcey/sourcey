import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, posix, relative, resolve } from "node:path";
import { load } from "js-yaml";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LoadedSpec, OpenApiDocument, ParsedSpec } from "./types.js";

/**
 * Dereference a loaded spec document.
 * All $ref pointers are resolved (local, remote, circular).
 *
 * Uses the document source as the base URI, but honors OpenAPI 3.2's
 * `$self` field when present so relative references resolve canonically.
 */
export async function parseSpec(
  loaded: LoadedSpec,
  options: { publishBundle?: boolean } = {},
): Promise<ParsedSpec> {
  try {
    const parser = new $RefParser();
    const resolver = { http: false as const, file: createConfinedFileResolver(loaded) };
    const publicDocument = options.publishBundle
      ? ((await new $RefParser().bundle(
          resolveDocumentUri(loaded),
          structuredClone(loaded.raw) as never,
          { resolve: resolver },
        )) as unknown as Record<string, unknown>)
      : undefined;
    const dereferenced = await parser.dereference(
      resolveDocumentUri(loaded),
      structuredClone(loaded.raw) as never,
      {
        dereference: {
          circular: "ignore",
          onDereference(ref: string, value: unknown) {
            const refName = refNameFromRef(ref);
            if (refName && isRecord(value) && typeof value["x-ref-name"] !== "string") {
              value["x-ref-name"] = refName;
            }
          },
        },
        resolve: resolver,
      },
    );

    return {
      document: dereferenced as unknown as OpenApiDocument,
      source: loaded.source,
      publicDocument,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse OpenAPI spec: ${message}`, { cause: error });
  }
}

function createConfinedFileResolver(loaded: LoadedSpec):
  | false
  | {
      order: number;
      canRead(file: { url: string }): boolean;
      read(file: { url: string }): Promise<Buffer>;
    } {
  const root = localSpecRoot(loaded.source);
  if (!root) return false;
  // Every local document read so far, kept to map a schema's `$id` URLs back to local files.
  const documents = new Map<string, Buffer>();
  const ids = new Map<string, string | null>();
  const readLocal = async (path: string): Promise<Buffer> => {
    const bytes = documents.get(path) ?? (await readFile(path));
    documents.set(path, bytes);
    return bytes;
  };
  const idOf = (path: string, bytes: Buffer): string | null => {
    if (!ids.has(path)) ids.set(path, declaredId(path, bytes));
    return ids.get(path) ?? null;
  };

  return {
    order: 1,
    canRead(file) {
      return filePathFromRef(file.url) !== null || /^https?:/i.test(file.url);
    },
    async read(file) {
      const filePath = filePathFromRef(file.url);
      if (filePath) {
        const resolved = resolve(filePath);
        if (!isWithinRoot(root, resolved)) {
          throw new Error(`External $ref resolves outside the spec directory: ${file.url}`);
        }
        return readLocal(resolved);
      }
      // A schema's `$id` makes the relative refs inside it absolute URLs. One resolves to a local
      // file only when it lies where a document already read places it, inside the spec
      // directory, and declares exactly that `$id`. Nothing is fetched.
      const target = withoutFragment(file.url);
      for (const [path, bytes] of [...documents]) {
        const id = idOf(path, bytes);
        if (!id || new URL(id).origin !== new URL(target).origin) continue;
        const candidate = resolve(
          dirname(path),
          posix.relative(posix.dirname(new URL(id).pathname), new URL(target).pathname),
        );
        if (!isWithinRoot(root, candidate)) continue;
        const found = await readLocal(candidate).catch(() => null);
        if (found && idOf(candidate, found) === target) return found;
      }
      throw new Error(`External $ref is not a schema in the spec directory: ${file.url}`);
    },
  };
}

/** The absolute `$id` a JSON or YAML schema declares at its root, without a fragment. */
function declaredId(path: string, bytes: Buffer): string | null {
  try {
    const text = bytes.toString("utf8");
    const value = extname(path) === ".json" ? JSON.parse(text) : load(text);
    const id = isRecord(value) ? value["$id"] : undefined;
    return typeof id === "string" && /^https?:/i.test(id) ? withoutFragment(id) : null;
  } catch {
    return null;
  }
}

function withoutFragment(url: string): string {
  return url.split("#", 1)[0] ?? url;
}

function localSpecRoot(source: string): string | null {
  if (source.startsWith("http://") || source.startsWith("https://")) return null;
  return dirname(resolve(source));
}

function filePathFromRef(refUrl: string): string | null {
  const withoutHash = refUrl.split("#", 1)[0];
  if (!withoutHash) return null;
  if (/^file:/i.test(withoutHash)) {
    try {
      return fileURLToPath(withoutHash);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(withoutHash)) return null;
  return resolve(withoutHash);
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function refNameFromRef(ref: string): string | null {
  const pointer = ref.includes("#") ? ref.slice(ref.indexOf("#") + 1) : ref;
  const segments = pointer.split("/").filter(Boolean);
  const raw = segments.at(-1);
  if (!raw) return null;
  return raw.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveDocumentUri(loaded: LoadedSpec): string {
  const self = typeof loaded.raw["$self"] === "string" ? loaded.raw["$self"] : undefined;
  if (!self) return loaded.source;

  try {
    if (loaded.source.startsWith("http://") || loaded.source.startsWith("https://")) {
      return new URL(self, loaded.source).toString();
    }

    const resolved = new URL(self, pathToFileURL(loaded.source));
    return resolved.protocol === "file:" ? fileURLToPath(resolved) : resolved.toString();
  } catch {
    return loaded.source;
  }
}
