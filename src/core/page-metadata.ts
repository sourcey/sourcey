import { Parser } from "htmlparser2";
import type { CurrentPage } from "./site-model.js";
import { referenceOperation, sectionBodies } from "./reference-identity.js";
import { referenceTag, tagDisplayName } from "./tag-utils.js";
import type { NormalizedOperation, NormalizedSchema } from "./types.js";
import { extractFirstParagraph, renderMarkdownInline } from "../utils/markdown.js";

/** Page facts shared by HTML metadata, social cards and the readable index. */
export interface PageMetadata {
  title: string;
  browserTitle: string;
  siteName: string;
  /** The source's own summary, without HTML or Markdown presentation syntax. */
  summary: string;
  /** The summary, else what the source states plainly (a model's fields), else the title. */
  description: string;
}

export function pageMetadata(
  page: CurrentPage,
  site: { name: string; titleSeparator: string },
  referenceLabel?: string,
): PageMetadata {
  const siteName = site.name || (page.kind === "spec" ? page.spec.info.title : "");
  let title: string;
  let summary: string;
  let browserTitle: string | undefined;
  let outline = "";
  if (page.kind === "markdown") {
    title = page.markdown.title;
    summary = metadataSummary(page.markdown.description);
  } else if (page.kind === "changelog") {
    const doc = page.changelog;
    const version = doc.permalinkVersionId
      ? doc.changelog.versions.find(candidate => candidate.id === doc.permalinkVersionId)
      : undefined;
    title = version ? `${version.version ?? "Unreleased"}${site.titleSeparator}${doc.title}` : doc.title;
    summary = metadataSummary(version
      ? version.summary || version.sections.flatMap(section => section.entries.map(entry => entry.text)).slice(0, 3).join(" ")
      : doc.description || doc.changelog.description);
  } else if (page.kind === "spec") {
    const { spec, view } = page;
    if (view?.kind === "operation") {
      const operation = referenceOperation(spec, view.id);
      title = operation.summary || `${operation.method.toUpperCase()} ${operation.path}`;
      summary = metadataSummary(operation.description) || metadataSummary(operation.summary);
      outline = operationOutline(operation);
    } else if (view?.kind === "section") {
      const tag = referenceTag(spec, view.tag);
      title = tagDisplayName(tag);
      summary = metadataSummary(tag.description);
      outline = namesOutline((sectionBodies(spec).get(view.tag) ?? []).map(operation => operation.summary || `${operation.method.toUpperCase()} ${operation.path}`), "Covers");
    } else if (view?.kind === "schema") {
      title = view.name;
      summary = metadataSummary(spec.schemas[view.name]?.description);
      outline = schemaOutline(spec.schemas[view.name]);
    } else {
      title = spec.info.title || siteName;
      summary = metadataSummary(spec.info.summary) || metadataSummary(spec.info.description);
      browserTitle = composeTitle(siteName, referenceLabel || (spec.operations.some(operation => operation.mcpExtras) ? "MCP Reference" : "API Reference"), site.titleSeparator);
    }
  } else {
    title = page.title;
    summary = metadataSummary(page.description);
  }
  // A summary that only repeats the title says less than what the source states plainly.
  return { title, summary, description: (summary !== title && summary) || outline || summary || title, siteName,
    browserTitle: browserTitle ?? composeTitle(title, siteName, site.titleSeparator) };
}

/**
 * A summary as plain text: the source's first prose paragraph (body copy keeps
 * it rich), rendered and read back without its markup, scripts or styles.
 */
export function metadataSummary(input?: string): string {
  if (!input) return "";
  let text = "", hidden = 0;
  const parser = new Parser({
    onopentag(name) { if (HIDDEN.has(name)) hidden += 1; else if (name === "br") text += " "; },
    onclosetag(name) { if (HIDDEN.has(name)) hidden -= 1; },
    ontext(value) { if (!hidden) text += value; },
  }, { decodeEntities: true });
  parser.end(renderMarkdownInline(extractFirstParagraph(input) || input));
  return text.replace(/\s+/g, " ").trim();
}

const HIDDEN = new Set(["script", "style", "template"]);

/** An operation with no description, described by what it is: its method and path, what it takes and returns. */
function operationOutline(operation: NormalizedOperation): string {
  const named = (content: Record<string, { schema?: NormalizedSchema }> | undefined) => {
    const schema = Object.values(content ?? {})[0]?.schema;
    return schema?.refName ?? (schema?.items?.refName && `a list of ${schema.items.refName}`);
  };
  const takes = named(operation.requestBody?.content);
  const returns = named(operation.responses.find(response => /^2/.test(response.statusCode))?.content);
  const parts = [takes && `takes ${takes}`, returns && `returns ${returns}`].filter(Boolean);
  return `${operation.method.toUpperCase()} ${operation.path}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/** Names as a sentence: the first six, then how many more. */
function namesOutline(names: string[], noun: string): string {
  if (!names.length) return "";
  const shown = names.slice(0, 6);
  const rest = names.length - shown.length;
  const words = rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
  return `${noun}: ${words}.`;
}

/** A model with no description, described by what it holds: its fields, or its values. */
function schemaOutline(schema: NormalizedSchema | undefined): string {
  if (!schema) return "";
  const fields = Object.keys(schema.properties ?? {});
  if (fields.length) return namesOutline(fields, fields.length === 1 ? "Field" : "Fields");
  if (schema.enum?.length) return namesOutline(schema.enum.map(String), "One of");
  if (schema.items?.refName) return `A list of ${schema.items.refName}.`;
  return "";
}

function composeTitle(title: string, siteName: string, separator: string): string {
  if (!title) return siteName;
  if (!siteName) return title;
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalize(title) === normalize(siteName) ? title : `${title}${separator}${siteName}`;
}
