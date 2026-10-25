import type { CurrentPage } from "../core/site-model.js";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { App } from "../components/App.js";
import type { NormalizedSpec } from "../core/types.js";
import type { SiteNavigation } from "../core/navigation.js";
import type { RenderOptions, SiteConfig } from "./context.js";
import { pageMetadata } from "../core/page-metadata.js";
import { fillPageParts } from "../core/site-components.js";

/**
 * Render a page to a complete HTML string using Preact SSG.
 * All pages (spec or markdown) go through the same layout with full navigation.
 * If options.embeddable is true, returns the inner content without html/body wrapper.
 */
export function renderPage(
  spec: NormalizedSpec | undefined,
  options: RenderOptions,
  navigation: SiteNavigation,
  currentPage: CurrentPage,
  site: SiteConfig,
): string {
  const vnode = h(App, { spec, options, navigation, currentPage, site });
  let html = renderToString(vnode);
  if (site.pageParts) {
    html = fillPageParts(html, site.pageParts, () => ({
      title: pageMetadata(currentPage, site).title,
      url: options.pageUrl ?? "",
      lang: options.lang,
      notFound: options.notFound === true,
    }));
  }

  if (options.embeddable) {
    return html;
  }

  return `<!DOCTYPE html>\n${html}`;
}

