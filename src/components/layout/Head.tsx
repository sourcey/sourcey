import { useContext } from "preact/hooks";
import {
  SpecContext,
  OptionsContext,
  PageContext,
  SiteContext,
  NavigationContext,
} from "../../renderer/context.js";
import { shadedNeutrals } from "../../utils/palette.js";
import { hasContextChoices } from "./ContextControls.js";
import pkg from "../../../package.json" with { type: "json" };
import { pageMetadata } from "../../core/page-metadata.js";
import { breadcrumbList, structuredDataJson } from "../../core/breadcrumbs.js";
import { isAbsoluteHttpUrl } from "../../site-url.js";

/**
 * The weights the themes set. Google serves each from a variable family's one file, or the
 * static weights a family has, and skips the rest; a range fails unless it is the family's
 * exact axis (Poppins, Lato and Roboto Mono all refuse 100..900).
 */
export const GOOGLE_FONT_WEIGHTS = "400;500;550;600;650;700;750";

export function Head() {
  const site = useContext(SiteContext);
  const spec = useContext(SpecContext);
  const options = useContext(OptionsContext);
  const page = useContext(PageContext);
  const nav = useContext(NavigationContext);
  const metadata = pageMetadata(page, site, spec?.operations.some(operation => operation.mcpExtras)
    ? nav.tabs.find(tab => tab.slug === nav.activeTabSlug)?.label
    : undefined);
  const { browserTitle: pageTitle, description: pageDescription, siteName } = metadata;
  const breadcrumbs = !options.noindex && page.kind !== "not-found"
    ? breadcrumbList(nav, metadata.title, options.pageUrl, site.baseUrl)
    : undefined;
  // A canonical address and language alternates name pages by their absolute URLs, which only a
  // site that knows its origin has; and a page in one language has no alternate to name.
  const canonical = options.pageUrl && isAbsoluteHttpUrl(options.pageUrl) ? options.pageUrl : undefined;
  const languages = options.equivalents?.filter(e => e.kind === "locale" && e.lang && isAbsoluteHttpUrl(e.href)) ?? [];

  const { colors, fonts, layout } = site.theme;
  // A page's diagrams are set in Inter, loaded alongside the theme's families where the site loads them from Google.
  const googleFonts = fonts.google.length > 0 ? [...new Set([...fonts.google, ...(options.contentFonts ?? [])])] : [];
  // Desktop: h-16 row + h-12 tabs (when multi-tab) = 7rem, or h-16 alone = 4rem.
  // Mobile: h-16 row + h-14 breadcrumb = 7.5rem (always).
  const headerHeight = nav.tabs.length > 1 || hasContextChoices(options.equivalents) ? "7rem" : "4rem";
  const headerHeightMobile = "7.5rem";
  // The full-width theme shades its neutrals from the primary colour. They sit
  // with the other config tokens, so a site's custom CSS can still set them.
  const shades = site.theme.name === "api-first" ? shadedNeutrals(colors.primary) : undefined;
  const shadeTokens = shades
    ? Object.entries(shades.gray)
        .map(([step, rgb]) => `--color-gray-${step}: ${rgb};`)
        .join("\n      ")
    : "";

  const themeCSS = `
    :root {
      --color-primary: ${colors.primary};
      --color-primary-light: ${colors.light};
      --color-primary-dark: ${colors.dark};
      --color-primary-ink: ${colors.dark};
      --color-background-light: 255 255 255;
      --color-background-dark: ${shades?.backgroundDark ?? "11 12 16"};
      ${shadeTokens}
      --font-sans: ${fonts.sans};
      --font-mono: ${fonts.mono};
      --sidebar-width: ${layout.sidebar};
      --toc-width: ${layout.toc};
      --content-max-width: ${layout.content};
      --header-height: ${headerHeightMobile};
    }
    html:has(#navbar) { scroll-padding-top: var(--header-height); }
    @media (min-width: 1024px) {
      :root { --header-height: ${headerHeight}; }
    }
    body { margin: 0; background: rgb(var(--color-background-light)); }
    .dark body { background: rgb(var(--color-background-dark)); }
  `;

  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{pageTitle}</title>
      <meta name="description" content={pageDescription} />
      {breadcrumbs && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredDataJson(breadcrumbs) }} />}
      {options.noindex && <meta name="robots" content="noindex,follow" />}
      {languages.length > 1 && languages.map(e => <link rel="alternate" hrefLang={e.lang} href={e.href} />)}
      <meta name="generator" content={`Sourcey ${pkg.version}`} />
      {canonical && <link rel="canonical" href={canonical} />}
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDescription} />
      <meta property="og:type" content="website" />
      {siteName && <meta property="og:site_name" content={siteName} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {options.ogImageUrl && <meta property="og:image" content={options.ogImageUrl} />}
      {options.ogImageUrl && <meta property="og:image:width" content="1200" />}
      {options.ogImageUrl && <meta property="og:image:height" content="630" />}
      {options.ogImageUrl && <meta property="og:image:type" content="image/png" />}
      <meta name="twitter:card" content={options.ogImageUrl ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDescription} />
      {options.ogImageUrl && <meta name="twitter:image" content={options.ogImageUrl} />}
      <meta name="sourcey-assets" content={options.assetBase || "./"} />
      {options.componentStyles?.map(path => <link rel="stylesheet" href={`${options.assetBase}${path}`} />)}
      <meta name="sourcey-search-indexes" content={JSON.stringify(options.searchIndexes ?? [])} />
      {options.assets && <meta name="sourcey-search-module" content={options.assets.search} />}
      {options.alternateLinks?.map((link) => (
        <link
          key={`${link.type}-${link.href}`}
          rel={link.rel ?? "alternate"}
          type={link.type}
          href={link.href}
          title={link.title}
        />
      ))}
      {googleFonts.length > 0 && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
          {/* One stylesheet per family, so a family Google lacks cannot stop the other loading. */}
          {googleFonts.map(family => (
            <link key={family} rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${GOOGLE_FONT_WEIGHTS}&display=swap`} />
          ))}
        </>
      )}
      <style dangerouslySetInnerHTML={{ __html: themeCSS }} />
      {options.assets && <script src={options.assets.theme} data-default={site.theme.appearance?.default ?? "system"} data-storage-key={site.theme.appearance?.storageKey ?? "sourcey-theme"} />}
      {options.assets?.styles.map(href => <link rel="stylesheet" href={href} />)}
      {page.kind === "spec" && options.assets && <link rel="stylesheet" href={options.assets.languageIcons} />}
      {site.customCSS && <style dangerouslySetInnerHTML={{ __html: site.customCSS }} />}
      {site.favicon && <link rel="icon" href={site.favicon} />}
    </head>
  );
}
