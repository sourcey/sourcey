import type { NormalizedRequestBody } from "../../core/types.js";
import { SchemaView } from "../schema/SchemaView.js";
import { ExampleVariantsCard } from "../schema/ExampleView.js";
import { Markdown } from "../ui/Markdown.js";
import { MediaTypeDetails } from "./MediaTypeDetails.js";
import { buildExampleVariants } from "../../utils/example-variants.js";

interface RequestBodyProps {
  body: NormalizedRequestBody;
}

/**
 * Request body content (rendered in the main content column).
 */
export function RequestBody({ body }: RequestBodyProps) {
  const mediaTypes = Object.entries(body.content);
  if (!mediaTypes.length) return null;

  return (
    <div>
      {body.description && (
        <div class="mb-4 text-sm text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-400))]">
          <Markdown content={body.description} />
        </div>
      )}
      {mediaTypes.map(([mediaType, content]) => (
        <div key={mediaType} class={mediaTypes.length > 1 ? "mt-8 first:mt-0" : ""}>
          <MediaTypeDetails
            mediaType={mediaType}
            content={content}
            showLabel={
              mediaTypes.length > 1
              || Object.keys(content.encoding ?? {}).length > 0
              || (content.prefixEncoding?.length ?? 0) > 0
              || !!content.itemEncoding
            }
          />
          {content.schema && <SchemaView schema={content.schema} />}
        </div>
      ))}
    </div>
  );
}

interface RequestBodyExampleProps {
  body: NormalizedRequestBody;
}

/**
 * Request body example (rendered in the sticky code panel).
 */
export function RequestBodyExample({ body }: RequestBodyExampleProps) {
  const variants = buildExampleVariants(body.content);
  if (!variants.length) return null;

  return <ExampleVariantsCard variants={variants} title="Request Body" />;
}
