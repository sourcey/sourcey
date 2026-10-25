import { InputReader } from "./loader.js";
import { spawnSync } from "node:child_process";
import type { ResolvedGodocConfig } from "../config.js";
import type {
  GodocSpec,
  GodocPackage,
  GodocFunc,
  GodocType,
  GodocValue,
  GodocExample,
  GodocSnapshot,
} from "./godoc-types.js";
import { GODOC_SCHEMA_VERSION } from "./godoc-types.js";
import { godocMarkdown } from "./godoc-markdown.js";
import { repositoryFileUrl } from "../site-url.js";
import { runIntrospector, GodocIntrospectorError } from "./godoc-introspector.js";
import {
  DEFAULT_CALLOUTS,
  renderCodeBlock,
  renderMarkdown,
  siteMarkdownOptions,
  type CalloutRenderOptions,
  type MarkdownRenderOptions,
  type PageHeading,
} from "../utils/markdown.js";
import type { MarkdownPage, PageSearchEntry } from "./markdown-loader.js";
import type { SiteTab, SiteNavGroup, SiteNavItem } from "./navigation.js";

export interface GodocLoaderResult {
  pages: Map<string, MarkdownPage>;
  navTab: SiteTab;
  diagnostics: GodocLoaderDiagnostic[];
}

export interface GodocLoaderDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  package?: string;
  file?: string;
  line?: number;
}

export interface GodocSourceLinkOptions {
  repo?: string;
  editBranch?: string;
  editBasePath?: string;
}
/** What a package page renders with: its source links and the site's Markdown, callouts included. */
interface GodocRender {
  sourceLinks: GodocSourceLinkOptions;
  markdown: MarkdownRenderOptions;
}
const snapshots = new WeakMap<Buffer, Map<string, GodocSpec>>();
const rendered = new WeakMap<GodocSpec, Map<string, GodocLoaderResult>>();

/**
 * Resolve a configured godoc tab into pre-rendered Sourcey pages plus a
 * navigation tab. Honours `mode: "live" | "snapshot" | "auto"`:
 *
 *  - live: invoke the Go introspector. Requires Go on PATH.
 *  - snapshot: read the configured `godoc.json`. No Go required.
 *  - auto (default): use live when Go is available; fall back to snapshot.
 *
 * Source-of-truth contract: when both Go and a snapshot are present in
 * "auto" mode, live wins. Snapshot is a fallback cache, not a pin.
 */
export async function loadGodocTab(
  config: ResolvedGodocConfig,
  tabSlug: string,
  tabLabel: string,
  sourceLinks: GodocSourceLinkOptions = {},
  input = new InputReader(),
  callouts: CalloutRenderOptions = DEFAULT_CALLOUTS,
): Promise<GodocLoaderResult> {
  const spec = await loadSpec(config, input);
  const key = JSON.stringify([config, tabSlug, tabLabel, sourceLinks, callouts.icons, callouts.messages]);
  const entries = rendered.get(spec) ?? new Map<string, GodocLoaderResult>();
  let result = entries.get(key);
  if (!result) {
    result = buildResult(spec, tabSlug, tabLabel, config, { sourceLinks, markdown: siteMarkdownOptions(callouts.icons, callouts.messages, GO_DOC_MARKDOWN) });
    entries.set(key, result); rendered.set(spec, entries);
    if (entries.size > 32) entries.delete(entries.keys().next().value!);
  }
  return { ...result, navTab: structuredClone(result.navTab) };
}

async function loadSpec(config: ResolvedGodocConfig, input: InputReader): Promise<GodocSpec> {
  switch (config.mode) {
    case "live":
      return runIntrospector({ config });
    case "snapshot":
      if (!config.snapshot) {
        throw new GodocIntrospectorError(
          "GODOC_SNAPSHOT_MISSING",
          "godoc mode is 'snapshot' but no snapshot path was configured.",
        );
      }
      return loadSnapshot(config.snapshot, config.module, input);
    case "auto":
      if (goAvailable()) {
        return runIntrospector({ config });
      }
      if (config.snapshot) {
        const spec = await loadSnapshot(config.snapshot, config.module, input);
        return {
          ...spec,
          diagnostics: [
            {
              severity: "info",
              code: "GODOC_AUTO_FELL_BACK_TO_SNAPSHOT",
              message: "godoc auto mode did not find Go on PATH and used the configured snapshot.",
            },
            ...spec.diagnostics,
          ],
        };
      }
      throw new GodocIntrospectorError(
        "GO_NOT_FOUND",
        "godoc mode is 'auto' and Go is not on PATH. Install Go or set " +
          "mode: 'snapshot' with a committed godoc.json.",
      );
    default: {
      const exhaustive: never = config.mode;
      throw new Error(`Unknown godoc mode: ${exhaustive as string}`);
    }
  }
}

