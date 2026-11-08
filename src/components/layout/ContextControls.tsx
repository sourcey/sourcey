import { useContext } from "preact/hooks";
import { NavigationContext, OptionsContext, SiteContext } from "../../renderer/context.js";
import type { EquivalentPageLink } from "../../core/site-model.js";
import { NativeIcon } from "../ui/Icon.js";

export function hasContextChoices(choices: readonly EquivalentPageLink[] = []): boolean {
  return ["locale", "version"].some(kind => choices.filter(choice => choice.kind === kind).length > 1);
}

export function ContextControls() {
  const options = useContext(OptionsContext);
  const choices = options.equivalents ?? [];
  if (!hasContextChoices(choices)) return null;
  return (
    <div class="sourcey-context-controls">
      {(["locale", "version"] as const).map(kind => {
        const items = choices.filter(c => c.kind === kind);
        if (items.length <= 1) return null;
        const label = kind === "locale" ? options.messages.language : options.messages.version;
        return (
          <details class="sourcey-context-menu" name="sourcey-context">
            {/* Named "Version: v2" and so on: what it says, after what it chooses. */}
            <summary>
              {kind === "locale" && <NativeIcon meaning="language" size={17} class="sourcey-language-icon" />}
              <span class="sr-only">{label}: </span>
              <span>{items.find(item => item.active)?.label ?? label}</span>
              <svg class="sourcey-context-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </summary>
            <ul aria-label={label}>{items.map(item => <li><a href={item.href} lang={item.lang} data-sourcey-context-missing={item.missing && JSON.stringify(item.missing)} aria-current={item.active ? "page" : undefined}>{item.label}</a></li>)}</ul>
          </details>
        );
      })}
    </div>
  );
}

export function ContextNotice() {
  const { notice } = useContext(OptionsContext);
  return notice ? <aside class="sourcey-context-notice" role="note">{notice}</aside> : null;
}

/** The default and full-width themes list a tab's pages in a rail beside the page from 1024px. */
export function useSidebarRail(): boolean {
  const site = useContext(SiteContext);
  const nav = useContext(NavigationContext);
  return (site.theme.name === "default" || site.theme.name === "api-first") && nav.tabs.some((tab) => tab.slug === nav.activeTabSlug);
}

/**
 * A version's or language's notice is about the page, so it stands over the
 * page wherever no sidebar rail is on screen to carry it: on a phone, and in
 * a layout without a rail. The reader theme states it under its masthead.
 */
export function PageNotice({ rail = true }: { rail?: boolean }) {
  const { notice } = useContext(OptionsContext);
  const onRail = useSidebarRail() && rail;
  if (useContext(SiteContext).theme.name === "reader") return null;
  return notice ? <aside class="sourcey-context-notice sourcey-page-notice" role="note" data-rail={onRail || undefined}>{notice}</aside> : null;
}
