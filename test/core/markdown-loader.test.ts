import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { loadDocsPage, loadMarkdownPage, slugFromPath } from "../../src/core/markdown-loader.js";
import { preprocessMkDocsMarkdown } from "../../src/adapters/mkdocs.js";

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
      for (const literal of ["<code>$</code>", "<code>$&amp;</code>", "<code>$'</code>", "<code>$$</code>"]) {
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

  it("extracts h2 and h3 headings with IDs", async () => {
    const page = await loadMarkdownPage(resolve(FIXTURE_DIR, "test-page.md"), "test-page");
    expect(page.headings).toEqual([
      { level: 2, text: "Installation", id: "installation" },
      { level: 2, text: "Quick Start", id: "quick-start" },
      { level: 3, text: "Building", id: "building" },
    ]);
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
  it("normalizes MkDocs snippets, tabs, admonitions, and inline language markers", async () => {
    await withTempDir(async (dir) => {
      const docsDir = join(dir, "docs");
      await mkdir(join(docsDir, "examples"), { recursive: true });
      await writeFile(join(docsDir, "examples", "basic.cpp"), "nlohmann::json value = {1, 2};\n");
      const filePath = join(docsDir, "index.md");
      await writeFile(
        filePath,
        [
          "# MkDocs page",
          "",
          "Inline code keeps `#!cpp json value;` readable.",
          "Template names like <json> stay visible.",
          "",
          '!!! note "Read this"',
          "    The note body survives.",
          "",
          '??? example "Example"',
          "    ```cpp",
          '    --8<-- "examples/basic.cpp"',
          "    ```",
          "",
          '=== "Modern"',
          "    ```cpp",
          '    --8<-- "examples/basic.cpp"',
          "    ```",
        ].join("\n"),
      );

      const page = await loadDocsPage(filePath, "index", {
        changelog: false,
        sourceRoot: docsDir,
        preprocess: [preprocessMkDocsMarkdown],
      });

      expect(page.kind).toBe("markdown");
      if (page.kind !== "markdown") return;

      expect(page.html).toContain("nlohmann");
      expect(page.html).toContain("Read this");
      expect(page.html).toContain("The note body survives.");
      expect(page.html).toContain("Modern");
      expect(page.html).toContain("json value;");
      expect(page.html).toContain("&lt;json&gt;");
      expect(page.html).not.toContain("--8<--");
      expect(page.html).not.toContain("!!! note");
      expect(page.html).not.toContain("??? example");
      expect(page.html).not.toContain("=== &quot;Modern&quot;");
      expect(page.html).not.toContain("#!cpp");
    });
  });

  it("rejects MkDocs snippets outside the source root", async () => {
    await withTempDir(async (dir) => {
      const docsDir = join(dir, "docs");
      await mkdir(docsDir, { recursive: true });
      await writeFile(join(dir, "secret.txt"), "do not publish\n");
      const filePath = join(docsDir, "index.md");
      await writeFile(filePath, ['# Home', '', '--8<-- "../secret.txt"'].join("\n"));

      await expect(
        loadDocsPage(filePath, "index", {
          changelog: false,
          sourceRoot: docsDir,
          preprocess: [preprocessMkDocsMarkdown],
        }),
      ).rejects.toThrow(/escapes docs_dir/);
    });
  });

  it("preserves MkDocs HTML headings while escaping C++ template-like names", async () => {
    await withTempDir(async (dir) => {
      const docsDir = join(dir, "docs");
      const filePath = join(docsDir, "index.md");
      await mkdir(docsDir, { recursive: true });
      await writeFile(filePath, "# Home\n");

      const preprocessed = preprocessMkDocsMarkdown(
        "# <small>std::</small>hash<nlohmann::basic_json\\>",
        { filePath, sourceRoot: docsDir },
      );

      expect(preprocessed).toContain("<small>std::</small>hash&lt;nlohmann::basic_json&gt;");
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
