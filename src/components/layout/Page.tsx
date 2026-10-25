import { activeSection } from "../../core/navigation.js";
import type { NormalizedSpec } from "../../core/types.js";
import { ReaderPage } from "./Reader.js";
import { SearchDialog } from "./SearchDialog.js";
import { useContext } from "preact/hooks";
import {
  SpecContext,
  PageContext,
  NavigationContext,
  OptionsContext,
  SiteContext,
} from "../../renderer/context.js";
import type {
  ChangelogPage as ChangelogPageData,
  MarkdownPage,
} from "../../core/markdown-loader.js";
import { Markdown } from "../ui/Markdown.js";
import { joinHref, repositoryFileUrl } from "../../site-url.js";
import { linkTarget } from "../../utils/html.js";
import { Header } from "./Header.js";
import { PagePart } from "./PagePart.js";
import { LastUpdated } from "../ui/LastUpdated.js";
import { Feedback } from "../ui/Feedback.js";
import { PageNotice } from "./ContextControls.js";
import { Sidebar } from "./Sidebar.js";
import { TableOfContents } from "./TableOfContents.js";
import { Introduction } from "../openapi/Introduction.js";
import { SecurityDefinitions } from "../openapi/Security.js";
import { SectionIndex, TagSection, Tags } from "../openapi/Tags.js";
import { referenceTag } from "../../core/tag-utils.js";
import { Operation } from "../openapi/Operation.js";
import { Definition } from "../openapi/Definition.js";
import { useReferenceOutline } from "../openapi/outline.js";
import { SocialIcon, linkLabel } from "../ui/SocialIcon.js";
import { McpConnection } from "../mcp/McpConnection.js";
import { ChangelogPage } from "../changelog/ChangelogPage.js";
import { changelogNavigation } from "../changelog/navigation.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { definitionAnchor, referenceOperation } from "../../core/reference-identity.js";

/**
 * Where the page sits, over its title: the section listing it, or in the
 * full-width theme a trail from its tab, naming a section once when it shares
 * the tab's label. `spacing` sets it apart from a title it does not share a
 * header with.
 */
function PagePlace({ spacing }: { spacing?: string }) {
  const nav = useContext(NavigationContext);
  const site = useContext(SiteContext);
  const { messages } = useContext(OptionsContext);
  const { tab, group } = activeSection(nav);
  const eyebrow = group?.label;
  const trail =
    site.theme.name === "api-first"
      ? [nav.tabs.length > 1 ? tab?.label : undefined, eyebrow].filter(
          (label, i, labels): label is string => !!label && labels.indexOf(label) === i,
        )
      : [];
  if (trail.length > 0) {
    return (
      <nav class={spacing ? `page-trail ${spacing}` : "page-trail"} aria-label={messages.breadcrumb}>
        {trail.map((label, i) => (
          <span key={label} class="page-trail-item">
            {i > 0 && <span class="page-trail-separator" aria-hidden="true">/</span>}
            {label}
          </span>
        ))}
      </nav>
    );
  }
  if (!eyebrow) return null;
  return (
    <div class={`h-5 text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-primary-light))] text-sm font-semibold${spacing ? ` ${spacing}` : ""}`}>
      {eyebrow}
    </div>
  );
}

/**
 * Markdown page content with prose typography.
 */
function MarkdownPageContent({ page, className = "" }: { page: MarkdownPage; className?: string }) {
  return (
    <div
      class={`relative grow box-border flex-col w-full mx-auto px-1 min-w-0 ${className}`}
      id="content-area"
    >
      <PageNotice />
      <header class="relative leading-none">
        <div class="mt-0.5 space-y-2.5">
          <PagePlace />
          <div class="flex flex-col sm:flex-row items-start sm:items-center relative gap-2 min-w-0">
            <h1
              class="text-2xl sm:text-3xl text-[rgb(var(--color-gray-900))] tracking-tight dark:text-[rgb(var(--color-gray-200))] font-bold"
              style="overflow-wrap: anywhere"
            >
              {page.title}
            </h1>
          </div>
        </div>
        {page.description && !page.hideLede && (
          <div
            class="page-description mt-2 text-lg prose prose-gray dark:prose-invert"
            style="overflow-wrap: anywhere"
          >
            <Markdown content={page.description} inline />
          </div>
        )}
      </header>
      <div
        class="prose prose-gray dark:prose-invert relative mt-8 mb-14 max-w-none"
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
      <PageEnd />
      <ContentFooter />
    </div>
  );
}

