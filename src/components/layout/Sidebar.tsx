import { useContext } from "preact/hooks";
import { renderToString } from "preact-render-to-string";
import { Breakable } from "../ui/Breakable.js";
import { NavigationContext, OptionsContext, PageContext, SiteContext } from "../../renderer/context.js";
import { changelogNavigation } from "../changelog/navigation.js";
import { SocialIcon, linkLabel } from "../ui/SocialIcon.js";
import { PrimaryAction } from "../ui/PrimaryAction.js";
import { Logo, logoHref } from "../ui/Logo.js";
import { holdsPage, isNavGroup, walkNavItems, type SiteNavGroup } from "../../core/navigation.js";
import { joinHref } from "../../site-url.js";
import { kindTells } from "../../core/reference-identity.js";
import { linkTarget } from "../../utils/html.js";
import { ContextNotice } from "./ContextControls.js";
import { MethodBadge } from "../ui/Badge.js";
import type { NavbarLink } from "../../config.js";

/**
 * Colored method indicator for API sidebar items.
 * HTTP methods render as their badges. MCP methods render as coloured dots.
 */
function MethodPill({ method }: { method: string }) {
  const m = method.toUpperCase();

  const dotColors: Record<string, string> = {
    TOOL: "bg-purple-500 dark:bg-purple-400",
    RESOURCE: "bg-green-500 dark:bg-green-400",
    PROMPT: "bg-blue-500 dark:bg-blue-400",
  };

  if (dotColors[m]) {
    return (
      <span class="flex items-center w-4 h-[1lh] shrink-0 justify-center">
        <span class={`w-1.5 h-1.5 rounded-full ${dotColors[m]}`} />
      </span>
    );
  }

  return (
    <span class="flex items-center w-8 h-[1lh] shrink-0">
      <MethodBadge method={method} short />
    </span>
  );
}

/**
 * Shared nav group rendering used by both desktop sidebar and mobile drawer.
 * A group heads its list; one with a link of its own and no pages here (an
 * API tag whose operations are on another page) is a destination and reads as
 * a link, with any sections beneath it nested. Rows keep the list's rhythm;
 * only a headed list is set apart.
 */
function NavGroups({ groups, activePageSlug, base }: {
  groups: SiteNavGroup[];
  activePageSlug: string | null;
  base: string;
}) {
  const shown = groups.filter(leadsAnywhere);
  return <>{shown.map((group, index) => {
    const spacing = index === 0 ? undefined : flows(group) && flows(shown[index - 1]) ? "mt-px" : "mt-6 lg:mt-8";
    return holdsPage(group, activePageSlug)
      ? <div key={group.id ?? group.label} class={spacing}><NavGroup group={group} activePageSlug={activePageSlug} base={base} /></div>
      : <div key={group.id ?? group.label} class={spacing} dangerouslySetInnerHTML={{ __html: drawnAtRest(group, base) }} />;
  })}</>;
}

/**
 * A group as every page that is not in it draws it, drawn once: a site's
 * navigation is the same on each of its pages but around the current one.
 */
function drawnAtRest(group: SiteNavGroup, base: string): string {
  let drawn = atRest.get(group);
  if (!drawn) atRest.set(group, drawn = new Map());
  let html = drawn.get(base);
  if (html === undefined) drawn.set(base, html = renderToString(<NavGroup group={group} activePageSlug={null} base={base} />));
  return html;
}
const atRest = new WeakMap<SiteNavGroup, Map<string, string>>();

