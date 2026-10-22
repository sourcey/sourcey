import { pageOutputPath, tabPath, type PrettyUrls, type ResolvedConfig } from "./config.js";
import type { ChangelogPage } from "./core/markdown-loader.js";
import type { NormalizedChangelogVersion } from "./core/types.js";
import { isMainChangelogPage, type SitePage } from "./core/site-model.js";
import type { ArtifactBody } from "./core/source-file.js";
import { generateChangelogFeeds } from "./renderer/changelog-feed.js";
import { toPublicUrl } from "./site-url.js";

/** A page of its own for each release of every changelog, where the site gives releases permalinks. */
export function addPermalinkPages(pageMap: Map<string, SitePage>, prettyUrls: PrettyUrls): void {
  const changelogPages = Array.from(pageMap.values()).filter(isMainChangelogPage);
  for (const page of changelogPages) {
    const changelog = page.currentPage.changelog;
    for (const version of changelog.changelog.versions) {
      const permalinkPage: ChangelogPage = {
        ...structuredClone(changelog),
        description: version.summary ?? changelog.description,
        slug: `${changelog.slug}/${version.id}`,
        headings: [],
        permalinkVersionId: version.id,
      };

      const outputPath = pageOutputPath(
        page.tabSlug,
        `${changelog.slug}/${version.id}`,
        prettyUrls,
      );
      pageMap.set(JSON.stringify([page.identity, page.context.key, version.id]), {
        outputPath,
        currentPage: { kind: "changelog", changelog: permalinkPage },
        identity: { ...page.identity, document: `${page.identity.document}/${version.id}` },
        context: page.context,
        contentLocale: page.contentLocale,
        tabSlug: page.tabSlug,
        pageSlug: `${page.pageSlug}--${version.id}`,
      });
    }
  }
}

/**
 * Each changelog's Atom and RSS feeds, and the links its pages name them by.
 * A site with one changelog publishes its feeds at the root, and every page
 * names them.
 */
export function attachChangelogFeeds(
  pages: SitePage[],
  config: ResolvedConfig,
): Map<string, ArtifactBody> {
  const extraFiles = new Map<string, ArtifactBody>();
  if (!config.changelog.feed) return extraFiles;

  const changelogPages = pages.filter(isMainChangelogPage);
  const single = changelogPages.length === 1;

  for (const page of changelogPages) {
    const changelog = page.currentPage.changelog;
    const versionHref = (version: NormalizedChangelogVersion) => {
      if (config.changelog.permalinks) {
        return toPublicUrl(
          pageOutputPath(page.tabSlug, `${changelog.slug}/${version.id}`, config.prettyUrls),
          config.siteUrl,
          config.baseUrl,
          config.prettyUrls,
        );
      }

      return `${toPublicUrl(page.outputPath, config.siteUrl, config.baseUrl, config.prettyUrls)}#${version.id}`;
    };

    const atomPath = single ? "feed.xml" : tabPath(page.tabSlug, `${changelog.slug}/feed.xml`);
    const rssPath = single ? "feed.rss" : tabPath(page.tabSlug, `${changelog.slug}/feed.rss`);

    const feedConfig = config.changelog.feed || undefined;
    const feeds = generateChangelogFeeds(changelog, {
      atomPath: toPublicUrl(atomPath, config.siteUrl, config.baseUrl, config.prettyUrls),
      rssPath: toPublicUrl(rssPath, config.siteUrl, config.baseUrl, config.prettyUrls),
      pagePath: toPublicUrl(page.outputPath, config.siteUrl, config.baseUrl, config.prettyUrls),
      siteName: config.name,
      title: feedConfig?.title,
      description: feedConfig?.description,
      versionHref,
    });

    extraFiles.set(atomPath, feeds.atom);
    extraFiles.set(rssPath, feeds.rss);

    // The changelog's pages name its feeds, its releases' pages among them; with one changelog, every page does.
    const feedLinks = createFeedLinks(atomPath, rssPath, changelog.title);
    for (const candidate of pages) {
      if (candidate.currentPage.kind === "changelog" && candidate.currentPage.changelog.sourcePath === changelog.sourcePath) candidate.alternateLinks = feedLinks;
      else if (single && !candidate.alternateLinks?.length) candidate.alternateLinks = feedLinks;
    }
  }
  return extraFiles;
}

function createFeedLinks(atomPath: string, rssPath: string, title: string) {
  return [
    { href: atomPath, type: "application/atom+xml", title: `${title} Atom Feed` },
    { href: rssPath, type: "application/rss+xml", title: `${title} RSS Feed` },
  ];
}
