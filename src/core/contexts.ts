import { resolve } from "node:path";
import type {
  ResolvedConfig,
  ResolvedTab,
  SourceyConfig,
  TabConfig,
  VersionItem,
} from "../config.js";
import type { SourceLocaleContext } from "../adapters/types.js";
import type { ResolvedSiteContext } from "./site-model.js";
import { messagesFor } from "./messages.js";

const current: VersionItem = {
  id: "current",
  label: "Current",
  path: "",
  content: "",
  status: "maintained",
  index: true,
};

function path(value: string | undefined): string {
  if (!value) return "";
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /[?#]/.test(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  ) {
    throw new Error(`Expected a relative context path: ${value}`);
  }
  return value;
}
function versions<T extends VersionItem>(
  input: { default: string; items: T[] } | undefined,
): T[] | VersionItem[] {
  if (!input) return [current];
  const ids = new Set<string>(),
    paths = new Set<string>();
  for (const item of input.items) {
    if (!item.id || !item.label || ids.has(item.id))
      throw new Error(`Invalid or duplicate version: ${item.id}`);
    ids.add(item.id);
    const output = path(item.path ?? (item.id === input.default ? "" : item.id));
    if (paths.has(output)) throw new Error(`Duplicate version path: ${output}`);
    paths.add(output);
    if (item.status && !["maintained", "preview", "archived"].includes(item.status))
      throw new Error(`Invalid version status: ${item.status}`);
  }
  if (!ids.has(input.default)) throw new Error(`Default version does not exist: ${input.default}`);
  return input.items;
}

export async function resolveContexts(
  raw: SourceyConfig,
  configDir: string,
  resolveTabs: (
    tabs: TabConfig[],
    dir: string,
    locale: SourceLocaleContext,
  ) => Promise<ResolvedTab[]>,
): Promise<ResolvedSiteContext[]> {
  const defaultLocale = raw.i18n?.defaultLocale ?? "en";
  const locales = raw.i18n?.locales ?? { en: { label: "English", lang: "en" } };
  if (!locales[defaultLocale]) throw new Error(`Default locale does not exist: ${defaultLocale}`);
  const scopes = new Map<
    string,
    { tabs: TabConfig[]; input: SourceyConfig["versions"] | TabConfig["versions"] }
  >();
  for (const tab of raw.navigation.tabs) {
    const scope =
      tab.versions === false
        ? "unversioned"
        : tab.versions
          ? `tab:${tab.id ?? tab.slug ?? tab.tab}`
          : "site";
    const group = scopes.get(scope) ?? {
      tabs: [],
      input: tab.versions === false ? undefined : (tab.versions ?? raw.versions),
    };
    group.tabs.push(tab);
    scopes.set(scope, group);
  }
  const contexts: ResolvedConfig["contexts"] = [];
  for (const [scope, { tabs, input }] of scopes) {
    const versionInput = input || undefined;
    for (const selected of versions(versionInput)) {
      const version = {
        ...selected,
        path: path(
          selected.path ??
            (selected.id === versionInput?.default ? "" : versionInput ? selected.id : ""),
        ),
        content: selected.content ?? "",
        status: selected.status ?? "maintained",
        index: selected.index ?? true,
      };
      const historical = "navigation" in selected ? selected.navigation : undefined;
      const memberTabs = historical
        ? historical.tabs.filter((tab) => tabs.some((t) => (t.id ?? t.tab) === (tab.id ?? tab.tab)))
        : tabs;
      if (historical && memberTabs.length !== tabs.length)
        throw new Error(`Historical navigation must retain stable tab IDs in ${version.id}`);
      for (const [locale, localeConfig] of Object.entries(locales)) {
        const localePath = path(localeConfig.path ?? (locale === defaultLocale ? "" : locale));
        const prefix = [localePath, scope.startsWith("tab:") ? "" : version.path]
          .filter(Boolean)
          .join("/");
        const definitions = memberTabs.map((tab) => {
          const versionSource = "source" in selected ? selected.source as import("../adapters/types.js").SourceAdapter : undefined;
          const source = tab.translations?.[locale] ?? versionSource;
          if (!source) return tab;
          return {
            ...tab,
            source,
            openapi: undefined,
            mcp: undefined,
            groups: undefined,
            doxygen: undefined,
            godoc: undefined,
            rustdoc: undefined,
          };
        });
        const source: SourceLocaleContext = {
          locale,
          defaultLocale,
          content: path(localeConfig.content ?? (locale === defaultLocale ? "" : locale)),
          defaultContent: path(locales[defaultLocale].content),
          fallback: raw.i18n?.fallback !== false,
        };
        const resolved = await resolveTabs(definitions, resolve(configDir, version.content), source);
        for (const tab of resolved)
          tab.slug = [prefix, tab.slug, scope.startsWith("tab:") ? version.path : ""]
            .filter(Boolean)
            .join("/");
        contexts.push({
          key: JSON.stringify([scope, version.id, locale]),
          scope,
          version,
          locale,
          localeConfig: {
            ...localeConfig,
            lang: localeConfig.lang ?? locale,
            dir: localeConfig.dir ?? "ltr",
            messages: messagesFor(localeConfig.lang ?? locale, localeConfig.messages),
          },
          defaultLocale,
          defaultLang: locales[defaultLocale].lang ?? defaultLocale,
          isDefaultVersion: version.id === (versionInput?.default ?? "current"),
          prefix,
          localePath,
          source,
          tabs: resolved,
        });
      }
    }
  }
  return contexts;
}
