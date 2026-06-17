import type { NormalizedSchema } from "../../core/types.js";
import type { ExampleVariant } from "../../utils/example-variants.js";
import { variantFromSchema } from "../../utils/example-variants.js";
import { CopyButton } from "../ui/CopyButton.js";

const BODY_WRAP =
  "relative w-full px-4 py-3.5 text-sm leading-6 bg-[rgb(var(--color-code-block-light))] dark:bg-[rgb(var(--color-code-block-dark))] overflow-x-auto";
const BODY_CODE = "font-mono whitespace-pre text-xs leading-[1.35rem]";

/** Render one example body (highlighted JSON or an external-example link). */
export function VariantBody({ variant, showCopy }: { variant: ExampleVariant; showCopy?: boolean }) {
  return (
    <div class={BODY_WRAP} style="font-variant-ligatures: none">
      {showCopy && (
        <div class="absolute top-3 right-4 z-10">
          <CopyButton />
        </div>
      )}
      {variant.summary && (
        <p class="mb-2 text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
          {variant.summary}
        </p>
      )}
      {variant.externalValue ? (
        <p class="text-xs">
          <span class="text-[rgb(var(--color-gray-500))]">External example: </span>
          <a
            href={variant.externalValue}
            target="_blank"
            rel="noopener noreferrer"
            class="break-all text-[rgb(var(--color-primary))] hover:underline"
          >
            {variant.externalValue}
          </a>
        </p>
      ) : (
        <div class={BODY_CODE} dangerouslySetInnerHTML={{ __html: variant.html }} />
      )}
    </div>
  );
}

/**
 * Variant switcher reusing the code-sample language dropdown markup/JS, minus
 * the cross-group language sync (no `data-lang-sync`). Sits in the card header
 * to the left of the copy button, identical to the language select.
 */
export function VariantDropdown({ variants }: { variants: ExampleVariant[] }) {
  return (
    <div class="code-lang-dropdown relative">
      <button
        type="button"
        class="code-lang-trigger group relative my-1 mb-1.5 flex items-center whitespace-nowrap font-medium leading-6 outline-0 text-[rgb(var(--color-stone-500))] dark:text-[rgb(var(--color-stone-400))] cursor-pointer text-xs"
        aria-expanded="false"
        aria-haspopup="listbox"
      >
        <div class="z-10 flex items-center gap-1 rounded-lg px-1.5 group-hover:bg-[rgb(var(--color-stone-200)/0.5)] group-hover:text-[rgb(var(--color-primary))] dark:group-hover:bg-[rgb(var(--color-stone-700)/0.7)] dark:group-hover:text-[rgb(var(--color-primary-light))]">
          <span class="code-lang-label truncate">{variants[0].label}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="size-3.5 shrink-0">
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </div>
      </button>
      <div class="code-lang-menu hidden absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-[rgb(var(--color-stone-200))] dark:border-[rgb(255_255_255/0.1)] bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-stone-900))] shadow-lg py-1" role="listbox">
        {variants.map((v, i) => (
          <button
            key={i}
            role="option"
            aria-selected={i === 0 ? "true" : "false"}
            class={`code-lang-option w-full text-left px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 hover:bg-[rgb(var(--color-stone-100))] dark:hover:bg-[rgb(255_255_255/0.05)] ${i === 0 ? "text-[rgb(var(--color-primary))] dark:text-[rgb(var(--color-primary-light))]" : "text-[rgb(var(--color-stone-600))] dark:text-[rgb(var(--color-stone-400))]"}`}
            data-lang-index={String(i)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ExampleVariantsCardProps {
  variants: ExampleVariant[];
  title?: string;
}

/**
 * Standalone example card: a `.code-group` with an optional title, a variant
 * switcher when more than one example exists, and a copy button.
 */
export function ExampleVariantsCard({ variants, title }: ExampleVariantsCardProps) {
  if (!variants.length) return null;
  const multi = variants.length > 1;

  return (
    <div class="code-group not-prose">
      {(title || multi) && (
        <div class="relative flex items-center justify-between gap-2 px-3">
          <div class="flex min-w-0 items-center gap-1.5 font-medium text-xs leading-6 my-1 mb-1.5">
            {title && (
              <span class="truncate text-[rgb(var(--color-stone-950))] dark:text-[rgb(var(--color-stone-50))]">
                {title}
              </span>
            )}
          </div>
          <div class="flex shrink-0 items-center justify-end gap-1.5">
            {multi && <VariantDropdown variants={variants} />}
            <CopyButton />
          </div>
        </div>
      )}
      <div class="code-card-body">
        {multi ? (
          variants.map((v, i) => (
            <div
              key={i}
              class={`code-lang-panel${i === 0 ? " active" : ""}`}
              data-lang-panel={String(i)}
            >
              <VariantBody variant={v} />
            </div>
          ))
        ) : (
          <VariantBody variant={variants[0]} showCopy={!title} />
        )}
      </div>
    </div>
  );
}

interface ExampleViewProps {
  schema: NormalizedSchema;
  title?: string;
}

/**
 * Renders a schema-derived JSON example in a stone-themed code card.
 */
export function ExampleView({ schema, title }: ExampleViewProps) {
  const variant = variantFromSchema(schema, title ?? "Example");
  if (!variant) return null;
  return <ExampleVariantsCard variants={[variant]} title={title} />;
}