function ChangelogPageContent({
  page,
  className = "",
}: {
  page: ChangelogPageData;
  className?: string;
}) {
  return (
    <div
      class={`relative grow box-border flex-col w-full mx-auto px-1 min-w-0 ${className}`}
      id="content-area"
    >
      <PageNotice />
      <ChangelogPage page={page} />
      <PageEnd />
      <ContentFooter />
    </div>
  );
}

/** The MCP server a reference documents, when it documents one. */
function mcpConnection(spec: NormalizedSpec) {
  return spec.operations.find(operation => operation.mcpExtras?.connection)?.mcpExtras?.connection;
}

/**
 * OpenAPI spec page content. `bare` leaves out the page's place, previous and
 * next, and footer, for a frame that draws its own.
 */
function SpecPageContent({ className = "", bare = false }: { className?: string; bare?: boolean }) {
  const spec = useContext(SpecContext);
  const current = useContext(PageContext);
  const options = useContext(OptionsContext);
  const navigation = useContext(NavigationContext);
  const connection = mcpConnection(spec);
  const view = current.kind === "spec" ? current.view : undefined;
  const mcpOverview = connection && view?.kind === "overview";
  const place = !bare && <><PageNotice /><PagePlace spacing="mt-0.5 mb-2.5" /></>;
  // A split reference's pages read in order, as guides do.
  const end = !bare && <><PageEnd navigation={!!view} /><ContentFooter /></>;
  // Every page of a reference shares a guide's column, and so its edges.
  const area = `relative grow box-border flex-col w-full mx-auto px-1 min-w-0 ${className}`;
  if (view?.kind === "operation") {
    const operation = referenceOperation(spec, view.id);
    return <div id="content-area" class={area}>{place}{operation && <Operation operation={operation} />}{end}</div>;
  }
  if (view?.kind === "section") return <div id="content-area" class={area}>{place}<TagSection tag={referenceTag(spec, view.tag)} showOperations page />{end}</div>;
  if (view?.kind === "schema") return <div id="content-area" class={area}>{place}<Definition name={view.name} schema={spec.schemas[view.name]} />{end}</div>;

  return (
    <div class={area} id="content-area">
      <article>
        {place}
        <header class="mb-8">
          <div class="flex items-baseline gap-3">
            <h1 class="reference-page-title text-2xl sm:text-3xl font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] tracking-tight">
              {connection ? navigation.tabs.find(tab => tab.slug === navigation.activeTabSlug)?.label ?? spec.info.title : spec.info.title}
            </h1>
            {!connection && <span class="text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
              {/^\d/.test(spec.info.version) ? `v${spec.info.version}` : spec.info.version}
            </span>}
          </div>
          {spec.info.summary && (
            <p class="mt-2 max-w-2xl text-sm text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-400))]">
              {spec.info.summary}
            </p>
          )}
        </header>

        {/* The server's connection follows its introduction, or stands beside it where the theme has room. */}
        {/* A reference split by section lists its sections; one split by operation lists its operations. */}
        {mcpOverview ? <div class="sourcey-mcp-overview"><Introduction /><McpConnection connection={connection} /><div class="sourcey-mcp-tools">{view.split === "sections" ? <SectionIndex /> : <Tags tags={spec.tags} showOperations={false} />}</div></div> : <><Introduction />{connection && <McpConnection connection={connection} />}</>}
        <SecurityDefinitions />
        {!mcpOverview && (view?.kind === "overview" && view.split === "sections" ? <SectionIndex /> : <Tags tags={spec.tags} showOperations={view?.kind !== "overview"} />)}

        {view?.kind === "overview" && Object.keys(spec.schemas).length > 0 && <section class="mt-12"><h2 id="models"><AnchorAliases target="models" />{options.messages?.models ?? "Models"}</h2><ul class="reference-operation-links">{Object.entries(spec.schemas).map(([name, schema]) => <li id={definitionAnchor(name, spec)}><a href={options.referenceTargets?.schemas[name]?.href}><strong>{name}</strong>{schema.description && <span>{schema.description}</span>}</a></li>)}</ul></section>}
        {view?.kind !== "overview" && Object.keys(spec.schemas).length > 0 && (
          <div class="mt-12">
            <div class="mb-6">
              <h2 class="text-xl font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">
                Models
              </h2>
            </div>
            {Object.entries(spec.schemas).map(([name, schema]) => (
              <Definition key={name} name={name} schema={schema} />
            ))}
          </div>
        )}
      </article>
      {end}
    </div>
  );
}

