/** Built-in themes and their packaged assets. Themes may deliberately share a foundation. */
const foundation = { client: "index", css: ["default/sourcey.css"] };

export const themeDefinitions = {
  default: foundation,
  minimal: foundation,
  "api-first": foundation,
  reader: { client: "reader", css: ["default/sourcey.css", "reader/sourcey.css"] },
} as const;

export type ThemeName = keyof typeof themeDefinitions;
