import { cp } from "node:fs/promises";

// Preserve theme directories on every host; TypeScript emits the modules itself.
await cp(new URL("../src/themes/", import.meta.url), new URL("../dist/themes/", import.meta.url), {
  recursive: true,
  filter: (source) => !source.endsWith(".ts"),
});
