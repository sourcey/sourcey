---
title: Themes & Layout
description: Four themes, brand colours, fonts, layout widths, light and dark, custom CSS and icons.
---

`theme.name` chooses how every page is drawn. Colours, fonts, widths and your own CSS apply on top of any theme.

| Theme | Layout |
| --- | --- |
| `default` | The sidebar on the left, the page in the middle, "On this page" on the right |
| `minimal` | One centred column with no sidebar or "On this page" on a wide screen: readers move by the header's tabs and previous and next, and a phone's menu lists the pages. Suits a single page or a short manual |
| `api-first` | Full width, with the sidebar pinned to the left edge and each operation's examples beside it, in view while you read it |
| `reader` | An editorial frame for specifications and long documents: a dark masthead, chapter navigation, a reading column and a page outline, with a chapter selector on phones |

```ts
export default defineConfig({
  theme: {
    name: "api-first",
    colors: { primary: "#0d9488" },
    fonts: { sans: "Inter", mono: "system" },
    layout: { content: "48rem" },
    css: ["./brand.css"],
  },
  // ...
});
```

## Colours

`theme.colors.primary` colours links, the current page, focus rings and accents. It is a six-digit hex colour, such as `#0d9488`; without one, the theme is indigo, `#6366f1`.

`light` is the primary as text on dark surfaces and `dark` the primary as text on light ones, and fills behind white text. Leave them out and Sourcey derives each from the primary: the colour itself where it reads against the theme's surfaces, or else the nearest lighter or darker shade of its hue that does.

```ts
colors: { primary: "#0d9488", light: "#2dd4bf", dark: "#0f766e" },
```

## Fonts

Text is set in Inter, loaded from Google Fonts, and code in the platform's monospace fonts. A named family loads from Google Fonts, one stylesheet for each, at the weights the theme uses; a family without one of them shows its nearest. `"system"` uses the platform's own fonts, with nothing downloaded:

```ts
fonts: { sans: "system", mono: "JetBrains Mono" },
```

For a font Google does not serve, set `google: false` and define its `@font-face` in a stylesheet in `theme.css`. A relative `url()` there, to a font file or an image, resolves from the stylesheet's folder: Sourcey publishes the file beside the site's other media and rewrites the reference, and a missing file fails the build. Remote and `data:` URLs stay as written.

```ts
fonts: { sans: "Acme Sans", google: false },
css: ["./fonts.css"],
```

## Layout

`theme.layout` sets the sidebar's width, the width of "On this page", and the widest the reading column grows, as CSS lengths.

| Theme | `sidebar` | `toc` | `content` |
| --- | --- | --- | --- |
| `default` | `18rem` | `19rem` | `44rem` |
| `api-first` | `17.5rem` | `13.5rem` | `44rem`, for guide pages |
| `reader` | `245px` | `220px` | `850px` |

`minimal` keeps its own column width.

## Light and dark

Every theme has a light and a dark appearance, with a control in the header to switch between them. A reader's choice is saved in their browser and applied before the page is drawn, so a page never flashes the wrong one. Until they choose, the page follows their system:

```ts
theme: { appearance: { default: "dark" } },
```

`appearance.default` is `"system"`, `"light"` or `"dark"`. `appearance.storageKey` names where the choice is saved, `sourcey-theme` unless set, so sites on one origin can share a choice or keep their own. A switch dispatches a `sourcey:themechange` event, `{ theme: "dark" }`, on `document`.

