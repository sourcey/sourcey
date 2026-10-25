import { activeSection, holdsPage, isNavGroup, walkNavItems, type SiteNavGroup } from "../../core/navigation.js";
import { useReferenceOutline } from "../openapi/outline.js";
import { ContextControls, ContextNotice } from "./ContextControls.js";
import { LogoImage, logoHref } from "../ui/Logo.js";
import { Markdown } from "../ui/Markdown.js";
import { SocialIcon, linkLabel } from "../ui/SocialIcon.js";
import { english } from "../../core/messages.js";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import {
  NavigationContext,
  OptionsContext,
  PageContext,
  SiteContext,
} from "../../renderer/context.js";
import { SearchDialog } from "./SearchDialog.js";
import { PagePart } from "./PagePart.js";
import { LastUpdated } from "../ui/LastUpdated.js";
import { Feedback } from "../ui/Feedback.js";
import { Breadcrumbs } from "../ui/Breadcrumbs.js";
import { RepositoryStats, repositoryLabel } from "../ui/RepositoryStats.js";
import { navbarLinks, type ReaderLink } from "../../config.js";
import { safeUrl } from "../../utils/html.js";
import { joinHref } from "../../site-url.js";

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
    sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
    moon: ["M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"],
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

function ReaderGroups({ groups, active, href }: { groups: SiteNavGroup[]; active: string; href: (path: string) => string }) {
  return <>{groups.map(group => {
    const label = group.href ? <a class="nav-section" href={href(group.href)}>{group.label}</a> : <span class="nav-section">{group.label}</span>;
    const contents = <>{group.items.map(item => isNavGroup(item)
      ? <div class="reader-nested-group"><ReaderGroups groups={[item]} active={active} href={href} /></div>
      : <a href={href(item.href)} aria-current={item.id === active ? "page" : undefined}><span>{item.label}</span>{item.id === active && <span class="active-nav-dot" />}</a>)}</>;
    if (group.collapsed === undefined || !group.items.length) return <>{group.label && label}{contents}</>;
    const open = !group.collapsed || holdsPage(group, active);
    // A summary is a control of its own, so a section's own link sits beside its toggle, not inside it.
    if (group.href) return <div class="sourcey-nav-group-linked">{label}<details class="sourcey-nav-group" open={open}><summary class="nav-section" aria-label={group.label} />{contents}</details></div>;
    return <details class="sourcey-nav-group" open={open}><summary>{label}</summary>{contents}</details>;
  })}</>;
}

