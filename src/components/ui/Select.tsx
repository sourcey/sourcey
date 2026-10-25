import type { SelectHTMLAttributes } from "preact";

/** Native selection, with one theme-aware arrow and a shared control surface. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span class="sourcey-select-wrap">
      <select {...props} class={props.class ?? "sourcey-select"} />
      {!props.multiple && (!props.size || props.size === 1) && (
        <svg
          class="sourcey-select-caret"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
        </svg>
      )}
    </span>
  );
}
