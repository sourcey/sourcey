import { createHash } from "node:crypto";
import type { NormalizedOperation, NormalizedSchema, NormalizedSpec } from "../core/types.js";
import type { SitePage } from "../renderer/html-builder.js";
import type { SiteConfig } from "../renderer/context.js";
import { htmlId, operationAnchor, definitionAnchor } from "../utils/html-id.js";
import { generateCodeSamples } from "../utils/code-samples.js";
import { toPublicUrl } from "../site-url.js";
import { fencedCode } from "./markdown.js";
import { rewriteMarkdownDestinations } from "../core/markdown-loader.js";

export interface DocumentationEntry {
  id: string;
  kind: "page" | "operation" | "schema";
  title: string;
  description: string;
  tab: string;
  /** Canonical browser location, including the operation anchor when applicable. */
  url: string;
  /** Public Markdown location. */
  markdown: string;
  /** Path relative to the generated directory. */
  file: string;
  /** Compact body terms for keyword retrieval; content remains in the Markdown file. */
  searchText?: string;
  symbols?: { name: string; anchor?: string; kind: string }[];
}

export interface DocumentationIndex {
  version: 1;
  name: string;
  documents: DocumentationEntry[];
}

export interface ReadableDocument {
  entry: DocumentationEntry;
  content: string;
  /** Child operations and schemas already occur in their parent page. */
  aggregate: boolean;
}

export function markdownPath(outputPath: string): string {
  return outputPath.replace(/\.html$/, ".md");
}

function detailRoot(outputPath: string): string {
  return outputPath.replace(/(?:\/index)?\.html$/, "");
}

export function schemaMarkdownPath(outputPath: string, name: string): string {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 10);
  return `${detailRoot(outputPath)}/schemas/${htmlId(name) || "schema"}-${digest}.md`;
}

export function operationMarkdownPath(outputPath: string, operation: NormalizedOperation): string {
  return `${detailRoot(outputPath)}/operations/${operationAnchor(operation)}.md`;
}

