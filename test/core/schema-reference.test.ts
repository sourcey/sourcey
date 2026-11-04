import { expect, it } from "vitest";
import { schemaReferencePath } from "../../src/core/schema-reference.js";

it.each([
  ["#/$defs/a~1b~0c%25", ["$defs", "a/b~c%"]],
  ["#/%24defs/Thing", ["$defs", "Thing"]],
  ["models.json#/components/schemas/100%", ["components", "schemas", "100%"]],
  ["#/properties/choice/anyOf/0", ["properties", "choice", "anyOf", "0"]],
])("decodes reference tokens without changing their scope: %s", (ref, path) => {
  expect(schemaReferencePath(ref)).toEqual(path);
});
