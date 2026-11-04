import type { NormalizedChangelogVersion } from "../core/types.js";

/** The same release text for readable documentation and publisher notes. */
export function changelogVersionMarkdown(version: NormalizedChangelogVersion): string {
  return [
    `## ${version.version ?? "Unreleased"}${version.date ? ` (${version.date})` : ""}`,
    version.summary,
    ...version.sections.map(section =>
      `### ${section.label}\n\n${section.entries.map(entry => `- ${entry.markdown}`).join("\n")}`),
  ].filter(Boolean).join("\n\n");
}
