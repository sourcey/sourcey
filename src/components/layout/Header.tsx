import { walkNavItems } from "../../core/navigation.js";
import { useContext } from "preact/hooks";
import { NavigationContext, OptionsContext, PageContext, SiteContext } from "../../renderer/context.js";
import { SocialIcon, linkLabel } from "../ui/SocialIcon.js";
import { PrimaryAction } from "../ui/PrimaryAction.js";
import { Logo, logoHref } from "../ui/Logo.js";
import type { SiteNavigation } from "../../core/navigation.js";
import type { NavbarMenu } from "../../config.js";
import { joinHref } from "../../site-url.js";
import { linkTarget } from "../../utils/html.js";
import { ContextControls, hasContextChoices } from "./ContextControls.js";
import { PagePart } from "./PagePart.js";

function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="min-w-4 flex-none">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" class="h-4 w-4 block dark:hidden">
      <g strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1.11V2" />
        <path d="M12.87 3.13L12.24 3.76" />
        <path d="M14.89 8H14" />
        <path d="M12.87 12.87L12.24 12.24" />
        <path d="M8 14.89V14" />
        <path d="M3.13 12.87L3.76 12.24" />
        <path d="M1.11 8H2" />
        <path d="M3.13 3.13L3.76 3.76" />
        <circle cx="8" cy="8" r="3.78" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="h-4 w-4 hidden dark:block">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function BreadcrumbChevron() {
  return (
    <svg width="3" height="24" viewBox="0 -9 3 24" class="h-5 overflow-visible shrink-0">
      <path d="M0 0L3 3L0 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The current page in the mobile navigation row, after its tab where the site has several,
 * since a phone shows the tabs only in the drawer.
 */
function MobileBreadcrumbs({ nav }: { nav: SiteNavigation }) {
  const page = useContext(PageContext);
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  const activePage = (activeTab ? [...walkNavItems(activeTab.groups)] : []).find((item) => item.id === nav.activePageSlug);
  // A page the navigation does not list names itself; a reference's overview, its tab.
  const label = activePage?.label ?? (page.kind === "markdown" ? page.markdown.title : page.kind === "not-found" ? page.title : activeTab?.label);
  const tab = nav.tabs.length > 1 && activeTab && page.kind !== "not-found" && label !== activeTab.label ? activeTab.label : undefined;

  return (
    <div class="sourcey-mobile-trail">
      <div class="flex items-center min-w-0 space-x-3 leading-6 whitespace-nowrap">
        {tab && (
          <span class="flex items-center space-x-3 shrink-0 text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
            <span>{tab}</span>
            <BreadcrumbChevron />
          </span>
        )}
        {label && (
          <span class="font-semibold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] truncate min-w-0">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/** Links under one label, opening below it as the header's other menus do; one opens at a time. */
function HeaderMenu({ menu }: { menu: NavbarMenu }) {
  const site = useContext(SiteContext);
  return (
    <details class="sourcey-context-menu sourcey-header-menu" name="sourcey-header-menu">
      <summary class="sourcey-header-link text-[rgb(var(--color-gray-500))] hover:text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-400))] dark:hover:text-[rgb(var(--color-gray-300))]">
        <span>{menu.label}</span>
        <svg class="sourcey-context-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </summary>
      <ul aria-label={menu.label}>{menu.links.map((link) => (
        <li key={link.href}><a href={link.href} {...linkTarget(link.href, site.siteUrl)}>{linkLabel(link)}</a></li>
      ))}</ul>
    </details>
  );
}

/**
 * Site header.
 * Row 1 (h-16): logo, search (desktop), navbar links (desktop), theme toggle (desktop), search + hamburger (mobile)
 * Row 2: active page on mobile, section navigation on desktop, locale/version menus.
 */
export function Header() {
  const nav = useContext(NavigationContext);
  const options = useContext(OptionsContext);
  const site = useContext(SiteContext);
  if (site.pageParts?.Header) return <PagePart name="Header" />;
  const { messages } = options;

  const base = options.assetBase;
  const home = logoHref(site, nav, base);
  // Each row runs the window's width, so a theme can colour it edge to edge, and holds its
  // contents to the page's frame. The full-width theme's frame is the window.
  const framed = site.theme.name !== "api-first";

  return (
    <header id="navbar" class="z-30 fixed lg:sticky top-0 w-full">
      <div class="navbar-band absolute w-full h-full flex-none border-b border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-300)/0.06)] bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))]" />

      <div class="relative">
        {/* Row 1: Logo + Search + Actions */}
        <div class="sourcey-header-top relative">
          <div class={`sourcey-header-frame flex items-center h-16 min-w-0 mx-4 ${framed ? "max-w-[92rem] lg:mx-auto" : "lg:mx-0"}`}>
            <div
              class="sourcey-header-top-inner h-full relative flex-1 flex items-center gap-x-4 min-w-0"
            >
              {/* Logo */}
              <div class="sourcey-header-brand flex-1 flex items-center gap-x-4">
                <Logo href={home} logo={site.logo} name={site.name} />
              </div>

              {/* Search bar (desktop) */}
              <div class="sourcey-header-search relative hidden lg:flex items-center flex-1 z-20 gap-2">
                {/* Named by its visible placeholder, so a voice command that reads it reaches it. */}
                <button
                  id="search-open"
                  type="button"
                  aria-keyshortcuts="/"
                  class="sourcey-search-control group flex pointer-events-auto rounded-[var(--sourcey-control-radius)] w-full items-center text-sm leading-6 h-[var(--sourcey-control-height)] pl-3.5 pr-3 text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] ring-1 ring-[rgb(var(--color-gray-400)/0.3)] hover:ring-[rgb(var(--color-gray-600)/0.3)] dark:ring-[rgb(var(--color-gray-600)/0.3)] dark:hover:ring-[rgb(var(--color-gray-500)/0.3)] justify-between truncate gap-2 min-w-[43px] cursor-pointer bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))] dark:brightness-110 dark:hover:brightness-125"
                >
                  <div class="flex items-center gap-2 min-w-[42px]">
                    <SearchIcon />
                    <div class="truncate min-w-0">{messages.searchPlaceholder}</div>
                  </div>
                  <kbd aria-hidden="true">/</kbd>
                </button>
              </div>

              {/* The header's end: its links and actions, then appearance and mobile controls. A theme
                  can hold them in one column; otherwise they lay out as children of the row. */}
              <div class="sourcey-header-end contents">
                {/* Right actions (desktop): navbar links + CTA. Network links are icons in control-sized targets. */}
                <div class="sourcey-header-actions flex-1 relative hidden lg:flex items-center ml-auto justify-end">
                  {(site.navbar.links.length > 0 || site.navbar.primary) && <nav class="text-sm" aria-label={messages.siteLinks}>
                    <ul class="flex gap-x-1 items-center">
                      {site.navbar.links.map((link) => link.type === "menu" ? (
                        <li key={link.label}><HeaderMenu menu={link} /></li>
                      ) : (
                        <li key={link.href}>
                          <a
                            href={link.href}
                            {...linkTarget(link.href, site.siteUrl)}
                            aria-label={link.type === "link" ? undefined : linkLabel(link)}
                            class={`sourcey-header-link flex items-center justify-center h-8 whitespace-nowrap ${link.type === "link" ? "px-2" : "w-8"} text-[rgb(var(--color-gray-500))] hover:text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-400))] dark:hover:text-[rgb(var(--color-gray-300))]`}
                          >
                            {link.type === "link" ? linkLabel(link) : <SocialIcon type={link.type} />}
                          </a>
                        </li>
                      ))}
                      {site.navbar.primary && (
                        <li class="pl-2">
                          <PrimaryAction {...site.navbar.primary} />
                        </li>
                      )}
                    </ul>
                  </nav>}

                </div>

                {/* Shared appearance control and mobile navigation */}
                <div class="flex items-center gap-1 lg:gap-0">
                  <button id="search-open-mobile" type="button" aria-label={messages.search} class="text-[rgb(var(--color-gray-500))] w-11 h-11 lg:hidden flex items-center justify-center">
                    <SearchIcon />
                  </button>
                  <button
                    id="theme-toggle"
                    type="button"
                    aria-label={messages.dark}
                    data-light-label={messages.light}
                    data-dark-label={messages.dark}
                    class="w-11 h-11 lg:w-8 lg:h-8 p-2 flex items-center justify-center cursor-pointer text-[rgb(var(--color-gray-400))] hover:text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-500))] dark:hover:text-[rgb(var(--color-gray-300))]"
                  >
                    <SunIcon />
                    <MoonIcon />
                  </button>
                  <button type="button" data-drawer-slide="right" aria-label={messages.openMenu} class="text-[rgb(var(--color-gray-500))] w-11 h-11 lg:hidden flex items-center justify-center hover:text-[rgb(var(--color-gray-600))]">
                    <svg class="h-4" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
                      <path d="M0 96C0 78.3 14.3 64 32 64H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class={`sourcey-header-navigation${framed ? " max-w-[92rem] mx-auto" : ""}`} data-desktop={nav.tabs.length > 1 || hasContextChoices(options.equivalents)}>
          <MobileBreadcrumbs nav={nav} />
          {nav.tabs.length > 1 && <nav class="sourcey-section-tabs" aria-label={messages.sectionsNavigation}>
            {nav.tabs.map((tab) => {
              const isActive = tab.slug === nav.activeTabSlug;
              return (
                <a
                  key={tab.slug}
                  href={joinHref(base, tab.href)}
                  class={`group relative h-full gap-2 flex items-center font-medium cursor-pointer transition-colors ${
                    isActive
                      ? "text-[rgb(var(--color-gray-800))] dark:text-[rgb(var(--color-gray-200))] [text-shadow:-0.2px_0_0_currentColor,0.2px_0_0_currentColor]"
                      : "text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-400))] hover:text-[rgb(var(--color-gray-800))] dark:hover:text-[rgb(var(--color-gray-300))]"
                  }`}
                >
                  {tab.label}
                  {isActive ? (
                    <div class="absolute bottom-0 h-[1.5px] w-full left-0 bg-[rgb(var(--color-primary))] dark:bg-[rgb(var(--color-primary-light))]" />
                  ) : (
                    <div class="absolute bottom-0 h-[1.5px] w-full left-0 group-hover:bg-[rgb(var(--color-gray-200))] dark:group-hover:bg-[rgb(var(--color-gray-700))]" />
                  )}
                </a>
              );
            })}
          </nav>}
          <ContextControls />
        </div>
      </div>
    </header>
  );
}
