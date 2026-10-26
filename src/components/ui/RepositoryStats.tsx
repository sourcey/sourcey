import { useContext } from "preact/hooks";
import { OptionsContext, SiteContext } from "../../renderer/context.js";
import type { RepositoryStats as Stats } from "../../core/github-stats.js";
import { iconSvg, nativeIcon } from "../../utils/icons.js";

/** A fork, drawn in the outline the icon sets draw in; Heroicons has none. */
const FORK = '<svg class="sourcey-repository-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><circle cx="7" cy="5" r="2"/><circle cx="17" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M7 7v2a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7M12 12v5"/></svg>';

/** One formatter per language, for every page in it. */
const formats = new Map<string, Intl.NumberFormat>();
function counts(lang: string): Intl.NumberFormat {
  let format = formats.get(lang);
  if (!format) formats.set(lang, (format = new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 })));
  return format;
}

/**
 * A repository's latest release, stars and forks, the counts in the page's
 * language, as the whole name of the link they sit in: "GitHub, v6.7.9, 25K
 * stars, 2.4K forks", where the words the marks stand for are read and not
 * shown, so every figure a reader sees is part of the name they can say.
 */
export function RepositoryStats({ label, stats }: { label: string; stats: Stats }) {
  const site = useContext(SiteContext);
  const { lang, messages } = useContext(OptionsContext);
  const count = counts(lang);
  const star = iconSvg(nativeIcon(site.theme.icons, "star"), { class: "sourcey-repository-icon" });
  return (
    <span class="sourcey-repository-stats">
      <span class="sr-only">{label}, </span>
      {stats.release && <><span>{stats.release}</span><span class="sr-only">, </span></>}
      <span dangerouslySetInnerHTML={{ __html: `${star}${count.format(stats.stars)}` }} />
      <span class="sr-only"> {messages.githubStars}, </span>
      <span dangerouslySetInnerHTML={{ __html: `${FORK}${count.format(stats.forks)}` }} />
      <span class="sr-only"> {messages.githubForks}</span>
    </span>
  );
}
