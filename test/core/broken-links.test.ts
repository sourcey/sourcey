import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSiteDocs } from "../../src/index.js";
import { markdown } from "../../src/adapters/index.js";
import { resolveConfigFromRaw, type SourceyConfig } from "../../src/config.js";
import { buildSourceySite } from "../../src/site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-broken-links-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}
async function config(root: string, extra: Partial<SourceyConfig> = {}) {
  await file(root, "docs/start.md", [
    "# Start",
    "",
    "[Feed them](./feed.md), [the old guide](/guides/old/), [a gone page](/gone/), [the manual](/files/manual.pdf),",
    "[this page as Markdown](/start.md), [mail us](mailto:pets@example.com), [elsewhere](https://example.com/missing/)",
    "and [the live site's own lost page](https://pets.example/lost/).",
    "",
  ].join("\n"));
  await file(root, "docs/feed.md", "# Feed\n\nTwice a day.\n");
  await file(root, "public/files/manual.pdf", "%PDF");
  return resolveConfigFromRaw({ name: "Pets", siteUrl: "https://pets.example", prettyUrls: "slash", publicDir: "public", redirects: { "/guides/old/": "/feed/" }, theme: { fonts: { google: false } }, ...extra, navigation: { tabs: [
    { tab: "Docs", slug: "", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start", "feed"] }] }) },
  ] } }, root);
}

describe("broken links", () => {
  it("are each a link to a path on the site that no page, file or redirect answers", () => fixture(async root => {
    const site = await buildSourceySite({ config: await config(root), generateOgImages: false });
    expect(site.siteDiagnostics.filter(diagnostic => diagnostic.code === "broken-link")).toEqual([
      { severity: "warning", code: "broken-link", page: "/start/", message: 'Link "/gone/" leads to /gone/, which the site does not publish.' },
      { severity: "warning", code: "broken-link", page: "/start/", message: 'Link "https://pets.example/lost/" leads to /lost/, which the site does not publish.' },
    ]);
  }));

  it('stop sourcey build, before anything is written, with brokenLinks: "error"', () => fixture(async root => {
    const output = join(root, "site");
    await expect(buildSiteDocs({ config: await config(root, { brokenLinks: "error" }), outputDir: output, generateOgImages: false })).rejects.toThrow([
      'brokenLinks is "error", and 2 links lead nowhere the site publishes:',
      '  /start/: Link "/gone/" leads to /gone/, which the site does not publish.',
      '  /start/: Link "https://pets.example/lost/" leads to /lost/, which the site does not publish.',
    ].join("\n"));
    await expect(readdir(output)).rejects.toThrow();
    await expect(config(root, { brokenLinks: "throw" as "error" })).rejects.toThrow('brokenLinks is "warn" or "error", not "throw"');
  }));
});
