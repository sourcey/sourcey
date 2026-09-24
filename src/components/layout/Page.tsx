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
import { joinHref } from "../../site-url.js";
import { Header } from "./Header.js";
import { Sidebar } from "./Sidebar.js";
import { TableOfContents } from "./TableOfContents.js";
import { Introduction } from "../openapi/Introduction.js";
import { SecurityDefinitions } from "../openapi/Security.js";
import { Tags } from "../openapi/Tags.js";
import { Definition } from "../openapi/Definition.js";
import { SocialIcon, socialLabels } from "../ui/SocialIcon.js";
import { McpConnection } from "../mcp/McpConnection.js";
import { ChangelogPage } from "../changelog/ChangelogPage.js";

/**
 * Markdown page content with prose typography.
 */
function MarkdownPageContent({ page, className = "" }: { page: MarkdownPage; className?: string }) {
  const nav = useContext(NavigationContext);

  // Find the group label for the current page (eyebrow)
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  const activeGroup = activeTab?.groups.find((g) =>
    g.items.some((item) => item.id === nav.activePageSlug),
  );
  const eyebrow = activeGroup?.label;

  return (
    <div
      class={`relative grow box-border flex-col w-full mx-auto px-1 min-w-0 ${className}`}
      id="content-area"
    >
      <header class="relative leading-none">
        <div class="mt-0.5 space-y-2.5">
          {eyebrow && (
            <div class="h-5 text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-primary-light))] text-sm font-semibold">
              {eyebrow}
            </div>
          )}
          <div class="flex flex-col sm:flex-row items-start sm:items-center relative gap-2 min-w-0">
            <h1
              class="text-2xl sm:text-3xl text-[rgb(var(--color-gray-900))] tracking-tight dark:text-[rgb(var(--color-gray-200))] font-bold"
              style="overflow-wrap: anywhere"
            >
              {page.title}
            </h1>
          </div>
        </div>
        {page.description && (
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
      <PageNavigation />
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
      <ChangelogPage page={page} />
      <PageNavigation />
      <ContentFooter />
    </div>
  );
}

/**
 * OpenAPI spec page content.
 */
function SpecPageContent({ className = "" }: { className?: string }) {
  const spec = useContext(SpecContext);
  const serverUrl = spec.servers[0]?.url ?? "/";

  return (
    <div
      class={`relative grow box-border flex-col w-full mx-auto px-1 min-w-0 ${className}`}
      id="content-area"
    >
      <article>
        <header class="mb-8">
          <div class="flex items-baseline gap-3">
            <h1 class="text-2xl sm:text-3xl font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] tracking-tight">
              {spec.info.title}
            </h1>
            <span class="text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
              v{spec.info.version}
            </span>
          </div>
          {spec.info.summary && (
            <p class="mt-2 max-w-2xl text-sm text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-400))]">
              {spec.info.summary}
            </p>
          )}
        </header>

        <Introduction />
        {spec.operations[0]?.mcpExtras?.connection && (
          <McpConnection connection={spec.operations[0].mcpExtras.connection} />
        )}
        <SecurityDefinitions />
        <Tags tags={spec.tags} serverUrl={serverUrl} />

        {Object.keys(spec.schemas).length > 0 && (
          <div class="mt-12">
            <div class="mb-6">
              <h1 class="text-xl font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">
                Models
              </h1>
            </div>
            {Object.entries(spec.schemas).map(([name, schema]) => (
              <Definition key={name} name={name} schema={schema} />
            ))}
          </div>
        )}
      </article>
      <ContentFooter />
    </div>
  );
}

function PageNavigation() {
  const nav = useContext(NavigationContext);
  const options = useContext(OptionsContext);
  const activeTab = nav.tabs.find((t) => t.slug === nav.activeTabSlug);
  if (!activeTab) return null;

  // Flatten all nav items in the active tab
  const allItems = activeTab.groups.flatMap((g) => g.items);
  const idx = allItems.findIndex((item) => item.id === nav.activePageSlug);
  if (idx === -1) return null;

  const prev = idx > 0 ? allItems[idx - 1] : null;
  const next = idx < allItems.length - 1 ? allItems[idx + 1] : null;
  if (!prev && !next) return null;

  const linkClass =
    "group flex flex-col gap-1 px-4 py-3 rounded-lg border border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] hover:border-[rgb(var(--color-primary)/0.4)] dark:hover:border-[rgb(var(--color-primary-light)/0.3)] transition-colors no-underline";
  const labelClass =
    "text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]";
  const titleClass =
    "text-sm font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))] group-hover:text-[rgb(var(--color-primary-ink))] dark:group-hover:text-[rgb(var(--color-primary-light))] transition-colors";
  const base = options.assetBase;

  return (
    <nav class="mt-12 flex items-stretch justify-between gap-4">
      {prev ? (
        <a href={joinHref(base, prev.href)} class={linkClass}>
          <span class={labelClass}>← Previous</span>
          <span class={titleClass}>{prev.label}</span>
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={joinHref(base, next.href)} class={`${linkClass} text-right ml-auto`}>
          <span class={labelClass}>Next →</span>
          <span class={titleClass}>{next.label}</span>
        </a>
      ) : null}
    </nav>
  );
}

function ContentFooter() {
  const site = useContext(SiteContext);
  const page = useContext(PageContext);
  const links = site.footer.links;

  // Build "Edit this page" URL when repo + editBranch are configured
  let editUrl: string | undefined;
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
  if (site.repo && site.editBranch && editPath) {
    const repoBase = site.repo.replace(/\/$/, "");
    const editBasePath =
      page.kind === "markdown" && page.markdown.editBasePath !== undefined
        ? page.markdown.editBasePath
        : site.editBasePath;
    const basePath = editBasePath ? `${editBasePath.replace(/^\/|\/$/g, "")}/` : "";
    editUrl = `${repoBase}/edit/${site.editBranch}/${basePath}${editPath}`;
  }

  const linkStyle =
    "hover:text-[rgb(var(--color-gray-600))] dark:hover:text-[rgb(var(--color-gray-300))] transition-colors";

  return (
    <div class="mt-16 mb-8 flex items-center justify-between border-t border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-gray-800)/0.5)] pt-6 text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
      <a href="https://sourcey.com" target="_blank" rel="noopener noreferrer" class={linkStyle}>
        Docs by Sourcey
      </a>
      <div class="flex items-center gap-4">
        {editUrl && (
          <a
            href={editUrl}
            target="_blank"
            rel="noopener noreferrer"
            class={`${linkStyle} flex items-center gap-1`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-3 h-3 mr-0.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
              />
            </svg>
            Edit this page
          </a>
        )}
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.label ?? socialLabels[link.type] ?? link.href}
            class={linkStyle}
          >
            {link.type === "link" ? (
              (link.label ?? link.href)
            ) : (
              <>
                <SocialIcon type={link.type} />
                {link.label && <span class="ml-1">{link.label}</span>}
              </>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in theme layouts
// ---------------------------------------------------------------------------

function DefaultLayout() {
  const page = useContext(PageContext);

  return (
    <div class="max-w-[92rem] mx-auto relative px-4 lg:px-8">
      <Sidebar />
      <main id="docs" class="pt-[8.5rem] lg:pt-10">
        {page.kind === "markdown" ? (
          <div class="flex flex-row-reverse gap-12 box-border w-full">
            <TableOfContents headings={page.markdown.headings} />
            <MarkdownPageContent
              page={page.markdown}
              className="lg:pl-[23.7rem] lg:-ml-12 xl:w-[calc(100%-28rem)]"
            />
          </div>
        ) : page.kind === "changelog" ? (
          <div class="flex flex-row-reverse gap-12 box-border w-full">
            <TableOfContents headings={page.changelog.headings} />
            <ChangelogPageContent
              page={page.changelog}
              className="lg:pl-[23.7rem] lg:-ml-12 xl:w-[calc(100%-28rem)]"
            />
          </div>
        ) : (
          <SpecPageContent className="lg:pl-[23.7rem] lg:-ml-12" />
        )}
      </main>
    </div>
  );
}

function MinimalLayout() {
  const page = useContext(PageContext);

  return (
    <div class="max-w-3xl mx-auto relative px-4 lg:px-8">
      <main id="docs" class="pt-[8.5rem] lg:pt-10">
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

function ApiFirstLayout() {
  const page = useContext(PageContext);

  return (
    <div class="max-w-[92rem] mx-auto relative px-4 lg:px-8">
      <Sidebar />
      <main id="docs" class="pt-[8.5rem] lg:pt-10">
        {page.kind === "markdown" ? (
          <div class="flex flex-row-reverse gap-12 box-border w-full">
            <TableOfContents headings={page.markdown.headings} />
            <MarkdownPageContent
              page={page.markdown}
              className="lg:pl-[23.7rem] lg:-ml-12 xl:w-[calc(100%-28rem)]"
            />
          </div>
        ) : page.kind === "changelog" ? (
          <div class="flex flex-row-reverse gap-12 box-border w-full">
            <TableOfContents headings={page.changelog.headings} />
            <ChangelogPageContent
              page={page.changelog}
              className="lg:pl-[23.7rem] lg:-ml-12 xl:w-[calc(100%-28rem)]"
            />
          </div>
        ) : (
          <SpecPageContent className="lg:pl-[23.7rem] lg:-ml-12" />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export function Page() {
  const site = useContext(SiteContext);
  const theme = site.theme.name;

  const page = useContext(PageContext);
  if (theme === "reader") {
    return (
      <ReaderPage>
        {page.kind === "spec" ? (
          <SpecPageContent />
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
      class="relative antialiased text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]"
    >
      <Header />
      <span class="fixed inset-0 bg-[rgb(var(--color-background-light))] dark:bg-[rgb(var(--color-background-dark))] -z-10 pointer-events-none" />
      <Layout />
      <SearchDialog />
    </div>
  );
}
