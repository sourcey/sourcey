/**
 * Rustdoc-grade rendering for the sourcey rustdoc adapter.
 *
 * Renders sourcey-native output (the same look as the godoc/doxygen/openapi
 * adapters), not a copy of rustdoc's own DOM. Items render inline as sourcey
 * sections; the only collapsible is the trait-implementor list. Code blocks go
 * through sourcey's shared Shiki pipeline. Anchors still follow rustdoc's
 * scheme (#method.<name>, #impl-Trait-for-Type%3CK%3E) so inbound deep-links
 * from a rustdoc URL keep working.
 */

import { renderMarkdown, renderCodeBlock } from "../utils/markdown.js";
import {
  apiImplToggle,
  apiItemInfoRow,
  apiSectionAnchor,
  apiStabilityCallout,
  apiSymbolLink,
  escapeAttr,
  escapeHtml,
} from "./api-rendering.js";
import type {
  CrateSpec,
  ExternalCrateRef,
  Item,
  LinkTarget,
  ModuleSpec,
  RustdocDiagnostic,
  Signature,
  Stability,
} from "./rustdoc-types.js";
import { RUSTDOC_DIAGNOSTIC_CODES } from "./rustdoc-types.js";
import { fencedCode } from "../exports/markdown.js";

export interface RenderContext {
  crate: CrateSpec;
  itemsById: Map<string, Item>;
  externalCrates: Map<number, ExternalCrateRef>;
  tabSlug: string;
  /** Where each item of this crate renders: its module page and anchor (`rustItemPages`). */
  itemPages: ReadonlyMap<string, RustItemPage>;
  sourceLinks: {
    repo?: string;
    editBranch?: string;
    editBasePath?: string;
  };
  /** Mutable out-buffer for diagnostics raised during rendering. */
  diagnostics: RustdocDiagnostic[];
}

// ---------------------------------------------------------------------------
// Anchor encoding
// ---------------------------------------------------------------------------

/**
 * Encode a parametric impl anchor in rustdoc's URL-encoded form, e.g.
 *   impl-Clone-for-HashMap%3CK,+V,+S,+A%3E
 */
export function encodeImplAnchor(traitName: string, forType: string): string {
  return `impl-${encodeGenericSegment(traitName)}-for-${encodeGenericSegment(forType)}`;
}

/** Encode a single segment for anchor-ID use: <,>,space and special chars escaped rustdoc-style. */
export function encodeGenericSegment(value: string): string {
  return value.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/, /g, ",+").replace(/ /g, "+");
}

export function itemAnchor(item: Item): string {
  switch (item.inner.kind) {
    case "function":
      return `fn.${slug(item.name)}`;
    case "struct":
      return `struct.${slug(item.name)}`;
    case "enum":
      return `enum.${slug(item.name)}`;
    case "variant":
      return `variant.${slug(item.name)}`;
    case "union":
      return `union.${slug(item.name)}`;
    case "trait":
      return `trait.${slug(item.name)}`;
    case "trait_alias":
      return `traitalias.${slug(item.name)}`;
    case "type_alias":
      return `type.${slug(item.name)}`;
    case "constant":
      return `constant.${slug(item.name)}`;
    case "static":
      return `static.${slug(item.name)}`;
    case "macro":
      return `macro.${slug(item.name)}`;
    case "proc_macro":
      return `macro.${slug(item.name)}`;
    case "assoc_type":
      return `associatedtype.${slug(item.name)}`;
    case "assoc_const":
      return `associatedconstant.${slug(item.name)}`;
    case "struct_field":
      return `structfield.${slug(item.name)}`;
    case "use":
      return `reexport.${slug(useBaseName(item.inner))}`;
    case "module":
      return `mod.${slug(item.name)}`;
    case "impl":
      return implAnchor(item);
    case "primitive":
      return `primitive.${slug(item.name)}`;
    case "extern_type":
      return `externtype.${slug(item.name)}`;
  }
}

function implAnchor(item: Item): string {
  if (item.inner.kind !== "impl") return `impl-${slug(item.name)}`;
  const traitDisplay = item.inner.trait_path?.display ?? "";
  const forDisplay = item.inner.for_type.display;
  if (traitDisplay) return encodeImplAnchor(traitDisplay, forDisplay);
  return `impl-${encodeGenericSegment(forDisplay)}`;
}

function slug(name: string | null | undefined): string {
  if (!name) return "";
  return name;
}

/** Base name of a re-export: the imported name, or the last path segment. */
function useBaseName(inner: { name: string; source: string }): string {
  return inner.name || (inner.source.split("::").filter(Boolean).pop() ?? inner.source);
}

/**
 * Heading/anchor display name for an item. Re-exports (`use`) carry their name
 * on `inner`, not the top-level `item.name` which rustdoc leaves null, so we
 * derive it from the imported name or the re-exported path (with `::*` for globs).
 */
