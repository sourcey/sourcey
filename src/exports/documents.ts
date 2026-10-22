import { pageMetadata } from "../core/page-metadata.js";
import { referenceOverviewSearchText, referenceSearchText } from "../core/search-indexer.js";
import { createHash } from "node:crypto";
import type { NormalizedOperation, NormalizedSchema, NormalizedSpec } from "../core/types.js";
import type { ResolvedSiteContext, SitePage } from "../core/site-model.js";
import type { SiteConfig } from "../renderer/context.js";
import { slugify } from "../utils/slug.js";
import { operationAnchor, definitionAnchor, referenceOperation } from "../core/reference-identity.js";
import { generateCodeSamples } from "../utils/code-samples.js";
import { toPublicUrl } from "../site-url.js";
import { fencedCode } from "./markdown.js";
import { rewriteMarkdownDestinations } from "../utils/markdown-links.js";

import type { DocumentationEntry } from "./document-index.js";
export type { DocumentationEntry, DocumentationIndex } from "./document-index.js";

// Projection only: source pages and the complete readable-URL mapping own it.
const readableLinks = new WeakMap<object, { key: string; input: string; content: string }>();

export interface ReadableDocument {
  entry: Pick<DocumentationEntry, "id" | "kind" | "title" | "description" | "tab" | "url" | "markdown" | "file"> & Partial<DocumentationEntry>;
  content: string;
  /** Child operations and schemas already occur in their parent page. */
  aggregate: boolean;
}

export function markdownPath(outputPath: string): string {
  return outputPath.replace(/\.html$/, ".md");
}

/** The directory a version's or language's own documents.json and llms.txt index. */
export function exportRoot(context: ResolvedSiteContext): string {
  if (context.isDefaultVersion) return context.localePath;
  return context.scope.startsWith("tab:") ? context.tabs[0].slug : context.prefix;
}

/**
 * A page's Markdown view sits beside it. The home of a version or language
 * sits beside its directory (`archive.html`), so its view goes inside
 * (`archive/index.md`), where that version's own index can list it.
 */
export function pageMarkdownPath(page: Pick<SitePage, "outputPath" | "context">): string {
  const root = page.context && exportRoot(page.context);
  return root && page.outputPath === `${root}.html` ? `${root}/index.md` : markdownPath(page.outputPath);
}

function detailRoot(outputPath: string): string {
  return outputPath.replace(/(?:\/index)?\.html$/, "");
}

export function schemaMarkdownPath(outputPath: string, name: string): string {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 10);
  return `${detailRoot(outputPath)}/schemas/${slugify(name) || "schema"}-${digest}.md`;
}

export function operationMarkdownPath(outputPath: string, operation: NormalizedOperation, spec: NormalizedSpec): string {
  return `${detailRoot(outputPath)}/operations/${operationAnchor(operation, spec)}.md`;
}

