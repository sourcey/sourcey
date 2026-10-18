import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DocumentationEntry, DocumentationIndex } from "./documents.js";

export type { DocumentationEntry, DocumentationIndex } from "./documents.js";

/** The public index contract, validated once by consumers of built documentation. */
export function parseDocumentationIndex(value: unknown): DocumentationIndex {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("documents" in value) ||
    !Array.isArray(value.documents)
  )
    throw new Error(
      "Expected a Sourcey documents.json version 1 index. Rebuild with Markdown exports enabled.",
    );
  const seen = new Set<string>();
  for (const entry of value.documents) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !["id", "title", "description", "tab", "url", "markdown", "file"].every(
        (key) => typeof entry[key] === "string",
      ) ||
      !["page", "operation", "schema"].includes(entry.kind) ||
      (entry.searchText !== undefined && typeof entry.searchText !== "string") ||
      seen.has(entry.id)
    )
      throw new Error("Malformed or duplicate document entry.");
    if (
      !entry.file.endsWith(".md") ||
      isAbsolute(entry.file) ||
      entry.file.split(/[\\/]/).some((part: string) => part === ".." || !part)
    )
      throw new Error(`Unsafe document path: ${entry.file}`);
    if (
      entry.symbols !== undefined &&
      (!Array.isArray(entry.symbols) ||
        entry.symbols.some(
          (symbol: unknown) =>
            !symbol ||
            typeof symbol !== "object" ||
            !("name" in symbol) ||
            typeof symbol.name !== "string" ||
            !("kind" in symbol) ||
            typeof symbol.kind !== "string" ||
            ("anchor" in symbol && typeof symbol.anchor !== "string"),
        ))
    )
      throw new Error(`Malformed symbols for ${entry.id}`);
    seen.add(entry.id);
  }
  return value as DocumentationIndex;
}

export async function openDocumentation(directory: string) {
  const root = await realpath(directory);
  const indexPath = await realpath(resolve(root, "documents.json"));
  if (relative(root, indexPath).startsWith("..") || isAbsolute(relative(root, indexPath)))
    throw new Error("Index resolves outside the built documentation.");
  const index = parseDocumentationIndex(JSON.parse(await readFile(indexPath, "utf8")));
  const byId = new Map(index.documents.map((entry) => [entry.id, entry]));
  const searchRows = index.documents.map((entry, order) => ({
    entry,
    order,
    title: entry.title.toLowerCase(),
    text: `${entry.title} ${entry.description} ${entry.searchText ?? ""} ${(entry.symbols ?? []).map((symbol) => symbol.name).join(" ")}`.toLowerCase(),
  }));
  return {
    index,
    async read(id: string): Promise<{ entry: DocumentationEntry; text: string }> {
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown document: ${id}`);
      const path = await realpath(resolve(root, entry.file));
      const within = relative(root, path);
      if (within.startsWith("..") || isAbsolute(within))
        throw new Error("Document resolves outside the built documentation.");
      return { entry, text: await readFile(path, "utf8") };
    },
    search(query: string, limit = 10): DocumentationEntry[] {
      const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      return searchRows
        .map(({ entry, order, title, text }) => {
          const score = terms.every((term) => text.includes(term))
            ? terms.reduce((total, term) => total + (title.includes(term) ? 4 : 1), 0)
            : 0;
          return { entry, score, order };
        })
        .filter((match) => match.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            Number(a.entry.kind === "page") - Number(b.entry.kind === "page") ||
            a.order - b.order,
        )
        .slice(0, Math.max(1, Math.min(20, limit)))
        .map((match) => match.entry);
    },
    symbols(name: string, limit = 10) {
      const needle = name.toLowerCase().trim();
      return needle
        ? index.documents
            .flatMap((entry) =>
              (entry.symbols ?? [])
                .filter((symbol) => symbol.name.toLowerCase().includes(needle))
                .map((symbol) => ({
                  ...symbol,
                  document: entry.id,
                  url: symbol.anchor ? `${entry.url.split("#", 1)[0]}#${symbol.anchor}` : entry.url,
                })),
            )
            .slice(0, Math.max(1, Math.min(20, limit)))
        : [];
    },
  };
}