A logo that does not read on both backgrounds can have one for each, and [figures](./components.md#figures-video-and-diagrams) can too:

```ts
logo: { light: "./brand/logo.svg", dark: "./brand/logo-dark.svg" },
```

## Custom CSS

Stylesheets in `theme.css` load after the theme's, in the order listed, so their rules win. The dark appearance puts a `dark` class on the root element:

```css
.dark .callout {
  border-color: rgb(var(--color-primary-light));
}
```

The theme's colours, fonts and widths are custom properties a stylesheet can read or set. Colours are space-separated RGB channels, used as `rgb(var(--color-primary))`:

| Property | Holds |
| --- | --- |
| `--color-primary`, `--color-primary-light`, `--color-primary-ink` | The primary, and its text shades on dark and light surfaces |
| `--color-gray-50` to `--color-gray-950` | The neutral greys |
| `--color-background-light`, `--color-background-dark` | The page in each appearance |
| `--font-sans`, `--font-mono` | The font stacks |
| `--sidebar-width`, `--toc-width`, `--content-max-width` | The layout widths |

Each code block names its language, `<div class="prose-code-block" data-language="ts">`, so a stylesheet can label blocks by language.

## Icons

Card and inline icons (`<Card icon="...">`, `<Icon icon="..." />`), callouts and the built-in language and contents icons come from one outline set. [Heroicons](https://heroicons.com) is the default. Set `theme.icons: "lucide"` to draw them from [Lucide](https://lucide.dev) instead, and install its `lucide-static` package beside Sourcey:

```ts
export default defineConfig({
  theme: { icons: "lucide" },
  // ...
});
```

Icons are named as the set names them (`key` in Heroicons, `key-round` in Lucide) and are written into the page as inline SVG at build time; no icon library or extra request reaches the browser. A name the set lacks stops the build at the component that uses it. A card or inline icon can instead be an image, by path (`./icons/go.svg`) or URL, which keeps its own colours, or a brand mark: `brand:aws` draws [Font Awesome Free](https://fontawesome.com)'s mark in the text colour, from its `@fortawesome/fontawesome-free` package installed beside Sourcey. Font Awesome's icons are licensed CC BY 4.0, so each brand mark carries Font Awesome's attribution notice in its `data-sourcey-attribution` attribute; the marks stay their owners' trademarks. Brand marks on navbar and footer links (`github`, `discord`, `discourse`, ...) are separate and do not change with `theme.icons`.

## API first

`api-first` is the full-width theme. The header and tab row run edge to edge, the sidebar is pinned to the left edge, and guide and API pages share the same left and right edges. Guide pages keep "On this page" on the right. Each API and MCP operation splits into two columns: parameters and responses on the left, and the request and response examples on the right, in view while you read the operation.

Its greys, header band, borders and code cards are shaded from `theme.colors.primary`. A vivid primary gives the neutrals a hint of its hue, and a grey primary leaves them grey. Links and the active page use the primary itself. The shades are written as the custom properties above, before your custom CSS, so a stylesheet can override any of them:

```css
:root {
  --color-gray-50: 248 250 252;
  --color-background-dark: 10 12 16;
}
```

## Reader

`reader` is a three-column editorial theme for specifications and long-form documentation, with light and dark reading modes. It has a dark masthead, grouped chapter navigation, a page table of contents, previous/next links, and a compact chapter selector on mobile. The appearance control shares the saved choice and sits after search in the masthead. Its configuration holds the project's own content; the theme holds no project names or protocol assumptions.

```ts
export default defineConfig({
  name: "Example standards",
  theme: {
    name: "reader",
    fonts: { sans: "Your Local Font", google: false },
    css: ["./fonts.css", "./brand.css"],
    reader: {
      document: {
        label: "Protocol",
        title: "Interaction specification",
        version: "Draft",
        status: "Working draft",
        badge: "Draft",
        updated: "22 September 2026",
      },
      sidebar: {
        links: [{ label: "Examples", href: "/examples/", icon: "code" }],
        note: "A shared interaction contract.",
      },
      aside: {
        links: [
          {
            label: "Try the example",
            description: "See the interaction in action.",
            href: "/examples/",
            icon: "code",
          },
        ],
      },
      pagination: {
        after: { label: "Contribute", href: "/contribute/" },
      },
      footer: {
        text: "Example standards",
        links: [{ label: "Edit this specification", href: "/contribute/" }],
      },
      searchHref: "/search/",
    },
  },
  navigation: {
    tabs: [
      {
        tab: "Specification",
        slug: "",
        source: markdown({ groups: [{ group: "Start", pages: ["index", "authorization"] }] }),
      },
    ],
  },
});
```

All `reader` settings are optional. A mark-only logo is `logo.mark`. `document.updated` is authored publication metadata, never the build date. `sidebar.links`, `sidebar.note`, `aside.links` and `footer.links` hold the project's own links and notes; the theme supplies none for those areas. `pagination.before` and `pagination.after` lead to destinations before the first chapter and after the last. Omit `searchHref` to use Sourcey's own search. The reader footer includes Sourcey's standard "Docs by Sourcey" attribution. Without JavaScript, chapter and site links still work.

Reader's brand CSS loads after its styles and can set `--ink`, `--paper`, `--lime`, `--blue`, `--blue-ink` and `--font`. Its own browser script supplies its navigation and copy controls, without the other themes' drawer.
