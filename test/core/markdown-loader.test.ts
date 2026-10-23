import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { loadDocsPage, loadMarkdownPage, slugFromPath } from "../../src/core/markdown-loader.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "../fixtures");

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sourcey-markdown-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadMarkdownPage", { timeout: 30_000 }, () => {
  it("parses frontmatter title and description", async () => {
    const page = await loadMarkdownPage(resolve(FIXTURE_DIR, "test-page.md"), "test-page");
    expect(page.title).toBe("Getting Started");
    expect(page.description).toBe("How to install and use LibSourcey");
    expect(page.slug).toBe("test-page");
  });

  it("renders markdown body to HTML", async () => {
    const page = await loadMarkdownPage(resolve(FIXTURE_DIR, "test-page.md"), "test-page");
    expect(page.html).toContain("<p>");
    expect(page.html).toContain("C++20 networking toolkit");
  });

  it("syntax highlights fenced code blocks", async () => {
    const page = await loadMarkdownPage(resolve(FIXTURE_DIR, "test-page.md"), "test-page");
    // Shiki wraps highlighted code in <pre class="shiki ...">
    expect(page.html).toContain('class="shiki');
    // cmake block should be highlighted (FetchContent appears in spans)
    expect(page.html).toContain("FetchContent");
    // cpp block should contain the server code (split across spans by Shiki)
    expect(page.html).toContain("ServerConnection");
  });

  it("keeps linked cards as block siblings and allows independent links in their body", async () => {
    await withTempDir(async dir => {
      const file = join(dir, "cards.md");
      await writeFile(file, '<CardGroup cols={2}>\n<Card title="Install" href="/install">Run the server. [Requirements](/requirements).</Card>\n<Card title="Use the API" href="/api">Make a request.</Card>\n</CardGroup>');
      const page = await loadMarkdownPage(file, "cards");
      expect(page.html.match(/class="card-item"/g)).toHaveLength(2);
      expect(page.html).toContain('<div class="card-group not-prose" data-cols="2"><div class="card-item">');
      expect(page.html).toContain('<a class="card-item-link" href="/install">Install</a>');
      expect(page.html).toContain('<a href="/requirements">Requirements</a>');
      expect(page.html).not.toMatch(/<p>\s*<(?:a|div)[^>]*class="card-item"/);
    });
  });

  it("does not expand directives or JSX components inside fenced code blocks", async () => {
    const page = await loadMarkdownPage(
      resolve(FIXTURE_DIR, "fenced-directive-example.md"),
      "fenced-directive-example",
    );
    expect(page.html).toContain("card-group");
    expect(page.html).toContain("CardGroup");
    expect(page.html).not.toContain('class="card-group not-prose"');
  });

  it("handles nested tabs and code groups without leaking directive markers", async () => {
    const page = await loadMarkdownPage(
      resolve(FIXTURE_DIR, "nested-tabs-code-group.md"),
      "nested-tabs-code-group",
    );

    expect(page.html).toContain("Stream");
    expect(page.html).toContain("Record");
    expect(page.html).toContain("Relay");
    expect(page.html).toContain("File source");
    expect(page.html).toContain("Camera source");
    expect(page.html.match(/class="directive-tab(?: active)?"/g)?.length).toBe(5);
    expect(page.html).not.toContain(":::tabs");
    expect(page.html).not.toContain(":::code-group");
    expect(page.html).not.toContain("::tab{");
  });

  it("keeps supported component tags literal inside inline code and groups accordions once", async () => {
    const page = await loadMarkdownPage(
      resolve(FIXTURE_DIR, "component-inline-accordion.md"),
      "component-inline-accordion",
    );

    expect(page.html).toMatch(/<code>&lt;Tab title=(?:&quot;|")Shell(?:&quot;|")&gt;<\/code>/);
    expect(page.html.match(/class="accordion-group not-prose"/g)?.length).toBe(1);
    expect(page.html.match(/class="accordion-item"/g)?.length).toBe(2);
    expect(page.html.match(/class="directive-tab(?: active)?"/g)?.length).toBe(2);
    expect(page.html).not.toContain("<AccordionGroup>");
    expect(page.html).not.toContain("<Tab title=");
  });

  it("restores code containing dollar signs exactly, never as replacement patterns", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "dollars.md");
      await writeFile(
        file,
        [
          "## Anchors",
          "",
          "`^` and `$` anchor the value; `$&`, `$'` and `$$` stay literal.",
          "",
          "```js",
          "const tail = /x$`/;",
          "```",
          "",
          "## After",
        ].join("\n"),
      );
      const page = await loadMarkdownPage(file, "dollars");

      expect(page.headings.map((heading) => heading.id)).toEqual(["anchors", "after"]);
      expect(page.html.match(/id="anchors"/g)?.length).toBe(1);
      for (const literal of ["<code>$</code>", "<code>$&amp;</code>", "<code>$&#39;</code>", "<code>$$</code>"]) {
        expect(page.html).toContain(literal);
      }
      expect(page.html.replace(/<[^>]+>/g, "")).toContain("/x$`/");
    });
  });

  it("falls back to visible markdown when directive containers are malformed", async () => {
    const page = await loadMarkdownPage(
      resolve(FIXTURE_DIR, "malformed-directive-fallback.md"),
      "malformed-directive-fallback",
    );

    expect(page.html).toContain("This block is missing");
    expect(page.html).toContain("This card group is missing card children too.");
    expect(page.html).toContain("This steps block has no numbered steps.");
    expect(page.html).not.toContain('class="directive-tabs not-prose"');
    expect(page.html).not.toContain('class="card-group not-prose"');
    expect(page.html).not.toContain('class="steps not-prose"');
  });

  it("draws a steps block written as a numbered list, one step per item", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "steps.md");
      await writeFile(file, [":::steps", "1. Register", "   Send the request.", "2. Verify", "   Check the signature.", ":::"].join("\n"));
      const page = await loadMarkdownPage(file, "steps");

      expect(page.html).toContain('class="steps not-prose"');
      expect(page.html.match(/class="step-item"/g)?.length).toBe(2);
      expect(page.html).toContain('<p class="step-title">Register</p>');
      expect(page.html).toContain("Check the signature.");
    });
  });

  it("keeps an escaped angle bracket as text rather than a component's tag", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "handles.md");
      await writeFile(file, "# Handles\n\n**Handle\\<T\\>** wraps every handle.\n");
      const page = await loadMarkdownPage(file, "handles");

      expect(page.html).toContain("<strong>Handle&lt;T&gt;</strong> wraps every handle.");
    });
  });

  it("names a code block's language on the block, for a theme to label it", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "run.md");
      await writeFile(file, '# Run\n\n```Bash title="install.sh"\ncurl -s https://example.com | sh\n```\n\n```\nplain\n```\n');
      const page = await loadMarkdownPage(file, "run");

      expect(page.html).toContain('<div class="prose-code-block not-prose" data-language="bash"><div class="prose-code-title">install.sh</div>');
      expect(page.html).toContain('<div class="prose-code-block not-prose">\n');
    });
  });

  it("names a code group's tabs by its fences' titles, which its panels do not repeat", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "install.md");
      await writeFile(file, '# Install\n\n:::code-group\n```bash title="npm"\nnpm i x\n```\n```bash title="pnpm"\npnpm add x\n```\n:::\n');
      const page = await loadMarkdownPage(file, "install");

      expect(page.html.match(/class="directive-tab[ "][^>]*>(npm|pnpm)</g)).toHaveLength(2);
      expect(page.html).not.toContain("prose-code-title");
      expect(page.markdown).toContain("**npm**");
    });
  });

  it("names the page whose code fence carries metadata it cannot read, in a code group or on its own", async () => {
    await withTempDir(async (dir) => {
      const own = join(dir, "own.md"), grouped = join(dir, "grouped.md");
      await writeFile(own, "# Install\n\n```bash npm\nnpm i x\n```\n");
      await writeFile(grouped, "# Install\n\n:::code-group\n```bash npm\nnpm i x\n```\n:::\n");
      await expect(loadMarkdownPage(own, "own")).rejects.toThrow(/own\.md: Unknown code metadata: npm/);
      await expect(loadMarkdownPage(grouped, "grouped")).rejects.toThrow(/Unknown code metadata: npm at \S*grouped\.md:\d+/);
    });
  });

  it("extracts h2 and h3 headings with IDs", async () => {
    const page = await loadMarkdownPage(resolve(FIXTURE_DIR, "test-page.md"), "test-page");
    expect(page.headings).toEqual([
      { level: 2, text: "Installation", id: "installation" },
      { level: 2, text: "Quick Start", id: "quick-start" },
      { level: 3, text: "Building", id: "building" },
    ]);
  });

  it("shows headings without inline HTML or entities, keeping their ids", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "hash.md");
      await writeFile(filePath, "# Hash\n\n## <small>std::</small>hash&lt;json&gt;\n\n## Fish &amp; chips\n");

      const page = await loadMarkdownPage(filePath, "hash");

      expect(page.headings).toEqual([
        { level: 2, text: "std::hash<json>", id: "stdhashjson" },
        { level: 2, text: "Fish & chips", id: "fish--chips" },
      ]);
      expect(page.html).toContain('id="small-std-small-hash-lt-json-gt"');
      expect(page.html).toContain('id="fish-amp-chips"');
    });
  });

  it("generates id attributes on heading elements", async () => {
    const page = await loadMarkdownPage(resolve(FIXTURE_DIR, "test-page.md"), "test-page");
    expect(page.html).toContain('id="installation"');
    expect(page.html).toContain('id="quick-start"');
    expect(page.html).toContain('id="building"');
  });

  it("preserves source path", async () => {
    const filePath = resolve(FIXTURE_DIR, "test-page.md");
    const page = await loadMarkdownPage(filePath, "test-page");
    expect(page.sourcePath).toBe(relative(process.cwd(), filePath));
  });

  it("falls back to the first paragraph for page descriptions", async () => {
    const page = await loadMarkdownPage(
      resolve(FIXTURE_DIR, "description-fallback.md"),
      "description-fallback",
    );

    expect(page.title).toBe("icey");
    expect(page.description).toBe(
      "icey pulls WebRTC, signalling, TURN relay, and media encoding into one C++ runtime.",
    );
  });

  it("strips markdown links with bracketed code labels from descriptions", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "operators.md");
      await writeFile(
        filePath,
        [
          "# Operators",
          "",
          "Use [`operator[]`](../api/basic_json/operator%5B%5D.md) and [`at`](../api/basic_json/at.md).",
        ].join("\n"),
      );

      const page = await loadMarkdownPage(filePath, "operators");

      expect(page.description).toBe("Use `operator[]` and `at`.");
    });
  });
});