function goAvailable(): boolean {
  try {
    const result = spawnSync("go", ["version"], { stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function loadSnapshot(snapshotPath: string, moduleDir: string, input: InputReader): Promise<GodocSpec> {
  let raw: string;
  let bytes: Buffer;
  try {
    bytes = (await input.read(snapshotPath, snapshotPath)).body;
    const cached = snapshots.get(bytes)?.get(moduleDir);
    if (cached) return cached;
    raw = bytes.toString("utf8");
  } catch (err) {
    throw new GodocIntrospectorError(
      "GODOC_SNAPSHOT_UNREADABLE",
      `Could not read godoc snapshot at ${snapshotPath}: ${(err as Error).message}`,
      err as Error,
    );
  }

  let snapshot: GodocSnapshot;
  try {
    snapshot = JSON.parse(raw) as GodocSnapshot;
  } catch (err) {
    throw new GodocIntrospectorError(
      "GODOC_SNAPSHOT_BAD_JSON",
      `Snapshot at ${snapshotPath} is not valid JSON: ${(err as Error).message}`,
      err as Error,
    );
  }

  if (snapshot.source !== "sourcey-godoc") {
    throw new GodocIntrospectorError(
      "GODOC_SNAPSHOT_BAD_SOURCE",
      `Snapshot at ${snapshotPath} has source="${snapshot.source}", expected "sourcey-godoc".`,
    );
  }
  if (snapshot.schema_version !== GODOC_SCHEMA_VERSION) {
    throw new GodocIntrospectorError(
      "GODOC_SCHEMA_MISMATCH",
      `Snapshot at ${snapshotPath} has schema_version ${snapshot.schema_version}; ` +
        `this build of sourcey supports ${GODOC_SCHEMA_VERSION}. Regenerate with \`sourcey godoc\`.`,
    );
  }

  const spec: GodocSpec = {
    modulePath: snapshot.module_path,
    moduleDir,
    generatedAt: snapshot.generated_at,
    packages: snapshot.packages,
    diagnostics: snapshot.diagnostics ?? [],
  };
  const entries = snapshots.get(bytes) ?? new Map<string, GodocSpec>();
  entries.set(moduleDir, spec); snapshots.set(bytes, entries);
  return spec;
}

function buildResult(
  spec: GodocSpec,
  tabSlug: string,
  tabLabel: string,
  config: ResolvedGodocConfig,
  render: GodocRender,
): GodocLoaderResult {
  const pages = new Map<string, MarkdownPage>();
  const groups = new Map<string, NavEntry[]>();

  const filteredPackages = config.hideUndocumented
    ? spec.packages.filter((p) => p.doc.trim().length > 0)
    : spec.packages;

  for (const pkg of filteredPackages) {
    const slug = packageSlug(pkg.importPath, spec.modulePath);
    const html = renderPackagePage(pkg, slug, render);
    const headings = collectHeadings(pkg);
    const searchEntries = collectSearchEntries(pkg);
    // Fallback description for undocumented packages — using the import
    // path keeps llms.txt and search summaries clean instead of leaking
    // raw HTML structure.
    const description = pkg.synopsis || pkg.importPath;

    pages.set(slug, {
      kind: "markdown",
      title: packageTitle(pkg, spec.modulePath),
      description,
      // The synopsis is the doc's first sentence, which the body renders.
      hideLede: Boolean(pkg.synopsis),
      slug,
      html,
      markdown: godocMarkdown(pkg),
      headings,
      sourcePath: `godoc/${slug}.md`,
      editPath: packageEditPath(pkg),
      editBasePath: render.sourceLinks.editBasePath ?? "",
      searchEntries,
    });

    const groupKey = navGroupKey(pkg.importPath, spec.modulePath);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({ slug, label: packageNavLabel(pkg, spec.modulePath) });
  }

  const indexSlug = "index";
  const indexHtml = renderIndexPage(spec, filteredPackages);
  const extent = `${filteredPackages.length} package${filteredPackages.length === 1 ? "" : "s"}`;
  pages.set(indexSlug, {
    kind: "markdown",
    title: tabLabel,
    // Standard library packages belong to no module, so the summary names one only where there is one.
    description: spec.modulePath ? `Go API for ${spec.modulePath} across ${extent}.` : `Go API across ${extent}.`,
    slug: indexSlug,
    html: indexHtml,
    markdown: filteredPackages
      .map(
        (pkg) =>
          `- [${pkg.importPath}](${packageSlug(pkg.importPath, spec.modulePath)}.html): ${pkg.synopsis}`,
      )
      .join("\n"),
    headings: [],
    sourcePath: `godoc/${indexSlug}.md`,
    editPath: null,
    editBasePath: render.sourceLinks.editBasePath ?? "",
  });

  // Navigation names each page; the site's routes give it its address.
  const navGroups: SiteNavGroup[] = [];
  navGroups.push({
    label: tabLabel,
    items: [{ label: "Overview", href: "", id: indexSlug, documentId: indexSlug }],
  });

  const sortedKeys = [...groups.keys()].sort();
  for (const key of sortedKeys) {
    const items = groups.get(key)!.sort((a, b) => a.label.localeCompare(b.label));
    navGroups.push({
      label: key,
      items: items.map((entry): SiteNavItem => ({
        label: entry.label,
        href: "",
        id: entry.slug,
        documentId: entry.slug,
      })),
    });
  }

  const diagnostics: GodocLoaderDiagnostic[] = spec.diagnostics.map((d) => ({
    severity: d.severity,
    code: d.code,
    message: d.message,
    package: d.package,
    file: d.file,
    line: d.line,
  }));

  return {
    pages,
    diagnostics,
    navTab: {
      label: tabLabel,
      slug: tabSlug,
      href: "",
      kind: "docs",
      groups: navGroups,
    },
  };
}

interface NavEntry {
  slug: string;
  label: string;
}

function packageTitle(pkg: GodocPackage, modulePath: string): string {
  const rel = relativeImportPath(pkg.importPath, modulePath);
  if (rel === "." || rel === "") return pkg.importPath;
  return rel;
}

function packageNavLabel(pkg: GodocPackage, modulePath: string): string {
  const rel = relativeImportPath(pkg.importPath, modulePath);
  if (rel === "." || rel === "") return pkg.name;
  return rel;
}

function relativeImportPath(importPath: string, modulePath: string): string {
  if (!modulePath) return importPath;
  if (importPath === modulePath) return ".";
  if (importPath.startsWith(`${modulePath}/`)) {
    return importPath.slice(modulePath.length + 1);
  }
  return importPath;
}

function packageSlug(importPath: string, modulePath: string): string {
  const rel = relativeImportPath(importPath, modulePath);
  if (rel === "." || rel === "") return "package-root";
  return `pkg-${rel.replace(/[/]/g, "-").replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function navGroupKey(importPath: string, modulePath: string): string {
  const rel = relativeImportPath(importPath, modulePath);
  if (rel === "." || rel === "") return "Root";
  const first = rel.split("/")[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function collectHeadings(pkg: GodocPackage): PageHeading[] {
  const headings: PageHeading[] = [];
  if (pkg.consts.length > 0) headings.push({ id: "constants", text: "Constants", level: 2 });
  if (pkg.vars.length > 0) headings.push({ id: "variables", text: "Variables", level: 2 });
  if (pkg.funcs.length > 0) {
    headings.push({ id: "functions", text: "Functions", level: 2 });
    for (const f of pkg.funcs) {
      headings.push({ id: funcAnchor(f.name), text: f.name, level: 3 });
    }
  }
  if (pkg.types.length > 0) {
    headings.push({ id: "types", text: "Types", level: 2 });
    for (const t of pkg.types) {
      headings.push({ id: typeAnchor(t.name), text: t.name, level: 3 });
    }
  }
  if (pkg.examples.length > 0) {
    headings.push({ id: "examples", text: "Examples", level: 2 });
  }
  return headings;
}

function collectSearchEntries(pkg: GodocPackage): PageSearchEntry[] {
  const entries: PageSearchEntry[] = [];
  for (const value of pkg.consts) {
    entries.push(
      godocSearchEntry(
        `const ${value.name}`,
        value.doc,
        value.declaration,
        valueAnchor("const", value.name),
        "go constant",
      ),
    );
  }
  for (const value of pkg.vars) {
    entries.push(
      godocSearchEntry(
        `var ${value.name}`,
        value.doc,
        value.declaration,
        valueAnchor("var", value.name),
        "go variable",
      ),
    );
  }
  for (const fn of pkg.funcs) {
    entries.push(
      godocSearchEntry(fn.signature, fn.doc, fn.signature, funcAnchor(fn.name), "go function"),
    );
    for (const ex of fn.examples) {
      entries.push(
        godocSearchEntry(
          exampleTitle(`Example ${fn.name}`, ex),
          ex.doc,
          ex.code,
          funcAnchor(fn.name),
          "go example",
        ),
      );
    }
  }
  for (const t of pkg.types) {
    entries.push(
      godocSearchEntry(`type ${t.name}`, t.doc, t.declaration, typeAnchor(t.name), "go type"),
    );
    for (const method of t.methods) {
      entries.push(
        godocSearchEntry(
          `${t.name}.${method.name}`,
          method.doc,
          method.signature,
          methodAnchor(t.name, method.name),
          "go method",
        ),
      );
      for (const ex of method.examples) {
        entries.push(
          godocSearchEntry(
            exampleTitle(`Example ${t.name}.${method.name}`, ex),
            ex.doc,
            ex.code,
            methodAnchor(t.name, method.name),
            "go example",
          ),
        );
      }
    }
    for (const ex of t.examples) {
      entries.push(
        godocSearchEntry(
          exampleTitle(`Example ${t.name}`, ex),
          ex.doc,
          ex.code,
          typeAnchor(t.name),
          "go example",
        ),
      );
    }
  }
  for (const ex of pkg.examples) {
    entries.push(
      godocSearchEntry(exampleTitle("Example", ex), ex.doc, ex.code, "examples", "go example"),
    );
  }
  return entries;
}

function godocSearchEntry(
  title: string,
  doc: string,
  declaration: string,
  anchor: string,
  category: string,
): PageSearchEntry {
  return {
    title,
    content: [doc, declaration].filter(Boolean).join("\n\n"),
    anchor,
    category,
  };
}

function exampleTitle(prefix: string, ex: GodocExample): string {
  return ex.suffix ? `${prefix} (${humaniseSuffix(ex.suffix)})` : prefix;
}

function packageEditPath(pkg: GodocPackage): string | null {
  const firstFile = pkg.files[0];
  if (!firstFile) return null;
  return firstFile;
}

function funcAnchor(name: string): string {
  return `func-${slugifySymbol(name)}`;
}

function typeAnchor(name: string): string {
  return `type-${slugifySymbol(name)}`;
}

function methodAnchor(typeName: string, methodName: string): string {
  return `method-${slugifySymbol(typeName)}-${slugifySymbol(methodName)}`;
}

function valueAnchor(prefix: "const" | "var", name: string): string {
  return `${prefix}-${slugifySymbol(name)}`;
}

function slugifySymbol(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function renderIndexPage(spec: GodocSpec, packages: GodocPackage[]): string {
  const parts: string[] = [];
  if (spec.modulePath) {
    parts.push(`<p class="godoc-import-path"><code>${escHtml(spec.modulePath)}</code></p>`);
  }

  const cards: string[] = [];
  for (const pkg of packages) {
    const slug = packageSlug(pkg.importPath, spec.modulePath);
    const title = packageTitle(pkg, spec.modulePath);
    const synopsis = pkg.synopsis ? `<p>${escHtml(pkg.synopsis)}</p>` : "";
    cards.push(
      `<a href="${slug}.html" class="card-item">` +
        `<div class="card-item-inner">` +
        `<h2 class="card-item-title">${escHtml(title)}</h2>` +
        `<div class="card-item-content">${synopsis}` +
        `<p class="card-item-meta"><code>${escHtml(pkg.importPath)}</code></p>` +
        `</div></div></a>`,
    );
  }

  if (cards.length > 0) {
    const cols = cards.length <= 2 ? "2" : "3";
    parts.push(
      `<div class="card-group not-prose" data-cols="${cols}">\n${cards.join("\n")}\n</div>`,
    );
  } else {
    parts.push(`<p>No Go packages were resolved.</p>`);
  }

  return parts.join("\n");
}

function renderPackagePage(
  pkg: GodocPackage,
  slug: string,
  render: GodocRender,
): string {
  const parts: string[] = [];

  parts.push(`<p class="godoc-import"><code>import "${escHtml(pkg.importPath)}"</code></p>`);

  if (pkg.doc) {
    parts.push(`<div class="godoc-doc">${renderDoc(pkg, render)}</div>`);
  }

  parts.push(renderTableOfContents(pkg));

  if (pkg.consts.length > 0) {
    parts.push(`<h2 id="constants">Constants</h2>`);
    parts.push(renderValueGroup(pkg.consts, "const", render));
  }
  if (pkg.vars.length > 0) {
    parts.push(`<h2 id="variables">Variables</h2>`);
    parts.push(renderValueGroup(pkg.vars, "var", render));
  }
  if (pkg.funcs.length > 0) {
    parts.push(`<h2 id="functions">Functions</h2>`);
    for (const fn of pkg.funcs) {
      parts.push(renderFunc(fn, funcAnchor(fn.name), render));
    }
  }
  if (pkg.types.length > 0) {
    parts.push(`<h2 id="types">Types</h2>`);
    for (const t of pkg.types) {
      parts.push(renderType(t, render));
    }
  }
  if (pkg.examples.length > 0) {
    parts.push(`<h2 id="examples">Examples</h2>`);
    for (const ex of pkg.examples) {
      parts.push(renderExample(ex, render));
    }
  }

  void slug;
  return parts.join("\n");
}

function renderTableOfContents(pkg: GodocPackage): string {
  const items: string[] = [];
  if (pkg.consts.length > 0) items.push(`<li><a href="#constants">Constants</a></li>`);
  if (pkg.vars.length > 0) items.push(`<li><a href="#variables">Variables</a></li>`);
  if (pkg.funcs.length > 0) {
    items.push(`<li><a href="#functions">Functions</a></li>`);
    for (const fn of pkg.funcs) {
      items.push(
        `<li class="godoc-toc-sub"><a href="#${funcAnchor(fn.name)}">${escHtml(fn.signature)}</a></li>`,
      );
    }
  }
  if (pkg.types.length > 0) {
    items.push(`<li><a href="#types">Types</a></li>`);
    for (const t of pkg.types) {
      items.push(
        `<li class="godoc-toc-sub"><a href="#${typeAnchor(t.name)}">type ${escHtml(t.name)}</a></li>`,
      );
    }
  }
  if (pkg.examples.length > 0) items.push(`<li><a href="#examples">Examples</a></li>`);

  if (items.length === 0) return "";
  // "Index" names the navigation; the page's own sections are its headings.
  return `<nav class="godoc-toc not-prose" aria-labelledby="godoc-index"><p id="godoc-index" class="godoc-toc-label">Index</p><ul>${items.join("")}</ul></nav>`;
}

function renderValueGroup(
  values: GodocValue[],
  kind: "const" | "var",
  render: GodocRender,
): string {
  const seenDeclarations = new Set<string>();
  const parts: string[] = [];

  for (const v of values) {
    const id = valueAnchor(kind, v.name);
    if (!seenDeclarations.has(v.declaration)) {
      seenDeclarations.add(v.declaration);
      const docHtml = v.doc ? `<div class="godoc-doc">${renderDoc(v, render)}</div>` : "";
      parts.push(
        `<section class="godoc-value" id="${id}">` +
          docHtml +
          renderSourceLink(v.position, render.sourceLinks) +
          renderCodeBlock(v.declaration, "go") +
          `</section>`,
      );
    } else {
      // For the secondary names in a grouped declaration we still want
      // anchor stability so external links don't break — emit an empty,
      // styled anchor target.
      parts.push(`<a id="${id}" class="godoc-anchor"></a>`);
    }
  }

  return parts.join("\n");
}

function renderFunc(fn: GodocFunc, anchorId: string, render: GodocRender): string {
  const parts: string[] = [];
  parts.push(`<section class="godoc-func" id="${anchorId}">`);
  parts.push(`<h3 class="godoc-symbol">${escHtml(fn.signature)}</h3>`);
  parts.push(renderSourceLink(fn.position, render.sourceLinks));
  if (fn.doc) parts.push(`<div class="godoc-doc">${renderDoc(fn, render)}</div>`);
  for (const ex of fn.examples) parts.push(renderExample(ex, render));
  parts.push(`</section>`);
  return parts.join("\n");
}

function renderType(t: GodocType, render: GodocRender): string {
  const parts: string[] = [];
  const id = typeAnchor(t.name);
  parts.push(`<section class="godoc-type" id="${id}">`);
  parts.push(`<h3 class="godoc-symbol">type ${escHtml(t.name)}</h3>`);
  parts.push(renderSourceLink(t.position, render.sourceLinks));
  if (t.doc) parts.push(`<div class="godoc-doc">${renderDoc(t, render)}</div>`);
  parts.push(renderCodeBlock(t.declaration, "go"));

  if (t.fields.length > 0 && (t.kind === "struct" || t.kind === "interface")) {
    parts.push(renderFields(t, render));
  }

  for (const m of t.methods) {
    parts.push(renderMethod(t.name, m, render));
  }
  for (const ex of t.examples) parts.push(renderExample(ex, render));

  parts.push(`</section>`);
  return parts.join("\n");
}

function renderFields(t: GodocType, render: GodocRender): string {
  const heading = t.kind === "interface" ? "Methods" : "Fields";
  const rows: string[] = [];
  for (const f of t.fields) {
    const docHtml = f.doc ? `<div class="godoc-field-doc">${renderDoc(f, render)}</div>` : "";
    const tagHtml = f.tag ? `<code class="godoc-tag">\`${escHtml(f.tag)}\`</code>` : "";
    rows.push(
      `<li class="godoc-field"><code class="godoc-field-sig">${escHtml(f.name)}` +
        (f.embedded ? "" : ` <span class="godoc-field-type">${escHtml(f.type)}</span>`) +
        `</code> ${tagHtml}${docHtml}</li>`,
    );
  }
  return `<details class="godoc-fields" open><summary>${heading}</summary><ul>${rows.join("")}</ul></details>`;
}

function renderMethod(typeName: string, m: GodocFunc, render: GodocRender): string {
  const id = methodAnchor(typeName, m.name);
  return renderFunc(m, id, render).replace(`id="${funcAnchor(m.name)}"`, `id="${id}"`);
}

function renderSourceLink(
  position: { file: string; line: number } | undefined,
  sourceLinks: GodocSourceLinkOptions,
): string {
  const href = sourceURL(position, sourceLinks);
  if (!href || !position) return "";
  return `<p class="godoc-source"><a href="${escAttr(href)}" target="_blank" rel="noopener">Source: ${escHtml(position.file)}:${position.line}</a></p>`;
}

function sourceURL(
  position: { file: string; line: number } | undefined,
  sourceLinks: GodocSourceLinkOptions,
): string | undefined {
  if (!position || !sourceLinks.repo || !sourceLinks.editBranch) return undefined;
  return repositoryFileUrl(sourceLinks.repo, sourceLinks.editBranch, sourceLinks.editBasePath, position.file, [position.line]);
}

function renderExample(ex: GodocExample, render: GodocRender): string {
  const title = escHtml(exampleTitle("Example", ex));
  const parts: string[] = [`<details class="godoc-example"><summary>${title}</summary>`];
  if (ex.doc) parts.push(`<div class="godoc-doc">${renderDoc(ex, render)}</div>`);
  parts.push(renderCodeBlock(ex.code, "go"));
  if (ex.output) {
    parts.push(`<p class="godoc-example-output-label">Output:</p>`);
    parts.push(renderCodeBlock(ex.output, "text"));
  }
  parts.push(`</details>`);
  return parts.join("\n");
}

function humaniseSuffix(suffix: string): string {
  return suffix.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Code in a Go doc comment is indented, so it carries no language: it is Go. */
const GO_DOC_MARKDOWN: MarkdownRenderOptions = {
  code: (token) => renderCodeBlock(token.text, token.lang || "go"),
};

/** A doc comment, from the helper's Markdown when the snapshot carries it. */
function renderDoc(symbol: { doc: string; docMarkdown?: string }, render: GodocRender): string {
  return renderMarkdown(symbol.docMarkdown ?? symbol.doc, render.markdown).trim();
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return escHtml(s);
}
