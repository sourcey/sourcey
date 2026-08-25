import { readFile, access } from "node:fs/promises";
import { resolve, extname } from "node:path";
import yaml from "js-yaml";
import type { LoadedSpec, SpecFormat, SpecVersion } from "./types.js";

const REMOTE_SPEC_TIMEOUT_MS = 30_000;

/**
 * Load an OpenAPI/Swagger spec from a local file path or URL.
 * Auto-detects JSON vs YAML and Swagger 2.0 vs OpenAPI 3.x.
 */
export async function loadSpec(source: string): Promise<LoadedSpec> {
  const content = await fetchContent(source);
  const format = detectFormat(source, content);
  const raw = parseContent(content, format);
  const version = detectVersion(raw);
  const resolvedSource = isUrl(source) ? source : resolve(source);

  return { raw, format, version, source: resolvedSource };
}

/**
 * Fetch raw content from a file path or URL.
 */
async function fetchContent(source: string): Promise<string> {
  if (isUrl(source)) {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(REMOTE_SPEC_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch spec from ${source}: ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  const filePath = resolve(source);
  await access(filePath).catch(() => {
    throw new Error(`Spec file not found: ${filePath}`);
  });
  return readFile(filePath, "utf-8");
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
    const parsed = yaml.load(content);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("YAML spec must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
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
  throw new Error('Unable to detect spec version. Expected "swagger": "2.0" or "openapi": "3.x.x"');
}

function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}
