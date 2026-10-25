import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd, maxBuffer: 1024 * 1024 * 1024 })).stdout.trim();
}

/** The repository a site's folder is in: its top, its commit, and the folder within it. */
export interface Repository {
  top: string;
  head: string;
  folder: string;
}

/** When each file under a folder last changed, by repository, commit and folder: one walk while HEAD stays. */
const walks = new Map<string, Promise<Map<string, string>>>();

function walk({ top, head }: Repository, folder: string): Promise<Map<string, string>> {
  const key = `${top}\0${head}\0${folder}`;
  let changed = walks.get(key);
  if (!changed) {
    changed = git(top, ["-c", "core.quotePath=false", "log", "--format=%x1e%cI", "--name-only", "--no-renames", "HEAD", "--", folder || "."]).then((log) => {
      const dates = new Map<string, string>();
      for (const commit of log.split("\x1e")) {
        const [date, ...names] = commit.split("\n");
        for (const name of names) if (name && !dates.has(name)) dates.set(name, date.trim());
      }
      return dates;
    });
    walks.set(key, changed);
  }
  return changed;
}

/**
 * Begin reading the history of the repository a site's folder is in, so the
 * build reads it while the site's pages load. A folder in no repository with
 * commits, or a shallow checkout, which would date every file by its one
 * commit, stops the build where the dates are asked for.
 */
export function readRepository(directory: string): Promise<Repository> {
  const repository = (async () => {
    let lines: string[];
    try {
      lines = (await git(directory, ["rev-parse", "--show-toplevel", "HEAD", "--is-shallow-repository"])).split("\n");
    } catch (error) {
      throw new Error(`lastUpdated dates each page by its last commit, and ${directory} is in no git repository with commits`, { cause: error });
    }
    const [top, head, shallow] = lines as [string, string, string];
    if (shallow === "true") throw new Error("lastUpdated dates each page by its last commit, and this checkout holds only the latest commits; check out the whole history (fetch-depth: 0 for actions/checkout)");
    const found = { top, head, folder: posixPath(relative(top, await realpath(directory))) };
    void walk(found, found.folder);
    return found;
  })();
  // Its failure is reported where the dates are asked for.
  repository.catch(() => undefined);
  return repository;
}

/** When each file last changed, as the date of the last commit that touched it. A file no commit holds has none. */
export async function lastChanged(repository: Promise<Repository>, files: readonly string[]): Promise<Map<string, string>> {
  const found = await repository;
  const paths = new Map<string, string>();
  for (const file of files) {
    const path = posixPath(relative(found.top, await realpath(file).catch(() => file)));
    if (!path.startsWith("../")) paths.set(file, path);
  }
  // Pages outside the site's folder, as a Markdown root beside it may hold, are read in a walk of their own.
  const outside = [...paths.values()].filter((path) => found.folder && !path.startsWith(`${found.folder}/`));
  const [inner, outer] = await Promise.all([walk(found, found.folder), outside.length ? walk(found, commonFolder(outside)) : undefined]);
  const dates = new Map<string, string>();
  for (const [file, path] of paths) {
    const date = inner.get(path) ?? outer?.get(path);
    if (date) dates.set(file, date);
  }
  return dates;
}

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function commonFolder(paths: string[]): string {
  let shared = dirname(paths[0]);
  for (const path of paths) while (shared !== "." && !path.startsWith(`${shared}/`)) shared = dirname(shared);
  return shared === "." ? "" : shared;
}