export function itemDisplayName(item: Item): string {
  if (item.inner.kind === "use") {
    const base = useBaseName(item.inner);
    return item.inner.is_glob ? `${base}::*` : base;
  }
  return item.name ?? "";
}

// ---------------------------------------------------------------------------
// Signature formatter
// ---------------------------------------------------------------------------

const SIGNATURE_INLINE_LIMIT = 100;

/** Multi-line signature renderer with rustdoc break rules. */
export function renderSignature(signature: Signature, ctx: RenderContext): string {
  const inline = renderInlineSignature(signature, ctx);
  if (signature.display.length <= SIGNATURE_INLINE_LIMIT) {
    return `<span class="code-header rust-signature">${inline}</span>`;
  }
  return `<span class="code-header rust-signature">${renderMultilineSignature(signature, ctx)}</span>`;
}

function renderInlineSignature(signature: Signature, ctx: RenderContext): string {
  const parts: string[] = [];
  for (const token of signature.tokens) {
    parts.push(renderToken(token, ctx));
  }
  return parts.join("");
}

function renderMultilineSignature(signature: Signature, ctx: RenderContext): string {
  // Heuristic: break each input onto its own line; place `where` if present on
  // its own line. Keeps in sync with rustdoc's visual cadence without
  // requiring an AST.
  let head = "";
  const inputs: string[] = [];
  let output = "";
  let seenOpenParen = false;
  let seenCloseParen = false;
  let currentInput = "";

  for (const token of signature.tokens) {
    const rendered = renderToken(token, ctx);
    if (!seenOpenParen) {
      head += rendered;
      if (token.kind === "punct" && token.text === "(") seenOpenParen = true;
      continue;
    }
    if (!seenCloseParen) {
      if (token.kind === "punct" && token.text === ")") {
        if (currentInput.trim().length > 0) inputs.push(currentInput);
        currentInput = "";
        seenCloseParen = true;
        output = rendered;
        continue;
      }
      if (token.kind === "punct" && token.text === "," && currentInput.trim().length > 0) {
        inputs.push(currentInput.trimEnd());
        currentInput = "";
        continue;
      }
      currentInput += rendered;
      continue;
    }
    output += rendered;
  }

  const inputsBlock = inputs
    .map((line, idx) => `    ${line.trimStart()}${idx === inputs.length - 1 ? "" : ","}`)
    .join("\n");

  return `${head}\n${inputsBlock}\n${output}`;
}

function renderToken(token: Signature["tokens"][number], ctx: RenderContext): string {
  switch (token.kind) {
    case "keyword":
      return `<span class="kw">${escapeHtml(token.text)}</span>`;
    case "punct":
      return escapeHtml(token.text);
    case "generic":
      return `<span class="generic">${escapeHtml(token.text)}</span>`;
    case "lifetime":
      return `<span class="lifetime">'${escapeHtml(token.text)}</span>`;
    case "type": {
      const target = token.target;
      if (target) {
        const href = typePathHref(target, ctx);
        if (href) {
          return apiSymbolLink({
            kind: typeLinkClass(target),
            href,
            text: token.text,
            title: target.path.join("::"),
          });
        }
      }
      return `<span class="ident">${escapeHtml(token.text)}</span>`;
    }
    case "whitespace":
      return " ";
    case "newline":
      return "\n";
  }
}

function typeLinkClass(target: { external: boolean }): string {
  return target.external ? "rust-extern" : "rust-symbol";
}

function typePathHref(
  target: {
    crate_id: number;
    path: string[];
    html_root_url: string | null;
    external: boolean;
    item_kind?: string;
  },
  ctx: RenderContext,
): string | null {
  if (!target.external) {
    if (target.path.length === 0) return null;
    const name = target.path[target.path.length - 1];
    // Find the actual item in the snapshot so we can use ITS path (which
    // tells us which module page it lives on), not the inbound target.path
    // which may be a re-export shortcut.
    const candidate =
      [...ctx.itemsById.values()].find(
        (i) => i.name === name && i.path.join("::") === target.path.join("::"),
      ) ?? [...ctx.itemsById.values()].find((i) => i.name === name);
    // An item this crate does not render gets no link rather than a guessed one.
    return candidate ? itemPageHref(candidate, ctx) : null;
  }
  return externalItemHref(
    target.path[0] ?? "",
    target.html_root_url,
    target.path,
    target.item_kind,
  );
}

/** The page a crate module renders on. A module path starts with the crate's root module. */
export function rustModuleSlug(crateName: string, modulePath: readonly string[]): string {
  const base = `pkg-${slugifyId(crateName)}`;
  if (modulePath.length === 0) return base;
  return `${base}-${modulePath.map(slugifyId).join("-")}`;
}

export interface RustItemPage {
  readonly slug: string;
  /** The rendered element's id; null for a module, whose page is the target. */
  readonly anchor: string | null;
}