export function operationName(operation: NormalizedOperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

export function collectReadableDocuments(pages: SitePage[], site: SiteConfig): ReadableDocument[] {
  const documents: ReadableDocument[] = [];
  const sources = new Map<string, object>();
  const publicUrl = (file: string) =>
    toPublicUrl(file, site.siteUrl, site.baseUrl, site.prettyUrls);
  for (const page of pages) {
    if (page.status === 404 || page.currentPage.kind === "not-found") continue;
    const file = pageMarkdownPath(page);
    const metadata = pageMetadata(page.currentPage, site);
    const contextMetadata = { locale: page.context.locale, contentLocale: page.contentLocale,
      contentVersion: page.context.version.id, versionScope: page.context.scope };
    let body: string;
    const children: ReadableDocument[] = [];
    let symbols: DocumentationEntry["symbols"];
    if (page.currentPage.kind === "markdown") {
      const doc = page.currentPage.markdown;
      sources.set(file, doc);
      body = doc.markdown;
      symbols = doc.searchEntries?.map((entry) => ({
        name: entry.qualifiedName || entry.title,
        anchor: entry.anchor,
        kind: entry.symbolKind || entry.category,
      }));
    } else if (page.currentPage.kind === "changelog") {
      const doc = page.currentPage.changelog;
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
      const view = page.currentPage.view;
      // A page of its own links a model where the routes publish it: its own page, or its section of another.
      const published = (name: string) => {
        const target = page.referenceTargets?.schemas[name];
        return target ? publicUrl(target.anchor ? schemaMarkdownPath(target.outputPath, name) : markdownPath(target.outputPath)) : undefined;
      };
      if (view?.kind === "operation") {
        const operation = referenceOperation(spec, view.id);
        sources.set(file, operation);
        documents.push({ entry: { ...contextMetadata, id: file, documentId: page.identity.document, kind: "operation", searchText: referenceSearchText(operation), title: metadata.title, description: metadata.description, tab: page.tabSlug, url: publicUrl(page.outputPath), markdown: publicUrl(file), file }, content: operationMarkdown(operation, spec, site, published), aggregate: true });
        continue;
      }
      if (view?.kind === "schema") {
        const schema = spec.schemas[view.name];
        sources.set(file, schema);
        documents.push({ entry: { ...contextMetadata, id: file, documentId: page.identity.document, kind: "schema", searchText: referenceSearchText(schema), title: metadata.title, description: metadata.description, tab: page.tabSlug, url: publicUrl(page.outputPath), markdown: publicUrl(file), file }, content: `# ${view.name}\n\n${schemaMarkdown(schema, new Set(), published)}`, aggregate: true });
        continue;
      }
      const reference = (name: string) =>
        spec.schemas[name] ? publicUrl(schemaMarkdownPath(page.outputPath, name)) : undefined;
      for (const operation of view?.kind === "overview" ? [] : spec.operations) {
        if (operation.hidden) continue;
        const operationFile = operationMarkdownPath(page.outputPath, operation, spec);
        const operationMetadata = pageMetadata({ kind: "spec", spec, view: { kind: "operation", id: operationName(operation) } }, site);
        sources.set(operationFile, operation);
        children.push({
          entry: {
            ...contextMetadata,
            id: operationFile,
            documentId: operationName(operation),
            kind: "operation",
            title: operationMetadata.title,
            searchText: referenceSearchText(operation),
            description: operationMetadata.description,
            tab: page.tabSlug,
            url: `${publicUrl(page.outputPath)}#${operationAnchor(operation, spec)}`,
            markdown: publicUrl(operationFile),
            file: operationFile,
          },
          content: operationMarkdown(operation, spec, site, reference),
          aggregate: false,
        });
      }
      for (const [name, schema] of view?.kind === "overview" ? [] : Object.entries(spec.schemas)) {
        const schemaFile = schemaMarkdownPath(page.outputPath, name);
        const schemaMetadata = pageMetadata({ kind: "spec", spec, view: { kind: "schema", name } }, site);
        sources.set(schemaFile, schema);
        children.push({
          entry: {
            ...contextMetadata,
            id: schemaFile,
            kind: "schema",
            title: name,
            searchText: referenceSearchText(schema),
            description: schemaMetadata.description,
            tab: page.tabSlug,
            url: `${publicUrl(page.outputPath)}#${definitionAnchor(name, spec)}`,
            markdown: publicUrl(schemaFile),
            file: schemaFile,
          },
          content: `# ${name}\n\n${schemaMarkdown(schema, new Set(), reference)}`,
          aggregate: false,
        });
      }
      body = [
        spec.info.summary || spec.info.description,
        spec.info.version ? `Version: ${spec.info.version}` : "",
        securityMarkdown(spec),
        ...children.map((child) => child.content.replace(/^# /, "## ")),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    const title = metadata.title;
    const hasTitle = body.trimStart().split("\n", 1)[0].replace(/\s+\{#[^}]+\}$/, "") === `# ${title}`;
    const content = `${hasTitle ? "" : `# ${title}\n\n`}${body.trim()}\n`;
    documents.push(
      {
        entry: {
          id: file,
          documentId: page.identity.document,
          ...contextMetadata,
          kind: "page",
          searchText: page.currentPage.kind === "spec" ? referenceOverviewSearchText(page.currentPage.spec) : body,
          title,
          description: metadata.description,
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
  const owners = new Map(pages.map(page => [page.tabSlug, page]));
  const equivalents = new Map<string, ReadableDocument[]>();
  for (const document of documents) {
    const owner = owners.get(document.entry.tab);
    if (!owner?.context) continue;
    document.entry.documentId ??= document.entry.kind === "schema" ? `schema:${document.entry.title}` : document.entry.title;
    const key = JSON.stringify([owner.identity.tab, document.entry.kind, document.entry.documentId, document.entry.versionScope, document.entry.contentVersion]);
    const group = equivalents.get(key) ?? []; group.push(document); equivalents.set(key, group);
  }
  for (const group of equivalents.values()) for (const document of group) document.entry.alternates = group.filter(other => other.entry.contentLocale === other.entry.locale).map(other => ({ locale: other.entry.locale!, contentVersion: other.entry.contentVersion, url: other.entry.url, markdown: other.entry.markdown }));
  const files = new Set<string>();
  const readableUrls = new Map(
    documents
      .filter((document) => !new URL(document.entry.url, "https://sourcey.invalid").hash)
      .map((document) => [
        new URL(document.entry.url, "https://sourcey.invalid").href,
        { markdown: document.entry.markdown, fragments: document.entry.kind === "page" },
      ]),
  );
  const linkKey = createHash("sha256").update(JSON.stringify([...readableUrls])).digest("hex");
  for (const document of documents) {
    if (files.has(document.entry.file))
      throw new Error(`Duplicate documentation export: ${document.entry.file}`);
    files.add(document.entry.file);
    const source = sources.get(document.entry.file);
    const key = `${linkKey}:${document.entry.url}`;
    const previous = source && readableLinks.get(source);
    if (previous?.key === key && previous.input === document.content) { document.content = previous.content; continue; }
    const input = document.content;
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
      const readable = readableUrls.get(target.href);
      return readable && (!hash || readable.fragments) ? `${readable.markdown}${query}${hash}` : href;
    });
    if (source) readableLinks.set(source, { key, input, content: document.content });
  }
  return documents;
}

export function operationMarkdown(
  operation: NormalizedOperation,
  spec: NormalizedSpec,
  site: SiteConfig,
  reference?: (name: string) => string | undefined,
): string {
  const docs = operation.externalDocs;
  const parts = [`# ${operation.summary || operationName(operation)}`, operation.summary ? `\`${operationName(operation)}\`` : undefined, operation.description, docs ? `[${docs.description?.trim() || docs.url}](${docs.url})` : undefined];
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
  const samples = operation.mcpExtras
    ? (operation.codeSamples ?? [])
    : generateCodeSamples(operation, spec.servers, site.codeSamples, spec.securitySchemes, spec.sourceUrl ?? site.siteUrl);
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
