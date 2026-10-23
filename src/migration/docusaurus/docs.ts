/**
 * Docusaurus documents as its docs plugin (3.x) identifies and routes them:
 * number prefixes, `id`, `slug`, category index files, drafts and titles.
 */
import { posix } from "node:path";
import type { ProjectFiles } from "../project-files.js";
import { readFrontmatter } from "../text-edits.js";
import type { DocsInstance } from "./site.js";

export interface DocusaurusDoc {
  /** Project-relative file. */
  file: string;
  /** Path inside the content directory, with extension. */
  source: string;
  /** Directory of `source`, `.` at the top. */
  sourceDirName: string;
  id: string;
  /** Path below the instance's route, with a leading slash. */
  slug: string;
  title: string;
  /** Sidebar label: `sidebar_label`, else the title. */
  label: string;
  /** Sidebar position from frontmatter or the file name's number prefix. */
  position?: number;
  frontmatter: Record<string, unknown>;
  draft: boolean;
  unlisted: boolean;
}

const IGNORED_PREFIX = /^\d+[-_.]\d+/;
const NUMBER_PREFIX = /^(?<numberPrefix>\d+)\s*[-_.]+\s*(?<suffix>[^-_.\s].*)$/;

/** A number as Docusaurus validates one, with Joi's `number()` converting: a number, or a string that spells one, such as `"10"`. */
export function frontmatterNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value)) return undefined;
  // Joi reads -0 as 0.
  return parseFloat(value.trim()) || 0;
}

/** Docusaurus's default number prefix parser: `01-intro` is `intro` at position 1; `7.0-notes` is a version, not a prefix. */
export function numberPrefix(name: string, enabled = true): { name: string; position?: number } {
  const match = enabled && !IGNORED_PREFIX.test(name) ? NUMBER_PREFIX.exec(name) : null;
  return match ? { name: match.groups!.suffix, position: Number.parseInt(match.groups!.numberPrefix, 10) } : { name };
}

function stripPrefixes(path: string, enabled: boolean): string {
  return path
    .split("/")
    .map((segment) => numberPrefix(segment, enabled).name)
    .join("/");
}

/** A file is its directory's own page when it is `index`, `readme` or named after the directory. */
export function isCategoryIndex(source: string): boolean {
  const name = posix.parse(source).name.toLowerCase();
  const directory = posix.dirname(source).split("/").pop()?.toLowerCase();
  return name === "index" || name === "readme" || name === directory;
}

export async function readDocs(project: ProjectFiles, instance: DocsInstance, contentDir: string): Promise<DocusaurusDoc[]> {
  const files = await project.list(contentDir, (path) => {
    const inside = path.slice(contentDir.length + 1);
    return instance.include.some((pattern) => posix.matchesGlob(inside, pattern)) && !instance.exclude.some((pattern) => posix.matchesGlob(inside, pattern));
  });
  const docs: DocusaurusDoc[] = [];
  for (const file of files.sort()) {
    const source = file.slice(contentDir.length + 1);
    const text = await project.readText(file);
    const { data, bodyStart } = readFrontmatter(text);
    const prefixes = instance.numberPrefixes && data.parse_number_prefixes !== false;
    const sourceDirName = posix.dirname(source);
    const stem = posix.basename(source, posix.extname(source));
    const { name, position } = numberPrefix(stem, prefixes);
    const baseId = typeof data.id === "string" ? data.id : name;
    const dirName = sourceDirName === "." ? "" : stripPrefixes(sourceDirName, prefixes);
    const title = typeof data.title === "string" ? data.title : (contentTitle(text.slice(bodyStart)) ?? baseId);
    docs.push({
      file,
      source,
      sourceDirName,
      id: [dirName, baseId].filter(Boolean).join("/"),
      slug: docSlug(data.slug, source, dirName, baseId),
      title,
      label: typeof data.sidebar_label === "string" ? data.sidebar_label : title,
      position: frontmatterNumber(data.sidebar_position) ?? position,
      frontmatter: data,
      draft: data.draft === true,
      unlisted: data.unlisted === true,
    });
  }
  return docs;
}

/** The plugin's `getSlug`: an absolute `slug`, a category index at its directory, or the slug or ID resolved against the directory. */
function docSlug(frontmatterSlug: unknown, source: string, dirName: string, baseId: string): string {
  const directory = dirName ? `/${dirName}/` : "/";
  if (typeof frontmatterSlug === "string" && frontmatterSlug.startsWith("/")) return frontmatterSlug;
  if (typeof frontmatterSlug !== "string" && isCategoryIndex(source)) return directory;
  const relative = typeof frontmatterSlug === "string" ? frontmatterSlug : baseId;
  const resolved = posix.normalize(posix.join(directory, relative));
  return relative.endsWith("/") && !resolved.endsWith("/") ? `${resolved}/` : resolved;
}

/** The title Docusaurus takes from content: a level-one heading that opens it, after any imports. */
function contentTitle(body: string): string | undefined {
  const content = body.trim().replace(/^(?:import\s(?:.|\r?\n(?!\r?\n))*(?:\r?\n){2,})*/, "").trim();
  const atx = /^#[ \t]+(?<title>[^ \t].*)(?:\r?\n|$)/.exec(content);
  const setext = /^(?<title>.*)\r?\n=+(?:\r?\n|$)/.exec(content);
  const title = atx ? atx.groups!.title.trim().replace(/\s*(?:\{#*[\w-]+\}|#+)$/, "") : setext?.groups!.title.trim().replace(/\s*=+$/, "");
  // Like `toTextContentTitle`, inline code is the only Markdown unwrapped.
  return title?.replace(/`([^`]*)`/g, "$1").trim();
}