/**
 * Every item a crate renders, with the module page and anchor it renders under: each module's
 * items, their impl and trait members, and their fields and variants (which render inside their
 * parent, so they link to it).
 */
export function rustItemPages(
  crate: CrateSpec,
  itemsById: ReadonlyMap<string, Item>,
): Map<string, RustItemPage> {
  const pages = new Map<string, RustItemPage>();
  const place = (id: string, page: RustItemPage) => {
    if (!pages.has(id) && itemsById.has(id)) pages.set(id, page);
  };
  for (const module of crate.modules) {
    pages.set(module.id, { slug: rustModuleSlug(crate.name, module.path), anchor: null });
  }
  for (const module of crate.modules) {
    const slug = rustModuleSlug(crate.name, module.path);
    for (const id of module.item_ids) {
      const item = itemsById.get(id);
      if (!item || item.inner.kind === "module") continue;
      const own = { slug, anchor: itemAnchor(item) };
      place(id, own);
      for (const memberId of memberItemIds(item)) place(memberId, own);
      for (const implId of collectOwnImplIds(item)) {
        const impl = itemsById.get(implId);
        if (impl?.inner.kind !== "impl") continue;
        place(implId, own);
        for (const memberId of impl.inner.items) {
          const member = itemsById.get(memberId);
          if (member) place(memberId, { slug, anchor: implMemberAnchor(member, false) });
        }
      }
      if (item.inner.kind === "trait") {
        for (const memberId of item.inner.items) {
          const member = itemsById.get(memberId);
          if (!member) continue;
          const required = member.inner.kind === "function" && !member.inner.has_body;
          place(memberId, { slug, anchor: implMemberAnchor(member, required) });
        }
      }
    }
  }
  return pages;
}

/** Fields and variants: rendered inside their parent, without an anchor of their own. */
function memberItemIds(item: Item): readonly string[] {
  switch (item.inner.kind) {
    case "struct":
    case "union":
      return item.inner.fields;
    case "enum":
      return item.inner.variants;
    default:
      return [];
  }
}

/** A type's own impls; a trait's implementations belong to the types that implement it. */
function collectOwnImplIds(item: Item): readonly string[] {
  return item.inner.kind === "trait" ? [] : collectImplIds(item);
}

/**
 * Tab-relative, like every generated page link: the site's link pass resolves it against the
 * pages it builds and rewrites it for the linking page's depth and pretty-URL mode.
 */
function itemPageHref(item: Item, ctx: RenderContext): string | null {
  const page = ctx.itemPages.get(item.id);
  if (!page) return null;
  const href = `${ctx.tabSlug}/${page.slug}.html`;
  return page.anchor ? `${href}#${page.anchor}` : href;
}

function slugifyId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function joinUrl(base: string, suffix: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedSuffix = suffix.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedSuffix}`;
}

// ---------------------------------------------------------------------------
// Intra-doc link resolver
// ---------------------------------------------------------------------------

/**
 * Rewrite markdown intra-doc links using the rustdoc `Item.links` map.
 *
 * `Item.links` is a label→item-id map. We look up each link target in the
 * markdown, substitute either an internal sourcey URL (for items in this
 * crate) or a docs.rs / doc.rust-lang.org URL (for cross-crate items),
 * leaving plain prose untouched. Unresolved labels render as plain text
 * with `title="unresolved intra-doc link"`.
 */
const INTRA_DOC_DESTINATION = "sourcey-intra-doc:";

export interface IntraDocReferences {
  /** Markdown reference definitions, one per link label rustdoc resolved. */
  definitions: string;
  /** Maps a definition's destination, or a path written as one, to its URL. */
  resolveHref: (href: string) => string | null | undefined;
  /** Labels whose target this site does not render. */
  unresolved: string[];
}

/**
 * Intra-doc links as Markdown reference definitions. rustdoc records each link
 * it resolved under the text written between the brackets. Defining those
 * labels lets the Markdown parser apply them as reference links, so code
 * fences, code spans and the docs' own reference links stay as written, and a
 * path written as a destination, `[text](crate::Item)`, resolves the same way.
 * A label rustdoc could not resolve keeps its brackets, as rustdoc renders it.
 */
export function intraDocReferences(
  links: Record<string, LinkTarget>,
  ctx: RenderContext,
): IntraDocReferences {
  const labels = Object.keys(links);
  const hrefs = new Map<string, string | null>();
  const unresolved: string[] = [];
  for (const label of labels) {
    const href = linkTargetHref(links[label], ctx);
    if (href === null) unresolved.push(label);
    hrefs.set(label, href);
  }
  // rustdoc accepts a label with or without code ticks; define both.
  const definitions = labels
    .flatMap((label, index) => {
      const bare = label.replace(/^`(.+)`$/, "$1");
      return [bare, `\`${bare}\``].map(
        (form) => `[${form.replace(/[[\]\\]/g, "\\$&")}]: ${INTRA_DOC_DESTINATION}${index}`,
      );
    })
    .join("\n");
  const resolveHref = (href: string): string | null | undefined => {
    if (href.startsWith(INTRA_DOC_DESTINATION)) {
      return hrefs.get(labels[Number(href.slice(INTRA_DOC_DESTINATION.length))]) ?? null;
    }
    return hrefs.get(href);
  };
  return { definitions, resolveHref, unresolved };
}

