import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { h, type ComponentType } from "preact";
import { renderToString } from "preact-render-to-string";
import type { NativeComponentDefinition, StaticAttributes } from "./markdown-components.js";

/**
 * The places in every page a site's own component fills, or replaces, by its
 * file's name: `Head` closes the page's head, `Banner` opens its body, `Header`
 * and `Footer` replace the theme's, `ContentEnd` follows a document's content
 * and `BodyEnd` closes the body.
 */
export const PAGE_PARTS = ["Head", "Banner", "Header", "ContentEnd", "Footer", "BodyEnd"] as const;
export type PagePartName = (typeof PAGE_PARTS)[number];

/** What a page part is told about the page it is drawn on. */
export interface PagePartProps {
  title: string;
  url: string;
  lang: string;
  notFound: boolean;
}

/** A page part, drawn for each page; its digest names its sources for the page cache. */
export interface PagePart {
  file: string;
  digest: string;
  render(page: PagePartProps): string;
}

/** The element a page leaves where a site's own part goes, filled once the page is drawn. */
export const PAGE_PART_TAG = "sourcey-part";

/** Draw each of a site's parts into the slot the page left for it. */
export function fillPageParts(html: string, parts: Partial<Record<PagePartName, PagePart>>, page: PagePartProps): string {
  for (const name of PAGE_PARTS) {
    const part = parts[name];
    if (!part) continue;
    const slot = `<${PAGE_PART_TAG} name="${name}"></${PAGE_PART_TAG}>`;
    const at = html.indexOf(slot);
    if (at !== -1) html = html.slice(0, at) + part.render(page) + html.slice(at + slot.length);
  }
  return html;
}

export interface SiteComponents {
  /** The folder they were read from, when there is one. */
  directory?: string;
  /** Markdown components, by name; a built-in's name replaces it. */
  components: Record<string, NativeComponentDefinition>;
  parts: Partial<Record<PagePartName, PagePart>>;
  /** Every file they were read from, for a rebuild to watch. */
  files: string[];
}

const NONE: SiteComponents = { components: {}, parts: {}, files: [] };
const CHILDREN_TAG = "sourcey-children";
const EXTENSIONS = new Set([".html", ".tsx", ".jsx"]);

/**
 * A site's own components: each file in the folder named with a capital is
 * the component of that name, or the page part it fills. HTML is drawn as
 * written, a Markdown component's children where it puts a `<slot>`; a `.tsx`
 * or `.jsx` file's default export is a Preact component, given the attributes
 * the page wrote and its children, or a page part's `page`. A module named in
 * lower case is a helper the components import.
 */
export async function readSiteComponents(directory: string, required: boolean): Promise<SiteComponents> {
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && EXTENSIONS.has(extname(entry.name))).map((entry) => entry.name).sort();
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return NONE;
    throw new Error(`componentsDir: ${directory} is not a folder`, { cause: error });
  }
  const result: SiteComponents = { directory, components: {}, parts: {}, files: [] };
  const seen = new Map<string, string>();
  for (const file of names) {
    const extension = extname(file);
    const name = basename(file, extension);
    const path = join(directory, file);
    if (extension !== ".html" && !/^[A-Z]/.test(name)) continue;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name))
      throw new Error(`${path}: a component's file is named for it, starting with a capital, such as ${name.charAt(0).toUpperCase()}${name.slice(1).replace(/[^A-Za-z0-9]/g, "")}${extension}`);
    if (seen.has(name)) throw new Error(`${path}: ${seen.get(name)} is already the ${name} component`);
    seen.set(name, file);
    let draw: (props: Record<string, unknown>, children: string) => string;
    let files: string[];
    if (extension === ".html") {
      const source = await readFile(path, "utf8");
      draw = (_props, children) => source.replace(/<slot\s*\/?>(?:\s*<\/slot>)?/g, () => children);
      files = [path];
    } else {
      const imported = await importComponent(path);
      const component = imported.component;
      // Its children are drawn in where it puts them, with no element of their own.
      draw = (props, children) => children
        ? renderToString(h(component, { ...props, children: h(CHILDREN_TAG, null) })).split(`<${CHILDREN_TAG}></${CHILDREN_TAG}>`).join(children)
        : renderToString(h(component, props));
      files = imported.files;
    }
    result.files.push(...files);
    if ((PAGE_PARTS as readonly string[]).includes(name)) {
      const digest = createHash("sha256");
      for (const source of files) digest.update(await readFile(source));
      result.parts[name as PagePartName] = { file: path, digest: digest.digest("hex"), render: (page) => draw({ page }, "") };
    } else result.components[name] = markdownComponent(draw);
  }
  return result;
}

/** A Markdown component drawn by a file: its children stay the page's content, for search and exports. */
function markdownComponent(draw: (props: Record<string, unknown>, children: string) => string): NativeComponentDefinition<StaticAttributes, StaticAttributes> {
  return {
    parseProps: (attributes) => attributes,
    resolve: ({ props, children }) => ({ content: children, data: props }),
    renderHtml: (resolved, helpers) => draw({ ...resolved.data }, helpers.render(resolved.content)),
  };
}

/**
 * A component module read as the config is, with its JSX drawn by Sourcey's
 * own Preact, so the site needs no Preact of its own.
 */
async function importComponent(path: string): Promise<{ component: ComponentType<Record<string, unknown>>; files: string[] }> {
  const { runnerImport } = await import("vite");
  const preact = (specifier: string) => fileURLToPath(import.meta.resolve(specifier));
  const alias = [
    { find: /^preact\/jsx-(?:dev-)?runtime$/, replacement: preact("preact/jsx-runtime") },
    { find: /^preact\/hooks$/, replacement: preact("preact/hooks") },
    { find: /^preact$/, replacement: preact("preact") },
  ];
  const { module, dependencies } = await runnerImport<{ default?: unknown }>(path, {
    configFile: false,
    logLevel: "silent",
    resolve: { alias },
    oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  });
  if (typeof module.default !== "function") throw new Error(`${path}: its default export is the component, a function`);
  return { component: module.default as ComponentType<Record<string, unknown>>, files: [path, ...dependencies.filter((file) => !file.includes("/node_modules/"))] };
}