describe("slugFromPath", () => {
  it("preserves directory structure in slug", () => {
    expect(slugFromPath("getting-started")).toBe("getting-started");
    expect(slugFromPath("run/index")).toBe("run/index");
    expect(slugFromPath("run/install")).toBe("run/install");
    expect(slugFromPath("index")).toBe("index");
    expect(slugFromPath("intro.md")).toBe("intro");
    expect(slugFromPath("api/PacketStream.md")).toBe("api/packetstream");
  });

  it("keeps C++ API filenames distinct when symbols sanitize to the same id", () => {
    expect(slugFromPath("api/basic_json/basic_json.md")).toBe("api/basic-json/basic-json");
    expect(slugFromPath("api/basic_json/~basic_json.md")).toBe(
      "api/basic-json/destructor-basic-json",
    );
    expect(slugFromPath("api/basic_json/operator[].md")).toBe("api/basic-json/operator-array");
    expect(slugFromPath("api/basic_json/operator=.md")).toBe("api/basic-json/operator-assign");
    expect(slugFromPath("api/basic_json/operator+=.md")).toBe("api/basic-json/operator-plus-eq");
    expect(slugFromPath("api/basic_json/operator_eq.md")).toBe("api/basic-json/operator-eq");
  });
});

describe("loadDocsPage", () => {
  it("never takes a title from a comment inside a fenced code block", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "routing.md");
      await writeFile(
        filePath,
        ["Starlette has a simple routing system.", "", "```python", "# A standalone static files server:", "app = StaticFiles()", "```"].join("\n"),
      );

      expect((await loadDocsPage(filePath, "routing")).title).toBe("routing");
      expect((await loadDocsPage(filePath, "routing", { title: "Routing" })).title).toBe("Routing");
    });
  });

  it("prefers the page's own title and heading over a source format's title", async () => {
    await withTempDir(async (dir) => {
      const headed = join(dir, "headed.md");
      const titled = join(dir, "titled.md");
      await writeFile(headed, "# The `Router` class\n\nRoutes requests.\n");
      await writeFile(titled, "---\ntitle: From frontmatter\n---\n\n# Heading\n");

      const page = await loadDocsPage(headed, "headed", { title: "Routing" });
      expect(page.title).toBe("The Router class");
      expect(page.kind === "markdown" && page.html).not.toContain("<h1");
      expect((await loadDocsPage(titled, "titled", { title: "Routing" })).title).toBe("From frontmatter");
    });
  });

  it("detects changelog pages and returns a structured changelog page", async () => {
    const page = await loadDocsPage(resolve(FIXTURE_DIR, "changelog.md"), "changelog", {
      repoUrl: "https://github.com/example/project",
    });

    expect(page.kind).toBe("changelog");
    if (page.kind !== "changelog") return;

    expect(page.title).toBe("Changelog");
    expect(page.changelog.versions[0].version).toBeNull();
    expect(page.changelog.versions[1].version).toBe("1.2.0");
    expect(page.headings).toEqual([
      { level: 2, text: "Unreleased", id: "unreleased" },
      { level: 2, text: "1.2.0", id: "1-2-0" },
      { level: 2, text: "1.1.0", id: "1-1-0" },
    ]);
  });
});
