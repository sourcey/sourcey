import { createHash } from "node:crypto";
import type { ResolvedConfig } from "./config.js";
import { buildSearchArtifacts } from "./core/search-artifacts.js";
import type { SearchEntry } from "./core/search-indexer.js";
import type { SitePage } from "./core/site-model.js";
import type { ArtifactBody } from "./core/source-file.js";
import { toPublicPath } from "./site-url.js";

/** Each language and version's published search, by context, with the rows it was built from. */
export type SearchCache = Map<string, { key: string } & ReturnType<typeof buildSearchArtifacts>>;

/**
 * Publish a site's search: for each language and version, its rows as
 * content-addressed index files, and a manifest naming them at an address
 * every build shares. Each page reads the manifests of the languages and
 * versions its navigation reaches. A context whose rows are the previous
 * build's keeps that build's files.
 */
export function publishSearch(config: ResolvedConfig, pages: readonly SitePage[], rows: readonly SearchEntry[], files: Map<string, ArtifactBody>, previous?: SearchCache): SearchCache {
  const contextByUrl = new Map(pages.map(page => [toPublicPath(page.outputPath, config.baseUrl, config.prettyUrls), page.context.key]));
  const rowsByContext = new Map<string, SearchEntry[]>();
  for (const row of rows) {
    const key = contextByUrl.get(row.url.split("#")[0]);
    if (key === undefined) continue;
    const own = rowsByContext.get(key) ?? [];
    own.push(row); rowsByContext.set(key, own);
  }
  const searches: SearchCache = new Map();
  const manifests = new Map<string, string>();
  for (const context of config.contexts) {
    const own = rowsByContext.get(context.key) ?? [];
    const hash = createHash("sha256");
    for (const row of own) hash.update(JSON.stringify(row)).update("\0");
    const key = hash.digest("hex");
    let search = previous?.get(context.key);
    if (search?.key !== key) search = { key, ...buildSearchArtifacts(own) };
    searches.set(context.key, search);
    for (const [path, body] of search.files) files.set(path, body);
    // One address for every build: a page names it, and it names this build's files.
    const manifest = `_search/context-${createHash("sha256").update(context.key).digest("hex").slice(0,16)}.json`;
    files.set(manifest, JSON.stringify(search.entry));
    manifests.set(context.key, manifest);
  }
  const reached = new Map(config.contexts.map(context => [context.key, [...new Set(config.contexts
    .filter(c => c.locale === context.locale && (c.scope === context.scope ? c.version.id === context.version.id : c.isDefaultVersion))
    .flatMap(c => manifests.get(c.key) ?? []))]]));
  for (const page of pages) page.searchIndexes = reached.get(page.context.key) ?? [];
  return searches;
}
