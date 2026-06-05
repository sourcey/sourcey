import { createContext } from "preact";
import type { NormalizedSpec } from "../core/types.js";
import type { SiteNavigation } from "../core/navigation.js";
import type { ChangelogPage, MarkdownPage } from "../core/markdown-loader.js";
import type { NavbarLink, PrettyUrls, ResolvedChangelogConfig, ResolvedTheme } from "../config.js";

export interface AlternateLink {
  href: string;
  type: string;
  title?: string;
}

/**
 * Options that control rendering behavior.
 */
export interface RenderOptions {
  /** Whether to generate embeddable output (no html/body wrapper) */
  embeddable: boolean;
  /** Base URL for assets (CSS, JS) */
  assetBase: string;
  /** Canonical absolute URL for the current page, when configured. */
  pageUrl?: string;
  /** Public URL for the OG image for this page. */
  ogImageUrl?: string;
  /** Alternate link tags to emit for the current page. */
  alternateLinks?: AlternateLink[];
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
export type CurrentPage =
  | { kind: "spec"; spec: NormalizedSpec }
  | { kind: "markdown"; markdown: MarkdownPage }
  | { kind: "changelog"; changelog: ChangelogPage };

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
});

/**
 * Preact context for site-wide navigation.
 */
export const NavigationContext = createContext<SiteNavigation>(null as never);

/**
 * Preact context for the current page being rendered.
 */
export const PageContext = createContext<CurrentPage>(null as never);

/**
 * Site-wide config available to all layout components.
 */
export interface SiteConfig {
  name: string;
  titleSeparator: string;
  siteUrl?: string;
  baseUrl: string;
  prettyUrls: PrettyUrls;
  theme: ResolvedTheme;
  logo?: { light?: string; dark?: string; href?: string };
  favicon?: string;
  repo?: string;
  editBranch?: string;
  editBasePath?: string;
  codeSamples: string[];
  navbar: { links: NavbarLink[]; primary?: { type: "button"; label: string; href: string } };
  footer: { links: NavbarLink[] };
  customCSS?: string;
  changelog: ResolvedChangelogConfig;
}

export const SiteContext = createContext<SiteConfig>(null as never);
