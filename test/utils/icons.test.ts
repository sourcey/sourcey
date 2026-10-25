import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { markdown } from "../../src/index.js";
import { messagesFor } from "../../src/core/messages.js";
import { hasIcon, iconDrawing, iconSvg, nativeIcon } from "../../src/utils/icons.js";
import { renderMarkdown, siteMarkdownOptions } from "../../src/utils/markdown.js";

describe("icon sets", () => {
  it("draws a Heroicon with the set's own attributes, read once from its package", () => {
    const drawing = iconDrawing("heroicons", "language")!;
    expect(drawing.attributes).toEqual({ xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", "stroke-width": "1.5", stroke: "currentColor" });
    expect(drawing.body).toMatch(/^<path stroke-linecap="round" stroke-linejoin="round" d="/);
    expect(iconDrawing("heroicons", "language")).toBe(drawing);
    expect(iconSvg(drawing, { class: "sourcey-language-icon", size: 17 })).toMatch(/^<svg class="sourcey-language-icon" width="17" height="17" aria-hidden="true" xmlns="http:\/\/www.w3.org\/2000\/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path /);
  });

  it("names only the set's own files", () => {
    for (const name of ["no-such-icon", "Language", "../package", "language.svg", "info circle", ""]) expect(hasIcon("heroicons", name)).toBe(false);
  });

  it("has every native icon in the default set", () => {
    for (const meaning of ["note", "tip", "warning", "danger", "language", "contents"] as const) expect(nativeIcon("heroicons", meaning).body).toContain("<path");
  });

  it("rejects an icon set it does not know", async () => {
    await expect(resolveConfigFromRaw({ theme: { icons: "feather" as never }, navigation: { tabs: [] } }, tmpdir())).rejects.toThrow('Invalid theme.icons "feather"; use "heroicons" or "lucide"');
  });
});

describe("GitHub alerts in reference Markdown", () => {
  it("render as the site's callouts, in its language, and leave other quotes alone", () => {
    const html = renderMarkdown("> [!WARNING]\n> Rotate the **key** first.\n\n> [!NOTE] Custom title\n> A plain quote.\n\n> Also plain.", siteMarkdownOptions("heroicons", messagesFor("fr")));
    expect(html).toContain('<div class="callout callout-warning not-prose" role="note"><svg class="callout-icon" width="20" height="20" aria-hidden="true"');
    // The icon keeps its coordinate system, so the 24-unit drawing scales to 20px instead of being clipped,
    // and so it does where the page's own HTML sends the callout through the sanitizer.
    expect(html).toContain('viewBox="0 0 24 24"');
    const sanitized = renderMarkdown("> [!WARNING]\n> Rotate the key.\n\n<kbd>Esc</kbd>", siteMarkdownOptions("heroicons", messagesFor("fr")));
    expect(sanitized).toContain('viewbox="0 0 24 24"');
    expect(sanitized).toContain("<kbd>Esc</kbd>");
    expect(html).toContain('<div class="callout-title">Avertissement</div><div class="callout-content"><p>Rotate the <strong>key</strong> first.</p>');
    expect(html.match(/role="note"/g)).toHaveLength(1);
    expect(html).toContain("[!NOTE] Custom title");
    expect(html).toContain("<blockquote>\n<p>Also plain.</p>");
  });

  it("title an important alert and draw it as information", () => {
    const html = renderMarkdown("> [!IMPORTANT]\n> Back up first.");
    expect(html).toContain('callout callout-info');
    expect(html).toContain('<div class="callout-title">Important</div>');
    expect(html).toContain(nativeIcon("heroicons", "note").body.match(/ d="[^"]+"/)![0]);
  });
});

describe("authored icons", () => {
  it("stop the build at the component when the set has no icon of that name", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-icons-"));
    try {
      const page = join(root, "guide.md");
      await mkdir(dirname(page), { recursive: true });
      await writeFile(page, '# Guide\n\n<CardGroup>\n<Card title="Keys" icon="key">Manage keys.</Card>\n<Card title="Refresh" icon="refresh-cw">Rotate.</Card>\n</CardGroup>\n');
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
      await expect(buildSourceySite({ config, generateOgImages: false })).rejects.toThrow(/Icon "refresh-cw" is not in the heroicons set \(theme\.icons\) at .*guide\.md:\d+/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("draw a card's image icon as a published asset, and an inline icon sized to the text", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-icons-"));
    try {
      await mkdir(join(root, "icons"), { recursive: true });
      await writeFile(join(root, "icons/go.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#00ADD8"/></svg>\n');
      await writeFile(join(root, "guide.md"), '# Guide\n\n<Card title="Go" icon="./icons/go.svg">The Go SDK.</Card>\n\nOpen the <Icon icon="ellipsis-horizontal" /> menu, then select <Icon icon="clipboard" label="Copy" />.\n');
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
      if (page.kind !== "markdown") throw new Error("Expected a guide");
      const asset = page.markdown.html.match(/<img class="card-icon" src="\/(_media\/[0-9a-f]{20}\.svg)" alt="">/)?.[1];
      expect(asset).toBeDefined();
      expect([...(await sourceyArtifacts(site)).keys()]).toContain(asset);
      // Decorative without a label; with one, it is named for assistive technology and stays in readable Markdown.
      expect(page.markdown.html).toMatch(/Open the <svg class="sourcey-inline-icon" aria-hidden="true"[^>]*>.*?<\/svg> menu/);
      expect(page.markdown.html).toMatch(/select <svg class="sourcey-inline-icon" role="img" aria-label="Copy"/);
      // Inline, the icon keeps its sentence in readable Markdown.
      expect(page.markdown.markdown).toContain("Open the  menu, then select Copy.\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stop an inline icon at an attribute it does not read or a name its set lacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-icons-"));
    try {
      const build = async (page: string) => {
        await writeFile(join(root, "guide.md"), page);
        const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
        return buildSourceySite({ config, generateOgImages: false });
      };
      await expect(build('# Guide\n\nOpen <Icon icon="clipboard" size={12} />.\n')).rejects.toThrow(/Icon attribute size is not supported at .*guide\.md/);
      await expect(build('# Guide\n\nOpen <Icon icon="ellipsis" />.\n')).rejects.toThrow(/Icon "ellipsis" is not in the heroicons set \(theme\.icons\) at .*guide\.md/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("brand marks", () => {
  it("draw Font Awesome's mark with its own viewBox, carrying the file's attribution", () => {
    const drawing = iconDrawing("brands", "aws")!;
    expect(drawing.attributes.viewBox).toBe("0 0 640 512");
    expect(drawing.attributes["data-sourcey-attribution"]).toMatch(/^Font Awesome Free \d+\.\d+\.\d+ by @fontawesome - https:\/\/fontawesome\.com License - https:\/\/fontawesome\.com\/license\/free \(Icons: CC BY 4\.0, .*\) Copyright \d{4} Fonticons, Inc\. Licence: https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\. SVG attributes adapted by Sourcey for inline rendering\.$/);
    expect(drawing.body).toMatch(/^<path fill="currentColor" d="/);
    expect(hasIcon("brands", "no-such-brand")).toBe(false);
  });

  it("draw on a card and in a sentence by brand:<name>, attributed in the published page", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-brands-"));
    try {
      const build = async (page: string) => {
        await writeFile(join(root, "guide.md"), page);
        const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
        return buildSourceySite({ config, generateOgImages: false });
      };
      const site = await build('# Guide\n\n<Card title="AWS" icon="brand:aws">Deploy to AWS.</Card>\n\nSign in with <Icon icon="brand:github" label="GitHub" />.\n');
      const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
      if (page.kind !== "markdown") throw new Error("Expected a guide");
      const published = String((await sourceyArtifacts(site)).get("guide.html"));
      for (const html of [page.markdown.html, published]) {
        expect(html).toMatch(/<svg class="card-icon" aria-hidden="true" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 640 512" data-sourcey-attribution="Font Awesome Free \d+\.\d+\.\d+ [^"]*Licence: https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\. SVG attributes adapted by Sourcey for inline rendering\."><path fill="currentColor" d="/);
        expect(html).toMatch(/<svg class="sourcey-inline-icon" role="img" aria-label="GitHub" [^>]*data-sourcey-attribution="Font Awesome Free \d+\.\d+\.\d+ /);
      }
      await expect(build('# Guide\n\n<Card title="Nope" icon="brand:nope">No.</Card>\n')).rejects.toThrow(/Icon "brand:nope" is not in Font Awesome's brand marks at .*guide\.md/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Lucide", () => {
  it("draws with its own attributes, has every native icon, and keeps its shapes through sanitising", () => {
    expect(iconDrawing("lucide", "info")!.attributes).toEqual({ xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" });
    for (const meaning of ["note", "tip", "warning", "danger", "language", "contents"] as const) expect(nativeIcon("lucide", meaning).body).toMatch(/<(path|circle)/);
    const html = renderMarkdown("> [!NOTE]\n> Drawn by Lucide.", siteMarkdownOptions("lucide", messagesFor("en")));
    expect(html).toContain('stroke-width="2"');
    expect(html).toMatch(/<circle cx="12" cy="12" r="10"/);
    // Sanitized, where the page's own HTML calls for it, the shapes stay.
    const sanitized = renderMarkdown("> [!NOTE]\n> Drawn by Lucide.\n\n<kbd>Esc</kbd>", siteMarkdownOptions("lucide", messagesFor("en")));
    expect(sanitized).toContain('<circle cx="12" cy="12" r="10"></circle>');
  });

  it("draws a guide's callouts and cards when the theme selects it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-lucide-"));
    try {
      await writeFile(join(root, "guide.md"), '# Guide\n\n<Note>Rotate keys.</Note>\n\n<Card title="Refresh" icon="refresh-cw">Rotate.</Card>\n');
      const site = await buildSourceySite({ config: await resolveConfigFromRaw({ theme: { fonts: { google: false }, icons: "lucide" }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root), generateOgImages: false });
      const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
      if (page.kind !== "markdown") throw new Error("Expected a guide");
      expect(page.markdown.html).toMatch(/<div class="callout callout-note[^>]*><svg class="callout-icon"[^>]*stroke-width="2"/);
      expect(page.markdown.html).toMatch(/<svg class="card-icon"[^>]*stroke-width="2"[^>]*>/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
