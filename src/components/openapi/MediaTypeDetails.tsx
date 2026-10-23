import type { EncodingObject, MediaTypeContent, NormalizedParameter } from "../../core/types.js";
import { SchemaDatatype } from "../schema/SchemaDatatype.js";
import { Badge, DeprecatedBadge, RequiredBadge } from "../ui/Badge.js";
import { Breakable } from "../ui/Breakable.js";

interface MediaTypeDetailsProps {
  /** The media types this content is offered as: one, or several sharing a schema. */
  mediaTypes: readonly string[];
  content: MediaTypeContent;
  showLabel?: boolean;
}

export function MediaTypeDetails(
  { mediaTypes, content, showLabel = true }: MediaTypeDetailsProps,
) {
  const hasEncodings = hasEncodingDetails(content);
  if (!showLabel && !hasEncodings) return null;

  return (
    <div class={showLabel ? "mt-4" : ""}>
      {showLabel && (
        <div class="mb-3 flex flex-wrap items-center gap-2">
          {mediaTypes.map((mediaType, index) => (
            <code key={mediaType} class="whitespace-nowrap text-xs font-medium text-[rgb(var(--color-gray-800))] dark:text-[rgb(var(--color-gray-200))]">
              {index < mediaTypes.length - 1 ? `${mediaType},` : mediaType}
            </code>
          ))}
          {content.schema && (
            <span class="param-type">
              <SchemaDatatype schema={content.schema} />
            </span>
          )}
        </div>
      )}
      {hasEncodings && <EncodingDetails content={content} />}
    </div>
  );
}

export function firstContentSchema(
  content?: Record<string, MediaTypeContent>,
) {
  if (!content) return undefined;
  return Object.values(content).find((mediaType) => mediaType.schema)?.schema;
}

export function contentMediaTypes(content?: Record<string, MediaTypeContent>): string[] {
  return content ? Object.keys(content) : [];
}

export function hasEncodingDetails(content: MediaTypeContent): boolean {
  return Object.keys(content.encoding ?? {}).length > 0
    || (content.prefixEncoding?.length ?? 0) > 0
    || !!content.itemEncoding;
}

function EncodingDetails({ content }: { content: MediaTypeContent }) {
  const namedEntries = Object.entries(content.encoding ?? {});
  const positionalEntries = [
    ...(content.prefixEncoding ?? []).map((encoding, index) => ({
      name: `[${index}]`,
      encoding,
    })),
    ...(content.itemEncoding ? [{ name: "[n]", encoding: content.itemEncoding }] : []),
  ];

  if (!namedEntries.length && !positionalEntries.length) return null;

  return (
    <div class="mt-4">
      <div class="text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
        Encoding
      </div>

      {namedEntries.length > 0 && (
        <EncodingList
          className="params-list mt-2"
          entries={namedEntries.map(([name, encoding]) => ({ name, encoding }))}
        />
      )}

      {positionalEntries.length > 0 && (
        <div class={namedEntries.length > 0 ? "mt-4" : "mt-2"}>
          <div class="text-xs font-medium text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
            Ordered Parts
          </div>
          <EncodingList
            className="params-list mt-2"
            entries={positionalEntries}
          />
        </div>
      )}
    </div>
  );
}

function EncodingList(
  { entries, className = "params-list" }: {
    entries: { name: string; encoding: EncodingObject }[];
    className?: string;
  },
) {
  return (
    <div class={className}>
      {entries.map((entry) => (
        <EncodingItem key={entry.name} name={entry.name} encoding={entry.encoding} />
      ))}
    </div>
  );
}

function EncodingItem({ name, encoding }: { name: string; encoding: EncodingObject }) {
  const headerEntries = Object.entries(encoding.headers ?? {});
  const nestedEntries = [
    ...(encoding.prefixEncoding ?? []).map((entry, index) => ({
      name: `[${index}]`,
      encoding: entry,
    })),
    ...(encoding.itemEncoding ? [{ name: "[n]", encoding: encoding.itemEncoding }] : []),
  ];

  return (
    <div class="param-item">
      <div class="param-header">
        <code class="param-name"><Breakable text={name} /></code>
        {encoding.contentType && (
          <span class="param-type">
            <code class="text-xs font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">
              {encoding.contentType}
            </code>
          </span>
        )}
        {encoding.style && <Badge>style {encoding.style}</Badge>}
        {encoding.explode !== undefined && <Badge>explode {String(encoding.explode)}</Badge>}
        {encoding.allowReserved !== undefined && (
          <Badge>allowReserved {String(encoding.allowReserved)}</Badge>
        )}
      </div>

      {headerEntries.length > 0 && (
        <div class="mt-3">
          <div class="text-xs font-medium text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
            Headers
          </div>
          <div class="params-list mt-2">
            {headerEntries.map(([headerName, header]) => (
              <EncodingHeader key={headerName} name={headerName} header={header} />
            ))}
          </div>
        </div>
      )}

      {nestedEntries.length > 0 && (
        <div class="mt-3">
          <div class="text-xs font-medium text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
            Nested Encoding
          </div>
          <EncodingList className="params-list mt-2" entries={nestedEntries} />
        </div>
      )}
    </div>
  );
}

function EncodingHeader({ name, header }: { name: string; header: NormalizedParameter }) {
  const schema = header.schema ?? firstContentSchema(header.content);
  const mediaTypes = contentMediaTypes(header.content);

  return (
    <div class="param-item">
      <div class="param-header">
        <code class="param-name"><Breakable text={name} /></code>
        {schema && (
          <span class="param-type">
            <SchemaDatatype schema={schema} />
          </span>
        )}
        {mediaTypes.length > 0 && (
          <span class="param-type">
            <code class="text-xs font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">
              {mediaTypes.join(", ")}
            </code>
          </span>
        )}
        {header.required && <RequiredBadge />}
        {header.deprecated && <DeprecatedBadge />}
      </div>
      {header.description && (
        <div class="param-description">
          {header.description}
        </div>
      )}
    </div>
  );
}