function linkTargetHref(target: LinkTarget, ctx: RenderContext): string | null {
  if (target.kind === "external") return externalLinkHref(target);
  const item = ctx.itemsById.get(target.id);
  return item ? itemPageHref(item, ctx) : null;
}

function externalLinkHref(target: Extract<LinkTarget, { kind: "external" }>): string {
  return externalItemHref(target.crate_name, target.html_root_url, target.path, target.item_kind);
}

const STD_CRATES = new Set(["std", "core", "alloc", "proc_macro"]);

/** rustdoc's page prefix for each item kind: `trait.Error.html`. */
const RUSTDOC_PAGE_PREFIX: Record<string, string> = {
  struct: "struct",
  enum: "enum",
  union: "union",
  trait: "trait",
  trait_alias: "traitalias",
  function: "fn",
  type_alias: "type",
  constant: "constant",
  static: "static",
  macro: "macro",
  proc_attribute: "attr",
  proc_derive: "derive",
  primitive: "primitive",
  keyword: "keyword",
  extern_type: "foreigntype",
};

/**
 * An item's page in another crate's rustdoc: the standard library's stable
 * docs, a crate's own docs root, or docs.rs. rustdoc names each page by the
 * item's kind, `core/error/trait.Error.html`; a target without a kind, from an
 * older snapshot, keeps its bare path.
 */
function externalItemHref(
  crateName: string,
  htmlRootUrl: string | null,
  path: readonly string[],
  kind?: string,
): string {
  const root = STD_CRATES.has(crateName)
    ? "https://doc.rust-lang.org/stable"
    : (htmlRootUrl ?? `https://docs.rs/${crateName}/latest`);
  return joinUrl(root, rustdocPagePath(path, kind));
}

function rustdocPagePath(path: readonly string[], kind?: string): string {
  const name = path[path.length - 1] ?? "";
  if (kind === "module") return `${path.join("/")}/index.html`;
  if (kind === "variant" && path.length > 1) {
    return [...path.slice(0, -2), `enum.${path[path.length - 2]}.html#variant.${name}`].join("/");
  }
  const prefix = kind ? RUSTDOC_PAGE_PREFIX[kind] : undefined;
  if (!prefix) return path.join("/");
  return [...path.slice(0, -1), `${prefix}.${name}.html`].join("/");
}

// ---------------------------------------------------------------------------
// Stability + item-info row helpers
// ---------------------------------------------------------------------------

export function renderStabilityCallouts(item: Item): string {
  const parts: string[] = [];
  if (item.deprecation) {
    parts.push(
      apiStabilityCallout({
        kind: "deprecated",
        since: item.deprecation.since,
        reason: item.deprecation.note,
      }),
    );
  }
  const stability: Stability | null = item.stability;
  if (stability?.level === "unstable") {
    parts.push(
      apiStabilityCallout({
        kind: "unstable",
        featureName: stability.feature,
        issueId: stability.issue,
      }),
    );
  }
  for (const featureName of item.feature_gates) {
    parts.push(apiStabilityCallout({ kind: "portability", featureName }));
  }
  if (hasAttr(item, "non_exhaustive")) {
    parts.push(apiStabilityCallout({ kind: "non_exhaustive" }));
  }
  const mustUseReason = extractMustUseReason(item);
  if (mustUseReason !== null) {
    parts.push(
      apiStabilityCallout({
        kind: "must_use",
        reason: mustUseReason === "" ? undefined : mustUseReason,
      }),
    );
  }
  return parts.join("\n");
}

function hasAttr(item: Item, marker: string): boolean {
  return item.attrs_structured.some((a) => a.includes(marker));
}

