import { createRequire } from "node:module";
import type SanitizeHtml from "sanitize-html";

const BASE_URL = "https://sourcey.invalid/";
const EXPLICIT_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

export interface SafeUrlOptions {
  allowedProtocols?: readonly string[];
  allowRelative?: boolean;
  allowAnchor?: boolean;
}

/** The elements HTML closes with their start tag; any other is open until its end tag, whatever the start tag ends with. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export function safeUrl(input: string, options: SafeUrlOptions = {}): string | null {
  const allowedProtocols = options.allowedProtocols ?? ["http:", "https:", "mailto:"];
  const allowRelative = options.allowRelative ?? true;
  const allowAnchor = options.allowAnchor ?? true;
  const value = input.trim();

  if (!value || hasRawControlOrSpace(value)) return null;
  if (value.startsWith("#")) return allowAnchor ? value : null;
  if (value.startsWith("//")) return null;

  try {
    const parsed = new URL(value, BASE_URL);
    const hasExplicitScheme = EXPLICIT_SCHEME_RE.test(value);
    if (!hasExplicitScheme) return allowRelative ? value : null;
    return allowedProtocols.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** A configured link to another site opens in a new tab; one within this site, such as the host's own pages, opens in place. */
export function linkTarget(href: string, siteUrl?: string): { target?: "_blank"; rel?: "noopener" } {
  if (!/^https?:\/\//i.test(href)) return {};
  try {
    if (siteUrl && new URL(href).origin === new URL(siteUrl).origin) return {};
  } catch {
    // A malformed address is treated as another site's.
  }
  return { target: "_blank", rel: "noopener" };
}

function hasRawControlOrSpace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Static SVG, as icon sets and authored badges and figures draw it: shapes,
 * groups, clipping, masks, gradients, filters and text. No scripts, foreign
 * content or event handlers. Inside <svg> the parser spells elements as SVG
 * does (clipPath, feFlood) and lowercases attributes; HTML parsing restores the
 * attributes' own spelling (viewBox, stdDeviation).
 */
const SVG_TAGS = [
  "svg", "g", "defs", "title", "desc", "path", "circle", "ellipse", "line", "polygon", "polyline", "rect", "text", "tspan",
  "clipPath", "mask", "linearGradient", "radialGradient", "stop",
  "filter", "feBlend", "feColorMatrix", "feComposite", "feFlood", "feGaussianBlur", "feMerge", "feMergeNode", "feOffset",
];
const SVG_ATTRIBUTES = [
  "xmlns", "viewbox", "preserveaspectratio", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "d", "points", "transform",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "stroke-opacity", "opacity", "style",
  "clip-path", "clippathunits", "mask", "maskunits", "maskcontentunits", "filter", "filterunits", "primitiveunits", "color-interpolation-filters",
  "gradientunits", "gradienttransform", "spreadmethod", "offset", "stop-color", "stop-opacity",
  "in", "in2", "result", "values", "type", "mode", "operator", "k1", "k2", "k3", "k4", "dx", "dy", "stddeviation", "flood-color", "flood-opacity",
  "text-anchor", "dominant-baseline", "font-family", "font-size", "font-weight", "aria-hidden", "focusable",
];

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const LENGTH = /^(0|\d{1,4}(\.\d{1,3})?(px|rem|em|%))$/;
const FRACTION = /^(0|1|0?\.\d{1,3})$/;
const SHIKI_FONT_STYLE = /^(italic|normal|inherit)$/;
const SHIKI_FONT_WEIGHT = /^(bold|normal|inherit|[1-9]00)$/;
const SHIKI_TEXT_DECORATION = /^(underline|line-through|none|inherit)$/;

const require = createRequire(import.meta.url);

/** `linkSchemes` are further link schemes the build resolves after rendering, such as `operation`. */
export function sanitizeRenderedHtml(input: string, linkSchemes: readonly string[] = []): string {
  // The sanitizer loads with the first HTML an author wrote; many sites have none.
  const sanitizeHtml = require("sanitize-html") as typeof SanitizeHtml;
  return sanitizeHtml(input, {
    nonBooleanAttributes: sanitizeHtml.defaults.nonBooleanAttributes.filter(
      (name) => name !== "hidden",
    ),
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "picture",
      "figure",
      "figcaption",
      "button",
      "del",
      "details",
      "iframe",
      "img",
      // A task list's checkbox, as Markdown draws one.
      "input",
      "source",
      "summary",
      "video",
      ...SVG_TAGS,
    ],
    allowedAttributes: {
      "*": [
        "class",
        "id",
        "role",
        "tabindex",
        "title",
        "hidden",
        "aria-*",
        "data-*",
      ],
      picture: ["data-sourcey-picture"],
      a: ["href", "name", "target", "rel", "title", "class", "id"],
      button: [
        "type",
        "class",
        "aria-expanded",
        "aria-label",
        "aria-selected",
        "data-copy-source",
        "data-tab-group",
        "data-tab-index",
      ],
      div: [
        "class",
        "id",
        "role",
        "style",
        "data-cols",
        "data-tab-group",
        "data-tab-index",
        "data-traverse-target",
      ],
      details: ["class", "id", "open"],
      h1: ["id", "class"],
      h2: ["id", "class"],
      h3: ["id", "class"],
      h4: ["id", "class"],
      h5: ["id", "class"],
      h6: ["id", "class"],
      iframe: ["src", "title", "frameborder", "allow", "allowfullscreen", "loading", "height", "width", "class", "id"],
      img: ["src", "srcset", "sizes", "alt", "title", "width", "height", "loading", "class", "id"],
      input: [{ name: "type", values: ["checkbox"], multiple: false }, "checked", "disabled"],
      ol: ["start"],
      ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_ATTRIBUTES])),
      pre: ["class", "tabindex", "style"],
      source: ["data-light", "data-dark", "src", "srcset", "sizes", "media", "type"],
      span: ["class", "style", "title"],
      table: ["class"],
      td: ["class", "colspan", "rowspan"],
      th: ["class", "colspan", "rowspan", "scope"],
      video: ["src", "poster", "playsinline", "autoplay", "muted", "loop", "controls", "preload", "title", "class", "id"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      ...(linkSchemes.length ? { a: ["http", "https", "mailto", ...linkSchemes] } : {}),
      iframe: ["http", "https"],
      img: ["http", "https"],
      source: ["http", "https"],
    },
    allowProtocolRelative: false,
    // Inline styles keep authored drawing and layout: SVG paint, sizes and
    // flex rows. Values are keywords, hex colours and lengths, never url().
    allowedStyles: {
      "*": {
        background: [/^transparent$/, HEX],
        "background-color": [HEX],
        color: [HEX],
        height: [LENGTH, /^auto$/],
        width: [LENGTH, /^auto$/],
        "max-width": [LENGTH],
        fill: [HEX, /^(none|currentColor)$/],
        stroke: [HEX, /^(none|currentColor)$/],
        "fill-rule": [/^(nonzero|evenodd)$/],
        "clip-rule": [/^(nonzero|evenodd)$/],
        opacity: [FRACTION],
        "fill-opacity": [FRACTION],
        "stroke-opacity": [FRACTION],
        display: [/^(block|inline|inline-block|flex|inline-flex|grid)$/],
        gap: [LENGTH],
        "flex-wrap": [/^(wrap|nowrap)$/],
        "align-items": [/^(start|end|flex-start|flex-end|center|baseline|stretch)$/],
        "justify-content": [/^(start|end|flex-start|flex-end|center|space-between|space-around|space-evenly)$/],
        "--shiki-dark": [HEX],
        "--shiki-dark-bg": [HEX],
        "--shiki-light": [HEX],
        "--shiki-light-bg": [HEX],
        // A theme's emphasis in highlighted code: italic comments, bold keywords.
        "--shiki-dark-font-style": [SHIKI_FONT_STYLE],
        "--shiki-light-font-style": [SHIKI_FONT_STYLE],
        "--shiki-dark-font-weight": [SHIKI_FONT_WEIGHT],
        "--shiki-light-font-weight": [SHIKI_FONT_WEIGHT],
        "--shiki-dark-text-decoration": [SHIKI_TEXT_DECORATION],
        "--shiki-light-text-decoration": [SHIKI_TEXT_DECORATION],
      },
    },
  });
}

