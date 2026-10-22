import { readFile, realpath } from "node:fs/promises";
import { resolve, extname, dirname, basename, isAbsolute } from "node:path";
import { load, YAMLException } from "js-yaml";
import type { LoadedSpec, SpecFormat, SpecVersion } from "./types.js";
import { createHash } from "node:crypto";
import { hashFile, SourceFile } from "./source-file.js";
import { isAbsoluteHttpUrl } from "../site-url.js";

export async function canonicalInputPath(source: string): Promise<string> {
  if (isAbsoluteHttpUrl(source)) return source;
  const path = resolve(source);
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    let parent = dirname(path);
    const suffix = [basename(path)];
    for (;;) {
      try { return resolve(await realpath(parent), ...suffix); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === dirname(parent)) throw error; }
      suffix.unshift(basename(parent)); parent = dirname(parent);
    }
  }
}
const remoteInputs = new Map<string, Input>();
interface Input { body: Buffer; digest: string; etag?: string; modified?: string }

/** Build-scoped byte authority. Forking keeps a failed update out of the serving snapshot. */
export interface InputReaderOptions {
  /**
   * Files published unchanged are hashed as they stream and copied from
   * source when the output is written, rather than held in memory: for a
   * build that writes its output, not a host that serves the site from memory.
   */
  copyFromSource?: boolean;
}

export class InputReader {
  constructor(readonly signal?: AbortSignal, readonly options: InputReaderOptions = {}) {}
  readonly inputs = new Map<string, Input>();
  /** Files published unchanged, kept as a path and digest when the build copies from source. */
  readonly files = new Map<string, { file: SourceFile; head: Buffer }>();
  private pendingFiles = new Map<string, Promise<{ file: SourceFile; head: Buffer }>>();
  readonly dependents = new Map<string, Set<string>>();
  private pending = new Map<string, Promise<Input>>();
  private canonical = new Map<string, string>();
  private async key(source: string): Promise<string> {
    const known = this.canonical.get(source);
    if (known) return known;
    const canonical = await canonicalInputPath(source); this.canonical.set(source, canonical); return canonical;
  }

  fork(changed: Iterable<string>, signal = this.signal): InputReader {
    const next = new InputReader(signal, this.options);
    for (const [key, input] of this.inputs) next.inputs.set(key, input);
    for (const [key, file] of this.files) next.files.set(key, file);
    for (const [key, values] of this.dependents) next.dependents.set(key, new Set(values));
    for (const file of changed) {
      next.inputs.delete(isAbsoluteHttpUrl(file) ? file : resolve(file));
      next.files.delete(resolve(file));
    }
    return next;
  }

  private async depend(key: string, dependent?: string): Promise<void> {
    if (!dependent) return;
    const edges = this.dependents.get(key) ?? new Set();
    edges.add(isAbsolute(dependent) ? await canonicalInputPath(dependent) : dependent); this.dependents.set(key, edges);
  }

  /**
   * A file the site publishes unchanged, with its first bytes: the file
   * itself when the build copies from source, otherwise its bytes.
   */
  async file(source: string, dependent?: string): Promise<{ body: Buffer | SourceFile; digest: string; head: Buffer }> {
    if (!this.options.copyFromSource || isAbsoluteHttpUrl(source)) {
      const { body, digest } = await this.read(source, dependent);
      return { body, digest, head: body.subarray(0, 80) };
    }
    this.signal?.throwIfAborted();
    const key = await this.key(source);
    await this.depend(key, dependent);
    let entry = this.files.get(key);
    if (!entry) {
      let pending = this.pendingFiles.get(key);
      if (!pending) {
        pending = hashFile(key, this.signal).then(({ digest, size, head, identity }) => {
          const value = { file: new SourceFile(key, digest, size, identity), head };
          this.files.set(key, value);
          return value;
        });
        this.pendingFiles.set(key, pending);
      }
      try { entry = await pending; }
      finally { this.pendingFiles.delete(key); }
    }
    return { body: entry.file, digest: entry.file.digest, head: entry.head };
  }

