import { useContext } from "preact/hooks";
import { NavigationContext, OptionsContext, SiteContext } from "../../renderer/context.js";
import { pageTrail } from "../../core/breadcrumbs.js";
import { iconSvg, nativeIcon } from "../../utils/icons.js";
import { joinHref } from "../../site-url.js";
import { logoHref } from "./Logo.js";
import type { IconSet } from "../../config.js";

/** The home mark, drawn once for each icon set. */
const homes = new Map<IconSet, string>();
function home(icons: IconSet): string {
  let svg = homes.get(icons);
  if (!svg) homes.set(icons, (svg = iconSvg(nativeIcon(icons, "home"), { class: "sourcey-breadcrumbs-home" })));
  return svg;
}

/**
 * The way to the page: the site's home, then its tab and sections, each a link
 * where it has a page. Nothing, for a page in no section.
 */
export function Breadcrumbs({ class: className }: { class?: string }) {
  const site = useContext(SiteContext);
  const nav = useContext(NavigationContext);
  const { assetBase, messages } = useContext(OptionsContext);
  const trail = pageTrail(nav);
  if (!trail.length) return null;
  return (
    <nav class={`sourcey-breadcrumbs${className ? ` ${className}` : ""}`} aria-label={messages.breadcrumb}>
      <ol>
        <li>
          <a href={logoHref(site, nav, assetBase)} aria-label={site.name} dangerouslySetInnerHTML={{ __html: home(site.theme.icons) }} />
        </li>
        {trail.map((crumb) => (
          <li key={crumb.label}>{crumb.href ? <a href={joinHref(assetBase, crumb.href)}>{crumb.label}</a> : <span>{crumb.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}
