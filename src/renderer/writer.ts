import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  readdir,
  mkdtemp,
  rmdir,
  lstat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { safeOutputPath } from "../core/site-model.js";
import { hashFile, SourceFile, type ArtifactBody } from "../core/source-file.js";

const inventoryName = ".sourcey-output.json";
const digest = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
async function existing(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
/** The digest of a file already in the output, read as a stream, or nothing where there is none. */
async function existingDigest(path: string): Promise<string | undefined> {
  try {
    return (await hashFile(path)).digest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
/**
 * Clone a source file into staging, where the file system can, or copy it,
 * and check it is still the file that was hashed: its bytes are not read again.
 */
async function copySource(source: SourceFile, target: string): Promise<void> {
  await copyFile(source.path, target, constants.COPYFILE_FICLONE);
  if (!source.unchanged(await stat(source.path))) throw new Error(`Source file changed during the build: ${source.path}`);
}

/** A lexical child path must also stay inside the owned tree on disk. */
async function plainOutputPath(
  root: string,
  target: string,
  directories: Set<string>,
): Promise<void> {
  for (let path = target; ; path = dirname(path)) {
    if (directories.has(path)) return;
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error(`Output contains a symbolic link: ${path}`);
    if (info && path !== target && !info.isDirectory())
      throw new Error(`Output parent is not a directory: ${path}`);
    if (info?.isDirectory()) directories.add(path);
    if (path === root) return;
  }
}

interface Change {
  target: string;
  existed: boolean;
  staged?: string;
  backup?: string;
  installed?: boolean;
}

export interface OutputWriter {
  /** Stage one artifact. Its bytes go to disk now and are not kept. */
  put(path: string, body: ArtifactBody): Promise<void>;
  /** Promote every staged artifact and prune what the generation no longer has. */
  commit(): Promise<void>;
  /** Discard what was staged; the live output is untouched. */
  abort(): Promise<void>;
}

/**
 * Own standalone output exclusively. Artifacts stream into a staging
 * directory as they are produced, so a site is never held in memory whole;
 * the live output is untouched until commit, which checks every prune
 * conflict before promotion and retains replaced and pruned files until the
 * new inventory commits, so an ordinary filesystem failure can roll the
 * generation back. Astro never uses this writer.
 */
export async function openOutput(outputDir: string): Promise<OutputWriter> {
  const root = resolve(outputDir);
  if (root === resolve("/") || root === resolve(process.cwd()))
    throw new Error(`Refusing to own source directory: ${root}`);
  const directories = new Set<string>();
  const inventoryPath = resolve(root, inventoryName);
  await plainOutputPath(root, inventoryPath, directories);
  const inventory = await existing(inventoryPath);
  let previous: Record<string, string> = {};
  if (inventory) {
    previous = JSON.parse(inventory.toString("utf8"));
    if (
      !previous ||
      typeof previous !== "object" ||
      Array.isArray(previous) ||
      Object.values(previous).some((hash) => typeof hash !== "string")
    )
      throw new Error("Invalid output inventory");
    Object.keys(previous).forEach(safeOutputPath);
  } else {
    const entries = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (entries.length)
      throw new Error(
        `Output directory is not owned by Sourcey: ${root}. Choose an empty build directory. ` +
          "Sourcey before 3.8 kept no record of its files, so delete a directory one built once.",
      );
  }

  const next: Record<string, string> = Object.create(null);
  const changes: Change[] = [];
  const folded = new Set<string>();
  let staging: Promise<string> | undefined;
  let promoting = false;
  const stage = () => (staging ??= mkdir(root, { recursive: true }).then(() => mkdtemp(join(root, ".sourcey-write-"))));
  // Once promotion starts it owns the staging directory: it removes it, or
  // keeps it as the recovery copy when a rollback fails.
  const discard = async () => {
    if (staging && !promoting) await rm(await staging, { recursive: true, force: true });
  };

  async function put(path: string, body: ArtifactBody): Promise<void> {
    safeOutputPath(path);
    if (path === inventoryName || path.startsWith(".sourcey-write-"))
      throw new Error(`Reserved output path: ${path}`);
    const key = path.normalize("NFC").toLowerCase();
    if (folded.has(key)) throw new Error(`Output collision: ${path}`);
    folded.add(key);
    const hash = (next[path] = body instanceof SourceFile ? body.digest : digest(body)),
      target = resolve(root, path);
    await plainOutputPath(root, target, directories);
    const actual = await existingDigest(target);
    if (actual !== undefined && !Object.hasOwn(previous, path))
      throw new Error(`Refusing to overwrite unowned output: ${target}`);
    if (actual === hash) return;
    // Staging cannot replace a live artifact.
    const change: Change = { target, existed: actual !== undefined, staged: join(await stage(), `${changes.length}.next`) };
    changes.push(change);
    if (body instanceof SourceFile) await copySource(body, change.staged!);
    else await writeFile(change.staged!, body);
  }

  async function commit(): Promise<void> {
    // A prune conflict must leave every page and the inventory untouched.
    for (const [path, hash] of Object.entries(previous)) {
      if (Object.hasOwn(next, path)) continue;
      const target = resolve(root, path);
      await plainOutputPath(root, target, directories);
      const actual = await existingDigest(target);
      if (actual !== undefined && actual !== hash)
        throw new Error(`Refusing to prune modified output: ${target}`);
      if (actual !== undefined) changes.push({ target, existed: true });
    }
    // Artifact completion order is not part of the output generation's identity.
    const nextInventory = JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
    if (inventory?.toString("utf8") !== nextInventory) {
      const change: Change = { target: inventoryPath, existed: inventory !== undefined, staged: join(await stage(), `${changes.length}.next`) };
      changes.push(change);
      await writeFile(change.staged!, nextInventory);
    }
    if (!changes.length) return discard();
    const directory = await stage();
    promoting = true;
    await promote(directory, changes);
  }

  return { put, commit, abort: discard };
}

/** Writes staged at once while the next artifact is produced. */
const WRITES_IN_FLIGHT = 16;

/**
 * Write a generation as its artifacts are produced: each is staged to disk
 * and let go, with a few writes in flight, and the output changes all at once
 * when every one is staged. See `openOutput`.
 */
export async function writeArtifacts(
  outputDir: string,
  artifacts: Iterable<[string, ArtifactBody]> | AsyncIterable<[string, ArtifactBody]>,
): Promise<void> {
  const output = await openOutput(outputDir);
  const writing = new Set<Promise<void>>();
  try {
    for await (const [path, body] of artifacts) {
      const write: Promise<void> = output.put(path, body).finally(() => writing.delete(write));
      write.catch(() => {});
      writing.add(write);
      if (writing.size >= WRITES_IN_FLIGHT) await Promise.race(writing);
    }
    await Promise.all(writing);
    await output.commit();
  } catch (error) {
    await Promise.allSettled(writing);
    await output.abort();
    throw error;
  }
}

async function promote(staging: string, changes: Change[]): Promise<void> {
  const created = new Set<string>();
  let recovered = true;
  try {
    try {
      for (const [i, change] of changes.entries()) {
        const first = await mkdir(dirname(change.target), { recursive: true });
        if (first)
          for (let path = dirname(change.target); path !== dirname(first); path = dirname(path))
            created.add(path);
        if (change.existed) {
          const backup = join(staging, `${i}.previous`);
          await rename(change.target, backup);
          change.backup = backup;
        }
        if (change.staged) {
          await rename(change.staged, change.target);
          change.installed = true;
        }
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const change of [...changes].reverse()) {
        try {
          if (change.installed) await rm(change.target, { force: true });
          if (change.backup) await rename(change.backup, change.target);
        } catch (failure) {
          failures.push(failure);
        }
      }
      for (const path of [...created].sort((a, b) => b.length - a.length)) {
        try {
          await rmdir(path);
        } catch (failure) {
          if (!["ENOENT", "ENOTEMPTY"].includes((failure as NodeJS.ErrnoException).code ?? ""))
            failures.push(failure);
        }
      }
      if (failures.length) {
        recovered = false;
        throw new AggregateError(
          [error, ...failures],
          `Output rollback failed; recovery files remain at ${staging}`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    if (recovered) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch (error) {
        // Cleanup cannot turn a committed generation into a reported failure,
        // or hide the original error after a successful rollback.
        console.warn(`Sourcey: could not remove output staging directory ${staging}`, error);
      }
    }
  }
}
