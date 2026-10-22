import { createRequire } from "node:module";
import type { CodeFenceMetadata } from "./markdown.js";
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { INITIAL, Theme, type StateStack } from "shiki/textmate";
import githubLight from "shiki/themes/github-light-default.mjs";
import darkPlus from "shiki/themes/dark-plus.mjs";

// Cache on globalThis so Vite SSR re-evaluation doesn't create new instances.
const CACHE_KEY = "__sourcey_shiki__";
const shared = globalThis as Record<string, unknown>;
// Oniguruma, the regex engine the grammars are written for, compiled to
// WebAssembly: it reads them as written, where the JavaScript engine
// translates each pattern and missed some (SQL's SUM read as plain text),
// and it highlights in half the time.
const highlighter = await ((shared[CACHE_KEY] as Promise<HighlighterCore> | undefined)
  ?? (shared[CACHE_KEY] = createHighlighterCore({
    themes: [githubLight, darkPlus],
    langs: [],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  })));

/**
 * The languages code is highlighted in: each grammar's name and the other
 * names a fence may give it. A grammar is read, with the grammars it reaches,
 * the first time a block in its language is drawn, so a site holds only the
 * grammars of the languages it shows: a compiled grammar holds megabytes.
 */
export const LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  c: [], cmake: [], cpp: ["c++"], "cpp-macro": [], csharp: ["c#", "cs"], css: [], dart: [], docker: ["dockerfile"],
  glsl: [], go: [], graphql: ["gql"], haml: [], html: [], java: [], javascript: ["js", "cjs", "mjs"], json: [],
  jsx: [], kotlin: ["kt", "kts"], lua: [], php: [], python: ["py"], regexp: ["regex"], ruby: ["rb"], rust: ["rs"],
  shellscript: ["bash", "sh", "shell", "zsh"], sql: [], swift: [], tsx: [], typescript: ["ts", "cts", "mts"], xml: [], yaml: ["yml"],
};
/**
 * Each language's grammar comes from its own module, which registers the
 * grammars it embeds, except where a grammar reaches one that module leaves
 * out: C++ macros include C++, and HAML embeds Ruby only once Ruby is loaded.
 */
export const GRAMMAR_MODULES: Readonly<Record<string, string>> = { "cpp-macro": "cpp", haml: "ruby" };
const grammarNames = new Map(Object.entries(LANGUAGES).flatMap(([name, aliases]) => [name, ...aliases].map((alias) => [alias, name] as const)));
const require = createRequire(import.meta.url);
const read = new Set<string>();

/** The grammar a fence's language is highlighted with, or undefined for a language that is not. */
function grammarFor(language: string) {
  const name = grammarNames.get(language);
  if (!name) return undefined;
  const module = GRAMMAR_MODULES[name] ?? name;
  if (!read.has(module)) {
    highlighter.loadLanguageSync((require(`shiki/langs/${module}.mjs`) as { default: LanguageRegistration[] }).default);
    read.add(module);
  }
  return highlighter.getLanguage(name);
}

/**
 * The two code themes as the tokenizer matches them. A page shows the first
 * in light mode and the second in dark, each through its own CSS variables.
 */
const themes = ([["light", "github-light-default"], ["dark", "dark-plus"]] as const).map(([name, id]) => {
  const resolved = highlighter.getTheme(id);
  const theme = Theme.createFromRawTheme(resolved);
  const { foregroundId, fontStyle } = theme.getDefaults();
  return { name, id, theme, colors: theme.getColorMap(), replacements: resolved.colorReplacements, fg: resolved.fg, bg: resolved.bg, defaults: { foreground: foregroundId, fontStyle } };
});
const PRE = `<pre class="shiki shiki-themes ${themes.map(({ id }) => id).join(" ")}" style="${[
  ...themes.map(({ name, fg }) => `--shiki-${name}:${fg}`),
  ...themes.map(({ name, bg }) => `--shiki-${name}-bg:${bg}`),
].join(";")}" tabindex="0"><code>`;

/** The tokenizer's font style bits; `NOT_SET` leaves a scope's parent's style. */
const NOT_SET = -1, ITALIC = 1, BOLD = 2, UNDERLINE = 4, STRIKETHROUGH = 8;
interface Style { foreground: number; fontStyle: number }

