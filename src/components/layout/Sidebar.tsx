import { useContext } from "preact/hooks";
import { NavigationContext, OptionsContext, SiteContext } from "../../renderer/context.js";
import { SocialIcon, socialLabels } from "../ui/SocialIcon.js";
import { Logo } from "../ui/Logo.js";
import type { SiteNavGroup } from "../../core/navigation.js";

/**
 * Colored method indicator for API sidebar items.
 * HTTP methods render as text pills. MCP methods render as coloured dots.
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

  const label = m === "DELETE" ? "DEL" : m;

  const colors: Record<string, string> = {
    GET: "bg-green-100 dark:bg-green-400/20 text-green-800 dark:text-green-300",
    POST: "bg-blue-100 dark:bg-blue-400/20 text-blue-800 dark:text-blue-300",
    PUT: "bg-amber-100 dark:bg-yellow-400/20 text-amber-900 dark:text-yellow-300",
    DELETE: "bg-red-100 dark:bg-red-400/20 text-red-800 dark:text-red-300",
    DEL: "bg-red-100 dark:bg-red-400/20 text-red-800 dark:text-red-300",
    PATCH: "bg-orange-100 dark:bg-orange-400/20 text-orange-900 dark:text-orange-300",
  };

  return (
    <span class="flex items-center w-8 h-[1lh] shrink-0">
      <span class={`px-1 py-0.5 rounded-md text-[0.55rem] leading-tight font-bold ${colors[m] ?? "bg-gray-400/20 text-gray-700"}`}>
        {label}
      </span>
    </span>
  );
}

/**
 * Shared nav group rendering used by both desktop sidebar and mobile drawer.
 */
function NavGroups({ groups, activePageSlug, base }: {
  groups: SiteNavGroup[];
  activePageSlug: string | null;
  base: string;
}) {
  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.label} class={gi > 0 ? "mt-6 lg:mt-8" : ""}>
          {group.label && (group.href ? (
            <a
              href={`${base}${group.href}`}
              class={`nav-group-label nav-group-link${group.id === activePageSlug ? " active" : ""}`}
            >
              {group.label}
            </a>
          ) : (
            <h5 class="nav-group-label">{group.label}</h5>
          ))}
          <ul class="space-y-px">
            {group.items.map((item) => {
              const isActive = item.id === activePageSlug;
              return (
                <li key={item.id}>
                  <a
                    href={`${base}${item.href}`}
                    class={`nav-link${isActive ? " active" : ""}`}
                  >
                    {item.method && <MethodPill method={item.method} />}
                    <span class="flex-1 break-words [word-break:break-word]">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

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
export function Sidebar() {
  const nav = useContext(NavigationContext);
  const options = useContext(OptionsContext);
  const site = useContext(SiteContext);
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  if (!activeTab) return null;

  const base = options.assetBase;
  const { links } = site.navbar;
  const primaryAction = site.navbar.primary;
  const groups = activeTab.groups;
  const logoHref = site.logo?.href ?? `${base}${nav.tabs[0]?.href ?? ""}`;

  return (
    <>
      {/* Desktop sidebar — fixed, shows active tab only */}
      <div
        id="sidebar"
        class="z-20 hidden lg:block fixed bottom-0 right-auto w-[18rem]"
        style="top: var(--header-height)"
      >
        <div
          class="absolute inset-0 z-10 overflow-auto pr-8 pb-10"
          data-sourcey-sidebar-scroll
          data-sourcey-sidebar-tab={nav.activeTabSlug || "default"}
        >
          <div class="relative text-sm leading-6">
            <div class="sticky top-0 h-8 z-10 bg-gradient-to-b from-[rgb(var(--color-background-light))] dark:from-[rgb(var(--color-background-dark))]" />
            <nav id="nav" role="navigation">
              <NavGroups groups={groups} activePageSlug={nav.activePageSlug} base={base} />
            </nav>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      <dialog id="mobile-nav" class="mobile-nav-dialog">
        {/* Drawer header: logo (hidden when no logo configured) */}
        {site.logo?.light && (
          <div class="px-4 py-4 border-b border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] shrink-0">
            <Logo href={logoHref} logo={site.logo} height="h-6" />
          </div>
        )}

        {/* Tab dropdown — only when multiple tabs */}
        {nav.tabs.length > 1 && (
          <div class="pt-5 px-4 shrink-0">
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
                      href={`${base}${tab.href}`}
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
        <nav class="pt-5 pb-3 px-4 flex-1 overflow-y-auto">
          <NavGroups groups={groups} activePageSlug={nav.activePageSlug} base={base} />
        </nav>

        {/* Navbar links + CTA */}
        {(links.length > 0 || primaryAction) && (
          <div class="px-4 py-3 border-t border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] shrink-0">
            <ul class="space-y-3">
              {links.map((link) => {
                const label = link.label ?? socialLabels[link.type] ?? link.href;
                return (
                  <li key={link.href}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer" class="flex items-center gap-2.5 text-[rgb(var(--color-gray-600))] hover:text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-400))] dark:hover:text-[rgb(var(--color-gray-200))]">
                      {link.type !== "link" && <SocialIcon type={link.type} />}
                      <span>{label}</span>
                    </a>
                  </li>
                );
              })}
              {primaryAction && (
                <li>
                  <a href={primaryAction.href} target="_blank" class="group relative flex items-center justify-center px-4 py-2 text-sm font-medium">
                    <span class="absolute inset-0 bg-[rgb(var(--color-primary-dark))] rounded-lg group-hover:opacity-90" />
                    <span class="z-10 text-white">{primaryAction.label}</span>
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}
      </dialog>
    </>
  );
}