function PageNavigation({ spacing = "mt-12" }: { spacing?: string }) {
  const nav = useContext(NavigationContext);
  const options = useContext(OptionsContext);
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  if (!activeTab) return null;

  const prev = nav.adjacentPages?.previous;
  const next = nav.adjacentPages?.next;
  if (!prev && !next) return null;

  const linkClass =
    "group flex flex-col gap-1 px-4 py-3 rounded-lg border border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] hover:border-[rgb(var(--color-primary)/0.4)] dark:hover:border-[rgb(var(--color-primary-light)/0.3)] transition-colors no-underline";
  const labelClass =
    "text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]";
  const titleClass =
    "text-sm font-medium [overflow-wrap:break-word] text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))] group-hover:text-[rgb(var(--color-primary-ink))] dark:group-hover:text-[rgb(var(--color-primary-light))] transition-colors";
  const base = options.assetBase;
  // A name with a word too long for half a phone's column, such as an API operation's, may break
  // inside it rather than widening the page; other names keep their words whole.
  const breakable = (label: string) => (/\S{18,}/.test(label) ? " min-w-0" : "");

  return (
    <nav class={`${spacing} flex items-stretch justify-between gap-4`} aria-label={options.messages.pagination}>
      {prev ? (
        <a href={joinHref(base, prev.href)} class={`${linkClass}${breakable(prev.label)}`}>
          <span class={labelClass}>← {options.messages?.previous ?? "Previous"}</span>
          <span class={titleClass}>{prev.label}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={joinHref(base, next.href)} class={`${linkClass} text-right ml-auto${breakable(next.label)}`}>
          <span class={labelClass}>{options.messages?.next ?? "Next"} →</span>
          <span class={titleClass}>{next.label}</span>
        </a>
      ) : null}
    </nav>
  );
}

/** Where the page's source can be edited, when the site names its repository and branch. */
function useEditUrl(): string | undefined {
  const site = useContext(SiteContext);
  const page = useContext(PageContext);
  const options = useContext(OptionsContext);
  if (page.kind === "markdown" && page.markdown.editUrl) return page.markdown.editUrl;
  const editBranch = options.sourceRevision ?? site.editBranch;
  const editPath =
    page.kind === "markdown"
      ? page.markdown.editPath === undefined
        ? page.markdown.sourcePath
        : page.markdown.editPath
      : page.kind === "changelog"
        ? page.changelog.editPath === undefined
          ? page.changelog.sourcePath
          : page.changelog.editPath
        : undefined;
  if (!site.repo || !editBranch || !editPath) return undefined;
  const editBasePath =
    page.kind === "markdown" && page.markdown.editBasePath !== undefined
      ? page.markdown.editBasePath
      : site.editBasePath;
  return repositoryFileUrl(site.repo, editBranch, editBasePath, editPath);
}

/**
 * A page's end: the site's own part there, the feedback question, a way to
 * edit its source beside when it last changed, then the pages before and
 * after it.
 */
function PageEnd({ navigation = true }: { navigation?: boolean }) {
  const editUrl = useEditUrl();
  const { updated } = useContext(OptionsContext);
  const about = editUrl || updated;
  return (
    <>
      <PagePart name="ContentEnd" />
      <Feedback />
      {about && (
        <div class="sourcey-page-about flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
          {editUrl && <EditPageLink href={editUrl} />}
          <LastUpdated class="sourcey-last-updated" />
        </div>
      )}
      {navigation && <PageNavigation spacing={about ? "mt-8" : "mt-12"} />}
    </>
  );
}