/** A token's style attribute in both themes: each theme's colour and font, unset ones inherited, as Shiki writes it. */
function tokenStyle(styles: readonly Style[]): string {
  const variants = styles.map(({ foreground, fontStyle }, index) => {
    const { colors, replacements } = themes[index];
    const color = colors[foreground];
    const variant: Record<string, string> = {};
    if (color) variant.color = replacements?.[color.toLowerCase()] || color;
    if (fontStyle & ITALIC) variant["font-style"] = "italic";
    if (fontStyle & BOLD) variant["font-weight"] = "bold";
    const decoration = [fontStyle & UNDERLINE ? "underline" : "", fontStyle & STRIKETHROUGH ? "line-through" : ""].filter(Boolean).join(" ");
    if (decoration) variant["text-decoration"] = decoration;
    return variant;
  });
  const keys = [...new Set(variants.flatMap((variant) => Object.keys(variant)))];
  return variants.flatMap((variant, index) => keys.map((key) => `--shiki-${themes[index].name}${key === "color" ? "" : `-${key}`}:${variant[key] || "inherit"}`)).join(";");
}

/**
 * A scope path and its style in both themes, folded from the root as the
 * tokenizer folds it: each scope's matching rule sets what it names and
 * leaves the rest to its parent. One tokenizing of a block reads both themes.
 */
interface Scope { readonly scopeName: string; readonly parent: Scope | null; styles: Style[]; style: string; children?: Map<string, Scope> }
const roots = new Map<string, Scope>();
function scope(parent: Scope | null, scopeName: string): Scope {
  const siblings = parent ? (parent.children ??= new Map()) : roots;
  let node = siblings.get(scopeName);
  if (node) return node;
  node = { scopeName, parent, styles: [], style: "" };
  // A theme matches a path by its scope name and its parents' alone.
  const path = node as unknown as Parameters<Theme["match"]>[0];
  node.styles = themes.map(({ theme, defaults }, index) => {
    const inherited = parent?.styles[index] ?? defaults;
    const matched = theme.match(path);
    return { foreground: matched?.foregroundId || inherited.foreground, fontStyle: matched && matched.fontStyle !== NOT_SET ? matched.fontStyle : inherited.fontStyle };
  });
  node.style = tokenStyle(node.styles);
  siblings.set(scopeName, node);
  return node;
}
/** Code in each theme's own default colour and font is left as text, which takes the block's colour. */
const plain = themes.every(({ colors, defaults, fg }) => colors[defaults.foreground]?.toLowerCase() === fg.toLowerCase())
  ? tokenStyle(themes.map(({ defaults }) => defaults)) : undefined;

const escapeCode = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Highlight code at build time, in both code themes from one tokenizing. Each
 * token carries `--shiki-light` and `--shiki-dark`, which the theme's CSS
 * reads in light and dark mode, so the page switches with no script.
 */
export function highlightCode(code: string, lang?: string, metadata?: CodeFenceMetadata): string {
  function lineClasses(line: number): string[] {
    if (!metadata) return [];
    return [metadata.highlight.includes(line) && "highlighted", metadata.focus.length && (metadata.focus.includes(line) ? "focused" : "unfocused"), metadata.add.includes(line) && "diff-added", metadata.remove.includes(line) && "diff-removed"].filter((value): value is string => typeof value === "string");
  }

  const grammar = lang ? grammarFor(lang) : undefined;
  if (!grammar) {
    const lines = escapeCode(code).split("\n").map((l, index) => `<span class="line ${lineClasses(index + 1).join(" ")}"><span>${l}</span></span>`).join("\n");
    return `<pre class="shiki" tabindex="0"><code>${lines}</code></pre>`;
  }

  let state: StateStack = INITIAL;
  const lines = code.split(/\r?\n/).map((line, index) => {
    const open = `<span class="${["line", ...lineClasses(index + 1)].join(" ")}">`;
    // An empty line is not tokenized and leaves the grammar's state where it was, as Shiki leaves it.
    if (!line) return `${open}</span>`;
    const { tokens, ruleStack } = grammar.tokenizeLine(line, state, 500);
    state = ruleStack;
    let body = "", run = "", runStyle: string | undefined;
    const flush = () => { if (run) body += runStyle === undefined || runStyle === plain ? escapeCode(run) : `<span style="${runStyle}">${escapeCode(run)}</span>`; };
    for (const token of tokens) {
      const text = line.slice(token.startIndex, token.endIndex);
      if (!text) continue;
      // Whitespace shows no colour, so it joins the run beside it.
      if (/^\s+$/.test(text)) { run += text; continue; }
      let node: Scope | null = null;
      for (const name of token.scopes) node = scope(node, name);
      const style = node!.style;
      if (runStyle !== undefined && style !== runStyle) { flush(); run = ""; }
      run += text; runStyle = style;
    }
    flush();
    return `${open}${body}</span>`;
  });
  return `${PRE}${lines.join("\n")}</code></pre>`;
}