function extractMustUseReason(item: Item): string | null {
  for (const attr of item.attrs_structured) {
    if (attr.startsWith("MustUse")) return "";
    if (attr.startsWith('#[must_use = "')) {
      const m = attr.match(/^#\[must_use = "([^"]*)"\]/);
      if (m) return m[1];
      return "";
    }
    if (attr === "#[must_use]") return "";
  }
  return null;
}

export function renderItemInfoRow(item: Item, ctx: RenderContext): string {
  const since = item.stability?.level === "stable" ? item.stability.since : null;
  const sourceHref = renderSourceHref(item, ctx);
  return apiItemInfoRow({ since: since ?? null, sourceHref });
}

export function renderSourceHref(item: Item, ctx: RenderContext): string | null {
  if (!item.source) return null;
  const { repo, editBranch, editBasePath } = ctx.sourceLinks;
  if (!repo || !editBranch) return null;
  const base = repo.replace(/\/+$/, "");
  const basePath = editBasePath ? `${editBasePath.replace(/^\/+|\/+$/g, "")}/` : "";
  return `${base}/blob/${editBranch}/${basePath}${item.source.file}#L${item.source.line_start}-L${item.source.line_end}`;
}

// ---------------------------------------------------------------------------
// Item rendering
// ---------------------------------------------------------------------------

export function renderItemHtml(item: Item, ctx: RenderContext): string {
  const anchor = itemAnchor(item);
  const callouts = renderStabilityCallouts(item);
  const infoRow = renderItemInfoRow(item, ctx);
  const signatureHtml = renderItemSignature(item, ctx);
  const docs = renderItemDocs(item, ctx);
  const impls = renderItemImpls(item, ctx);
  return [
    `<section class="rust-item rust-${item.inner.kind} api-item">`,
    infoRow,
    apiSectionAnchor({
      level: 4,
      id: anchor,
      text: itemDisplayName(item) || anchor,
      className: "code-header rust-item-header",
    }),
    signatureHtml,
    callouts,
    docs,
    impls,
    `</section>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderItemImpls(item: Item, ctx: RenderContext): string {
  const traitOwnMembers = renderTraitOwnMembers(item, ctx);
  const implIds = collectImplIds(item);
  if (implIds.length === 0 && !traitOwnMembers) return "";

  // Inherent impls render inline (they carry the type's own API). Trait impls
  // can be numerous and are mostly boilerplate, so they collapse behind one
  // styled toggle each, default closed.
  const inherent: string[] = [];
  const traitImpls: string[] = [];
  const traitRows: string[] = [];

  for (const implId of implIds) {
    const impl = ctx.itemsById.get(implId);
    if (!impl || impl.inner.kind !== "impl") continue;
    const traitName = impl.inner.trait_path?.display;
    const forName = impl.inner.for_type.display;
    const header = traitName ? `impl ${traitName} for ${forName}` : `impl ${forName}`;
    const implAnchorId = itemAnchor(impl);
    const providedMethods = new Set(impl.inner.provided_trait_methods);
    const methodSections = impl.inner.items
      .map((mid) => ctx.itemsById.get(mid))
      .filter((m): m is Item => Boolean(m))
      .map((m) => {
        const isRequired =
          item.inner.kind === "trait" &&
          m.inner.kind === "function" &&
          !providedMethods.has(m.name ?? "");
        return renderImplMember(m, ctx, isRequired);
      })
      .filter(Boolean)
      .join("\n");
    // No <code> child: `.code-header` gives the mono font, and a bare <code>
    // inside the prose container would render with backtick pseudo-elements.
    const implHeader = `<h3 class="code-header rust-impl-header" id="${escapeAttr(
      implAnchorId,
    )}">${escapeHtml(header)}</h3>`;

    if (traitName) {
      if (methodSections) {
        // Substantive trait impls collapse behind a chevron.
        traitImpls.push(apiImplToggle({ open: false, summary: implHeader, body: methodSections }));
      } else {
        // Marker / auto / blanket traits (Send, Sync, From, …) carry no methods.
        // Render them as a quiet, non-expandable row rather than an empty
        // collapsible that opens onto nothing.
        traitRows.push(`<div class="rust-impl-row">${implHeader}</div>`);
      }
    } else if (methodSections) {
      inherent.push(implHeader + methodSections);
    }
  }

  const parts: string[] = [];
  if (traitOwnMembers) parts.push(traitOwnMembers);
  if (inherent.length > 0) {
    parts.push(
      apiSectionAnchor({
        level: 3,
        id: `impls-for-${itemAnchor(item)}`,
        text: "Implementations",
        className: "rust-impls-header",
      }),
    );
    parts.push(inherent.join("\n"));
  }
  if (traitImpls.length > 0 || traitRows.length > 0) {
    parts.push(
      apiSectionAnchor({
        level: 3,
        id: `trait-impls-for-${itemAnchor(item)}`,
        text: "Trait Implementations",
        className: "rust-impls-header",
      }),
    );
    if (traitImpls.length > 0) parts.push(traitImpls.join("\n"));
    if (traitRows.length > 0)
      parts.push(`<div class="rust-impl-rows">${traitRows.join("\n")}</div>`);
  }
  if (parts.length === 0) return "";
  return parts.join("\n");
}

