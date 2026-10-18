import type {
  GodocExample,
  GodocFunc,
  GodocPackage,
  GodocType,
  GodocValue,
} from "./godoc-types.js";
import { fencedCode } from "../exports/markdown.js";

export function godocMarkdown(pkg: GodocPackage): string {
  const parts = [pkg.docMarkdown ?? pkg.doc];
  const examples = (items: GodocExample[]) =>
    items
      .map((item) =>
        [
          `### Example${item.name ? `: ${item.name}${item.suffix ? `_${item.suffix}` : ""}` : ""}`,
          item.docMarkdown ?? item.doc,
          fencedCode(item.code, "go"),
          item.output !== undefined ? `Output:\n\n${fencedCode(item.output, "text")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
      .join("\n\n");
  const symbol = (item: GodocValue | GodocFunc | GodocType): string =>
    [
      `## ${item.name}`,
      fencedCode("signature" in item ? item.signature : item.declaration, "go"),
      item.docMarkdown ?? item.doc,
      "fields" in item
        ? item.fields
            .map(
              (field) =>
                `- \`${field.name}: ${field.type}\`${field.tag ? ` (${field.tag})` : ""}: ${field.docMarkdown ?? field.doc}`,
            )
            .join("\n")
        : "",
      "methods" in item ? item.methods.map(symbol).join("\n\n") : "",
      "examples" in item ? examples(item.examples) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  parts.push(
    ...[...pkg.consts, ...pkg.vars, ...pkg.funcs, ...pkg.types].map(symbol),
    examples(pkg.examples),
  );
  return parts.filter(Boolean).join("\n\n");
}
