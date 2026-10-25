import { h, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { SiteContext } from "../../renderer/context.js";
import { PAGE_PART_TAG, type PagePartName } from "../../core/site-components.js";

/**
 * Where a site's own page part goes, drawn in once the page is drawn; without
 * one, what the theme draws there.
 */
export function PagePart({ name, children }: { name: PagePartName; children?: ComponentChildren }) {
  const site = useContext(SiteContext);
  return site.pageParts?.[name] ? h(PAGE_PART_TAG, { name }) : <>{children}</>;
}