function renderTraitOwnMembers(item: Item, ctx: RenderContext): string {
  if (item.inner.kind !== "trait") return "";
  const members = item.inner.items
    .map((mid) => ctx.itemsById.get(mid))
    .filter((m): m is Item => Boolean(m));
  if (members.length === 0) return "";
  const required: Item[] = [];
  const provided: Item[] = [];
  const assocTypes: Item[] = [];
  const assocConsts: Item[] = [];
  for (const m of members) {
    if (m.inner.kind === "function") {
      // Functions without bodies on a trait are required; with bodies are provided.
      (m.inner.has_body ? provided : required).push(m);
    } else if (m.inner.kind === "assoc_type") {
      assocTypes.push(m);
    } else if (m.inner.kind === "assoc_const") {
      assocConsts.push(m);
    }
  }
  const parts: string[] = [];
  if (assocTypes.length > 0) {
    parts.push(
      apiSectionAnchor({
        level: 3,
        id: "required-associated-types",
        text: "Required Associated Types",
      }),
    );
    parts.push(assocTypes.map((m) => renderImplMember(m, ctx, false)).join("\n"));
  }
  if (assocConsts.length > 0) {
    parts.push(
      apiSectionAnchor({
        level: 3,
        id: "required-associated-consts",
        text: "Required Associated Constants",
      }),
    );
    parts.push(assocConsts.map((m) => renderImplMember(m, ctx, false)).join("\n"));
  }
  if (required.length > 0) {
    parts.push(apiSectionAnchor({ level: 3, id: "required-methods", text: "Required Methods" }));
    parts.push(required.map((m) => renderImplMember(m, ctx, true)).join("\n"));
  }
  if (provided.length > 0) {
    parts.push(apiSectionAnchor({ level: 3, id: "provided-methods", text: "Provided Methods" }));
    parts.push(provided.map((m) => renderImplMember(m, ctx, false)).join("\n"));
  }
  return parts.join("\n");
}

function implMemberAnchor(member: Item, isRequiredTraitMethod: boolean): string {
  if (member.inner.kind === "function") {
    const prefix = isRequiredTraitMethod ? "tymethod" : "method";
    return `${prefix}.${member.name ?? ""}`;
  }
  if (member.inner.kind === "assoc_type") return `associatedtype.${member.name ?? ""}`;
  if (member.inner.kind === "assoc_const") return `associatedconstant.${member.name ?? ""}`;
  return itemAnchor(member);
}

function collectImplIds(item: Item): string[] {
  switch (item.inner.kind) {
    case "struct":
    case "enum":
    case "union":
      return item.inner.impls;
    case "trait":
      // Implementors of the trait are rendered separately below. Trait's own
      // members are handled by renderTraitOwnMembers().
      return item.inner.implementations;
    default:
      return [];
  }
}

function renderImplMember(member: Item, ctx: RenderContext, isRequiredTraitMethod = false): string {
  const anchor = implMemberAnchor(member, isRequiredTraitMethod);
  const sigHtml = renderItemSignature(member, ctx);
  const callouts = renderStabilityCallouts(member);
  const docs = renderItemDocs(member, ctx);
  const infoRow = renderItemInfoRow(member, ctx);
  const body = [
    infoRow,
    `<h4 class="code-header rust-method-header" id="${escapeAttr(anchor)}">${escapeHtml(
      member.name ?? "",
    )}</h4>`,
    sigHtml,
    callouts,
    docs,
  ]
    .filter(Boolean)
    .join("\n");
  if (!body) return "";
  return `<section class="rust-member api-member">${body}</section>`;
}