export function operationName(operation: NormalizedOperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

export function collectReadableDocuments(pages: SitePage[], site: SiteConfig): ReadableDocument[] {
  const documents: ReadableDocument[] = [];
  const publicUrl = (file: string) =>
    toPublicUrl(file, site.siteUrl, site.baseUrl, site.prettyUrls);
  for (const page of pages) {
    const file = markdownPath(page.outputPath);
    let title: string;
    let description: string;
    let body: string;
    const children: ReadableDocument[] = [];
    let symbols: DocumentationEntry["symbols"];
    if (page.currentPage.kind === "markdown") {
      const doc = page.currentPage.markdown;
      title = doc.title;
      description = doc.description;
      body = doc.markdown;
      symbols = doc.searchEntries?.map((entry) => ({
        name: entry.qualifiedName || entry.title,
        anchor: entry.anchor,
        kind: entry.symbolKind || entry.category,
      }));
    } else if (page.currentPage.kind === "changelog") {
      const doc = page.currentPage.changelog;
      title = doc.title;
      description = doc.description;
      const versions = doc.permalinkVersionId
        ? doc.changelog.versions.filter((version) => version.id === doc.permalinkVersionId)
        : doc.changelog.versions;
      body = versions
        .map((version) =>
          [
            `## ${version.version ?? "Unreleased"}${version.date ? ` (${version.date})` : ""}`,
            version.summary,
            ...version.sections.map(
              (section) =>
                `### ${section.label}\n\n${section.entries.map((entry) => `- ${entry.text}`).join("\n")}`,
            ),
          ]
            .filter(Boolean)
            .join("\n\n"),
        )
        .join("\n\n");
    } else {
      const spec = page.currentPage.spec;
      title = spec.info.title;
      description = spec.info.summary || spec.info.description || "";
      const reference = (name: string) =>
        spec.schemas[name] ? publicUrl(schemaMarkdownPath(page.outputPath, name)) : undefined;
      for (const operation of spec.operations) {
        if (operation.hidden) continue;
        const operationFile = operationMarkdownPath(page.outputPath, operation);
        const operationTitle = operationName(operation);
        children.push({
          entry: {
            id: operationFile,
            kind: "operation",
            title: operationTitle,
            description: operation.summary || operation.description || "",
            tab: page.tabSlug,
            url: `${publicUrl(page.outputPath)}#${operationAnchor(operation)}`,
            markdown: publicUrl(operationFile),
            file: operationFile,
          },
          content: operationMarkdown(operation, spec, site, reference),
          aggregate: false,
        });
      }
      for (const [name, schema] of Object.entries(spec.schemas)) {
        const schemaFile = schemaMarkdownPath(page.outputPath, name);
        children.push({
          entry: {
            id: schemaFile,
            kind: "schema",
            title: name,
            description: schema.description || "",
            tab: page.tabSlug,
            url: `${publicUrl(page.outputPath)}#${definitionAnchor(name)}`,
            markdown: publicUrl(schemaFile),
            file: schemaFile,
          },
          content: `# ${name}\n\n${schemaMarkdown(schema, new Set(), reference)}`,
          aggregate: false,
        });
      }
      body = [
        description,
        spec.info.version ? `Version: ${spec.info.version}` : "",
        securityMarkdown(spec),
        ...children.map((child) => child.content.replace(/^# /, "## ")),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    const hasTitle = body.trimStart().split("\n", 1)[0] === `# ${title}`;
    const content = `${hasTitle ? "" : `# ${title}\n\n`}${body.trim()}\n`;
    documents.push(
      {
        entry: {
          id: file,
          kind: "page",
          title,
          description,
          tab: page.tabSlug,
          url: publicUrl(page.outputPath),
          markdown: publicUrl(file),
          file,
          symbols,
        },
        content,
        aggregate: !(
          page.currentPage.kind === "changelog" && page.currentPage.changelog.permalinkVersionId
        ),
      },
      ...children,
    );
  }
  const files = new Set<string>();
  const readableUrls = new Map(
    documents
      .filter((document) => document.entry.kind === "page")
      .map((document) => [
        new URL(document.entry.url, "https://sourcey.invalid").href,
        document.entry.markdown,
      ]),
  );
  for (const document of documents) {
    if (files.has(document.entry.file))
      throw new Error(`Duplicate documentation export: ${document.entry.file}`);
    files.add(document.entry.file);
    document.content = rewriteMarkdownDestinations(document.content, (href) => {
      if (href.startsWith("#")) return href;
      let target: URL;
      try {
        target = new URL(href, new URL(document.entry.url, "https://sourcey.invalid"));
      } catch {
        return href;
      }
      const hash = target.hash;
      const query = target.search;
      target.hash = "";
      target.search = "";
      const markdown = readableUrls.get(target.href);
      return markdown ? `${markdown}${query}${hash}` : href;
    });
  }
  return documents;
}

export function operationMarkdown(
  operation: NormalizedOperation,
  spec: NormalizedSpec,
  site: SiteConfig,
  reference?: (name: string) => string | undefined,
): string {
  const parts = [`# ${operationName(operation)}`, operation.summary, operation.description];
  if (operation.deprecated) parts.push("Deprecated.");
  parts.push(securityMarkdown(spec, operation));
  if (operation.parameters.length) {
    parts.push(
      "Parameters:",
      ...operation.parameters.map((parameter) =>
        [
          `- \`${parameter.name}\` (${parameter.in}, ${schemaType(parameter.schema)}, ${parameter.required ? "required" : "optional"})${parameter.description ? ` - ${parameter.description}` : ""}`,
          parameter.schema ? indent(schemaMarkdown(parameter.schema, new Set(), reference)) : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }
  for (const [type, media] of Object.entries(operation.requestBody?.content ?? {})) {
    parts.push(
      `Request body: ${type}${operation.requestBody?.required ? " (required)" : ""}`,
      operation.requestBody?.description,
      media.schema ? schemaMarkdown(media.schema, new Set(), reference) : "",
    );
    if (media.example !== undefined)
      parts.push(fencedCode(JSON.stringify(media.example, null, 2), "json"));
  }
  if (operation.mcpExtras?.outputSchema)
    parts.push("Returns:", schemaMarkdown(operation.mcpExtras.outputSchema, new Set(), reference));
  if (operation.mcpExtras?.annotations)
    parts.push(
      "Declared MCP annotations:",
      fencedCode(JSON.stringify(operation.mcpExtras.annotations, null, 2), "json"),
    );
  if (operation.responses.length) parts.push("Responses:");
  for (const response of operation.responses) {
    parts.push(
      `- ${response.statusCode}: ${[response.summary, response.description].filter(Boolean).join(" - ")}`,
    );
    for (const [type, media] of Object.entries(response.content ?? {})) {
      parts.push(
        `Content type: ${type}`,
        media.schema ? schemaMarkdown(media.schema, new Set(), reference) : "",
      );
      if (media.example !== undefined)
        parts.push(fencedCode(JSON.stringify(media.example, null, 2), "json"));
    }
  }
  const server = operation.servers?.[0] ?? spec.servers[0];
  const serverUrl =
    server?.url.replace(
      /\{([^}]+)\}/g,
      (match, name: string) => server.variables?.[name]?.default ?? match,
    ) ?? "";
  const samples = operation.mcpExtras
    ? (operation.codeSamples ?? [])
    : generateCodeSamples(operation, serverUrl, site.codeSamples);
  if (samples.length)
    parts.push(
      "## Examples",
      ...samples.map(
        (sample) =>
          `### ${sample.label || sample.lang}\n\n${fencedCode(sample.source, sample.lang)}`,
      ),
    );
  return parts.filter(Boolean).join("\n\n") + "\n";
}

function securityMarkdown(spec: NormalizedSpec, operation?: NormalizedOperation): string {
  const names = operation
    ? [...new Set(operation.security.flatMap((requirement) => Object.keys(requirement)))]
    : Object.keys(spec.securitySchemes);
  if (!names.length)
    return operation ? "Authentication: no security requirement declared for this operation." : "";
  return (
    (operation
      ? `Authentication (security requirement alternatives):\n\n${fencedCode(JSON.stringify(operation.security, null, 2), "json")}\n\n`
      : "Authentication:\n") +
    names
      .map((name) => {
        const scheme = spec.securitySchemes[name];
        const scopes = operation?.security.flatMap((requirement) => requirement[name] || []) ?? [];
        return `- ${name}${scheme ? `: ${scheme.type}${scheme.scheme ? ` (${scheme.scheme})` : ""}${scheme.name ? `, ${scheme.in} ${scheme.name}` : ""}${scheme.description ? `. ${scheme.description}` : ""}` : ""}${scopes.length ? `; scopes: ${scopes.join(", ")}` : ""}`;
      })
      .join("\n")
  );
}

function schemaType(schema?: NormalizedSchema): string {
  if (!schema) return "unknown";
  return [
    Array.isArray(schema.type)
      ? schema.type.join(" | ")
      : schema.type || schema.refName || (schema.properties ? "object" : "unknown"),
    schema.format,
  ]
    .filter(Boolean)
    .join(", ");
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

export function schemaMarkdown(
  schema: NormalizedSchema,
  ancestors = new Set<NormalizedSchema>(),
  reference?: (name: string) => string | undefined,
): string {
  const refName = schema.refName || schema.name;
  const href = refName ? reference?.(refName) : undefined;
  const ref = href ? `[${refName}](${href})` : refName;
  if (ancestors.has(schema)) return `Recursive reference: ${ref || schemaType(schema)}.`;
  const namedReference = ancestors.size > 0 && !!schema.refName;
  const seen = new Set(ancestors).add(schema);
  const parts = [
    `${namedReference ? `Reference: ${ref}; ` : ""}Type: ${schemaType(schema)}${schema.nullable ? "; nullable" : ""}`,
    schema.description,
    href && !namedReference ? `Schema: ${ref}` : "",
  ];
  for (const key of [
    "default",
    "const",
    "enum",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "uniqueItems",
    "readOnly",
    "writeOnly",
    "deprecated",
  ] as const) {
    if (
      schema[key] !== undefined &&
      !(
        schema[key] === false &&
        ["uniqueItems", "readOnly", "writeOnly", "deprecated"].includes(key)
      )
    )
      parts.push(`${key}: ${JSON.stringify(schema[key])}`);
  }
  if (schema.example !== undefined)
    parts.push(`Example:\n\n${fencedCode(JSON.stringify(schema.example, null, 2), "json")}`);
  if (namedReference) return parts.filter(Boolean).join("\n\n");
  for (const [name, property] of Object.entries(schema.properties ?? {}))
    parts.push(
      `- \`${name}\` (${schema.required?.includes(name) ? "required" : "optional"})\n${indent(schemaMarkdown(property, seen, reference))}`,
    );
  if (schema.examples?.length)
    parts.push(`Examples:\n\n${fencedCode(JSON.stringify(schema.examples, null, 2), "json")}`);
  if (schema.discriminator)
    parts.push(
      `Discriminator:\n\n${fencedCode(JSON.stringify(schema.discriminator, null, 2), "json")}`,
    );
  if (schema.not)
    parts.push(`Must not match:\n${indent(schemaMarkdown(schema.not, seen, reference))}`);
  if (schema.items) parts.push(`Items:\n${indent(schemaMarkdown(schema.items, seen, reference))}`);
  for (const key of ["oneOf", "anyOf", "allOf"] as const)
    if (schema[key])
      parts.push(
        `${key}:\n${schema[key].map((variant) => indent(schemaMarkdown(variant, seen, reference))).join("\n\n")}`,
      );
  if (schema.additionalProperties !== undefined)
    parts.push(
      `Additional properties: ${typeof schema.additionalProperties === "boolean" ? schema.additionalProperties : `\n${indent(schemaMarkdown(schema.additionalProperties, seen, reference))}`}`,
    );
  return parts.filter(Boolean).join("\n\n");
}
