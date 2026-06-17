import type { NormalizedOperation } from "../../core/types.js";
import { generateCodeSamples } from "../../utils/code-samples.js";
import { highlightCode } from "../../utils/highlighter.js";
import { langIcon } from "../../utils/lang-icons.js";
import { CopyButton } from "../ui/CopyButton.js";

interface CodeSamplesProps {
  operation: NormalizedOperation;
  serverUrl: string;
  codeSampleLangs?: string[];
}

/**
 * Code samples in a stone-themed card with language dropdown and copy button.
 * Language dropdown and copy button for generated request examples.
 */
export function CodeSamplesExamples({ operation, serverUrl, codeSampleLangs }: CodeSamplesProps) {
  const samples = generateCodeSamples(operation, serverUrl, codeSampleLangs);
  if (!samples.length) return null;

  const title = operation.summary ?? `${operation.method.toUpperCase()} ${operation.path}`;

  return (
    <div class="code-group not-prose">
      {/* Header bar */}
      <div class="relative flex items-center justify-between gap-2 px-3">
        {/* Title */}
        <div class="flex min-w-0 items-center gap-1.5 font-medium text-xs leading-6 my-1 mb-1.5">
          <span class="truncate text-[rgb(var(--color-stone-950))] dark:text-[rgb(var(--color-stone-50))]">
            {title}
          </span>
        </div>
        {/* Language dropdown + copy */}
        <div class="flex shrink-0 items-center justify-end gap-1.5">
          <div class="code-lang-dropdown relative" data-lang-sync>
            <button
              type="button"
              class="code-lang-trigger group relative my-1 mb-1.5 flex items-center whitespace-nowrap font-medium leading-6 outline-0 text-[rgb(var(--color-stone-500))] dark:text-[rgb(var(--color-stone-400))] cursor-pointer text-xs"
              aria-expanded="false"
              aria-haspopup="listbox"
            >
              <div class="z-10 flex items-center gap-1 rounded-lg px-1.5 group-hover:bg-[rgb(var(--color-stone-200)/0.5)] group-hover:text-[rgb(var(--color-primary))] dark:group-hover:bg-[rgb(var(--color-stone-700)/0.7)] dark:group-hover:text-[rgb(var(--color-primary-light))]">
                <span class="code-lang-icon" dangerouslySetInnerHTML={{ __html: langIcon(samples[0].lang) }} />
                <span class="code-lang-label truncate">{samples[0].label ?? samples[0].lang}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="size-3.5 shrink-0">
                  <path d="m7 15 5 5 5-5" />
                  <path d="m7 9 5-5 5 5" />
                </svg>
              </div>
            </button>
            {/* Dropdown menu (hidden by default, toggled by JS) */}
            <div class="code-lang-menu hidden absolute right-0 top-full mt-1 z-20 min-w-[120px] rounded-lg border border-[rgb(var(--color-stone-200))] dark:border-[rgb(255_255_255/0.1)] bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-stone-900))] shadow-lg py-1" role="listbox">
              {samples.map((sample, i) => (
                <button
                  key={i}
                  role="option"
                  aria-selected={i === 0 ? "true" : "false"}
                  class={`code-lang-option w-full text-left px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 hover:bg-[rgb(var(--color-stone-100))] dark:hover:bg-[rgb(255_255_255/0.05)] ${i === 0 ? "text-[rgb(var(--color-primary))] dark:text-[rgb(var(--color-primary-light))]" : "text-[rgb(var(--color-stone-600))] dark:text-[rgb(var(--color-stone-400))]"}`}
                  data-lang-index={String(i)}
                >
                  <span dangerouslySetInnerHTML={{ __html: langIcon(sample.lang) }} />
                  {sample.label ?? sample.lang}
                </button>
              ))}
            </div>
          </div>
          <CopyButton />
        </div>
      </div>

      {/* Code panels */}
      <div class="code-card-body">
        {samples.map((sample, i) => {
          const html = highlightCode(sample.source, sample.lang);
          return (
            <div
              key={i}
              class={`code-lang-panel${i === 0 ? " active" : ""}`}
              data-lang-panel={String(i)}
            >
              <div class="relative w-full px-4 py-3.5 text-sm leading-6 bg-[rgb(var(--color-code-block-light))] dark:bg-[rgb(var(--color-code-block-dark))] overflow-x-auto" style="font-variant-ligatures: none">
                <div class="font-mono whitespace-pre text-xs leading-[1.35rem] code-block" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
