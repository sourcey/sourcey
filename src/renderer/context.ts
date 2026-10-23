import type { AlternateLink, EquivalentPageLink } from "../core/site-model.js";
import { createContext } from "preact";
import { english, type UiMessages } from "../core/messages.js";
import type { NormalizedSpec } from "../core/types.js";
import type { SiteNavigation } from "../core/navigation.js";
import type {
  NavbarEntry,
  NavbarLink,
  PrettyUrls,
  ResolvedChangelogConfig,
  ResolvedTheme,
  TryItConfig,
} from "../config.js";


/**
 * Options that control rendering behavior.
 */
/** The engine files a page links, as it addresses them (content-addressed in builds, source modules in dev). */
export interface RenderAssetPaths {
  styles: string[];
  /** The code-language icons, linked only by pages that draw code samples. */
  languageIcons: string;
  client: string;
  clientType?: "module";
  theme: string;
  search: string;
  tryIt?: string;
}

export interface RenderOptions {
  anchorAliases?: Record<string, string>;
  /** Whether to generate embeddable output (no html/body wrapper) */
  embeddable: boolean;
  /** Base URL for assets (CSS, JS) */
  assetBase: string;
  /** Engine assets resolved by the renderer or development transport. */
  assets?: RenderAssetPaths;
  /** Compiled canonical path, made absolute when an origin is configured. */
  pageUrl?: string;
  /** Public URL for the OG image for this page. */
  ogImageUrl?: string;
  /** Alternate link tags to emit for the current page. */
  alternateLinks?: AlternateLink[];
  /** The tag of the language the page's content is in, which the page declares: its own language's, or the default language's where it falls back. */
  lang: string;
  dir: "ltr" | "rtl";
  messages: UiMessages;
  noindex?: boolean;
  equivalents?: EquivalentPageLink[];
  notice?: string;
  searchIndexes?: string[];
  componentStyles?: string[];
  referenceTargets?: import("../core/site-model.js").ReferenceTargets;
  sourceRevision?: string;
}

/**
 * Full context available to all components during rendering.
 */
export interface RenderContext {
  spec: NormalizedSpec;
  options: RenderOptions;
}

/**
 * What the current page is rendering.
 */
import type { CurrentPage } from "../core/site-model.js";

/**
 * Preact context for passing spec data to deeply nested components.
 */
export const SpecContext = createContext<NormalizedSpec>(null as never);

/**
 * Preact context for render options.
 */
export const OptionsContext = createContext<RenderOptions>({
  embeddable: false,
  assetBase: "",
  lang: "en",
  dir: "ltr",
  messages: english,
});

/**
 * Preact context for site-wide navigation.
 */
export const NavigationContext = createContext<SiteNavigation>(null as never);

/**
 * Preact context for the current page being rendered.
 */
export const PageContext = createContext<CurrentPage>(null as never);

/** A reference page that holds one operation, titled by it, rather than a reference listing many. */
export function isOperationPage(page: CurrentPage): boolean {
  return page.kind === "spec" && page.view?.kind === "operation";
}

/**
 * Site-wide config available to all layout components.
 */
export interface SiteConfig {
  tryIt?: false | TryItConfig;
  name: string;
  titleSeparator: string;
  siteUrl?: string;
  baseUrl: string;
  prettyUrls: PrettyUrls;
  theme: ResolvedTheme;
  logo?: { light?: string; dark?: string; href?: string; mark?: boolean };
  favicon?: string;
  repo?: string;
  editBranch?: string;
  editBasePath?: string;
  codeSamples: string[];
  navbar: { links: NavbarEntry[]; primary?: { type: "button"; label: string; href: string } };
  footer: { text?: string; links: NavbarLink[] };
  customCSS?: string;
  changelog: ResolvedChangelogConfig;
  /** Typographer's quotes, dashes and ellipses in rendered prose. */
  smartypants?: boolean;
  /** The site root's address, when a page publishes there. */
  home?: string;
}

export const SiteContext = createContext<SiteConfig>(null as never);
