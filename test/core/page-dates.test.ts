import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-page-dates-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}
/** A commit on a fixed day, whatever the machine's git settings. */
function commit(root: string, date: string, ...paths: string[]) {
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Pets", "-c", "user.email=pets@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  git("add", ...paths);
  git("commit", "-q", "-m", `Change ${paths.join(", ")}`);
}
async function site(root: string, pages = ["start", "feed", "draft"], lang?: string) {
  const config = await resolveConfigFromRaw({ name: "Pets", siteUrl: "https://pets.example", lastUpdated: true, theme: { fonts: { google: false } }, ...(lang ? { i18n: { defaultLocale: "fr", locales: { fr: { label: "Français", lang } } } } : {}), navigation: { tabs: [
    { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages }] }) },
  ] } }, root);
  return sourceyArtifacts(await buildSourceySite({ config, generateOgImages: false }));
}

describe("lastUpdated", () => {
  it("dates each page by its file's last commit, at its end and in the sitemap, in the page's language", () => fixture(async root => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    await file(root, "docs/start.md", "# Start\n\nInstall it.\n");
    await file(root, "docs/feed.md", "# Feed\n\nTwice a day.\n");
    commit(root, "2026-09-01T10:00:00+00:00", "docs/start.md", "docs/feed.md");
    await file(root, "docs/feed.md", "# Feed\n\nThree times a day.\n");
    commit(root, "2026-10-23T22:30:00+10:00", "docs/feed.md");
    await file(root, "docs/draft.md", "# Draft\n\nNot committed.\n");
    const files = await site(root);
    const page = (path: string) => files.get(path)!.toString();
    expect(page("start.html")).toContain('<p class="sourcey-last-updated">Last updated <time datetime="2026-09-01T10:00:00Z">September 1, 2026</time></p>');
    // A day is the day in UTC, wherever the commit was made.
    expect(page("feed.html")).toContain('<time datetime="2026-10-23T22:30:00+10:00">October 23, 2026</time>');
    expect(page("draft.html")).not.toContain("sourcey-last-updated");
    expect(files.get("sitemap.xml")!.toString()).toContain("<loc>https://pets.example/feed.html</loc><lastmod>2026-10-23T22:30:00+10:00</lastmod>");
    expect(files.get("sitemap.xml")!.toString()).toContain("<loc>https://pets.example/draft.html</loc></url>");
    const french = await site(root, undefined, "fr");
    expect(french.get("start.html")!.toString()).toContain("Dernière mise à jour <time datetime=\"2026-09-01T10:00:00Z\">1 septembre 2026</time>");
  }));

  it("stops on a checkout without its history, and outside a repository", () => fixture(async root => {
    const origin = join(root, "origin");
    await mkdir(origin);
    execFileSync("git", ["init", "-q"], { cwd: origin });
    await file(origin, "docs/start.md", "# Start\n");
    commit(origin, "2026-09-01T10:00:00+00:00", "docs/start.md");
    await file(origin, "docs/start.md", "# Start\n\nAgain.\n");
    commit(origin, "2026-09-02T10:00:00+00:00", "docs/start.md");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, "shallow"], { cwd: root });
    await expect(site(join(root, "shallow"), ["start"])).rejects.toThrow(/holds only the latest commits; check out the whole history \(fetch-depth: 0 for actions\/checkout\)/);
    const loose = join(root, "loose");
    await file(loose, "docs/start.md", "# Start\n");
    await expect(site(loose, ["start"])).rejects.toThrow(/lastUpdated dates each page by its last commit, and .*loose is in no git repository with commits/);
  }));
});
