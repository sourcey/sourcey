import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Compile the Go documentation helper once before any test file runs. Live
 * Godoc tests invoke it with `go run`; on a cold build cache, parallel test
 * files would each compile it and its standard-library dependencies at once.
 * Without Go, the live tests skip themselves.
 */
export default function setup(): void {
  const result = spawnSync("go", ["build", "./..."], {
    cwd: resolve(import.meta.dirname, "../go/sourcey-godoc"),
    stdio: "inherit",
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return;
  if (result.error || result.status !== 0) {
    throw new Error("Could not compile the Go documentation helper", { cause: result.error });
  }
}
