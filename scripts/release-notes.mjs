import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeChangelog } from "../dist/core/changelog-normalizer.js";
import { changelogVersionMarkdown } from "../dist/exports/changelog.js";

export function releaseNotes(markdown, version) {
  if (!version) throw new Error("A release version is required.");
  const changelog = normalizeChangelog(markdown);
  const matches = changelog.versions.filter(release => release.version === version);
  if (matches.length !== 1) throw new Error(`Expected one changelog entry for ${version}, found ${matches.length}.`);
  const release = matches[0];
  if (!release.date) throw new Error(`Changelog entry ${version} needs its release date.`);
  if (!release.summary && !release.sections.some(section => section.entries.length))
    throw new Error(`Changelog entry ${version} has no release notes.`);
  return changelogVersionMarkdown(release) + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(releaseNotes(await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"), process.argv[2]));
}