/** Rewrite URL attribute values using the HTML parser's source offsets. */
export async function rewriteHtmlUrls(
  input: string,
  rewrite: (url: string, tag: string, attribute: string) => Promise<string>,
): Promise<string> {
  if (!/<(?:img|source|video|a)\b/i.test(input)) return input;
  const { Parser } = await import("htmlparser2");
  const attributes: { start: number; end: number; name: string; value: string; tag: string }[] = [];
  let tag = "";
  const parser = new Parser({
    onopentagname(name) { tag = name.toLowerCase(); },
    onattribute(name, value) {
      if ((["img", "source", "video"].includes(tag) && ["src", "poster", "srcset"].includes(name)) || tag === "a" && name === "href")
        attributes.push({ start: parser.startIndex, end: parser.endIndex, name, value, tag });
    },
  });
  parser.end(input);
  const edits = await Promise.all(attributes.map(async attribute => {
    if (attribute.name !== "srcset") return { ...attribute, target: await rewrite(attribute.value, attribute.tag, attribute.name) };
    const { default: parseSrcset } = await import("parse-srcset");
    const candidates = parseSrcset(attribute.value);
    const rewritten = await Promise.all(candidates.map(async candidate => ({ ...candidate, url: await rewrite(candidate.url, attribute.tag, attribute.name) })));
    const changed = candidates.some((candidate, index) => candidate.url !== rewritten[index].url);
    const target = changed ? rewritten.map(candidate => `${candidate.url}${candidate.w === undefined ? "" : ` ${candidate.w}w`}${candidate.h === undefined ? "" : ` ${candidate.h}h`}${candidate.d === undefined ? "" : ` ${candidate.d}x`}`).join(", ") : attribute.value;
    return { ...attribute, target };
  }));
  let result = input;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.target !== edit.value) result = result.slice(0, edit.start) + `${edit.name}="${escapeAttr(edit.target)}"` + result.slice(edit.end);
  }
  return result;
}