export function ReaderPage({ children }: { children?: ComponentChildren }) {
  const site = useContext(SiteContext);
  const nav = useContext(NavigationContext);
  const page = useContext(PageContext);
  const { assetBase: base, messages = english, updated, lang } = useContext(OptionsContext);
  const settings = site.theme.reader ?? {};
  const document = settings.document;
  const { tab, group } = activeSection(nav);
  const items = tab ? [...walkNavItems(tab.groups)] : [];
  const index = items.findIndex((item) => item.id === nav.activePageSlug);
  const previous = nav.adjacentPages?.previous;
  const next = nav.adjacentPages?.next;
  const label = document?.label ?? tab?.label ?? site.name;
  const edition = [label, document?.version].filter(Boolean).join(" ");
  const href = (path: string) => joinHref(base, path);
  // The chapter menu and its fallback links list the same chapters in order;
  // the menu navigates through the links, whose addresses hosts may re-base.
  const activeHref = href(items[index]?.href ?? tab?.href ?? "");
  const home = safeUrl(logoHref(site, nav, base)) ?? "/";
  const searchHref = settings.searchHref ? safeUrl(settings.searchHref) : null;
  const docPage = page.kind === "markdown" ? page.markdown : null;
  // Chapters and reference pages read in order, under the same breadcrumb and footer.
  const paged = docPage !== null || page.kind === "spec";
  const before: ReaderLink | undefined = previous
    ? { label: previous.label, href: href(previous.href), description: `← ${messages.previous}` }
    : docPage ? settings.pagination?.before : undefined;
  const after: ReaderLink | undefined = next
    ? { label: next.label, href: href(next.href), description: `${messages.next} →` }
    : docPage ? settings.pagination?.after : undefined;
  const isCurrent = (target: string) => {
    if (target.startsWith("/") && site.baseUrl) return site.baseUrl.startsWith(target);
    return target === activeHref;
  };
  // The mobile lists hold every link, a menu's in its place; the desktop header keeps its menus.
  const navigationLinks = navbarLinks(site.navbar.links).map((link) => ({ ...link, label: linkLabel(link) }));
  const outline = useReferenceOutline();
  const headings = docPage?.headings ?? (page.kind === "changelog" ? page.changelog.headings : outline);
  const places = headings.filter((heading) => heading.level === Math.min(...headings.map((h) => h.level)));
  // A chapter names its edition; a reference page, the section listing it.
  const crumbs = [tab?.label, docPage ? edition : group?.label].filter(
    (crumb, i, all): crumb is string => !!crumb && all.indexOf(crumb) === i,
  );
  const breadcrumb = (
    <div class="doc-breadcrumb">
      {site.breadcrumbs ? <Breadcrumbs /> : crumbs.map((crumb, i) => (
        <>
          {i > 0 && <Icon name="chevron" size={12} />}
          <span>{crumb}</span>
        </>
      ))}
      {docPage && document?.status && <span class="pill soft">{document.badge ?? document.status}</span>}
    </div>
  );
  const pagination = (before || after) && (
    <nav class="doc-pagination" aria-label={messages.chapterPagination}>
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
  );
  const footer = (
    <PagePart name="Footer">
      <footer class="doc-footer">
        <span>{settings.footer?.text ?? (site.footer.text ? <Markdown inline content={site.footer.text} class="sourcey-footer-text" /> : site.name)}</span>
        <span class="doc-footer-links">
          {settings.footer?.links?.map((link) => (
            <Link key={link.href} link={link}>
              {link.label}
              <Icon name="northeast" size={12} />
            </Link>
          ))}
          <span class="sourcey-attribution">
            <a href="https://sourcey.com/docs" target="_blank" rel="noopener">
              Docs by Sourcey
              <Icon name="northeast" size={12} />
            </a>
          </span>
        </span>
      </footer>
    </PagePart>
  );

  return (
    <div class="sourcey-reader" id="page">
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <PagePart name="Header">
        <header class="site-header">
          <div class="header-inner">
            <a class="home-link" href={home} aria-label={`${site.name} home`}>
              <span class="brand">
                {site.logo?.light && (
                  <LogoImage
                    className={site.logo.mark ? "brand-mark" : "brand-logo"}
                    light={site.logo.dark ?? site.logo.light}
                    dark={site.logo.dark}
                    alt={site.logo.mark ? "" : site.name}
                  />
                )}
                {(!site.logo?.light || site.logo.mark) && <span>{site.name}</span>}
              </span>
            </a>
            <nav class="desktop-nav" aria-label={messages.mainNavigation}>
              {site.navbar.links.map((link) => link.type === "menu" ? (
                <details key={link.label} class="sourcey-context-menu sourcey-header-menu" name="sourcey-header-menu">
                  <summary>
                    <span>{link.label}</span>
                    <svg class="sourcey-context-chevron" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </summary>
                  <ul aria-label={link.label}>{link.links.map((item) => (
                    <li key={item.href}><a href={safeUrl(item.href) ?? undefined} aria-current={isCurrent(item.href) ? "page" : undefined}>{linkLabel(item)}</a></li>
                  ))}</ul>
                </details>
              ) : (
                <a
                  key={link.href}
                  href={safeUrl(link.href) ?? undefined}
                  class={link.type === "link" ? undefined : link.repository ? "desktop-nav-icon desktop-nav-repository" : "desktop-nav-icon"}
                  aria-label={link.type === "link" ? undefined : link.repository ? repositoryLabel(linkLabel(link), link.repository, lang, messages) : linkLabel(link)}
                  aria-current={isCurrent(link.href) ? "page" : undefined}
                >
                  {link.type === "link" ? linkLabel(link) : <><SocialIcon type={link.type} size={18} />{link.repository && <RepositoryStats stats={link.repository} />}</>}
                </a>
              ))}
            </nav>
            <div class="header-actions">
              {searchHref ? (
                <a class="search-link" href={searchHref} aria-label={messages.search}>
                  <Icon name="search" size={17} />
                  <span>{messages.search}</span>
                  <kbd>/</kbd>
                </a>
              ) : (
                <button
                  class="search-link"
                  id="search-open"
                  aria-label={messages.search}
                  data-reader-enhancement
                  hidden
                >
                  <Icon name="search" size={17} />
                  <span>{messages.search}</span>
                  <kbd>/</kbd>
                </button>
              )}
              <button
                id="theme-toggle"
                class="reader-theme-toggle"
                type="button"
                aria-label={messages.dark}
                data-light-label={messages.light}
                data-dark-label={messages.dark}
                data-reader-enhancement
                hidden
              >
                <span class="reader-theme-sun"><Icon name="sun" size={18} /></span>
                <span class="reader-theme-moon"><Icon name="moon" size={18} /></span>
              </button>
              {site.navbar.primary && (
                <a class="header-cta" href={safeUrl(site.navbar.primary.href) ?? undefined}>
                  {site.navbar.primary.label}
                  <Icon size={15} />
                </a>
              )}
              <button
                class="menu-toggle"
                aria-label={messages.openMenu}
                data-open-label={messages.openMenu}
                data-close-label={messages.closeMenu}
                aria-controls="reader-mobile-nav"
                aria-expanded="false"
                data-reader-enhancement
                hidden
              >
                <Icon name="menu" />
              </button>
            </div>
          </div>
          <div class="reader-context-row"><ContextControls /></div>
          <nav id="reader-mobile-nav" aria-label={messages.mainNavigation} hidden>
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
            {site.navbar.primary && (
              <a class="mobile-cta" href={safeUrl(site.navbar.primary.href) ?? undefined}>
                {site.navbar.primary.label}
                <Icon />
              </a>
            )}
          </nav>
          <nav class="reader-mobile-fallback" aria-label={messages.siteLinks} data-reader-fallback>
            {navigationLinks.map((link) => (
              <Link key={link.href} link={link} />
            ))}
          </nav>
        </header>
      </PagePart>
      {docPage?.layout === "page" ? (
        // A page drawn by its author keeps the header and footer, without chapters or contents.
        <main id="main" class="reader-page">
          <article class="reader-prose" dangerouslySetInnerHTML={{ __html: docPage.html }} />
          {footer}
        </main>
      ) : (
        <div class="docs-shell">
          {/* The chapters are a landmark of their own; a details element cannot be one. */}
          <aside class="docs-sidebar-region" aria-label={tab?.label ?? messages.chapters}>
            <details open class="docs-sidebar" data-reader-chapters>
              {/* On a phone the chapters fold under the edition and the chapter being read. */}
              <summary class="reader-chapters-trigger">
                <span class="reader-chapters-place">
                  <strong>{edition}</strong>
                  {items[index] && items[index].label !== edition && <span>{items[index].label}</span>}
                </span>
                <Icon name="chevron" size={14} />
              </summary>
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
              <ContextNotice />
              {nav.tabs.length > 1 && (
                <nav class="reader-tabs" aria-label={messages.sectionsNavigation}>
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
              <nav aria-label={messages.chapters}>
                {tab && <ReaderGroups groups={tab.groups} active={nav.activePageSlug} href={href} />}
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
            </details>
          </aside>
          <main id="main" class="docs-main">
            {docPage ? (
              <>
                {breadcrumb}
                <header class="doc-title">
                  <h1>{docPage.title}</h1>
                  {docPage.description && !docPage.hideLede && <p>{docPage.description}</p>}
                </header>
                <div class="doc-metadata">
                  {document?.status && <span>{document.status}</span>}
                  {/* The page's own date, where the site dates its pages, before the edition's. */}
                  {updated ? <LastUpdated inline /> : document?.updated && <span>{document.updated}</span>}
                  <button data-copy-page data-reader-enhancement data-copied-label={messages.copied} data-failure-label={messages.copyAddress} data-copy-label={messages.copyLink} hidden>
                    <Icon name="copy" size={12} />
                    <span aria-live="polite">{messages.copyLink}</span>
                  </button>
                </div>
                <article class="reader-prose" dangerouslySetInnerHTML={{ __html: docPage.html }} />
              </>
            ) : (
              <>
                {page.kind === "spec" && breadcrumb}
                {children}
              </>
            )}
            {paged && <PagePart name="ContentEnd" />}
            {paged && <Feedback />}
            {paged && pagination}
            {paged && footer}
          </main>
          <aside class="docs-toc" aria-label={messages.onThisPage}>
            {/* A list of one place on the page says nothing the page does not. */}
            {places.length > 1 && (
              <>
                <span id="sourcey-toc-label" class="eyebrow">{messages.onThisPage}</span>
                <nav aria-labelledby="sourcey-toc-label">
                  {places.map((heading) => (
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
      )}
      {!searchHref && <SearchDialog />}
    </div>
  );
}
