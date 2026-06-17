import type { ExampleObject, MediaTypeContent, NormalizedSchema } from "../core/types.js";
import { generateExample } from "./example-generator.js";
import { highlightCode } from "./highlighter.js";

/**
 * A single, render-ready example. One media type can contribute several
 * (named `examples`); each becomes its own variant so the UI can offer a
 * switcher between them.
 */
export interface ExampleVariant {
  /** Label shown in the variant switcher (example name, media type, or "Example"). */
  label: string;
  /** Optional caption from a named example's `summary`/`description`. */
  summary?: string;
  /** Media type the example came from (e.g. `application/json`). */
  mediaType: string;
  /** Syntax-highlighted HTML body, empty when the example is external-only. */
  html: string;
  /** Raw text body (for copy + tests), or the URL for an external example. */
  raw: string;
  /** Set when the example is referenced via `externalValue` rather than inline. */
  externalValue?: string;
}

/** Map a media type to a highlighter language, defaulting to JSON. */
function langForMediaType(mediaType: string): string {
  const m = mediaType.toLowerCase();
  if (m.includes("xml")) return "xml";
  if (m.includes("yaml") || m.includes("yml")) return "yaml";
  if (m.includes("html")) return "html";
  if (m.includes("json")) return "json";
  if (m.startsWith("text/")) return "text";
  return "json";
}

/** Build a variant from a concrete example value. */
function variantFromValue(
  value: unknown,
  opts: { label: string; mediaType: string; summary?: string },
): ExampleVariant {
  const lang = langForMediaType(opts.mediaType);
  // JSON media encodes any value (a bare string "hi" renders as "hi"); other
  // media types keep a provided string body verbatim (pre-formatted XML/text).
  const raw = typeof value === "string" && lang !== "json"
    ? value
    : JSON.stringify(value, null, 2);
  return {
    label: opts.label,
    summary: opts.summary,
    mediaType: opts.mediaType,
    raw,
    html: highlightCode(raw, lang),
  };
}

/** Build a variant from a named OpenAPI example object. */
function variantFromExample(
  name: string,
  example: ExampleObject,
  mediaType: string,
): ExampleVariant | null {
  if (example.value !== undefined) {
    return variantFromValue(example.value, {
      label: example.summary ?? name,
      summary: example.description,
      mediaType,
    });
  }
  if (example.externalValue) {
    return {
      label: example.summary ?? name,
      summary: example.description,
      mediaType,
      raw: example.externalValue,
      html: "",
      externalValue: example.externalValue,
    };
  }
  return null;
}

/** Build a single variant from a schema, falling back to a generated example. */
export function variantFromSchema(
  schema: NormalizedSchema,
  label = "Example",
  mediaType = "application/json",
): ExampleVariant | null {
  const value = schema.example ?? generateExample(schema);
  if (value === undefined) return null;
  return variantFromValue(value, { label, mediaType });
}

/**
 * Collect every render-ready example for a content map (a response, request
 * body, or parameter). Provided examples win over the schema: named `examples`
 * first, then a single `example`, and only then a schema-generated fallback.
 * Every media type contributes, so multi-content-type responses surface them
 * all rather than just the first.
 */
export function buildExampleVariants(
  content?: Record<string, MediaTypeContent>,
): ExampleVariant[] {
  if (!content) return [];
  const entries = Object.entries(content);
  const multiMedia = entries.length > 1;
  const variants: ExampleVariant[] = [];

  for (const [mediaType, media] of entries) {
    const named = media.examples ? Object.entries(media.examples) : [];
    if (named.length) {
      for (const [name, example] of named) {
        const variant = variantFromExample(name, example, mediaType);
        if (variant) variants.push(variant);
      }
      continue;
    }
    if (media.example !== undefined) {
      variants.push(variantFromValue(media.example, {
        label: multiMedia ? mediaType : "Example",
        mediaType,
      }));
      continue;
    }
    if (media.schema) {
      const variant = variantFromSchema(
        media.schema,
        multiMedia ? mediaType : "Example",
        mediaType,
      );
      if (variant) variants.push(variant);
    }
  }

  return variants;
}
