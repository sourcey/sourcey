/**
 * What a source site added to every page, written as the native site's page
 * parts in `components/`: its head's scripts, tags and stylesheets, and the
 * scripts that close its body.
 */
import type { PagePartName } from "../core/site-components.js";
import { escapeAttr } from "../utils/html.js";
import type { NativePlan } from "./plan.js";
import type { ProjectFiles } from "./project-files.js";

/** Markup for a page part, and what in the source added it. */
export interface PartMarkup {
  html: string;
  from: string;
}

/** Write each page part's markup as `components/<part>.html`, beside the native config. */
export async function writePageParts(
  project: ProjectFiles,
  files: NativePlan["files"],
  parts: Partial<Record<PagePartName, PartMarkup[]>>,
  fail: (message: string) => void,
): Promise<void> {
  for (const [name, markup] of Object.entries(parts)) {
    if (!markup?.length) continue;
    const file = `components/${name}.html`;
    const from = [...new Set(markup.map((item) => item.from))].join(", ");
    if (await project.exists(file)) {
      fail(`${file} already exists, so what ${from} adds to every page cannot be written there`);
      continue;
    }
    files.set(file, { bytes: `${markup.map((item) => item.html.trim()).join("\n")}\n`, reason: `What ${from} added to every page` });
  }
}

/** An element as a framework's configuration names one: `true` writes a bare attribute, `false` and absent values none. */
export function element(tag: string, attributes: Record<string, unknown>, inner = ""): string {
  const written = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`))
    .join("");
  return ["meta", "link"].includes(tag) ? `<${tag}${written}>` : `<${tag}${written}>${inner}</${tag}>`;
}

/** Google Analytics, loaded as Google's tag loads it. */
export function googleTag(id: string): string {
  return [
    element("script", { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}` }),
    `<script>window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments); } gtag("js", new Date()); gtag("config", ${JSON.stringify(id).replace(/</g, "\\u003c")});</script>`,
  ].join("\n");
}
