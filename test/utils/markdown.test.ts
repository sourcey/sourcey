import { describe, it, expect } from "vitest";
import {
  extractFirstParagraph,
  htmlText,
  inlineText,
  renderInlineMarkdown,
  renderMarkdown,
  renderMarkdownInline,
  stripMarkdownLinks,
} from "../../src/utils/markdown.js";

describe("renderMarkdown", () => {
  it("keeps what Markdown draws, whether or not the page's own HTML sends it through the sanitizer", () => {
    const source = "3. third\n4. fourth\n\n- [x] done\n- [ ] open\n\n~~dropped~~\n\n```js\n// a comment\nconst x = 1;\n```";
    for (const html of [renderMarkdown(source), renderMarkdown(`${source}\n\n<kbd>Esc</kbd>`)]) {
      expect(html).toMatch(/<ol start="3">/);
      expect(html.match(/<input [^>]*type="checkbox"/g)).toHaveLength(2);
      expect(html).toMatch(/<input [^>]*checked/);
      expect(html).toContain("<del>dropped</del>");
      expect(html).toMatch(/--shiki-(light|dark)/);
    }
    // Authored HTML is sanitized as before.
    expect(renderMarkdown("<script>alert(1)</script>\n\nText")).not.toContain("<script");
  });

  it("draws an image only from the web or this site, as it links", () => {
    expect(renderMarkdown("![Logo](/logo.png)")).toContain('<img src="/logo.png" alt="Logo">');
    expect(renderMarkdown("![Logo](https://example.com/logo.png)")).toContain('<img src="https://example.com/logo.png" alt="Logo">');
    for (const src of ["javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const html = renderMarkdown(`![Logo](${src})`);
      expect(html).not.toContain("<img");
      expect(html).toContain("Logo");
    }
  });

  it("renders markdown to HTML", () => {
    const html = renderMarkdown("**bold** text");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<p>");
  });

  it("strips scriptable raw HTML", () => {
    const html = renderMarkdown(`Hello <script>alert(1)</script><img src="x" onerror="alert(1)">`);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain("Hello");
  });

  it("rejects unsafe link schemes and escapes link attributes", () => {
    const html = renderMarkdown(
      `[bad](javascript:alert(1)) [ok](https://example.com/?q=%22 "quoted")`,
    );

    expect(html).not.toContain("javascript:");
    expect(html).toContain("bad");
    expect(html).toContain('href="https://example.com/?q=%22"');
    expect(html).toContain('title="quoted"');
  });

  it("sanitizes video and iframe directive URLs", () => {
    const html =
      renderMarkdown(`::video[https://cdn.example.com/demo.mp4" onerror="alert(1)]{title="Demo"}

::iframe[javascript:alert(1)]{title="Bad"}`);

    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("[video: invalid URL]");
    expect(html).toContain("[iframe: invalid URL]");
  });

  it("returns empty string for undefined", () => {
    expect(renderMarkdown(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("renderMarkdownInline", () => {
  it("renders inline markdown without <p> tags", () => {
    const html = renderMarkdownInline("**bold** text");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<p>");
  });

  it("reads text a reader sees from the tokens it rendered, which draw as Marked's own rendering does", () => {
    for (const markdown of [
      "A reader's \"quote\" &amp; `a<b &lt; c` [link](https://example.com)",
      "With <b>authored HTML</b>, which is sanitized",
    ]) {
      expect(`<p>${renderInlineMarkdown(markdown).html}</p>\n`).toBe(renderMarkdown(markdown));
    }
    const { tokens } = renderInlineMarkdown("A reader's \"quote\" &amp; `a<b &lt; c` <b>bold</b> [link](https://example.com)");
    // Code shows its entities as written; prose decodes the ones its author wrote.
    expect(inlineText(tokens)).toBe("A reader's \"quote\" & a<b &lt; c bold link");
  });
});

describe("htmlText", () => {
  it("reads rendered HTML as a reader does: tags dropped, entities decoded, spaces collapsed", () => {
    expect(htmlText("<code>A</code> reader&#39;s &quot;quote&quot; &amp;\n<em>more</em>")).toBe("A reader's \"quote\" & more");
  });
});

describe("extractFirstParagraph", () => {
  it("skips badge and navigation rows and drops images, inline HTML and emphasis from the summary", () => {
    const markdown = [
      "[![github]][github]&ensp;[![crates-io]][crates-io] | ![logo](logo.svg)",
      "",
      "**[API Reference →](api.md)** · **[Source →](src/)**",
      "",
      "This crate provides **fast** <em>and</em> safe `Error` values. ![inline](x.svg)",
      "",
      "[github]: https://github.com/example/crate",
      "[crates-io]: https://crates.io/crates/crate",
    ].join("\n");

    expect(extractFirstParagraph(markdown)).toBe("This crate provides fast and safe `Error` values.");
  });

  it("finds the first prose paragraph in generated markdown", () => {
    const markdown = `<a id="foo"></a>

## Foo

\`\`\`cpp
int foo();
\`\`\`

> **Inherits:** [Bar](bar.html#bar)

Uses [Bar](bar.html#bar).

### Methods`;

    expect(extractFirstParagraph(markdown)).toBe("Uses [Bar](bar.html#bar).");
  });

  it("passes over a paragraph that introduces the block after it", () => {
    expect(extractFirstParagraph("See also:\n\n- [How to use the API](api.md)\n\nFirefly III features a JSON API.\n")).toBe("Firefly III features a JSON API.");
  });
});

describe("stripMarkdownLinks", () => {
  it("replaces markdown links with their labels", () => {
    expect(stripMarkdownLinks("Uses [Bar](bar.html#bar) and [Baz](baz.html#baz).")).toBe(
      "Uses Bar and Baz.",
    );
  });

  it("handles malformed long link-like text without catastrophic backtracking", () => {
    const input = `${"[".repeat(1000)}${"`label".repeat(1000)}${"](".repeat(1000)}`;

    expect(stripMarkdownLinks(input)).toBe(input);
  });
});

describe("inline SVG", () => {
  it("keeps static drawing (clipping, masks, filters) and strips anything that runs", () => {
    const html = renderMarkdown([
      '<svg viewBox="0 0 10 10" onload="alert(1)"><g clip-path="url(#a)"><mask id="m" maskUnits="userSpaceOnUse"><path d="M0 0h10v10H0z" fill="#fff"/></mask>',
      '<path mask="url(#m)" filter="url(#f)" d="M0 0h5v5H0z"/></g><defs><clipPath id="a"><rect width="10" height="10" rx="2"/></clipPath>',
      '<filter id="f" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2" result="b"/><feBlend in="SourceGraphic" in2="b" mode="normal"/></filter></defs>',
      '<script>alert(2)</script><foreignObject><div>x</div></foreignObject></svg>',
    ].join(""));
    for (const kept of ['<clipPath id="a">', '<mask id="m" maskunits="userSpaceOnUse">', 'clip-path="url(#a)"', '<feGaussianBlur stddeviation="2" result="b">', '<feBlend in="SourceGraphic" in2="b" mode="normal">', 'viewbox="0 0 10 10"', 'rx="2"'])
      expect(html).toContain(kept);
    for (const removed of ["onload", "<script", "alert(2)", "<foreignobject"]) expect(html.toLowerCase()).not.toContain(removed);
  });

  it("keeps authored paint and layout styles, never a url() or an unlisted property", () => {
    const html = renderMarkdown([
      '<div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; position: fixed">',
      '<a href="https://example.com"><svg viewBox="0 0 4 4" style="height: 40px; width: auto"><path d="M0 0h4v4H0z" style="fill-rule:evenodd;fill:#43a047;opacity:.6;background:url(https://evil.test/x)"/></svg></a>',
      "</div>",
    ].join(""));
    expect(html).toContain('style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap"');
    expect(html).toContain('style="height:40px;width:auto"');
    expect(html).toContain('style="fill-rule:evenodd;fill:#43a047;opacity:.6"');
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("fixed");
  });
});
