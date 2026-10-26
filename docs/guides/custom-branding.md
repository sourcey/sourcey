---
title: Custom branding
description: Your colours, fonts and logo on any theme.
---

Sourcey starts indigo, in Inter. This replaces that with your own brand. [Themes](../themes.md) lists every setting used here.

## Colours

:::steps

1. Set the primary colour
   ```ts
   theme: {
     colors: { primary: "#0066cc" },
   }
   ```
   This one value colours links, the current page, focus rings and accents. Sourcey derives the shades it needs as text on light and dark surfaces, so it reads in both appearances.

2. Choose those shades yourself, if you want to
   ```ts
   theme: {
     colors: {
       primary: "#0066cc",
       light: "#3399ff", // the primary as text on dark surfaces
       dark: "#003d99",  // the primary as text on light surfaces
     },
   }
   ```

3. See it
   ```bash
   npx sourcey dev
   ```

:::

:::warning
Colours are six-digit hex values. Shorthand such as `#f00` fails the build; write `#ff0000`.
:::

## Logo

```ts
logo: "./brand/logo.svg",
```

A logo that does not read on both backgrounds can have one for each, and lead somewhere other than the docs' home:

```ts
logo: {
  light: "./brand/logo.svg",
  dark: "./brand/logo-dark.svg",
  href: "https://example.com",
},
```

A logo is taken as a wordmark, so the site's name is not repeated beside it. For a mark without the name, add `mark: true` and the name shows beside it.

## Fonts

Name a family from Google Fonts and Sourcey loads it:

```ts
theme: {
  fonts: { sans: "Inter", mono: "JetBrains Mono" },
}
```

`"system"` uses the reader's own platform fonts, with nothing downloaded. For a font Google does not serve, turn Google off and define it in your own stylesheet:

```ts
theme: {
  fonts: { sans: "Acme Sans", google: false },
  css: ["./fonts.css"],
}
```

## Favicon

```ts
favicon: "./brand/favicon.svg",
```

Without one, the site's icon is its logo where that is a mark, or a square of its primary colour.

## Your own CSS

For anything the settings don't cover, add a stylesheet. It loads after the theme's, so its rules win, and it can read or set the theme's custom properties, such as `--color-primary` and `--font-sans`:

```ts
theme: {
  css: ["./brand.css"],
}
```

```css
.dark .callout {
  border-color: rgb(var(--color-primary-light));
}
```

## All together

```ts
import { defineConfig } from "sourcey";

export default defineConfig({
  name: "Acme Docs",
  theme: {
    colors: { primary: "#0066cc" },
    fonts: { sans: "Inter", mono: "JetBrains Mono" },
    css: ["./brand.css"],
  },
  logo: { light: "./brand/logo.svg", dark: "./brand/logo-dark.svg" },
  favicon: "./brand/favicon.svg",
  navigation: { tabs: [/* ... */] },
});
```
