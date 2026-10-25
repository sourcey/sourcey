import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";

/** One formatter per language, for every page in it. */
const days = new Map<string, Intl.DateTimeFormat>();

/** When the page's file last changed, as its day in the page's language: a paragraph, or `inline` a span. */
export function LastUpdated({ class: className, inline = false }: { class?: string; inline?: boolean }) {
  const { updated, lang, messages } = useContext(OptionsContext);
  if (!updated) return null;
  let format = days.get(lang);
  if (!format) days.set(lang, (format = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" })));
  const Tag = inline ? "span" : "p";
  return <Tag class={className}>{messages.lastUpdated} <time datetime={updated}>{format.format(new Date(updated))}</time></Tag>;
}