function NavGroup({ group, activePageSlug, base }: {
  group: SiteNavGroup;
  activePageSlug: string | null;
  base: string;
}) {
  const current = group.id === activePageSlug || group.page === activePageSlug;
  if (isDestination(group)) {
    const sections = group.items.filter(isNavGroup).filter(leadsAnywhere);
    return <>
      <a href={joinHref(base, group.href)} class={`nav-link${current ? " active" : ""}`} aria-current={current ? "location" : undefined}>
        <span class="flex-1 break-words [word-break:break-word]"><Breakable text={group.label} /></span>
      </a>
      {sections.length > 0 && <ul class="pl-3 mt-px space-y-px">{sections.map(section => (
        <li key={section.id ?? section.label}><NavGroup group={section} activePageSlug={activePageSlug} base={base} /></li>
      ))}</ul>}
    </>;
  }
  const label = group.href
    ? <a href={joinHref(base, group.href)} class={`nav-group-label nav-group-link${current ? " active" : ""}`}>{group.label}</a>
    : <span class="nav-group-label">{group.label}</span>;
  // A row sits on its siblings' edge and what opens beneath it moves one step in; a heading
  // within a list is set in, above the links it heads.
  const collapsible = isCollapsible(group);
  const methods = group.items.flatMap(item => !isNavGroup(item) && item.method ? [item.method] : []);
  const contents = <ul class={collapsible ? "pl-3 space-y-px" : "space-y-px"}>{group.items.map(item => isNavGroup(item)
    ? leadsAnywhere(item) && <li key={item.id ?? item.label} class={isRow(item) ? undefined : "pl-3 pt-3"}><NavGroup group={item} activePageSlug={activePageSlug} base={base} /></li>
    : <li key={item.id}><a href={joinHref(base, item.href)} class={`nav-link${item.id === activePageSlug ? " active" : ""}`}
        aria-current={item.id === activePageSlug ? (item.href.includes("#") ? "location" : "page") : undefined}>
        {item.method && kindTells(item.method, methods) && <MethodPill method={item.method} />}<span class="flex-1 break-words [word-break:break-word]"><Breakable text={item.label} /></span>
      </a></li>)}</ul>;
  // A group holding the page opens, its sections' own pages included, so the way to the page shows.
  const active = holdsPage(group, activePageSlug);
  if (!collapsible) return <>{group.label && label}{contents}</>;
  // A summary is a control of its own, so a section's own link sits beside its toggle, not inside it.
  if (group.href) return <div class="sourcey-nav-group-linked">{label}<details open={active || !group.collapsed} class="sourcey-nav-group"><summary aria-label={group.label} />{contents}</details></div>;
  return <details open={active || !group.collapsed} class="sourcey-nav-group"><summary>{label}</summary>{contents}</details>;
}

const hasPages = (group: SiteNavGroup) => !walkNavItems([group]).next().done;
/** A group with a link of its own, or anything beneath it to follow. */
const leadsAnywhere = (group: SiteNavGroup): boolean => !!group.href || hasPages(group) || group.items.some(item => isNavGroup(item) && leadsAnywhere(item));
const isDestination = (group: SiteNavGroup): group is SiteNavGroup & { href: string } => !!group.href && !hasPages(group);
const isCollapsible = (group: SiteNavGroup) => group.collapsed !== undefined && hasPages(group);
/** A navbar link in the mobile drawer: its network's icon, and its text. */
function DrawerLink({ link }: { link: NavbarLink }) {
  const site = useContext(SiteContext);
  return (
    <li>
      <a href={link.href} {...linkTarget(link.href, site.siteUrl)} class="flex items-center gap-2.5 min-h-11 text-[rgb(var(--color-gray-600))] hover:text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-400))] dark:hover:text-[rgb(var(--color-gray-200))]">
        <SocialIcon type={link.type} />
        <span>{linkLabel(link)}</span>
      </a>
    </li>
  );
}

/** A group drawn as one row of the list: a destination, or a section that opens in place. */
const isRow = (group: SiteNavGroup) => isDestination(group) || isCollapsible(group);
/** Rows and unheaded links read as one list; only a headed list is set apart. */
const flows = (group: SiteNavGroup) => isRow(group) || !group.label;

/**
 * Chevron icon for the group dropdown trigger.
 */
