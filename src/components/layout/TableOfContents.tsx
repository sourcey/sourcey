import { useContext } from "preact/hooks";
import type { PageHeading } from "../../core/markdown-loader.js";
import { SiteContext, OptionsContext } from "../../renderer/context.js";
import { NativeIcon } from "../ui/Icon.js";

/**
 * Right-sidebar table of contents for prose pages.
 * TOC layout: w-[19rem] outer, w-[16.5rem] inner,
 * sticky at 9.5rem, "On this page" with icon.
 */
const tocLink = "toc-item break-words block hover:text-[rgb(var(--color-gray-900))] dark:hover:text-[rgb(var(--color-gray-300))] dark:text-[rgb(var(--color-gray-400))] transition-colors";

function TocIcon() {
  return <NativeIcon meaning="contents" size={16} class="shrink-0" />;
}

function TocList({ headings }: { headings: PageHeading[] }) {
  // Group by the shallowest heading present. Moxygen C++ pages often use
  // h1 for the page title and h3 for sections, with no h2 in between.
  // A deeper heading before the first of those still opens a group.
  const rootLevel = Math.min(...headings.map((h) => h.level));
  const groups: { root: PageHeading; children: PageHeading[] }[] = [];
  for (const h of headings) {
    if (h.level <= rootLevel || !groups.length) {
      groups.push({ root: h, children: [] });
    } else {
      groups[groups.length - 1].children.push(h);
    }
  }

  return (
    <ul>
      {groups.map((g) => (
        <li key={g.root.id}>
          <a href={`#${g.root.id}`} class={`${tocLink} py-1 font-medium`}>{g.root.text}</a>
          {g.children.length > 0 && (
            <ul class="mb-2">
              {g.children.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} class={`${tocLink} pl-3 py-1 text-[rgb(var(--color-gray-500))]`}>{c.text}</a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "On this page", where the page has two places or more to list: a list of one
 * says nothing the page does not. With `reserve`, a page with none keeps the
 * column empty, so its text sits where every other page's does.
 */
export function TableOfContents({ headings, label, reserve = false }: { headings: PageHeading[]; label?: string; reserve?: boolean }) {
  const site = useContext(SiteContext);
  const messages = useContext(OptionsContext).messages;
  label ??= messages.onThisPage;
  if (headings.length < 2) return reserve && site.theme.name !== "api-first" ? <div class="hidden xl:block shrink-0 w-[19rem] xl:mr-4" aria-hidden="true" /> : null;

  if (site.theme.name === "api-first") {
    // The full-width theme: a plain column pinned beside the reading column.
    return (
      <aside
        id="toc"
        aria-labelledby="sourcey-toc-label"
        class="toc-wide hidden xl:block self-start sticky shrink-0 overflow-y-auto"
        style="max-height: calc(100vh - var(--header-height) - 2.5rem); top: calc(var(--header-height) + 2.5rem)"
      >
        <p id="sourcey-toc-label" class="toc-wide-label"><TocIcon />{label}</p>
        <nav aria-labelledby="sourcey-toc-label">
          <TocList headings={headings} />
        </nav>
      </aside>
    );
  }

  // It ends 1rem inside the frame, mirroring the sidebar's text 1rem inside its left.
  return (
    <aside
      id="toc"
      aria-labelledby="sourcey-toc-label"
      class="hidden xl:flex self-start sticky xl:flex-col max-w-[28rem] xl:mr-4 z-[21]"
      style="height: calc(100vh - var(--header-height) - 2.5rem); top: calc(var(--header-height) + 2.5rem)"
    >
      <div class="z-10 hidden xl:flex box-border max-h-full pl-10 w-[19rem]">
        <div class="text-[rgb(var(--color-gray-600))] text-sm leading-6 w-[16.5rem] overflow-y-auto space-y-2 pb-4 -mt-10 pt-10">
          {/* The label names the navigation; it is not a heading of the page. */}
          <p id="sourcey-toc-label" class="font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))] flex items-center gap-2">
            <TocIcon />
            {label}
          </p>

          <nav aria-labelledby="sourcey-toc-label">
            <TocList headings={headings} />
          </nav>
        </div>
      </div>
    </aside>
  );
}
