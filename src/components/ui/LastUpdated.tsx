import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";

/** When the page's file last changed, as its day in the page's language: a paragraph, or `inline` a span. */
export function LastUpdated({ class: className, inline = false }: { class?: string; inline?: boolean }) {
  const { updated, lang, messages } = useContext(OptionsContext);
  if (!updated) return null;
  const day = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(new Date(updated));
  const Tag = inline ? "span" : "p";
  return <Tag class={className}>{messages.lastUpdated} <time datetime={updated}>{day}</time></Tag>;
}
