import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ResolvedConfig } from "./config.js";
import { pageMetadata } from "./core/page-metadata.js";
import type { SitePage } from "./core/site-model.js";
import { artifactBytes, type ArtifactBody } from "./core/source-file.js";
import type { SiteConfig } from "./renderer/context.js";
import { contentTypeForPath, outputPathFromRequestPath } from "./renderer/static-files.js";
import { isAbsoluteHttpUrl } from "./site-url.js";

/** Each page's social card, still to draw. */
export type SiteCards = Map<SitePage, () => Promise<Buffer | undefined>>;

/**
 * Name each page's social image. A site with an image of its own shows it on
 * every page. Otherwise each page names a card of its own, drawn as the
 * site's artifacts are produced, just before its page, so the build never
 * holds every card at once.
 */
export async function planCards(pages: readonly SitePage[], config: ResolvedConfig, site: SiteConfig, files: Map<string, ArtifactBody>): Promise<SiteCards | undefined> {
  if (config.ogImage) {
    const remote = /^(?:https?:\/\/|data:)/.test(config.ogImage);
    const image = remote ? config.ogImage : `_og/static${extname(config.ogImage) || ".png"}`;
    if (!remote) files.set(image, await readFile(config.ogImage));
    for (const page of pages) page.ogImagePath = image;
    return undefined;
  }

  const { embedRemoteLogo, generateOgImage } = await import("./og/generate-og-image.js");
  // The card is dark, so it draws the logo the site shows in dark mode.
  let logo = site.logo?.dark ?? site.logo?.light;
  if (logo && isAbsoluteHttpUrl(logo)) logo = await embedRemoteLogo(logo);
  else if (logo && !logo.startsWith("data:")) {
    const path = outputPathFromRequestPath(logo, config.baseUrl);
    const body = files.get(path);
    if (body === undefined) throw new Error(`Missing compiled logo asset: ${path}`);
    logo = `data:${contentTypeForPath(path)};base64,${Buffer.from(await artifactBytes(body)).toString("base64")}`;
  }

  const cards: SiteCards = new Map();
  for (const page of pages) {
    const card = cardText(page, site, config.changelog.ogImages);
    if (!card) continue;
    page.ogImagePath = `_og/${page.outputPath.replace(/\.html$/, ".png")}`;
    cards.set(page, () => generateOgImage({
      ...card,
      siteName: config.name,
      theme: config.theme,
      logo,
      logoMark: site.logo?.mark,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Sourcey: skipping OG image for ${page.outputPath}: ${message}`);
      return undefined;
    }));
  }
  return cards;
}

/** What a page's card says, or nothing for a page without one: the not-found page, and a release's permalink unless the changelog asks. */
function cardText(page: SitePage, site: SiteConfig, permalinkCards: boolean): { title: string; description?: string } | undefined {
  if (page.status === 404) return undefined;
  if (page.currentPage.kind === "changelog" && page.currentPage.changelog.permalinkVersionId && !permalinkCards) return undefined;
  const { title, description } = pageMetadata(page.currentPage, site);
  return { title, description };
}

/** Produce a site's artifacts while its cards are drawn: the worker that lays cards out ends with the last of them, and frees what it held. */
export async function drawingCards<T>(produce: () => Promise<T>): Promise<T> {
  try {
    return await produce();
  } finally {
    const { closeCardDrawer } = await import("./og/draw-card.js");
    await closeCardDrawer();
  }
}
