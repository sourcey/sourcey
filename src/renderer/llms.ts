import type { SiteNavigation } from "../core/navigation.js";
import type { ReadableDocument } from "../exports/documents.js";
import { compactDescription } from "../exports/markdown.js";
import { closeMarkdownFence } from "../core/markdown-loader.js";

/** Indexes the same readable documents used by page exports and the full file. */
export function generateLlmsTxt(
  documents: ReadableDocument[],
  navigation: SiteNavigation,
  name: string,
  markdown: boolean,
): string {
  const lines = [`# ${name || documents[0]?.entry.title || "Documentation"}`, ""];
  const byTab = new Map<string, ReadableDocument[]>();
  for (const document of documents) {
    const group = byTab.get(document.entry.tab) ?? [];
    group.push(document);
    byTab.set(document.entry.tab, group);
  }
  for (const tab of navigation.tabs) {
    const group = byTab.get(tab.slug);
    if (!group?.length) continue;
    lines.push(`## ${tab.label}`, "");
    for (const { entry } of group) {
      const description = compactDescription(entry.description);
      lines.push(
        `- [${entry.title}](${markdown ? entry.markdown : entry.url})${description ? `: ${description}` : ""}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function generateLlmsFullTxt(documents: ReadableDocument[], name: string): string {
  const parts = [`# ${name || documents[0]?.entry.title || "Documentation"}`];
  for (const document of documents) {
    if (!document.aggregate) continue;
    const path = document.entry.url.replace(/^https?:\/\/[^/]+/, "");
    parts.push(
      `### ${document.entry.title}\n\nPath: \`${path}\`\n\n${closeMarkdownFence(document.content)}`,
    );
  }
  return parts.join("\n\n") + "\n";
}