function EditPageLink({ href: editUrl }: { href: string }) {
  const options = useContext(OptionsContext);
  return (
    <p class="sourcey-edit-page text-sm">
      <a
        href={editUrl}
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1.5 text-[rgb(var(--color-gray-500))] hover:text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-gray-400))] dark:hover:text-[rgb(var(--color-primary-light))] transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          aria-hidden="true"
          class="w-3.5 h-3.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
          />
        </svg>
        {options.messages?.editPage ?? "Edit this page"}
      </a>
    </p>
  );
}

/**
 * The site's foot: who it belongs to, then the places it leads outside, words
 * first and the networks' marks together after them.
 */
function ContentFooter() {
  const site = useContext(SiteContext);
  if (site.pageParts?.Footer) return <PagePart name="Footer" />;
  const words = site.footer.links.filter((link) => link.type === "link");
  const marks = site.footer.links.filter((link) => link.type !== "link");
  const linkStyle =
    "hover:text-[rgb(var(--color-gray-700))] dark:hover:text-[rgb(var(--color-gray-200))] transition-colors";

  return (
    <div class="mt-16 mb-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] pt-6 text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Markdown inline content={site.footer.text} class="sourcey-footer-text" />
        <a href="https://sourcey.com/docs" target="_blank" rel="noopener" class={linkStyle}>
          Docs by Sourcey
        </a>
      </div>
      {/* Many links wrap onto a second line rather than widening the page past a narrow screen. */}
      {site.footer.links.length > 0 && (
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          {words.map((link) => (
            <a key={link.href} href={link.href} {...linkTarget(link.href, site.siteUrl)} class={linkStyle}>
              {link.label ?? link.href}
            </a>
          ))}
          {marks.length > 0 && (
            <span class="flex items-center gap-3.5">
              {marks.map((link) => (
                <a key={link.href} href={link.href} {...linkTarget(link.href, site.siteUrl)} aria-label={linkLabel(link)} class={linkStyle}>
                  <SocialIcon type={link.type} />
                </a>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in theme layouts
// ---------------------------------------------------------------------------

function DefaultLayout() {
  const page = useContext(PageContext);
  const nav = useContext(NavigationContext);
  const releases = changelogNavigation(page, nav);
  const outline = useReferenceOutline();
  // A reading column ends on the frame's right line, 1rem inside it, until "On this page" stands there;
  // the 1rem "On this page" keeps from the frame comes out of the gap before it, not out of the text.
  const reading = "lg:pl-[23.7rem] lg:-ml-12 lg:mr-4 xl:mr-0 xl:w-[calc(100%-28rem)]";

  return (
    <div class="max-w-[92rem] mx-auto relative px-4 lg:px-8">
      <Sidebar />
      <main id="docs">
        {page.kind === "markdown" ? (
          <div class="flex flex-row-reverse gap-8 box-border w-full">
            <TableOfContents headings={page.markdown.headings} reserve />
            <MarkdownPageContent page={page.markdown} className={reading} />
          </div>
        ) : page.kind === "spec" && page.view?.kind === "overview" ? (
          // A split reference's overview reads as a guide does.
          <div class="flex flex-row-reverse gap-8 box-border w-full">
            <TableOfContents headings={outline} reserve />
            <SpecPageContent className={reading} />
          </div>
        ) : page.kind === "changelog" ? (
          <div class="sourcey-changelog-layout" data-release-navigation={releases ? "sidebar" : "outline"}>
            <ChangelogPageContent page={page.changelog} className="sourcey-changelog-reading" />
            {!releases && <TableOfContents headings={page.changelog.headings} label="Releases" />}
          </div>
        ) : (
          // The reference runs to the frame's right line, 1rem inside it, as "On this page" does:
          // set 3rem left, it is 2rem wider than the frame and keeps no padding on the right.
          <SpecPageContent className="lg:pl-[23.7rem] lg:-ml-12 lg:pr-0 lg:w-[calc(100%+2rem)]" />
        )}
      </main>
    </div>
  );
}

function MinimalLayout() {
  const page = useContext(PageContext);

  return (
    <div class="max-w-3xl mx-auto relative px-4 lg:px-8">
      <Sidebar mobileOnly />
      <main id="docs">
        {page.kind === "markdown" ? (
          <MarkdownPageContent page={page.markdown} />
        ) : page.kind === "changelog" ? (
          <ChangelogPageContent page={page.changelog} />
        ) : (
          <SpecPageContent />
        )}
      </main>
    </div>
  );
}

/**
 * The full-width frame: the sidebar is pinned to the left edge and the page
 * fills the rest of the window. Guide and spec pages share one left edge:
 * guides, and a split API reference's overview, cap their reading column and
 * keep the table of contents beside it; spec pages give each operation the
 * full width for its content and example columns, and an MCP overview its
 * connection beside the introduction.
 */
function ApiFirstLayout() {
  const page = useContext(PageContext);
  const nav = useContext(NavigationContext);
  const releases = changelogNavigation(page, nav);
  const outline = useReferenceOutline();

  return (
    <div class="relative">
      <Sidebar />
      <main id="docs" class="api-first-main">
        {page.kind === "markdown" ? (
          <div class="api-first-page">
            <MarkdownPageContent page={page.markdown} className="api-first-reading" />
            <TableOfContents headings={page.markdown.headings} />
          </div>
        ) : page.kind === "spec" && page.view?.kind === "overview" && !mcpConnection(page.spec) ? (
          <div class="api-first-page">
            <SpecPageContent className="api-first-reading" />
            <TableOfContents headings={outline} />
          </div>
        ) : page.kind === "changelog" ? (
          <div class="api-first-page" data-release-navigation={releases ? "sidebar" : "outline"}>
            <ChangelogPageContent page={page.changelog} className="api-first-reading" />
            {!releases && <TableOfContents headings={page.changelog.headings} label="Releases" />}
          </div>
        ) : (
          <div class="api-first-spec">
            <SpecPageContent />
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

/** A page drawn by its author: the site's header and footer around its own body. */
function OwnPage({ page }: { page: MarkdownPage }) {
  const theme = useContext(SiteContext).theme.name;
  return (
    <div id="page" data-sourcey-theme={theme} class="relative antialiased text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
      <Header />
      <span class="fixed inset-0 bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))] -z-10 pointer-events-none" />
      <Sidebar mobileOnly />
      <main id="main" class="sourcey-page">
        <PageNotice rail={false} />
        <div id="content-area" class="prose prose-gray dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: page.html }} />
        <ContentFooter />
      </main>
      <SearchDialog />
    </div>
  );
}

export function Page() {
  const site = useContext(SiteContext);
  const theme = site.theme.name;

  const page = useContext(PageContext);
  const options = useContext(OptionsContext);
  if (page.kind === "not-found") {
    const content = <div class="sourcey-not-found"><p class="sourcey-status-code">404</p><h1>{page.title}</h1><p>{page.description}</p><a class="sourcey-not-found-home" href={joinHref(options.assetBase, page.homeHref)}>{options.messages?.browseDocs ?? "Browse the documentation"}<span aria-hidden="true"> →</span></a></div>;
    if (theme === "reader") return <ReaderPage>{content}</ReaderPage>;
    return <div id="page" data-sourcey-theme={theme}><Header /><Sidebar mobileOnly /><main id="main">{content}</main><SearchDialog /></div>;
  }
  // A blank page is its body alone; search still answers its shortcut.
  if (page.kind === "markdown" && page.markdown.layout === "blank") return <><div id="page" data-sourcey-theme={theme} class="sourcey-blank" dangerouslySetInnerHTML={{ __html: page.markdown.html }} /><SearchDialog /></>;
  if (page.kind === "markdown" && page.markdown.layout === "page" && theme !== "reader") return <OwnPage page={page.markdown} />;
  if (theme === "reader") {
    return (
      <ReaderPage>
        {page.kind === "spec" ? (
          <SpecPageContent bare />
        ) : page.kind === "changelog" ? (
          <ChangelogPageContent page={page.changelog} />
        ) : null}
      </ReaderPage>
    );
  }

  const Layout =
    theme === "minimal" ? MinimalLayout : theme === "api-first" ? ApiFirstLayout : DefaultLayout;

  return (
    <div
      id="page"
      data-sourcey-theme={theme}
      class="relative antialiased text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]"
    >
      <Header />
      <span class="fixed inset-0 bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))] -z-10 pointer-events-none" />
      <Layout />
      <SearchDialog />
    </div>
  );
}
