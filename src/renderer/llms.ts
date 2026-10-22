import type { SiteNavigation } from "../core/navigation.js";
import type { ReadableDocument } from "../exports/documents.js";
import { compactDescription } from "../exports/markdown.js";

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

/** A document's Markdown with a code fence it leaves open closed, so the next document in the file starts as prose. */
export function closeMarkdownFence(markdown: string): string {
  let fence: { char: string; length: number } | null = null;
  for (const line of markdown.split("\n")) {
    if (fence) { if (closesFence(line, fence)) fence = null; }
    else fence = fenceStart(line);
  }
  return fence ? `${markdown.trimEnd()}\n${fence.char.repeat(fence.length)}\n` : markdown;
}

function fenceStart(line: string): { char: string; length: number } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

function closesFence(line: string, fence: { char: string; length: number }): boolean {
  return new RegExp(`^ {0,3}${fence.char}{${fence.length},} *$`).test(line);
}