  async read(source: string, dependent?: string): Promise<Input> {
    this.signal?.throwIfAborted();
    const key = await this.key(source);
    await this.depend(key, dependent);
    let input = this.inputs.get(key);
    if (input) return input;
    let promise = this.pending.get(key);
    if (!promise) {
      promise = (async () => {
        let body: Buffer;
        let etag: string | undefined, modified: string | undefined;
        if (isAbsoluteHttpUrl(key)) {
          const previous = remoteInputs.get(key);
          const headers: Record<string, string> = {};
          if (previous?.etag) headers["If-None-Match"] = previous.etag;
          else if (previous?.modified) headers["If-Modified-Since"] = previous.modified;
          const response = await fetch(key, { headers, signal: this.signal });
          if (response.status === 304 && previous) { this.inputs.set(key, previous); return previous; }
          if (!response.ok) throw new Error(`Failed to read ${key}: ${response.status}`);
          body = Buffer.from(await response.arrayBuffer());
          etag = response.headers.get("etag") ?? undefined;
          modified = response.headers.get("last-modified") ?? undefined;
        } else body = await readFile(key, { signal: this.signal }).catch((error: NodeJS.ErrnoException) => {
          throw error.code === "ENOENT" ? new Error(`File not found: ${key}`, { cause: error }) : error;
        });
        const value = { body, digest: createHash("sha256").update(body).digest("hex"), etag, modified };
        this.inputs.set(key, value);
        if (isAbsoluteHttpUrl(key)) remoteInputs.set(key, value);
        return value;
      })();
      this.pending.set(key, promise);
    }
    try { input = await promise; return input; }
    finally { this.pending.delete(key); }
  }

  async affected(owner: string, changed: string[]): Promise<boolean> {
    const canonical = await this.key(owner);
    return changed.some(file => this.dependents.get(file)?.has(canonical));
  }
  async contains(source: string): Promise<boolean> {
    const key = await this.key(source);
    return this.inputs.has(key) || this.files.has(key);
  }

  async readText(source: string, dependent?: string): Promise<string> {
    return (await this.read(source, dependent)).body.toString("utf8");
  }
}

/**
 * Load an OpenAPI/Swagger spec from a local file path or URL.
 * Auto-detects JSON vs YAML and Swagger 2.0 vs OpenAPI 3.x.
 */
export async function loadSpec(source: string, reader?: InputReader): Promise<LoadedSpec> {
  const { raw, format } = await loadDocument(source, reader, source);
  const version = detectVersion(raw);
  const resolvedSource = isAbsoluteHttpUrl(source) ? source : resolve(source);

  return { raw, format, version, source: resolvedSource };
}

/** Parse a JSON/YAML input, read through the build's reader or, outside a build, one of its own. */
export async function loadDocument(source: string, reader = new InputReader(), dependent?: string): Promise<{ raw: Record<string, unknown>; format: SpecFormat }> {
  const content = await reader.readText(source, dependent);
  const format = detectFormat(source, content);
  const raw = parseContent(content, format);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Document must be an object: ${source}`);
  return { raw, format };
}

/**
 * Detect whether the content is JSON or YAML based on extension and content.
 */
function detectFormat(source: string, content: string): SpecFormat {
  const ext = extname(source).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".yml" || ext === ".yaml") return "yaml";

  // Try to detect from content
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) return "json";
  return "yaml";
}

/**
 * Parse raw string content into a JS object.
 */
function parseContent(content: string, format: SpecFormat): Record<string, unknown> {
  if (format === "json") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`Failed to parse JSON spec: ${(e as Error).message}`, { cause: e });
    }
  }

  try {
    const parsed = load(content);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("YAML spec must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof YAMLException) {
      throw new Error(`Failed to parse YAML spec: ${e.message}`, { cause: e });
    }
    throw e;
  }
}

/**
 * Detect the spec version from the parsed document.
 */
function detectVersion(raw: Record<string, unknown>): SpecVersion {
  if (typeof raw.swagger === "string" && raw.swagger.startsWith("2.")) {
    return "swagger-2.0";
  }
  if (typeof raw.openapi === "string") {
    if (raw.openapi.startsWith("3.2")) return "openapi-3.2";
    if (raw.openapi.startsWith("3.1")) return "openapi-3.1";
    if (raw.openapi.startsWith("3.")) return "openapi-3.0";
  }
  throw new Error(
    'Unable to detect spec version. Expected "swagger": "2.0" or "openapi": "3.x.x"',
  );
}
