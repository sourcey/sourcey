import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Each file's last change by repository and commit: one walk of the history while HEAD stays. */
const histories = new Map<string, Promise<Map<string, string>>>();

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd, maxBuffer: 1024 * 1024 * 1024 })).stdout.trim();
}

/**
 * When each file last changed, as the date of the last commit that touched it,
 * from the history of the repository `directory` is in. A file no commit holds
 * has no date. A shallow checkout, which would date every file by its one
 * commit, stops the build.
 */
export async function lastChanged(directory: string, files: readonly string[]): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  if (files.length === 0) return dates;
  let top: string, head: string;
  try {
    top = await git(directory, ["rev-parse", "--show-toplevel"]);
    head = await git(top, ["rev-parse", "HEAD"]);
  } catch (error) {
    throw new Error(`lastUpdated dates each page by its last commit, and ${directory} is in no git repository with commits`, { cause: error });
  }
  if ((await git(top, ["rev-parse", "--is-shallow-repository"])) === "true")
    throw new Error("lastUpdated dates each page by its last commit, and this checkout holds only the latest commits; check out the whole history (fetch-depth: 0 for actions/checkout)");
  const paths = new Map<string, string>();
  for (const file of files) {
    const path = relative(top, await realpath(file).catch(() => file)).split(sep).join("/");
    if (!path.startsWith("../")) paths.set(file, path);
  }
  if (paths.size === 0) return dates;
  // The walk reads only the folder the pages share.
  const shared = commonFolder([...paths.values()]);
  const key = `${top}\0${head}\0${shared}`;
  let history = histories.get(key);
  if (!history) {
    history = git(top, ["-c", "core.quotePath=false", "log", "--format=%x1e%cI", "--name-only", "--no-renames", "HEAD", "--", shared || "."]).then(log => {
      const changed = new Map<string, string>();
      for (const commit of log.split("\x1e")) {
        const [date, ...names] = commit.split("\n");
        for (const name of names) if (name && !changed.has(name)) changed.set(name, date.trim());
      }
      return changed;
    });
    histories.set(key, history);
  }
  const changed = await history;
  for (const [file, path] of paths) {
    const date = changed.get(path);
    if (date) dates.set(file, date);
  }
  return dates;
}

function commonFolder(paths: string[]): string {
  let shared = dirname(paths[0]);
  for (const path of paths) while (shared !== "." && !path.startsWith(`${shared}/`)) shared = dirname(shared);
  return shared === "." ? "" : shared;
}
