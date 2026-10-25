/**
 * Outline icons for cards, callouts and built-in chrome, from the theme's icon
 * set, and brand marks an author names as `brand:<name>`.
 *
 * Heroicons (heroicons.com, MIT) is the default; Lucide (lucide.dev, ISC) is
 * optional through the `lucide-static` package. Brand marks are Font Awesome
 * Free's (fontawesome.com, icons CC BY 4.0), optional through the
 * `@fortawesome/fontawesome-free` package; each drawing carries its file's
 * attribution notice, which the file keeps in a comment that inline SVG cannot.
 * An icon is read from its package the first time a page draws it and is
 * cached; pages receive inline SVG drawn with the set's own attributes, and no
 * icon library reaches the browser. An authored icon can also be an image,
 * which components publish as an asset. Brand marks for links are separate
 * (`components/ui/SocialIcon.tsx`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { IconSet } from "../config.js";
import { escapeAttr } from "./html.js";

const require = createRequire(import.meta.url);

/** Where an icon is drawn from: the theme's outline set, or the brand marks. */
export type IconSource = IconSet | "brands";

/** Each source's SVGs, by package, with the licence whose notice each drawing carries. */
const SETS: Record<IconSource, { package: string; directory: string; licence?: string }> = {
  heroicons: { package: "heroicons", directory: "24/outline" },
  lucide: { package: "lucide-static", directory: "icons" },
  brands: { package: "@fortawesome/fontawesome-free", directory: "svgs/brands", licence: "https://creativecommons.org/licenses/by/4.0/" },
};

/** The icons native draws itself, by meaning, as each set names them. */
const NATIVE = {
  note: { heroicons: "information-circle", lucide: "info" },
  tip: { heroicons: "light-bulb", lucide: "lightbulb" },
  warning: { heroicons: "exclamation-triangle", lucide: "triangle-alert" },
  danger: { heroicons: "exclamation-circle", lucide: "circle-alert" },
  language: { heroicons: "language", lucide: "languages" },
  contents: { heroicons: "book-open", lucide: "book-open" },
  helpful: { heroicons: "hand-thumb-up", lucide: "thumbs-up" },
  unhelpful: { heroicons: "hand-thumb-down", lucide: "thumbs-down" },
} as const satisfies Record<string, Record<IconSet, string>>;
export type NativeIcon = keyof typeof NATIVE;

/** How a set draws its icons; size, class and accessibility belong to the page. */
const DRAWING_ATTRIBUTES = new Set(["xmlns", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]);

export interface IconDrawing {
  /** The set's own drawing attributes for the outer `<svg>`, with the attribution its licence asks for. */
  attributes: Readonly<Record<string, string>>;
  /** The icon's shapes. */
  body: string;
}

const directories = new Map<IconSource, string>();
const drawings = new Map<string, IconDrawing | null>();

function directory(set: IconSource): string {
  let found = directories.get(set);
  if (found) return found;
  const { package: name, directory } = SETS[set];
  try {
    found = join(dirname(require.resolve(`${name}/package.json`)), directory);
  } catch {
    const drawn = set === "brands" ? 'Brand icons ("brand:<name>") draw' : `theme.icons is "${set}", which draws`;
    throw new Error(`${drawn} from the ${name} package; install it beside Sourcey (npm install ${name})`);
  }
  directories.set(set, found);
  return found;
}

/** What an authored icon name draws from: `brand:<name>` is a brand mark, any other name the site's set. */
export function iconSource(icons: IconSet, value: string): { source: IconSource; name: string } {
  return value.startsWith("brand:") ? { source: "brands", name: value.slice("brand:".length) } : { source: icons, name: value };
}

/** An icon of the source, or undefined when it has no icon of that name. */
export function iconDrawing(set: IconSource, name: string): IconDrawing | undefined {
  const key = `${set}/${name}`;
  if (!drawings.has(key)) drawings.set(key, readDrawing(set, name));
  return drawings.get(key) ?? undefined;
}

function readDrawing(set: IconSource, name: string): IconDrawing | null {
  // Icon names are kebab-case file names; nothing else names a file in the set.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;
  const file = join(directory(set), `${name}.svg`);
  let svg: string;
  try {
    svg = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const match = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/);
  if (!match) throw new Error(`Unreadable icon ${file}`);
  const attributes: Record<string, string> = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].filter(([, attribute]) => DRAWING_ATTRIBUTES.has(attribute)).map(([, attribute, value]) => [attribute, value]));
  const { licence } = SETS[set];
  if (licence) {
    const notice = match[2].match(/<!--!?\s*([\s\S]*?)\s*-->/)?.[1];
    if (!notice) throw new Error(`Icon ${file} has no attribution notice`);
    attributes["data-sourcey-attribution"] = `${notice} Licence: ${licence}. SVG attributes adapted by Sourcey for inline rendering.`;
  }
  return { attributes, body: match[2].replace(/<!--[\s\S]*?-->/g, "").trim().replace(/>\s+</g, "><") };
}

/** An authored icon that names an image by path or URL; a glyph's name has neither a slash nor a dot. */
export const isImageIcon = (value: string) => /[./]/.test(value);

export function hasIcon(set: IconSource, name: string): boolean {
  return iconDrawing(set, name) !== undefined;
}

/** One of native's own icons in the set. */
export function nativeIcon(set: IconSet, meaning: NativeIcon): IconDrawing {
  const name = NATIVE[meaning][set];
  const drawing = iconDrawing(set, name);
  if (!drawing) throw new Error(`The ${SETS[set].package} package has no "${name}" icon for ${meaning}`);
  return drawing;
}

export interface IconPresentation {
  class?: string;
  /** Pixel size; without one, CSS sizes the icon. */
  size?: number;
  /** What the icon shows, for an icon that stands for something; without one it is decorative. */
  label?: string;
}

/** An icon as inline SVG markup, for HTML that Markdown and components produce. */
export function iconSvg(drawing: IconDrawing, presentation: IconPresentation = {}): string {
  const attributes = { ...(presentation.class ? { class: presentation.class } : {}), ...(presentation.size ? { width: String(presentation.size), height: String(presentation.size) } : {}), ...(presentation.label ? { role: "img", "aria-label": presentation.label } : { "aria-hidden": "true" }), ...drawing.attributes };
  return `<svg${Object.entries(attributes).map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join("")}>${drawing.body}</svg>`;
}
