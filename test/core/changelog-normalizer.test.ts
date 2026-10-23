import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeChangelog } from "../../src/core/changelog-normalizer.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "../fixtures");

describe("normalizeChangelog", () => {
  it("parses Keep a Changelog style release notes into a normalized model", () => {
    const markdown = readFileSync(resolve(FIXTURE_DIR, "changelog.md"), "utf-8");
    const changelog = normalizeChangelog(markdown, {
      repoUrl: "https://github.com/example/project",
    });

    expect(changelog.title).toBe("Changelog");
    expect(changelog.format).toBe("keepachangelog");
    expect(changelog.versions).toHaveLength(3);
    expect(changelog.versions[1].version).toBe("1.2.0");
    expect(changelog.versions[1].compareUrl).toContain("v1.1.0...v1.2.0");
    expect(changelog.versions[1].sections[0].type).toBe("added");
    expect(changelog.versions[1].sections[0].entries[1].refs).toEqual([
      {
        type: "pr",
        id: "42",
        url: "https://github.com/example/project/pull/42",
      },
    ]);
    expect(changelog.diagnostics).toEqual([]);
  });

  it("keeps an entry as written and its text as a reader reads it", () => {
    const changelog = normalizeChangelog(
      "# Changelog\n\n## 1.0.0 - 2026-01-01\n\n### Fixed\n\n- A reader's \"quoted\" `code` & [link](./guide.md)\n",
    );
    const [entry] = changelog.versions[0].sections[0].entries;

    expect(entry.markdown).toBe("A reader's \"quoted\" `code` & [link](./guide.md)");
    expect(entry.text).toBe("A reader's \"quoted\" code & link");
  });

  it("detects conventional changelog section names and maps them to canonical change types", () => {
    const markdown = readFileSync(resolve(FIXTURE_DIR, "changelog-conventional.md"), "utf-8");
    const changelog = normalizeChangelog(markdown);

    expect(changelog.format).toBe("conventional");
    expect(changelog.versions[0].sections.map((section) => section.type)).toEqual([
      "added",
      "fixed",
      "changed",
    ]);
  });

  it("emits validation diagnostics for unknown section labels and missing dates", () => {
    const changelog = normalizeChangelog(`
# Changelog

## 1.0.0

### Documentation

- Updated the guides
`);

    expect(changelog.diagnostics).toEqual([
      expect.objectContaining({ code: "CHG001_MISSING_DATE", severity: "warning" }),
      expect.objectContaining({ code: "CHG002_UNKNOWN_TYPE", severity: "warning" }),
    ]);
  });
});
