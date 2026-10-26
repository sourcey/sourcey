import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdown } from "../../src/adapters/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function site(href: string, theme: "default" | "reader" = "default") {
  const root = await mkdtemp(join(tmpdir(), "sourcey-github-stats-"));
  try {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/start.md"), "# Start\n\nInstall it.\n");
    const config = await resolveConfigFromRaw({ name: "Pets", theme: { name: theme, fonts: { google: false } }, navbar: { links: [{ type: "github", href, stats: true }] }, navigation: { tabs: [
      { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start"] }] }) },
    ] } }, root);
    const built = await buildSourceySite({ config, generateOgImages: false });
    return { built, start: (await sourceyArtifacts(built)).get("start.html")!.toString() };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
/**
 * The GitHub link as a reader meets it: whether it carries a label of its own,
 * the name its text gives it, and the figures it shows, the words they stand
 * for being read and not shown.
 */
function repositoryLink(html: string) {
  const link = /<a [^>]*>(?:(?!<\/a>)[\s\S])*sourcey-repository-stats(?:(?!<\/a>)[\s\S])*<\/a>/.exec(html)![0];
  const text = (markup: string) => markup.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
  return { labelled: /^<a [^>]*aria-label=/.test(link), name: text(link), shown: text(link.replace(/<span class="sr-only">[^<]*<\/span>/g, " ")).trim().split(/\s+/) };
}
/** GitHub's API as a repository with these numbers answers it. */
function github(answers: Record<string, { status?: number; body?: object }>) {
  const asked: { url: string; authorization?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    asked.push({ url, authorization: (init.headers as Record<string, string>).authorization });
    const answer = answers[url] ?? { status: 404 };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  });
  return asked;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("a GitHub link's numbers", () => {
  for (const theme of ["default", "reader"] as const) it(`${theme}: show the latest release, stars and forks, read once when the site builds`, async () => {
    const repository = `pets/${theme}`;
    vi.stubEnv("GITHUB_TOKEN", "token-1");
    const asked = github({
      [`https://api.github.com/repos/${repository}`]: { body: { stargazers_count: 25_123, forks_count: 2_412 } },
      [`https://api.github.com/repos/${repository}/releases/latest`]: { body: { tag_name: "v6.7.9" } },
    });
    const { start } = await site(`https://github.com/${repository}`, theme);
    // Every figure shown is part of the link's name, so a reader can say what they see.
    expect(repositoryLink(start)).toEqual({ labelled: false, name: "GitHub, v6.7.9, 25.1K stars, 2.4K forks", shown: ["v6.7.9", "25.1K", "2.4K"] });
    expect(start).toMatch(/<span><svg class="sourcey-repository-icon"[^>]*>.*?<\/svg>25\.1K<\/span>/);
    expect(asked).toEqual([
      { url: `https://api.github.com/repos/${repository}`, authorization: "Bearer token-1" },
      { url: `https://api.github.com/repos/${repository}/releases/latest`, authorization: "Bearer token-1" },
    ]);
    // A second build, as a dev server's rebuild, reads nothing again.
    await site(`https://github.com/${repository}`, theme);
    expect(asked).toHaveLength(2);
  });

  it("leave out a release the repository has not made", async () => {
    github({ "https://api.github.com/repos/pets/unreleased": { body: { stargazers_count: 12, forks_count: 3 } } });
    const { start } = await site("https://github.com/pets/unreleased");
    expect(repositoryLink(start)).toEqual({ labelled: false, name: "GitHub, 12 stars, 3 forks", shown: ["12", "3"] });
  });

  it("draw the plain link, and say so, when GitHub does not answer", async () => {
    github({ "https://api.github.com/repos/pets/limited": { status: 403 } });
    const { built, start } = await site("https://github.com/pets/limited");
    expect(start).not.toContain("sourcey-repository-stats");
    expect(start).toContain('aria-label="GitHub"');
    expect(built.siteDiagnostics).toContainEqual({ severity: "warning", code: "github-stats", message: "https://github.com/pets/limited: GitHub's release, stars and forks could not be read (GitHub answered 403 for https://api.github.com/repos/pets/limited); the link shows without them" });
  });

  it("are a repository's, so a link elsewhere stops the build", async () => {
    await expect(site("https://github.com/pets")).rejects.toThrow('Navbar link https://github.com/pets: stats are a GitHub repository\'s, so the link is { type: "github", href: "https://github.com/owner/repo" }');
  });
});
