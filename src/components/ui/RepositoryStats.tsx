import { useContext } from "preact/hooks";
import { OptionsContext, SiteContext } from "../../renderer/context.js";
import type { RepositoryStats as Stats } from "../../core/github-stats.js";
import type { UiMessages } from "../../core/messages.js";
import { iconSvg, nativeIcon } from "../../utils/icons.js";

/** A fork, drawn in the outline the icon sets draw in; Heroicons has none. */
const FORK = '<svg class="sourcey-repository-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><circle cx="7" cy="5" r="2"/><circle cx="17" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M7 7v2a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7M12 12v5"/></svg>';

function counts(lang: string) {
  return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 });
}

/** The link's name with its repository's numbers, as assistive technology reads it. */
export function repositoryLabel(label: string, stats: Stats, lang: string, messages: UiMessages): string {
  const count = counts(lang);
  return [label, stats.release, `${count.format(stats.stars)} ${messages.githubStars}`, `${count.format(stats.forks)} ${messages.githubForks}`].filter(Boolean).join(", ");
}

/** A repository's latest release, stars and forks, the counts in the page's language. */
export function RepositoryStats({ stats }: { stats: Stats }) {
  const site = useContext(SiteContext);
  const { lang } = useContext(OptionsContext);
  const count = counts(lang);
  const star = iconSvg(nativeIcon(site.theme.icons, "star"), { class: "sourcey-repository-icon" });
  return (
    <span class="sourcey-repository-stats" aria-hidden="true">
      {stats.release && <span>{stats.release}</span>}
      <span dangerouslySetInnerHTML={{ __html: `${star}${count.format(stats.stars)}` }} />
      <span dangerouslySetInnerHTML={{ __html: `${FORK}${count.format(stats.forks)}` }} />
    </span>
  );
}