function DropdownChevron() {
  return (
    <svg class="drawer-dropdown-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Desktop sidebar (hidden on mobile) + mobile drawer (dialog element).
 */
export function Sidebar({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const nav = useContext(NavigationContext);
  const options = useContext(OptionsContext);
  const site = useContext(SiteContext);
  const page = useContext(PageContext);
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  // A page outside the documentation has no sidebar; its drawer lists the sections.
  if (!activeTab && !mobileOnly) return null;

  const base = options.assetBase;
  // The full-width theme pins the sidebar to the window's left edge.
  const wide = site.theme.name === "api-first";
  const { links } = site.navbar;
  const primaryAction = site.navbar.primary;
  const releases = changelogNavigation(page, nav);
  const groups = releases?.groups ?? activeTab?.groups ?? [];
  const activePageSlug = releases?.activeId ?? nav.activePageSlug;
  const home = logoHref(site, nav, base);

  return (
    <>
      <div id="sidebar" class={`sourcey-nav-host${wide ? " sourcey-nav-wide" : ""}${mobileOnly ? " sourcey-nav-mobile-only" : ""}`}>
      <dialog id="mobile-nav" class="mobile-nav-dialog sourcey-responsive-nav">
        {/* Drawer header: logo (hidden when no logo configured) */}
        {site.logo?.light && (
          <div class="lg:hidden px-4 py-4 border-b border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] shrink-0">
            <Logo href={home} logo={site.logo} name={site.name} height="h-6" />
          </div>
        )}

        {/* Tab dropdown — only when multiple tabs */}
        {activeTab && nav.tabs.length > 1 && (
          <div class="lg:hidden pt-5 px-4 shrink-0">
            <div class="drawer-dropdown">
              <button
                id="drawer-group-toggle"
                type="button"
                class="drawer-dropdown-trigger"
                aria-expanded="false"
              >
                <span class="drawer-dropdown-label">{activeTab.label}</span>
                <DropdownChevron />
              </button>
              <ul id="drawer-group-list" class="drawer-dropdown-list" style="display:none">
                {nav.tabs.map((tab) => (
                  <li key={tab.slug}>
                    <a
                      href={joinHref(base, tab.href)}
                      class={`drawer-dropdown-item${tab.slug === nav.activeTabSlug ? " active" : ""}`}
                    >
                      {tab.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Sidebar content for the active tab */}
        {/* The page carries the notice wherever this is a drawer rather than a rail. */}
        {!mobileOnly && <div class="sourcey-nav-context"><ContextNotice /></div>}
        {activeTab ? (
          <nav id="nav" class="sourcey-nav-scroll pt-5 pb-3 px-4 flex-1 overflow-y-auto" aria-label={activeTab.label} data-sourcey-sidebar-scroll data-sourcey-sidebar-tab={nav.activeTabSlug || "default"}>
            <NavGroups groups={groups} activePageSlug={activePageSlug} base={base} />
          </nav>
        ) : (
          <nav class="sourcey-nav-scroll pt-5 pb-3 px-4 flex-1 overflow-y-auto" aria-label={options.messages.sections}>
            <ul class="space-y-px">{nav.tabs.map(tab => (
              <li key={tab.slug}><a href={joinHref(base, tab.href)} class="nav-link"><span class="flex-1 break-words [word-break:break-word]">{tab.label}</span></a></li>
            ))}</ul>
          </nav>
        )}

        {/* Navbar links + CTA */}
        {(links.length > 0 || primaryAction) && (
          <div class="lg:hidden px-4 py-3 border-t border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] shrink-0">
            <ul>
              {links.map((link) => link.type === "menu" ? (
                // A menu's links stand under its label, as one group of the drawer's list.
                <li key={link.label}>
                  <span class="flex items-center min-h-11 text-xs font-medium text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">{link.label}</span>
                  <ul class="pl-3">{link.links.map((item) => <DrawerLink key={item.href} link={item} />)}</ul>
                </li>
              ) : <DrawerLink key={link.href} link={link} />)}
              {primaryAction && (
                <li class="pt-2">
                  <PrimaryAction {...primaryAction} block />
                </li>
              )}
            </ul>
          </div>
        )}
      </dialog>
      </div>
    </>
  );
}
