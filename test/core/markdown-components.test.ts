import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markdown } from "../../src/index.js";
import { resolveConfigFromRaw } from "../../src/config.js";
import { buildSourceySite, sourceyArtifacts } from "../../src/site.js";
import { contentDiagnostics, defineComponent, parseComponents, readableContent, renderContent, type ContentNode, type NativeComponentDefinition } from "../../src/core/markdown-components.js";
import { messagesFor } from "../../src/core/messages.js";
import { InputReader } from "../../src/core/loader.js";
import { diagramSvg } from "../../src/core/diagrams.js";

/** Content read in English, at the current version, as a page drawn on its own is. */
const ENGLISH = { locale: "en", lang: "en", dir: "ltr" as const, contentLocale: "en", version: { id: "current", label: "Current" }, versionScope: "", messages: messagesFor("en"), icons: "heroicons" as const };

async function guide(body: string) {
  const root = await mkdtemp(join(tmpdir(), "sourcey-components-"));
  try {
    await writeFile(join(root, "guide.md"), body);
    const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
    const site = await buildSourceySite({ config, generateOgImages: false });
    const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
    if (page.kind !== "markdown") throw new Error("Expected a guide");
    return { ...page.markdown, searchIndex: JSON.stringify(site.searchRows) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const FIELDS = [
  "# Settings",
  "",
  '<Field name="Password Length" type="number" default={12} min={8} max={128} required>',
  "  Length of the **generated** password.",
  "</Field>",
  "",
  '<Field name="options" type="object" deprecated>',
  "  Client options.",
  "",
  '  <Field name="SiteUrl" type="string" default="https://app.example.com" anchor="param-site-url">',
  "    The URL of the API.",
  "  </Field>",
  "</Field>",
  "",
].join("\n");

describe("native fields", () => {
  it("draw as the reference draws parameters, with nested child attributes and real anchors", async () => {
    const page = await guide(FIELDS);
    expect(page.html).toContain('<div class="param-item" id="field-password-length"><div class="param-header not-prose"><code class="param-name">Password Length</code><span class="param-type"><span class="json-property-type">number</span><span class="json-property-range">[8, 128]</span><span class="json-property-default-value">12</span></span><span class="required-badge');
    expect(page.html).toContain("Length of the <strong>generated</strong> password.");
    expect(page.html).toMatch(/id="field-options">[\s\S]*?>deprecated<[\s\S]*?Client options\.[\s\S]*?<details class="schema-expandable">[\s\S]*?Show child attributes[\s\S]*?id="param-site-url"/);
    expect(page.anchors).toEqual(expect.arrayContaining(["settings", "field-password-length", "field-options", "param-site-url"]));
  });

  it("group child fields under each titled shape a field can take", async () => {
    const page = await guide([
      '<Field name="metadata" type="object">',
      "  Depends on the actor.",
      "",
      '  <Expandable title="user actor">',
      '    <Field name="userId" type="string">The user.</Field>',
      '    <Field name="permission" type="object">Effective permissions.</Field>',
      "  </Expandable>",
      '  <Expandable title="identity actor">',
      '    <Field name="identityId" type="string">The identity.</Field>',
      '    <Field name="permission" type="object">Effective permissions.</Field>',
      "  </Expandable>",
      "</Field>",
      "",
    ].join("\n"));
    expect(page.html).toMatch(/Depends on the actor\.[\s\S]*?<\/div><\/div><details class="schema-expandable"><summary[^>]*>[\s\S]*?user actor<\/summary>[\s\S]*?id="field-userid"[\s\S]*?id="field-permission"[\s\S]*?<details class="schema-expandable"><summary[^>]*>[\s\S]*?identity actor<\/summary>[\s\S]*?id="field-identityid"[\s\S]*?id="field-permission-1"/);
    expect(page.markdown).toContain("**user actor**");
  });

  it("keep the same facts and prose in readable Markdown and search", async () => {
    const page = await guide(FIELDS);
    expect(page.markdown).toContain(
      ["- `Password Length` (number, required, default `12`, [8, 128])", "  Length of the **generated** password."].join("\n"),
    );
    expect(page.markdown).toContain(["- `options` (object, optional, deprecated)", "  Client options.", "  - `SiteUrl` (string, optional, default `https://app.example.com`)", "    The URL of the API."].join("\n"));
    expect(page.searchIndex).toContain("The URL of the API.");
  });

  it("share the page's anchors with headings: repeats are numbered, explicit duplicates stop the build", async () => {
    const repeated = await guide('# Host\n\n<Field name="Host" type="string">First.</Field>\n\n<Field name="Host" type="string">Second.</Field>\n');
    expect(repeated.anchors).toEqual(expect.arrayContaining(["host", "field-host", "field-host-1"]));
    await expect(guide('## Port {#port}\n\n<Field name="Port" anchor="port">Clash.</Field>\n')).rejects.toThrow("Duplicate explicit anchor: port");
  });

  it("stop at the component on attributes they do not read", async () => {
    await expect(guide('<Field name="Host" placeholder="db">Text.</Field>\n')).rejects.toThrow(/Field attribute placeholder is not supported at .*guide\.md:\d+/);
    await expect(guide('<Field type="string">Text.</Field>\n')).rejects.toThrow(/Field requires a name at .*guide\.md:\d+/);
    await expect(guide('<Field name="Port" min="8">Text.</Field>\n')).rejects.toThrow(/Field min must be a number/);
  });
});

describe("indented code", () => {
  it("is code to the component scanner, as it is to Markdown", async () => {
    const page = await guide([
      "# Registry",
      "",
      "Pull from your registry:",
      "",
      "    docker pull <REGISTRY.DOMAIN.COM:PORT>/rancher/rancher:latest",
      "    <Note>stays an example</Note>",
      "",
      "1. In a list item:",
      "",
      "        <Host>:8080",
      "",
      "<Note>",
      "Inside a callout:",
      "",
      "    <Port>",
      "</Note>",
      "",
    ].join("\n"));
    expect(page.html).toContain("docker pull &lt;REGISTRY.DOMAIN.COM:PORT&gt;/rancher/rancher:latest");
    expect(page.html).toContain("&lt;Note&gt;stays an example&lt;/Note&gt;");
    expect(page.html).toContain("&lt;Host&gt;:8080");
    expect(page.html).toMatch(/<div class="callout callout-note[^>]*role="note">[\s\S]*?Inside a callout:[\s\S]*?&lt;Port&gt;/);
    expect(page.html.match(/role="note"/g)).toHaveLength(1);
  });
});

describe("diagrams", () => {
  /** Each drawn text, its lines parted by "|". */
  const lines = (svg: string) => [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1].replace(/<tspan x="[^"]*" dy="[^"]*">/g, "|").replace(/<[^>]+>/g, "").replace(/^\|/, "").replace(/\s+/g, " ").trim());

  it("draws a diagram once for every theme, in a shadow root of its own, its colours and font the page's", async () => {
    const page = await guide("# Flow\n\n```mermaid\ngraph LR\n  a[Request] --> b[Response]\n```\n");
    expect(page.html).toMatch(/<div class="sourcey-diagram-drawing" style="max-width:[\d.]+px;min-width:\d+px" role="img" aria-label="Diagram; its source is available below"><template shadowrootmode="open"><style>[^<]*<\/style><svg [^>]*style="--bg:var\(--diagram-bg\);--fg:var\(--diagram-fg\)"/);
    expect(page.html).not.toContain("<img");
    expect(page.fonts).toEqual(["Inter"]);
  });

  it("keeps a drawing whole on a page whose author wrote HTML, which the sanitizer reads and the drawing never passes through", async () => {
    const page = await guide('# Flow\n\n<div class="lead">Written <em>by hand</em><script>alert(1)</script></div>\n\n```mermaid\ngraph LR\n  a[Request] --> b[Response]\n```\n');
    expect(page.html).not.toContain("<script>");
    expect(page.html).toContain('<div class="lead">Written <em>by hand</em></div>');
    expect(page.html).toMatch(/<template shadowrootmode="open"><style>:host[^<]*<\/style><svg [^>]*viewBox="[^"]+"[^>]*>\s*<style>/);
  });

  it("breaks a label's lines at <br>, wherever Mermaid allows one", async () => {
    const flowchart = await diagramSvg('graph TB\n  subgraph S["Client<br>Layer"]\n  x["Ever Teams<br/>(React/RN)"] -->|HTTP<br/>WS| y[End]\n  end');
    expect(lines(flowchart)).toEqual(expect.arrayContaining(["Ever Teams|(React/RN)", "HTTP|WS", "Client|Layer"]));
    const sequence = await diagramSvg("sequenceDiagram\n  participant FE as Gauzy Frontend<br/>(Angular)\n  FE->>FE: Create<br/>settings\n  Note over FE: If it exists,<br/>redirect");
    expect(lines(sequence)).toEqual(expect.arrayContaining(["Gauzy Frontend|(Angular)", "Create|settings", "If it exists,|redirect"]));
    for (const svg of [flowchart, sequence]) expect(svg).not.toMatch(/&lt;br/i);
  });

  it("reads a label as Mermaid shows it: an entity is the character it names, emphasis stays and other markup is left out", async () => {
    const svg = await diagramSvg('graph LR\n  slot["&lt;page-slot id=\'main\'&gt;"] --> orm["Decorator Layer<br/>(entities & metadata)"]\n  orm --> plain["Plain <b>bold</b> <span>text</span>"]');
    expect(lines(svg)).toEqual(expect.arrayContaining(["&lt;page-slot id='main'&gt;", "Decorator Layer|(entities &amp; metadata)", "Plain bold text"]));
    expect(svg).toContain('<tspan font-weight="bold">bold</tspan>');
    expect(svg).not.toMatch(/&amp;(lt|gt|amp);|<span/);
  });
});

describe("diagrams the renderer cannot draw", () => {
  const gitGraph = "# Workflow\n\n```mermaid\ngitGraph\n  commit\n  branch develop\n```\n";

  it("keep their source in the page, explained, with no picture claiming to be it", async () => {
    const page = await guide(gitGraph);
    expect(page.html).toMatch(/<figure class="sourcey-diagram sourcey-diagram-unrendered"><figcaption>This diagram could not be drawn, so its source is shown\.<\/figcaption>[\s\S]*?gitGraph[\s\S]*?branch develop[\s\S]*?<\/figure>/);
    expect(page.html).not.toContain("<img");
    expect(page.markdown).toContain("```mermaid\ngitGraph");
  });

  it("are reported where they are written", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-diagram-"));
    try {
      const file = join(root, "guide.md");
      await writeFile(file, gitGraph);
      const nodes = await parseComponents(gitGraph, { source: file, root, input: new InputReader(), context: ENGLISH });
      const context = { ...ENGLISH, locale: "fr", lang: "fr", contentLocale: "fr", messages: messagesFor("fr") };
      const french = await parseComponents(gitGraph, { source: file, root, input: new InputReader(), context });
      expect(renderContent(french, context.messages)).toContain("<figcaption>Ce diagramme n’a pas pu être dessiné ; sa source est affichée.</figcaption>");
      expect(contentDiagnostics(nodes)).toEqual([
        { severity: "warning", code: "diagram", file: await realpath(file), message: expect.stringMatching(/guide\.md at offset 12: the diagram could not be drawn \(Diagram type "gitGraph" is not supported\); the page shows its source instead$/) },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("agent-only content", () => {
  it("stays in machine exports and out of the page, its anchors, search and description", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-agents-"));
    try {
      await writeFile(join(root, "guide.md"), "# Guide\n\n<ForAgents>\nAgents: fetch the full spec.\n\n## For agents\n\nUse the tag filter.\n</ForAgents>\n\nPeople start here.\n\n## Setup\n\nInstall it.\n");
      const config = await resolveConfigFromRaw({ theme: { fonts: { google: false } }, exports: { markdown: true }, navigation: { tabs: [{ tab: "Docs", slug: "", source: markdown({ slugs: "file", groups: [{ group: "Start", pages: ["guide"] }] }) }] } }, root);
      const site = await buildSourceySite({ config, generateOgImages: false });
      const page = site.pages.find(entry => entry.outputPath === "guide.html")!.currentPage;
      if (page.kind !== "markdown") throw new Error("Expected a guide");
      expect(page.markdown.html).not.toContain("fetch the full spec");
      expect(page.markdown.html).not.toContain("For agents");
      expect(page.markdown.headings.map(heading => heading.text)).toEqual(["Setup"]);
      expect(page.markdown.anchors).not.toContain("for-agents");
      expect(page.markdown.description).toBe("People start here.");
      expect(page.markdown.markdown).toContain("Agents: fetch the full spec.");
      expect(page.markdown.readerMarkdown).not.toContain("fetch the full spec");
      expect(JSON.stringify(site.searchRows)).not.toContain("fetch the full spec");
      const files = await sourceyArtifacts(site);
      expect(files.get("guide.md")!.toString()).toContain("Agents: fetch the full spec.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("inline components", () => {
  it("stay in their sentence in readable Markdown and the description, and keep an opening paragraph in the page", async () => {
    const page = await guide('# Guide\n\nUse <Badge text="stable" /> with care.\n\nMore.\n');
    expect(page.markdown).toContain("Use stable with care.\n");
    expect(page.description).toBe("Use stable with care.");
    // A plain description cannot show the badge, so the paragraph stays in the page rather than becoming the lede.
    expect(page.hideLede).toBe(true);
    expect(page.html).toContain('<p>Use <span class="sourcey-badge"><strong>stable</strong></span> with care.</p>');
  });

  it("stay in their place inside an author's HTML", async () => {
    const page = await guide('# Guide\n\n<div style="display:flex">\n  <Badge text="stable" />\n  Ready\n</div>\n\nMore.\n');
    expect(page.html).toContain('<div style="display:flex">\n  <span class="sourcey-badge"><strong>stable</strong></span>\n  Ready\n</div>');
  });

  it("keep an opening paragraph with a link in the page, where the plain lede would lose it", async () => {
    const page = await guide("# Guide\n\nUse the [REST API](/api/) or the CLI.\n\nMore.\n");
    expect(page.description).toBe("Use the REST API or the CLI.");
    expect(page.hideLede).toBe(true);
    expect(page.html).toContain('<p>Use the <a href="/api/">REST API</a> or the CLI.</p>');
  });

  it("make a plain opening paragraph the lede", async () => {
    const page = await guide("# Guide\n\nUse the CLI.\n\nMore.\n");
    expect(page.hideLede).toBeUndefined();
    expect(page.html).not.toContain("Use the CLI.");
  });
});

describe("footnotes", () => {
  it("number in reading order across the page, a callout's included, with their notes at its end and a way back", async () => {
    const page = await guide([
      "# Guide",
      "",
      "Opening.",
      "",
      "Install a LAMP stack[^lamp] first.",
      "",
      ":::note",
      "PHP 8.5 or later[^php], as the stack[^lamp] provides.",
      ":::",
      "",
      "[^php]: Earlier releases miss the **JSON** functions.",
      "",
      "    They were added in 8.3.",
      "[^lamp]: Linux, Apache, MySQL, PHP.",
      "[^unused]: Never cited.",
      "",
      "A [^missing] reference stays as written.",
      "",
    ].join("\n"));
    expect(page.html).toContain('LAMP stack<sup class="footnote-ref"><a href="#fn-lamp" id="fnref-lamp" aria-describedby="footnotes-label">1</a></sup> first.');
    expect(page.html).toContain('PHP 8.5 or later<sup class="footnote-ref"><a href="#fn-php" id="fnref-php" aria-describedby="footnotes-label">2</a></sup>, as the stack<sup class="footnote-ref"><a href="#fn-lamp" id="fnref-lamp-2"');
    expect(page.html).toContain("A [^missing] reference stays as written.");
    const notes = page.html.slice(page.html.indexOf('<section class="footnotes">'));
    expect(notes).toBe([
      '<section class="footnotes"><h2 id="footnotes-label" class="footnotes-label">Footnotes</h2><ol>',
      '<li id="fn-lamp"><p>Linux, Apache, MySQL, PHP. <a href="#fnref-lamp" class="footnote-back" aria-label="Back to reference 1">↩</a></p></li>',
      '<li id="fn-php"><p>Earlier releases miss the <strong>JSON</strong> functions.</p>\n<p>They were added in 8.3. <a href="#fnref-php" class="footnote-back" aria-label="Back to reference 2">↩</a></p></li>',
      "</ol></section>\n",
    ].join(""));
    expect(page.html).not.toContain("Never cited");
    expect(page.html).not.toMatch(/[-]/);
    // The page's Markdown copy keeps them as written.
    expect(page.markdown).toContain("[^lamp]: Linux, Apache, MySQL, PHP.");
  });
});

describe("accordion anchors", () => {
  it("publish an accordion's own anchor among the page's, strict as a field's", async () => {
    const page = await guide('# Guide\n\n<AccordionGroup>\n<Accordion title="Billing" anchor="billing-faq">Monthly.</Accordion>\n</AccordionGroup>\n');
    expect(page.html).toContain('<details class="accordion-item" id="billing-faq"><summary class="accordion-trigger">Billing</summary>');
    expect(page.anchors).toContain("billing-faq");
    await expect(guide('# Guide\n\n## Billing faq\n\n<Accordion title="Billing" anchor="billing-faq">Monthly.</Accordion>\n')).rejects.toThrow("Duplicate explicit anchor: billing-faq");
    await expect(guide('# Guide\n\n<Accordion title="Billing" anchor="billing faq">Monthly.</Accordion>\n')).rejects.toThrow(/Accordion anchor must be a fragment such as billing-faq at .*guide\.md/);
  });
});

describe("callouts", () => {
  it("read as GitHub alerts in readable Markdown, so a page's summary is its prose rather than a callout's label", async () => {
    const page = await guide("# Subscriptions\n\n:::tip\nThis tutorial is unfinished.\n:::\n\n:::warning[Back up first]\nIt changes your data.\n:::\n\nTrack regular payments with subscriptions.\n");
    expect(page.description).toBe("Track regular payments with subscriptions.");
    expect(page.markdown).toContain("> [!TIP]\n> This tutorial is unfinished.");
    expect(page.markdown).toContain("> [!WARNING]\n> **Back up first**\n>\n> It changes your data.");
  });

  it("stay in the list item whose text they are written in, with what follows them there", async () => {
    const page = await guide("# Setup\n\n- Add a method:\n\n  :::tip\n  Name it.\n  :::\n\n    - Each service asks for its own inputs.\n\n  <Note>Some are optional.</Note>\n\n- Edit a method.\n");
    expect(page.html).toMatch(/<li><p>Add a method:<\/p>\s*<div class="callout callout-tip[\s\S]*?Name it\.[\s\S]*?<\/div><ul>\s*<li>Each service asks for its own inputs\.<\/li>\s*<\/ul>\s*<div class="callout callout-note[\s\S]*?Some are optional\.[\s\S]*?<\/li>\s*<li><p>Edit a method\.<\/p>/);
    expect(page.markdown).toMatch(/- Add a method:\n\s*\n {2}> \[!TIP\]\n {2}> Name it\.\n\s*\n {4}- Each service asks for its own inputs\.\n\s*\n {2}> \[!NOTE\]\n {2}> Some are optional\.\n\s*\n- Edit a method\./);
  });
});

describe("cards", () => {
  it("title themselves one level below the heading they sit under, so the page's outline never skips", async () => {
    const cards = '<CardGroup>\n<Card title="Install" href="/install">Run it.</Card>\n<Card title="Use" href="/use">Call it.</Card>\n</CardGroup>';
    const top = await guide(`Start here.\n\n${cards}\n`);
    expect(top.html.match(/<h2 class="card-item-title">/g)).toHaveLength(2);
    const nested = await guide(`Start here.\n\n## Next steps\n\n${cards}\n\n### Deeper\n\n${cards}\n`);
    expect(nested.html.match(/<h3 class="card-item-title">/g)).toHaveLength(2);
    expect(nested.html.match(/<h4 class="card-item-title">/g)).toHaveLength(2);
    expect(nested.html).not.toContain("<h2 class=\"card-item-title\">");
  });
});

describe("included files", () => {
  async function inFolder(run: (parse: (markdown: string, components?: Record<string, NativeComponentDefinition>) => Promise<ContentNode[]>, root: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "sourcey-include-"));
    try {
      const source = join(root, "guide.md");
      await run((markdown, components) => parseComponents(markdown, { source, root, input: new InputReader(), context: ENGLISH, components }), root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("read as part of the page: Markdown with its components, or one region as code, and never in a cycle", () => inFolder(async (parse, root) => {
    await mkdir(join(root, "shared"));
    await writeFile(join(root, "shared", "intro.md"), "Shared **intro**.\n\n<Note>Inside the include.</Note>\n");
    await writeFile(join(root, "example.ts"), "const skipped = 0;\n// #region main\nconst answer = 42;\n// #endregion main\n");
    await writeFile(join(root, "loop.md"), '<Include src="./loop.md" />\n');
    const html = renderContent(await parse('<Include src="./shared/intro.md" />\n\n<Include src="./example.ts" region="main" language="ts" />\n'), ENGLISH.messages);
    expect(html).toContain("Shared <strong>intro</strong>.");
    expect(html).toMatch(/class="callout[^"]*"[\s\S]*Inside the include\./);
    expect(html).toContain("answer");
    expect(html).not.toContain("skipped");
    await expect(parse('<Include src="./loop.md" />\n')).rejects.toThrow(/^Include cycle: \S*guide\.md -> \S*loop\.md -> \S*loop\.md$/);
  }));

  it("are a site's own to draw when it defines an Include of its own", () => inFolder(async parse => {
    const Include = defineComponent({ parseProps: attributes => attributes, resolve: ({ children }) => ({ content: children }), renderHtml: (result, helpers) => `<aside>${helpers.render(result.content)}</aside>` });
    expect(renderContent(await parse('<Include src="./missing.md">\n\nKept as written.\n\n</Include>\n', { Include }), ENGLISH.messages)).toContain("<aside><p>Kept as written.</p>\n</aside>");
  }));
});

describe("a site's components", () => {
  it("arrange the nodes they return, their Markdown whole between the headings it names", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-arrange-"));
    try {
      // What readers are told comes first; the page draws only what the page wrote inside.
      const Panel = defineComponent({
        parseProps: attributes => attributes,
        resolve: ({ children }) => ({ content: [{ kind: "markdown" as const, value: "\n\nFor readers alone.\n\nAnd its second line.\n\n" }, ...children] }),
        renderHtml: (result, helpers) => `<aside>${helpers.render(result.content.slice(1))}</aside>`,
      });
      const nodes = await parseComponents("<Panel>\n\nWritten **inside**.\n\n## Named\n\nAfter it.\n\n</Panel>\n", { source: join(root, "guide.md"), root, input: new InputReader(), context: ENGLISH, components: { Panel } });
      const html = renderContent(nodes, ENGLISH.messages);
      expect(html).not.toContain("For readers alone.");
      expect(html).toContain("<p>Written <strong>inside</strong>.</p>");
      expect(html).toContain('<h2 id="named">Named</h2>');
      expect(html).toContain("<p>After it.</p>");
      expect(readableContent(nodes)).toContain("For readers alone.\n\nAnd its second line.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("directives", () => {
  it("name the directive a page writes that opens no component, whatever it is called", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-directive-"));
    try {
      await expect(parseComponents(":::constructor\nBody.\n:::\n", { source: join(root, "guide.md"), root, input: new InputReader(), context: ENGLISH })).rejects.toThrow(/^Unknown directive constructor at /);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
