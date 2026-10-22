import { COPY_ICON_PATH_1, COPY_ICON_PATH_2 } from "../../utils/copy-svg.js";
import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";

/**
 * Copy-to-clipboard button with hover tooltip.
 * Sits inside code block headers; actual copy logic is in client JS.
 */
export function CopyButton() {
  const { messages } = useContext(OptionsContext);
  return (
    <div class="relative z-10 select-none">
      <button
        aria-label={messages.copyCode}
        class="copy-btn peer group/copy flex size-[26px] items-center justify-center rounded-md backdrop-blur"
        type="button"
        data-copy-source="code"
        data-copy-label={messages.copy}
        data-copied-label={messages.copied}
      >
        <svg
          class="size-4 text-[rgb(var(--color-stone-400))] group-hover/copy:text-[rgb(var(--color-stone-500))] dark:text-[rgb(255_255_255/0.4)] dark:group-hover/copy:text-[rgb(255_255_255/0.6)]"
          fill="none"
          height="18"
          viewBox="0 0 18 18"
          width="18"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{messages.copy}</title>
          <path
            d={COPY_ICON_PATH_1}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={COPY_ICON_PATH_2}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        aria-hidden="true"
        class="copy-tooltip absolute top-[2.75rem] left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[rgb(var(--color-primary-dark))] px-1.5 py-0.5 text-white text-xs opacity-0 peer-hover:opacity-100 transition-opacity pointer-events-none"
      >
        {messages.copy}
      </div>
    </div>
  );
}