function renderItemDocs(item: Item, ctx: RenderContext, headingOffset = 4): string {
  if (!item.docs_markdown) return "";
  const { definitions, resolveHref, unresolved } = intraDocReferences(item.links ?? {}, ctx);
  for (const label of unresolved) {
    ctx.diagnostics.push({
      severity: "info",
      code: RUSTDOC_DIAGNOSTIC_CODES.INTRA_DOC_LINK_UNRESOLVED,
      message: `Intra-doc link "${label}" in ${item.path.join("::")} points to an item this site does not render.`,
      crate_name: ctx.crate.name,
      file: item.source?.file ?? null,
      line: item.source?.line_start ?? null,
    });
  }
  let ordinal = 0;
  const markdown = definitions ? `${item.docs_markdown}\n\n${definitions}\n` : item.docs_markdown;
  const rendered = renderMarkdown(markdown, {
    headingOffset,
    headingPrefix: `${itemAnchor(item)}-`,
    resolveHref,
    code(token) {
      const doctest = item.doctests[ordinal];
      const info = (token.lang ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (info[0]?.toLowerCase() === "rust") info.shift();
      // The extractor owns which fences are doctests and their attributes.
      // Match its next entry; foreign-language blocks keep normal rendering.
      if (!doctest || info.join(",") !== doctest.fence_attributes.join(",")) {
        return renderCodeBlock(token.text, token.lang);
      }
      return renderDoctestBlock(item, doctest, ordinal++);
    },
  });
  if (ordinal !== item.doctests.length) {
    throw new Error(`Doctest fences do not match the snapshot for ${item.path.join("::")}`);
  }
  return `<div class="docblock rust-doc">${rendered}</div>`;
}

function renderItemSignature(item: Item, ctx: RenderContext): string {
  if (item.inner.kind === "function") {
    return renderSignature(item.inner.signature, ctx);
  }
  const fallback = fallbackSignatureText(item);
  if (!fallback) return "";
  // A <div>, not <pre><code>: inside the page's prose container a bare <pre>
  // picks up the dark fenced-code-block treatment and a <code> gets backtick
  // pseudo-elements. `.code-header` already supplies the mono font + wrapping.
  return `<div class="code-header rust-signature rust-signature-fallback">${escapeHtml(
    fallback,
  )}</div>`;
}

function fallbackSignatureText(item: Item): string | null {
  const path = item.path.join("::");
  switch (item.inner.kind) {
    case "struct":
      return `pub struct ${path} { /* ... */ }`;
    case "enum":
      return `pub enum ${path} { /* ... */ }`;
    case "trait":
      return `pub trait ${path} { /* ... */ }`;
    case "trait_alias":
      return `pub trait ${path};`;
    case "type_alias":
      return `pub type ${path} = ${item.inner.aliased_type.display};`;
    case "constant":
      return `pub const ${path}: ${item.inner.type_display} = ${item.inner.expr};`;
    case "static":
      return `pub${item.inner.is_mutable ? " mut" : ""} static ${path}: ${item.inner.type_display};`;
    case "macro":
      return `macro_rules! ${item.name ?? ""}`;
    case "proc_macro":
      return `#[${item.inner.macro_kind === "derive" ? "derive" : "proc_macro"}] ${item.name ?? ""}`;
    case "use": {
      const { source, name, is_glob } = item.inner;
      if (is_glob) return `pub use ${source}::*;`;
      const lastSegment = source.split("::").filter(Boolean).pop();
      return name && name !== lastSegment ? `pub use ${source} as ${name};` : `pub use ${source};`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Doctest blocks
// ---------------------------------------------------------------------------

const RUST_EDITION_DEFAULT = "2024";

export function renderDoctestBlock(
  parent: Item,
  dt: Item["doctests"][number],
  idx: number,
): string {
  const anchor = `doctest-${itemAnchor(parent)}-${idx}`;
  const isRust = dt.lang.toLowerCase() === "rust" || dt.lang === "";
  const lang = isRust ? "rust" : dt.lang || "text";
  const badges = renderDoctestBadges(dt);
  const hasHidden = dt.display_code !== dt.executable_code;
  const edition = pickEdition(dt.fence_attributes);
  const playgroundHref =
    isRust && !dt.fence_attributes.includes("ignore")
      ? `https://play.rust-lang.org/?code=${encodeURIComponent(dt.executable_code)}&edition=${edition}`
      : null;

  const runButton = playgroundHref
    ? `<a class="test-arrow rust-doctest-run" href="${escapeAttr(playgroundHref)}" target="_blank" rel="noopener">Run</a>`
    : "";
  const hiddenToggle = hasHidden
    ? `<button class="rust-doctest-toggle-hidden" type="button" data-target="#${anchor}-full" data-display="#${anchor}-code">Show hidden lines</button>`
    : "";
  const controls =
    runButton || hiddenToggle
      ? `<div class="rust-doctest-controls">${runButton}${hiddenToggle}</div>`
      : "";

  return [
    `<div class="rust-doctest api-doctest" id="${anchor}">`,
    badges,
    `<div class="rust-doctest-code" id="${anchor}-code">${renderCodeBlock(dt.display_code, lang)}</div>`,
    hasHidden
      ? `<div class="rust-doctest-code rust-doctest-full" id="${anchor}-full" hidden>${renderCodeBlock(
          dt.executable_code,
          lang,
        )}</div>`
      : "",
    controls,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderDoctestBadges(dt: Item["doctests"][number]): string {
  if (dt.fence_attributes.length === 0) return "";
  const badges = dt.fence_attributes
    .map(
      (a) =>
        `<span class="rust-doctest-badge rust-doctest-badge-${escapeAttr(
          a.replace(/[^a-zA-Z0-9_-]/g, "_"),
        )}" title="${escapeAttr(badgeTitle(a))}">${escapeHtml(a)}</span>`,
    )
    .join(" ");
  return `<div class="rust-doctest-badges">${badges}</div>`;
}

function badgeTitle(attr: string): string {
  switch (attr) {
    case "ignore":
      return "Excluded from testing.";
    case "no_run":
      return "Compiled but not executed.";
    case "should_panic":
      return "Test expected to panic.";
    case "compile_fail":
      return "Test expected to fail to compile.";
    case "edition2018":
    case "edition2021":
    case "edition2024":
      return `Compiled with ${attr.replace("edition", "Rust edition ")}.`;
    case "standalone_crate":
      return "Compiled as a standalone crate.";
    default:
      return attr;
  }
}

function pickEdition(attrs: string[]): string {
  for (const a of attrs) {
    if (a === "edition2018") return "2018";
    if (a === "edition2021") return "2021";
    if (a === "edition2024") return "2024";
  }
  return RUST_EDITION_DEFAULT;
}

// ---------------------------------------------------------------------------
// Module page rendering
// ---------------------------------------------------------------------------

export interface ModulePageRender {
  html: string;
  sidebarSections: SidebarSection[];
}

export interface SidebarSection {
  label: string;
  items: SidebarItem[];
}

export interface SidebarItem {
  text: string;
  anchor: string;
}

export function renderModulePage(
  module: ModuleSpec,
  items: Item[],
  ctx: RenderContext,
): ModulePageRender {
  const parts: string[] = [];
  if (module.docs_markdown) {
    const moduleItem = ctx.itemsById.get(module.id);
    parts.push(
      moduleItem
        ? renderItemDocs(moduleItem, ctx, 2)
        : `<div class="docblock rust-doc">${renderMarkdown(module.docs_markdown, {
            headingOffset: 2,
            headingPrefix: `${module.id}-`,
          })}</div>`,
    );
  }
  const grouped = groupItemsForRendering(items);
  const sidebar: SidebarSection[] = [];
  for (const [group, members] of grouped) {
    if (members.length === 0) continue;
    parts.push(apiSectionAnchor({ level: 2, id: groupAnchor(group), text: group }));
    for (const m of members) {
      const html = renderItemHtml(m, ctx);
      if (!html) continue;
      parts.push(html);
    }
    sidebar.push({
      label: group,
      items: members
        .map((m) => ({ text: itemDisplayName(m), anchor: itemAnchor(m) }))
        .filter((entry) => entry.text)
        .sort((a, b) => a.text.localeCompare(b.text)),
    });
  }

  return {
    html: parts.join("\n"),
    sidebarSections: sidebar,
  };
}

/** Serialize the same native items without parsing the HTML presentation. */
export function renderModuleMarkdown(
  module: ModuleSpec,
  items: Item[],
  ctx: RenderContext,
): string {
  const seen = new Set<string>();
  const render = (item: Item): string => {
    if (seen.has(item.id)) return "";
    seen.add(item.id);
    const signature =
      item.inner.kind === "function" ? item.inner.signature.display : fallbackSignatureText(item);
    const children = [...memberItemIds(item), ...collectOwnImplIds(item)];
    if (item.inner.kind === "impl" || item.inner.kind === "trait")
      children.push(...item.inner.items);
    return [
      `<a id="${item.inner.kind === "function" ? ctx.itemPages.get(item.id)?.anchor || itemAnchor(item) : itemAnchor(item)}"></a>`,
      `## ${
        item.inner.kind === "impl"
          ? `impl ${item.inner.trait_path ? `${item.inner.trait_path.display} for ` : ""}${item.inner.for_type.display}`
          : itemDisplayName(item) || itemAnchor(item)
      }`,
      signature ? fencedCode(signature, "rust") : "",
      item.docs_markdown || "",
      ...Object.entries(item.links).flatMap(([label, target]) => {
        const href = linkTargetHref(target, ctx);
        return href ? [`[${label.replace(/^`(.+)`$/, "$1")}]: ${href}`] : [];
      }),
      ...children
        .map((id) => ctx.itemsById.get(id))
        .filter((child): child is Item => !!child)
        .map(render),
    ]
      .filter(Boolean)
      .join("\n\n");
  };
  return [module.docs_markdown, ...[...groupItemsForRendering(items).values()].flat().map(render)]
    .filter(Boolean)
    .join("\n\n");
}

const GROUP_ORDER = [
  "Modules",
  "Macros",
  "Structs",
  "Enums",
  "Unions",
  "Traits",
  "Trait Aliases",
  "Type Aliases",
  "Constants",
  "Statics",
  "Functions",
  "Re-exports",
  "Implementations",
] as const;

function groupItemsForRendering(items: Item[]): Map<(typeof GROUP_ORDER)[number], Item[]> {
  const out = new Map<(typeof GROUP_ORDER)[number], Item[]>();
  for (const g of GROUP_ORDER) out.set(g, []);
  for (const item of items) {
    const group = groupForItem(item);
    if (group) out.get(group)!.push(item);
  }
  return out;
}

function groupForItem(item: Item): (typeof GROUP_ORDER)[number] | null {
  switch (item.inner.kind) {
    case "module":
      return "Modules";
    case "macro":
    case "proc_macro":
      return "Macros";
    case "struct":
      return "Structs";
    case "enum":
      return "Enums";
    case "union":
      return "Unions";
    case "trait":
      return "Traits";
    case "trait_alias":
      return "Trait Aliases";
    case "type_alias":
      return "Type Aliases";
    case "constant":
      return "Constants";
    case "static":
      return "Statics";
    case "function":
      return "Functions";
    case "use":
      return "Re-exports";
    case "impl":
      return "Implementations";
    default:
      return null;
  }
}

function groupAnchor(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Re-export for unit tests.
export const __internals = {
  encodeImplAnchor,
  encodeGenericSegment,
  itemAnchor,
  renderDoctestBadges,
  pickEdition,
  externalItemHref,
};
