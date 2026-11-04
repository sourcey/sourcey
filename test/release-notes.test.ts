import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { releaseNotes } from "../scripts/release-notes.mjs";
import { normalizeChangelog } from "../src/core/changelog-normalizer.js";
import { changelogVersionMarkdown } from "../src/exports/changelog.js";
import { loadConfig } from "../src/config.js";
import { buildSourceySite } from "../src/site.js";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const entry = `## ${version} - 2026-11-05\n\n### Fixed\n\n- Keep a reader's "quoted" \`code\` & [link](https://sourcey.com).\n`;

it("uses the same normalized release text as readable documentation and excludes other releases", () => {
  const markdown = `# Changelog\n\n## Unreleased\n\n- Not published yet.\n\n${entry}`;
  const parsed = normalizeChangelog(markdown).versions.find(release => release.version === version)!;
  expect(releaseNotes(markdown, version)).toBe(changelogVersionMarkdown(parsed) + "\n");
  expect(releaseNotes(markdown, version)).toContain("a reader's \"quoted\" `code` & [link]");
  expect(releaseNotes(markdown, version)).not.toContain("Not published yet");
});

it("refuses a missing, duplicate, empty or undated release instead of publishing incomplete notes", () => {
  for (const markdown of ["# Changelog\n", entry + "\n" + entry, `## ${version} - 2026-11-05\n`, `## ${version}\n\n- A fix.\n`])
    expect(() => releaseNotes(markdown, version)).toThrow();
  expect(() => releaseNotes(entry, "")).toThrow();
});

it("prints exactly the current release's canonical notes through the publisher command", () => {
  const markdown = readFileSync(new URL("CHANGELOG.md", root), "utf8");
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("scripts/release-notes.mjs", root)), version], { encoding: "utf8" });
  expect(output).toBe(releaseNotes(markdown, version));
  expect(output).not.toContain("## Unreleased");
});

it("builds the documentation changelog from the root source at its existing address", async () => {
  const site = await buildSourceySite({ config: await loadConfig(fileURLToPath(new URL("docs/sourcey.config.ts", root))), generateOgImages: false });
  const page = site.pages.find(page => page.outputPath === "changelog.html")!;
  expect(page.source).toBe(fileURLToPath(new URL("CHANGELOG.md", root)));
  expect(page.currentPage.kind).toBe("changelog");
  if (page.currentPage.kind !== "changelog") throw new Error("The documentation did not publish its native changelog.");
  expect(page.currentPage.changelog.changelog.versions.some(release => release.version === version)).toBe(true);
  expect(site.pages.some(page => page.outputPath === "changelog/changelog.html")).toBe(false);
});
