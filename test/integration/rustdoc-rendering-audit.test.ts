import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import type { ResolvedRustdocConfig } from "../../src/config.js";
import { loadRustdocTab } from "../../src/core/rustdoc-loader.js";

const FIXTURE_MANIFEST = resolve(import.meta.dirname, "../fixtures/rustdoc/basic/Cargo.toml");
const FIXTURE_SNAPSHOT = resolve(
  import.meta.dirname,
  "../fixtures/rustdoc/basic/snapshots/rustdoc.json",
);

function snapshotConfig(): ResolvedRustdocConfig {
  return {
    manifest: FIXTURE_MANIFEST,
    crates: ["basic"],
    snapshot: FIXTURE_SNAPSHOT,
    mode: "snapshot",
    features: { default: true, list: [], all: false },
    includePrivate: false,
    includeHidden: false,
    toolchain: "nightly",
    sourceBasePath: "",
    doctestsIndex: true,
  };
}

// Sourcey-native output: items render inline as sourcey sections, code flows
// through the shared Shiki block, and the only collapsible is the trait-impl
// list. We assert that shape, not a copy of rustdoc's DOM.
const baseChecks = [
  { name: "code-header signature", pattern: /class="code-header rust-signature"/ },
  { name: "doctest container", pattern: /class="rust-doctest api-doctest"/ },
  { name: "section anchor §", pattern: /class="anchor api-anchor"/ },
  { name: "rust-item section", pattern: /class="rust-item rust-/ },
  { name: "rust-doc docblock", pattern: /class="docblock rust-doc"/ },
  { name: "inline impl member", pattern: /class="rust-member api-member"/ },
  { name: "trait-impl collapsible", pattern: /class="api-toggle api-impl-toggle"/ },
  { name: "rightside item-info row", pattern: /class="rightside api-rightside"/ },
];

const doctestChecks = [
  { name: "hidden-line toggle", pattern: /rust-doctest-toggle-hidden/ },
  { name: "run button", pattern: /class="test-arrow rust-doctest-run"/ },
  { name: "shared shiki code block", pattern: /class="prose-code-block not-prose"/ },
  { name: "shiki highlighting", pattern: /class="shiki/ },
  { name: "fence badges container", pattern: /class="rust-doctest-badges"/ },
];

// The old build mirrored rustdoc's DOM and never styled it. None of this markup
// should survive the sourcey-native rebuild.
const regressionChecks = [
  { name: "unstyled hideme summary", pattern: /hideme/ },
  { name: "bespoke grey code block", pattern: /rust-example-rendered/ },
  { name: "per-item method toggle", pattern: /api-method-toggle|method-toggle/ },
  { name: "rustdoc-mirror implementors toggle", pattern: /implementors-toggle/ },
  { name: "bespoke index cards", pattern: /rust-crate-card|rust-workspace-index/ },
];

async function loadResult() {
  return loadRustdocTab(snapshotConfig(), "rust-api", "Rust API", {
    repo: "https://github.com/nilstate/sourcey",
    editBranch: "main",
    editBasePath: "",
  });
}

async function concatenatedHtml(): Promise<string> {
  const result = await loadResult();
  const parts: string[] = [];
  for (const page of result.pages.values()) parts.push(page.html);
  return parts.join("\n");
}

describe("rustdoc rendering audit", () => {
  it("retains native signatures, method docs and runnable examples in readable Markdown", async () => {
    const result = await loadResult();
    const markdown = result.pages.get("pkg-basic-basic")!.markdown;
    expect(markdown).toContain("```rust");
    expect(markdown).toContain("fn greet(name: &str) -> String");
    expect(markdown).toContain("fn publish(self: &mut Self)");
    expect(markdown).toContain("Mark the widget as published.");
    expect(markdown).toContain("w.publish();");
    expect(markdown).not.toContain('class="shiki');
  });

  it("hits every must-have DOM element from the rendering catalog", async () => {
    const html = await concatenatedHtml();
    for (const check of baseChecks) {
      expect(html, `missing must-have element: ${check.name}`).toMatch(check.pattern);
    }
  });

  it("renders doctests through the shared Shiki code block with run + hidden-line controls", async () => {
    const html = await concatenatedHtml();
    for (const check of doctestChecks) {
      expect(html, `missing doctest element: ${check.name}`).toMatch(check.pattern);
    }
  });

  it("emits no leftover rustdoc-mirror markup", async () => {
    const html = await concatenatedHtml();
    for (const check of regressionChecks) {
      expect(html, `leftover rustdoc-mirror markup: ${check.name}`).not.toMatch(check.pattern);
    }
  });

  it("keeps hidden setup out of the ordinary prose and preserves the hidden control", async () => {
    const result = await loadResult();
    const module = result.pages.get("pkg-basic-basic");
    expect(module).toBeDefined();
    const html = module!.html;
    expect(html.match(/id="doctest-struct.Widget-0"/g)).toHaveLength(1);
    expect(html).not.toContain("# use basic::Widget;");
    expect(html).toMatch(/id="doctest-struct.Widget-0-full" hidden/);
    expect(html).toContain('data-target="#doctest-struct.Widget-0-full"');
    expect(html).toContain('id="struct.Widget-examples"');
    expect(html).not.toContain('<h1 id="examples"');
  });

  it("links every symbol to a page this tab builds, at an anchor that page renders", async () => {
    const result = await loadResult();
    const anchors = new Map(
      [...result.pages].map(([slug, page]) => [
        slug,
        new Set([...page.html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id)),
      ]),
    );
    const links = [...result.pages.values()].flatMap((page) =>
      [...page.html.matchAll(/href="rust-api\/([^"#]+)\.html(?:#([^"]*))?"/g)].map(
        ([, slug, anchor]) => ({ slug, anchor }),
      ),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const { slug, anchor } of links) {
      expect(anchors.has(slug), `link to a page the tab does not build: ${slug}`).toBe(true);
      if (anchor) {
        expect(anchors.get(slug)?.has(anchor), `no #${anchor} on ${slug}`).toBe(true);
      }
    }
  });

  it("emits a real workspace index page using shared cards (not the empty fallback)", async () => {
    const result = await loadResult();
    const index = result.pages.get("index")!;
    expect(index.html).toContain("card-group not-prose");
    expect(index.html).toContain("card-item");
    expect(index.html).not.toContain("No documented crates.");
  });

  it("uses rustdoc-style item anchors (fn.greet) in search entries", async () => {
    const result = await loadResult();
    const anchors = new Set<string>();
    for (const page of result.pages.values()) {
      for (const entry of page.searchEntries ?? []) {
        if (entry.anchor) anchors.add(entry.anchor);
      }
    }
    expect([...anchors].some((a) => /^[a-z]+\./.test(a))).toBe(true);
    expect([...anchors].every((a) => !/^\d+$/.test(a))).toBe(true);
  });

  it("renders impl methods (FINDING-002 regression check)", async () => {
    const html = await concatenatedHtml();
    expect(html).toMatch(/Widget::new|fn\.new/);
    expect(html).toMatch(/publish|fn\.publish/);
  });
});
