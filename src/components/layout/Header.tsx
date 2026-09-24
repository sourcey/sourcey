import { useContext } from "preact/hooks";
import { NavigationContext, OptionsContext, SiteContext } from "../../renderer/context.js";
import { SocialIcon, socialLabels } from "../ui/SocialIcon.js";
import { Logo } from "../ui/Logo.js";
import type { SiteNavigation } from "../../core/navigation.js";
import { joinHref } from "../../site-url.js";

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
 * Mobile breadcrumb bar below the logo row — shows group > page.
 */
function MobileBreadcrumbs({ nav }: { nav: SiteNavigation }) {
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  const activePage = activeTab?.groups
    .flatMap((g) => g.items)
    .find((item) => item.id === nav.activePageSlug);

  return (
    <div class="flex lg:hidden items-center h-14 px-5 text-sm overflow-hidden">
      <div class="flex items-center min-w-0 space-x-3 leading-6 whitespace-nowrap">
        {nav.tabs.length > 1 && activeTab && activePage?.label !== activeTab.label && (
          <div class="flex items-center space-x-3 shrink-0 text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
            <span>{activeTab.label}</span>
            <BreadcrumbChevron />
          </div>
        )}
        {activePage && (
          <span class="font-semibold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] truncate min-w-0">
            {activePage.label}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Site header.
 * Row 1 (h-16): logo, search (desktop), navbar links (desktop), theme toggle (desktop), search + hamburger (mobile)
 * Row 2 mobile (h-14): breadcrumbs (group > page)
 * Row 2 desktop (h-12): navigation tabs (when multiple tabs)
 */
export function Header() {
  const nav = useContext(NavigationContext);
  const options = useContext(OptionsContext);
  const site = useContext(SiteContext);

  const base = options.assetBase;
  const logoHref = site.logo?.href ?? joinHref(base, nav.tabs[0]?.href ?? "");

  return (
    <div id="navbar" class="z-30 fixed lg:sticky top-0 w-full">
      <div class="absolute w-full h-full flex-none border-b border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-300)/0.06)] bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))]" />

      <div class="max-w-[92rem] mx-auto relative">
        {/* Row 1: Logo + Search + Actions */}
        <div class="relative">
          <div class="flex items-center lg:px-12 h-16 min-w-0 mx-4 lg:mx-0">
            <div class="h-full relative flex-1 flex items-center gap-x-4 min-w-0 border-b border-[rgb(var(--color-gray-500)/0.08)] dark:border-[rgb(var(--color-gray-300)/0.08)]">
              {/* Logo */}
              <div class="flex-1 flex items-center gap-x-4">
                <Logo href={logoHref} logo={site.logo} name={site.name} />
              </div>

              {/* Search bar (desktop) */}
              <div class="relative hidden lg:flex items-center flex-1 z-20 gap-2">
                <button
                  id="search-open"
                  type="button"
                  class="group flex pointer-events-auto rounded-lg w-full items-center text-sm leading-6 h-9 pl-3.5 pr-3 text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] ring-1 ring-[rgb(var(--color-gray-400)/0.3)] hover:ring-[rgb(var(--color-gray-600)/0.3)] dark:ring-[rgb(var(--color-gray-600)/0.3)] dark:hover:ring-[rgb(var(--color-gray-500)/0.3)] justify-between truncate gap-2 min-w-[43px] cursor-pointer bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))] dark:brightness-110 dark:hover:brightness-125"
                >
                  <div class="flex items-center gap-2 min-w-[42px]">
                    <SearchIcon />
                    <div class="truncate min-w-0">Type <kbd>/</kbd> to search</div>
                  </div>
                </button>
              </div>

              {/* Right actions (desktop): navbar links + CTA + theme toggle */}
              <div class="flex-1 relative hidden lg:flex items-center ml-auto justify-end space-x-4">
                <nav class="text-sm">
                  <ul class="flex space-x-6 items-center">
                    {site.navbar.links.map((link) => (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={link.label ?? socialLabels[link.type] ?? link.href}
                          class="text-[rgb(var(--color-gray-500))] hover:text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-400))] dark:hover:text-[rgb(var(--color-gray-300))]"
                        >
                          {link.type === "link"
                            ? (link.label ?? link.href)
                            : (<><SocialIcon type={link.type} />{link.label && <span class="ml-1">{link.label}</span>}</>)}
                        </a>
                      </li>
                    ))}
                    {site.navbar.primary && (
                      <li>
                        <a
                          href={site.navbar.primary.href}
                          target="_blank"
                          class="group px-4 py-1.5 relative inline-flex items-center text-sm font-medium"
                        >
                          <span class="absolute inset-0 bg-[rgb(var(--color-primary-dark))] rounded-lg group-hover:opacity-90" />
                          <div class="mr-0.5 space-x-2.5 flex items-center text-white">
                            <span class="z-10">{site.navbar.primary.label}</span>
                            <svg width="3" height="6" viewBox="0 0 3 6" class="overflow-visible opacity-90">
                              <path d="M0 0L3 3L0 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                            </svg>
                          </div>
                        </a>
                      </li>
                    )}
                  </ul>
                </nav>
                <button
                  id="theme-toggle"
                  type="button"
                  aria-label="Toggle theme"
                  class="p-2 flex items-center justify-center cursor-pointer text-[rgb(var(--color-gray-400))] hover:text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-500))] dark:hover:text-[rgb(var(--color-gray-300))]"
                >
                  <SunIcon />
                  <MoonIcon />
                </button>
              </div>

              {/* Mobile actions: search + hamburger */}
              <div class="flex lg:hidden items-center gap-3">
                <button id="search-open-mobile" type="button" aria-label="Search" class="text-[rgb(var(--color-gray-500))] w-8 h-8 flex items-center justify-center">
                  <SearchIcon />
                </button>
                <button type="button" data-drawer-slide="right" aria-label="Open menu" class="text-[rgb(var(--color-gray-500))] w-8 h-8 flex items-center justify-center hover:text-[rgb(var(--color-gray-600))]">
                  <svg class="h-4" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
                    <path d="M0 96C0 78.3 14.3 64 32 64H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile breadcrumb bar: group > page */}
        <MobileBreadcrumbs nav={nav} />

        {/* Desktop: Navigation tabs (hidden when single tab) */}
        {nav.tabs.length > 1 && (
        <div class="hidden lg:flex px-12 h-12">
          <div class="h-full flex text-sm gap-x-6">
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
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
