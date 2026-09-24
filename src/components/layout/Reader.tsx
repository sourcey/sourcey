import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import {
  NavigationContext,
  OptionsContext,
  PageContext,
  SiteContext,
} from "../../renderer/context.js";
import { SearchDialog } from "./SearchDialog.js";
import type { ReaderLink } from "../../config.js";
import { safeUrl } from "../../utils/html.js";

function Icon({ name = "arrow", size = 20 }: { name?: string; size?: number }) {
  const paths: Record<string, string[]> = {
    arrow: ["M4 12h15m-6-6 6 6-6 6"],
    chevron: ["m9 5 7 7-7 7"],
    northeast: ["M6 18 18 6M6 6h12v12"],
    menu: ["M4 7h16M4 12h16M4 17h16"],
    search: ["m21 21-5-5", "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"],
    layers: ["m12 3 10 6-10 6L2 9l10-6Zm-10 10 10 6 10-6m-20 4 10 6 10-6"],
    copy: ["M9 9h12v12H9zM15 5V2H2v13h3"],
    code: ["m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"],
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {(paths[name] ?? paths.arrow).map((path) => (
        <path d={path} />
      ))}
    </svg>
  );
}

function Link({
  link,
  children,
  className,
}: {
  link: ReaderLink;
  children?: ComponentChildren;
  className?: string;
}) {
  return (
    <a href={safeUrl(link.href) ?? undefined} class={className}>
      {children ?? link.label}
    </a>
  );
}

