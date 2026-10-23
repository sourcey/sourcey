---
title: Markdown components
description: Write guides with callouts, tabs, linked page lists, responsive media and build-time components that remain readable outside the browser.
---

Native components use static attributes in Markdown or MDX. Their content feeds the rendered page, headings, search and Markdown exports.

## Callouts and tabs

```md
:::note[Keep the cursor]
Use the cursor returned by the server. Do not construct one yourself.
:::

<Tabs>
  <Tab title="Request">

  Send the request with your API key.

  </Tab>
  <Tab title="Response">

  Keep the returned cursor for the next page.

  </Tab>
</Tabs>
```

`Note`, `Warning`, `Tip`, `Info`, `Caution` and `Danger` support an authored title. Default titles follow the active UI language. GitHub alerts such as `> [!WARNING]` use the same native callouts. Tabs use ordinary buttons with arrow-key, Home and End navigation; their contents remain present in readable exports.

`Badge` can appear in a sentence or table cell. `Steps`/`Step`, `CardGroup`/`Card`, `AccordionGroup`/`Accordion`, `Expandable`, `FileTree` and `CodeGroup` cover the corresponding guide structures. An `Accordion` can have its own `anchor="..."` for links to it; it shares the page's anchors with its headings, and two explicit anchors that collide stop the build. A component name Sourcey does not know fails with its source location.

## Icons

```md
<Card title="Go" icon="./icons/go.svg" href="/sdks/go">The Go SDK.</Card>
<Card title="AWS" icon="brand:aws" href="/deploy/aws">Deploy to AWS.</Card>

Open the <Icon icon="ellipsis-horizontal" /> menu, then select <Icon icon="clipboard" label="Copy" />.
```

A card's `icon` and an inline `Icon` name a glyph of the site's [icon set](./configuration.md#icons), a brand mark as `brand:` and its Font Awesome name, or an image by path or URL, which keeps its own colours. An inline icon is sized to the text around it. Give it a `label` when it stands for something, such as a control to select: the label is its name for assistive technology and its text in readable Markdown. Without one it is decorative, and readable Markdown leaves it out.

## Fields

```md
<Field name="limit" type="integer" default={20} min={1} max={100}>
  How many items to return.
</Field>

<Field name="owner" type="object" required>
  Who owns the key.

  <Field name="id" type="string" required>The owner's ID.</Field>
</Field>
```

A field documents a setting, a variable or a property in a guide, drawn the way the API reference draws its parameters: its name, type, `required`, `deprecated`, `default` and a `min`/`max` range, then its description. Fields nested inside a field are its child attributes, behind the same disclosure the reference uses; an `<Expandable title="...">` inside a field groups child fields under that title, one group for each shape the field can take.

Each field has an anchor, `field-` and its name (`#field-limit`), or the fragment given in `anchor="..."`. Fields share a page's anchors with its headings: a repeated name is numbered (`#field-id-1`), and two explicit anchors that collide stop the build. Readable Markdown lists each field with the same facts as its row. An attribute a field does not read stops the build at the field.

## Content for agents

```md
<ForAgents>
The complete OpenAPI document is at `/api/docs/json`. Add `?tag=secrets` to get one tag.
</ForAgents>
```

`ForAgents` holds content written for agents that read the documentation. It stays in the page's Markdown export, `llms-full.txt` and the document index, and never in the page itself: the page, its table of contents, its anchors, human search and its default description leave it out.

## Page lists from navigation

```md
<PageCards section="authentication" layout="cards" />
```

The section is a navigation group's stable `id`. Omit it for the current tab. `layout="list"` gives a compact linked list. Titles, destinations and nested sections come from compiled navigation, so a page list follows a title or route edit without a second hand-maintained list.

## Include an authored file

```md
<Include src="./examples/request.ts" language="typescript" />
```

Omit `language` to include Markdown content. A `region` selects a balanced `#region name` / `#endregion name` block. Missing, repeated or unbalanced region markers fail the build. Includes are relative to their containing file and must stay within the allowed content root. Edits to an included file update its dependent pages.

## Code annotations

````md
```ts title="request.ts" {1,3} focus={3} add={4} remove={5}
const cursor = previous.nextCursor;
const limit = 50;
const page = await client.list({ cursor, limit });
render(page.items);
render(previous.items);
```
````

Line numbers refer to the displayed source. `highlight=`, `focus=`, `add=` and `remove=` accept comma-separated lines or ranges. They change presentation; copying code retains the source. An unknown option or out-of-range line fails with a diagnostic.

A code block names its language on its element, `<div class="prose-code-block" data-language="ts">`, so a stylesheet can label blocks by language.

## Figures, video and diagrams

```md
<Figure
  src="./dashboard.png"
  darkSrc="./dashboard-dark.png"
  alt="The project dashboard with three assigned tasks"
  width={1280}
  caption="The same project in light and dark mode."
/>

<Video src="./walkthrough.webm" poster="./walkthrough.png" title="Create a project" />
```

Figures generate responsive AVIF, WebP and PNG variants without upscaling. Set `densities` or `formats` when you need a different set. Without `quality`, each format uses its encoder's default (AVIF 50, WebP 80, PNG lossless); a `quality` applies to every format, so a high one is costly in AVIF. The chosen image follows the saved appearance preference; without JavaScript, the system preference selects its light or dark source. Video can declare a `sources` array for multiple formats and supports `muted`, `loop`, `autoplay` and `playsinline`.

A fenced `mermaid` block renders to static SVG at build time. The page retains its source in a disclosure, and readable Markdown retains the original diagram text. The diagram renderer stays out of the browser bundle. An unsupported or malformed diagram fails the build rather than producing a blank image.

Ordinary relative Markdown images, titled images, linked thumbnails, HTML media and local downloads join the same asset closure. A Git LFS pointer is diagnosed as an unmaterialized asset; keep your project's LFS checkout step.

## Build-time components

Register a native definition when a page should derive content from a specification, JSON file or other declared input:

```ts
import { defineComponent } from "sourcey";

const Options = defineComponent({
  parseProps: attributes => attributes,
  async resolve(_input, context) {
    const options = await context.readJson("./options.json");
    return {
      content: await context.parseMarkdown(
        ["## Storage options", "", "```json", JSON.stringify(options, null, 2), "```"].join("\n"),
      ),
    };
  },
});
```

Register the definition with `components: { Options }` in `defineConfig`.

Use `<Options />` in the page. `context.readText` and `readJson` register the input dependency; `asset`, `figure` and `diagram` use the shared asset builders. `context.context` identifies the selected locale, content language, release and UI messages.

Return semantic `content` for facts the reader needs. Optional `renderHtml` can arrange those nodes: each Markdown node stays whole, apart from a heading it holds, which becomes a node of its own. Generated headings and prose then remain available to the table of contents, search and agents. Executable JSX attributes require conversion; native attributes are static values.

## Optional browser behaviour

A definition can declare `client: { entry: "./components/options-client.ts", css: ["./components/options.css"] }`. The browser entry exports `default function mount(root, props)` and can return a cleanup function. Only the explicit `clientProps` value is serialized; build-only `data` stays on the build side. Declare `inline: true` for an intrinsically inline component.

The build bundles that module and its imported assets once. A helper or CSS edit invalidates its dependents. The client enhances the server-rendered content; put the useful reference material in `content` so the page remains readable before the module runs.

Use `data-*` attributes to bind the client to elements in `renderHtml`. Standard `aria-*` attributes survive rendering too. Put behavior in the client module; inline event handlers and script tags are removed.
