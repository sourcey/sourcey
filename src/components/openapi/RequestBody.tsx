import { useContext } from "preact/hooks";
import type { NormalizedRequestBody } from "../../core/types.js";
import { OptionsContext } from "../../renderer/context.js";
import { SchemaView } from "../schema/SchemaView.js";
import { ExampleVariantsCard } from "../schema/ExampleView.js";
import { Markdown } from "../ui/Markdown.js";
import { MediaTypeDetails, hasEncodingDetails, mediaTypeGroups, sharedFieldAliases } from "./MediaTypeDetails.js";
import { buildExampleVariants } from "../../utils/example-variants.js";
import { referenceFieldPath } from "../../core/reference-identity.js";

interface RequestBodyProps {
  body: NormalizedRequestBody;
  anchorRoot?: string;
}

/**
 * Request body content (rendered in the main content column). Media types that
 * carry the same schema, with no encoding of their own, share one field list
 * labelled with each: a body sent as JSON or as a form reads once.
 */
export function RequestBody({ body, anchorRoot }: RequestBodyProps) {
  const options = useContext(OptionsContext);
  const groups = mediaTypeGroups(body.content);
  if (!groups.length) return null;

  return (
    <div>
      {body.description && (
        <div class="mb-4 text-sm text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-400))]">
          <Markdown content={body.description} class="prose-sm" />
        </div>
      )}
      {groups.map(({ mediaTypes, content }) => {
        const root = anchorRoot && referenceFieldPath(anchorRoot, mediaTypes[0]);
        const fields = content.schema && <SchemaView schema={content.schema} anchorRoot={root} usage="request" />;
        return (
          <div key={mediaTypes[0]} class={groups.length > 1 ? "mt-8 first:mt-0" : ""}>
            <MediaTypeDetails mediaTypes={mediaTypes} content={content} showLabel={mediaTypes.length > 1 || groups.length > 1 || hasEncodingDetails(content)} />
            {root && content.schema && mediaTypes.length > 1 ? (
              // Each other type's field anchors stay, on the rows they name.
              <OptionsContext.Provider value={{ ...options, anchorAliases: { ...options.anchorAliases, ...sharedFieldAliases(content.schema, root, mediaTypes.slice(1).map(type => referenceFieldPath(anchorRoot!, type)), "request") } }}>
                {fields}
              </OptionsContext.Provider>
            ) : fields}
          </div>
        );
      })}
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
  const variants = buildExampleVariants(body.content, "request");
  if (!variants.length) return null;

  return <ExampleVariantsCard variants={variants} title="Request Body" />;
}