export function ReaderPage({ children }: { children?: ComponentChildren }) {
  const site = useContext(SiteContext);
  const nav = useContext(NavigationContext);
  const page = useContext(PageContext);
  const { assetBase: base } = useContext(OptionsContext);
  const settings = site.theme.reader ?? {};
  const document = settings.document;
  const tab = nav.tabs.find((item) => item.slug === nav.activeTabSlug);
  const items = tab?.groups.flatMap((group) => group.items) ?? [];
  const index = items.findIndex((item) => item.id === nav.activePageSlug);
  const previous = items[index - 1];
  const next = items[index + 1];
  const label = document?.label ?? tab?.label ?? site.name;
  const edition = [label, document?.version].filter(Boolean).join(" ");
  const href = (path: string) => `${base}${path}` || "./";
  const activeHref = href(items[index]?.href ?? tab?.href ?? "");
  const home = safeUrl(site.logo?.href ?? href(nav.tabs[0]?.href ?? "")) ?? "/";
  const searchHref = settings.searchHref ? safeUrl(settings.searchHref) : null;
  const before: ReaderLink | undefined = previous
    ? { label: previous.label, href: href(previous.href), description: "← Previous" }
    : settings.pagination?.before;
  const after: ReaderLink | undefined = next
    ? { label: next.label, href: href(next.href), description: "Next →" }
    : settings.pagination?.after;
  const isCurrent = (target: string) => {
    if (target.startsWith("/") && site.baseUrl) return site.baseUrl.startsWith(target);
    return target === activeHref;
  };
  const navigationLinks = site.navbar.links.map((link) => ({
    ...link,
    label: link.label ?? link.type,
  }));
  const docPage = page.kind === "markdown" ? page.markdown : null;
  const headings = docPage?.headings ?? (page.kind === "changelog" ? page.changelog.headings : []);

  return (
    <div class="sourcey-reader" id="page">
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="site-header">
        <div class="header-inner">
          <a class="home-link" href={home} aria-label={`${site.name} home`}>
            <span class="brand">
              {site.logo?.light && (
                <img
                  class={settings.logoMark ? "brand-mark" : "brand-logo"}
                  src={site.logo.light}
                  alt={settings.logoMark ? "" : site.name}
                />
              )}
              {(!site.logo?.light || settings.logoMark) && <span>{site.name}</span>}
            </span>
          </a>
          <nav class="desktop-nav" aria-label="Main navigation">
            {navigationLinks.map((link) => (
              <a
                key={link.href}
                href={safeUrl(link.href) ?? undefined}
                aria-current={isCurrent(link.href) ? "page" : undefined}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div class="header-actions">
            {searchHref ? (
              <a class="search-link" href={searchHref} aria-label="Search documentation">
                <Icon name="search" size={17} />
                <span>Search</span>
                <kbd>/</kbd>
              </a>
            ) : (
              <button
                class="search-link"
                id="search-open"
                aria-label="Search documentation"
                data-reader-enhancement
                hidden
              >
                <Icon name="search" size={17} />
                <span>Search</span>
                <kbd>/</kbd>
              </button>
            )}
            {site.navbar.primary && (
              <a class="header-cta" href={safeUrl(site.navbar.primary.href) ?? undefined}>
                {site.navbar.primary.label}
                <Icon size={15} />
              </a>
            )}
            <button
              class="menu-toggle"
              aria-label="Open navigation"
              aria-controls="reader-mobile-nav"
              aria-expanded="false"
              data-reader-enhancement
              hidden
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
        <nav id="reader-mobile-nav" aria-label="Mobile navigation" hidden>
          {navigationLinks.map((link) => (
            <Link key={link.href} link={link}>
              {link.label}
              <Icon />
            </Link>
          ))}
          {searchHref && (
            <a href={searchHref}>
              Search documentation
              <Icon name="search" />
            </a>
          )}
        </nav>
        <nav class="reader-mobile-fallback" aria-label="Site links" data-reader-fallback>
          {navigationLinks.map((link) => (
            <Link key={link.href} link={link} />
          ))}
        </nav>
      </header>
      <div class="docs-shell">
        <aside class="docs-sidebar" aria-label={`${tab?.label ?? "Documentation"} navigation`}>
          <div class="docs-project">
            <a
              class={`docs-map${document ? "" : " docs-project-title"}`}
              href={href(tab?.href ?? "")}
            >
              <strong class="docs-map-label">{label}</strong>
              {document?.title && <span class="docs-map-title">{document.title}</span>}
            </a>
            {(document?.version || document?.status) && (
              <span class="docs-version">
                <span class="small-dot" />
                {[document.version, document.status?.toLowerCase()].filter(Boolean).join(" ")}
              </span>
            )}
          </div>
          {nav.tabs.length > 1 && (
            <nav class="reader-tabs" aria-label="Documentation sections">
              {nav.tabs.map((item) => (
                <a
                  href={href(item.href)}
                  aria-current={item.slug === nav.activeTabSlug ? "page" : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}
          <nav aria-label="Chapters">
            {tab?.groups.map((group) => (
              <>
                {group.href ? (
                  <a class="nav-section" href={href(group.href)}>
                    {group.label}
                  </a>
                ) : (
                  <span class="nav-section">{group.label}</span>
                )}
                {group.items.map((item) => (
                  <a
                    href={href(item.href)}
                    aria-current={item.id === nav.activePageSlug ? "page" : undefined}
                  >
                    <span>{item.label}</span>
                    {item.id === nav.activePageSlug && <span class="active-nav-dot" />}
                  </a>
                ))}
              </>
            ))}
          </nav>
          {(settings.sidebar?.links?.length || settings.sidebar?.note) && (
            <div class="docs-sidebar-bottom">
              {settings.sidebar.links?.map((link) => (
                <Link key={link.href} link={link}>
                  {link.icon && <Icon name={link.icon} size={16} />}
                  {link.label}
                  <Icon name="northeast" size={13} />
                </Link>
              ))}
              {settings.sidebar.note && <p>{settings.sidebar.note}</p>}
            </div>
          )}
        </aside>
        <div class="mobile-doc-nav">
          <label for="chapter-select">{edition}</label>
          <select
            id="chapter-select"
            aria-label={`${tab?.label ?? "Documentation"} chapter`}
            data-reader-enhancement
            hidden
          >
            {nav.tabs.map((section) => (
              <optgroup label={section.label}>
                {section.groups
                  .flatMap((group) => group.items)
                  .map((item) => (
                    <option
                      value={href(item.href)}
                      selected={
                        section.slug === nav.activeTabSlug && item.id === nav.activePageSlug
                      }
                    >
                      {item.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <details class="reader-chapter-fallback" data-reader-fallback>
            <summary>Chapters</summary>
            <nav>
              {nav.tabs.map((section) => (
                <>
                  {nav.tabs.length > 1 && <strong>{section.label}</strong>}
                  {section.groups
                    .flatMap((group) => group.items)
                    .map((item) => (
                      <a href={href(item.href)}>{item.label}</a>
                    ))}
                </>
              ))}
            </nav>
          </details>
        </div>
        <main id="main" class="docs-main">
          {docPage ? (
            <>
              <div class="doc-breadcrumb">
                <span>{tab?.label}</span>
                <Icon name="chevron" size={12} />
                <span>{edition}</span>
                {document?.status && (
                  <span class="pill soft">{document.badge ?? document.status}</span>
                )}
              </div>
              <header class="doc-title">
                <h1>{docPage.title}</h1>
                {docPage.description && <p>{docPage.description}</p>}
              </header>
              <div class="doc-metadata">
                {document?.status && <span>{document.status}</span>}
                {document?.updated && <span>{document.updated}</span>}
                <button data-copy-page data-reader-enhancement hidden>
                  <Icon name="copy" size={12} />
                  <span aria-live="polite">Copy link</span>
                </button>
              </div>
              <article class="reader-prose" dangerouslySetInnerHTML={{ __html: docPage.html }} />
              {(before || after) && (
                <nav class="doc-pagination" aria-label="Previous and next chapter">
                  {before ? (
                    <Link link={before}>
                      <span>{before.description}</span>
                      <strong>{before.label}</strong>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {after && (
                    <Link link={after}>
                      <span>{after.description}</span>
                      <strong>{after.label}</strong>
                    </Link>
                  )}
                </nav>
              )}
              <footer class="doc-footer">
                <span>{settings.footer?.text ?? site.name}</span>
                <span class="doc-footer-links">
                  {settings.footer?.links?.map((link) => (
                    <Link key={link.href} link={link}>
                      {link.label}
                      <Icon name="northeast" size={12} />
                    </Link>
                  ))}
                  <span class="sourcey-attribution">
                    <a href="https://sourcey.com" target="_blank" rel="noopener noreferrer">
                      Docs by Sourcey
                      <Icon name="northeast" size={12} />
                    </a>
                  </span>
                </span>
              </footer>
            </>
          ) : (
            children
          )}
        </main>
        <aside class="docs-toc" aria-label="On this page">
          {headings.length > 0 && (
            <>
              <span class="eyebrow">On this page</span>
              <nav>
                {headings
                  .filter((heading) => heading.level === Math.min(...headings.map((h) => h.level)))
                  .map((heading) => (
                    <a href={`#${heading.id}`}>{heading.text}</a>
                  ))}
              </nav>
            </>
          )}
          {settings.aside?.links?.map((link) => (
            <Link key={link.href} className="toc-example" link={link}>
              {link.icon && <Icon name={link.icon} size={19} />}
              {link.description && <strong>{link.description}</strong>}
              <span>
                {link.label}
                <Icon size={12} />
              </span>
            </Link>
          ))}
        </aside>
      </div>
      {!searchHref && <SearchDialog />}
    </div>
  );
}
