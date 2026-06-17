import type { NormalizedResponse } from "../../core/types.js";
import { httpStatusText } from "../../utils/http.js";
import { SchemaDatatype } from "../schema/SchemaDatatype.js";
import { ExampleVariantsCard, VariantBody, VariantDropdown } from "../schema/ExampleView.js";
import { Markdown } from "../ui/Markdown.js";
import { CopyButton } from "../ui/CopyButton.js";
import { buildExampleVariants } from "../../utils/example-variants.js";

interface ResponsesProps {
  responses: NormalizedResponse[];
}

function statusColorClass(code: string): string {
  if (code.startsWith("2")) return "bg-green-100 text-green-800 dark:bg-green-400/20 dark:text-green-300";
  if (code.startsWith("3")) return "bg-blue-100 text-blue-800 dark:bg-blue-400/20 dark:text-blue-300";
  if (code.startsWith("4")) return "bg-amber-100 text-amber-900 dark:bg-yellow-400/20 dark:text-yellow-300";
  if (code.startsWith("5")) return "bg-red-100 text-red-800 dark:bg-red-400/20 dark:text-red-300";
  return "bg-gray-400/20 text-gray-700 dark:text-gray-400";
}

/**
 * Response status list (rendered in the content column).
 */
export function ResponsesCopy({ responses }: ResponsesProps) {
  if (!responses.length) return null;

  return (
    <div class="params-list">
      {responses.map((r) => (
        <div key={r.statusCode} class="param-item">
          <div class="param-header font-mono text-sm">
            <span class={`px-1.5 py-0.5 rounded-md text-xs font-bold ${statusColorClass(r.statusCode)}`}>
              {r.statusCode}
            </span>
            <span class="font-medium text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">
              {httpStatusText(r.statusCode)}
            </span>
            {r.content && (
              <span class="param-type">
                {renderResponseType(r)}
              </span>
            )}
          </div>
          {(r.summary || r.description) && (
            <div class="param-description">
              {r.summary && (
                <p class="text-sm font-medium text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">
                  {r.summary}
                </p>
              )}
              {r.description && (
                <Markdown content={r.description} class="prose-sm" />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Response examples with status code tabs on the code block card.
 * Status code tabs are part of the code block header.
 */
export function ResponsesExamples({ responses }: ResponsesProps) {
  if (!responses.length) return null;

  const groups = responses
    .map((r) => ({ statusCode: r.statusCode, variants: buildExampleVariants(r.content) }))
    .filter((g) => g.variants.length > 0);

  if (!groups.length) return null;

  // Single status code: a standalone card, with a variant switcher when the
  // response carries more than one example (named examples / content types).
  if (groups.length === 1) {
    return <ExampleVariantsCard variants={groups[0].variants} title={groups[0].statusCode} />;
  }

  // Multiple status codes: status tabs on the left of the header; on the right,
  // a per-status variant switcher (shown for the active status) next to copy,
  // matching the language select. Panels live in the clipped card body.
  return (
    <div class="response-tabs code-group not-prose">
      {/* Header: status tabs + active-status variant switcher + copy */}
      <div class="relative flex items-center justify-between gap-2 px-3">
        <div class="response-tab-list flex gap-1 overflow-x-auto text-xs leading-6" role="tablist">
          {groups.map((g, i) => (
            <button
              key={g.statusCode}
              type="button"
              role="tab"
              aria-selected={i === 0 ? "true" : "false"}
              class={`response-tab group relative my-1 mb-1.5 flex items-center gap-1.5 whitespace-nowrap font-medium outline-0${i === 0 ? " active" : ""}`}
              data-response-index={String(i)}
            >
              <div class="z-10 flex items-center gap-1.5 rounded-lg px-1.5 group-hover:bg-[rgb(var(--color-stone-200)/0.5)] group-hover:text-[rgb(var(--color-primary))] dark:group-hover:bg-[rgb(var(--color-stone-700)/0.7)] dark:group-hover:text-[rgb(var(--color-primary-light))]">
                {g.statusCode}
              </div>
            </button>
          ))}
        </div>
        <div class="flex shrink-0 items-center justify-end gap-1.5">
          {groups.map((g, i) =>
            g.variants.length > 1 ? (
              <div
                key={g.statusCode}
                data-response-dropdown={String(i)}
                class={i === 0 ? undefined : "hidden"}
              >
                <VariantDropdown variants={g.variants} />
              </div>
            ) : null
          )}
          <CopyButton />
        </div>
      </div>

      {/* Code panels (one per status; a status with several examples nests its
          own variant panels switched by the header dropdown). */}
      <div class="code-card-body">
        {groups.map((g, i) => (
          <div
            key={g.statusCode}
            class={`response-panel${i === 0 ? " active" : ""}`}
            role="tabpanel"
            data-response-panel={String(i)}
          >
            {g.variants.length > 1 ? (
              g.variants.map((v, j) => (
                <div
                  key={j}
                  class={`code-lang-panel${j === 0 ? " active" : ""}`}
                  data-lang-panel={String(j)}
                >
                  <VariantBody variant={v} />
                </div>
              ))
            ) : (
              <VariantBody variant={g.variants[0]} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderResponseType(r: NormalizedResponse) {
  const schema = getResponseSchema(r);
  if (!schema) return null;
  return <SchemaDatatype schema={schema} />;
}

function getResponseSchema(r: NormalizedResponse) {
  if (!r.content) return null;
  const firstMedia = Object.values(r.content)[0];
  return firstMedia?.schema ?? null;
}
