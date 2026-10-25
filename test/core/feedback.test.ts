import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { markdown, openapi } from "../../src/adapters/index.js";
import { resolveConfigFromRaw, type SourceyConfig } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-feedback-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text);
}
const api = { openapi: "3.1.0", info: { title: "Pet API", version: "1" }, paths: { "/pets": { get: { summary: "List pets", responses: { "200": { description: "Pets" } } } } } };
async function config(root: string, feedback: SourceyConfig["feedback"], theme: "default" | "reader" = "default") {
  await file(root, "docs/start.md", "# Start\n\nInstall it.\n");
  await file(root, "docs/quiet.md", "---\nfeedback: false\n---\n\n# Quiet\n\nNo question here.\n");
  await file(root, "pages/about.md", "# About\n\nWho we are.\n");
  await file(root, "api.json", JSON.stringify(api));
  return resolveConfigFromRaw({ name: "Pets", prettyUrls: "slash", pages: "pages", feedback, theme: { name: theme, fonts: { google: false } }, navigation: { tabs: [
    { tab: "Docs", slug: "docs", source: markdown({ root: "docs", groups: [{ group: "Start", pages: ["start", "quiet"] }] }) },
    { tab: "API", slug: "api", source: openapi("api.json") },
  ] } }, root);
}
async function pages(root: string, feedback: SourceyConfig["feedback"], theme?: "default" | "reader") {
  const files = await sourceyArtifacts(await buildSourceySite({ config: await config(root, feedback, theme), generateOgImages: false }));
  return (path: string) => files.get(path)!.toString();
}

describe("page feedback", () => {
  for (const theme of ["default", "reader"] as const) it(`${theme}: asks after each documentation and reference page, in the page's language, hidden until its script runs`, () => fixture(async root => {
    const page = await pages(root, true, theme);
    const guide = page("docs/start/index.html");
    const question = guide.slice(guide.indexOf('<section class="sourcey-feedback"'), guide.indexOf("</section>", guide.indexOf('<section class="sourcey-feedback"')) + 10);
    expect(question).toMatch(/^<section class="sourcey-feedback" data-sourcey-feedback="true" aria-labelledby="sourcey-feedback-title" hidden>/);
    expect(question).toContain('<p id="sourcey-feedback-title" class="sourcey-feedback-title">Was this page helpful?</p>');
    expect(question).toMatch(/<button type="button" class="sourcey-feedback-rating" data-rating="0" data-value="1" aria-pressed="false" aria-label="Yes" title="Yes"><svg class="sourcey-feedback-icon"/);
    expect(question).toContain('data-rating="1" data-value="0" aria-pressed="false" aria-label="No" title="No"');
    expect(question).toContain('<div class="sourcey-feedback-note" data-rating="0" hidden><p>Thanks for your feedback.</p>\n</div>');
    expect(guide.indexOf("Install it.")).toBeLessThan(guide.indexOf("sourcey-feedback"));
    expect(page("api/index.html")).toContain("data-sourcey-feedback");
    expect(page("docs/quiet/index.html")).not.toContain("data-sourcey-feedback");
    expect(page("about/index.html")).not.toContain("data-sourcey-feedback");
    expect(page("404.html")).not.toContain("data-sourcey-feedback");
  }));

  it("asks the site's own question, each rating with its icon and note, and refuses an icon the set lacks", () => fixture(async root => {
    const page = await pages(root, { title: "Did this help?", ratings: [
      { label: "This page was helpful", value: "good", icon: "face-smile", note: "Thanks!" },
      { label: "Could be better", value: "poor", note: "Tell us [on GitHub](https://github.com/example/pets/discussions).\n\n<div id=\"form\"></div>" },
    ] });
    const guide = page("docs/start/index.html");
    expect(guide).toContain(">Did this help?</p>");
    expect(guide).toContain('data-value="&quot;good&quot;" aria-pressed="false" aria-label="This page was helpful" title="This page was helpful"><svg class="sourcey-feedback-icon"');
    expect(guide).toContain('data-value="&quot;poor&quot;" aria-pressed="false">Could be better</button>');
    expect(guide).toContain('<div class="sourcey-feedback-note" data-rating="1" hidden><p>Tell us <a href="https://github.com/example/pets/discussions" target="_blank" rel="noopener">on GitHub</a>.</p>\n<div id="form"></div>');
    await expect(config(root, { ratings: [{ label: "Yes", value: 1, icon: "thumbs-up" }] })).rejects.toThrow('feedback.ratings[0]: the heroicons icon set has no "thumbs-up" icon');
  }));

  it("is off unless the site asks", () => fixture(async root => {
    expect((await pages(root, undefined))("docs/start/index.html")).not.toContain("sourcey-feedback");
  }));
});
