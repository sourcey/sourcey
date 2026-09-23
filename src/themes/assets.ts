import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { themeDefinitions, type ThemeName } from "./registry.js";

/** The same asset selection is used by development and packaged static builds. */
export function resolveThemeAssets(name: ThemeName) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const source = existsSync(resolve(root, "src/client/index.ts"));
  const tree = source ? "src" : "dist";
  const theme = themeDefinitions[name];
  return {
    clientEntry: resolve(root, tree, `client/${theme.client}.${source ? "ts" : "js"}`),
    foundationCss: resolve(root, tree, "themes/default/main.css"),
    sourceyCssPaths: theme.css.map((css) => resolve(root, tree, "themes", css)),
  };
}
