import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "sourcey-mcp-package-"));
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], {
      encoding: "utf8",
    }),
  )[0];
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      "packages/docs-mcp",
      "--ignore-scripts",
      "--no-save",
      "--package-lock=false",
      "--no-audit",
      "--no-fund",
      join(directory, packed.filename),
    ],
    { stdio: "inherit" },
  );
  execFileSync("npm", ["test", "--prefix", "packages/docs-mcp"], { stdio: "inherit" });
} finally {
  await rm(directory, { recursive: true, force: true });
}
