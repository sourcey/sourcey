import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";
export function SearchDialog() {
  const { messages } = useContext(OptionsContext);
  return (
    <dialog id="search-dialog" role="dialog" aria-label={messages.search} data-loading={messages.loading} data-error={messages.searchFailed} data-retry={messages.tryAgain} data-empty={messages.noResults}>
      <div class="search-dialog-inner">
        <div class="search-input-row">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="search-input-icon"
          >
            <path
              fill-rule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
              clip-rule="evenodd"
            />
          </svg>
          <input
            id="search-input"
            aria-label={messages.search}
            type="text"
            placeholder={messages.searchPlaceholder}
            autocomplete="off"
            spellcheck={false}
          />
        </div>
        <div id="search-results" aria-live="polite" />
        <div class="search-footer">
          <span class="search-footer-hint">
            <kbd>↑↓</kbd> {messages.navigate}
          </span>
          <span class="search-footer-hint">
            <kbd>↵</kbd> {messages.select}
          </span>
          <span class="search-footer-hint">
            <kbd>esc</kbd> {messages.close}
          </span>
        </div>
      </div>
    </dialog>
  );
}
