import { load as parseYaml } from "js-yaml";

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Apply byte-range edits to the original text; everything between them is kept as written. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let output = "";
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) throw new Error(`Overlapping edits at offset ${edit.start}`);
    output += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return output + source.slice(cursor);
}

export interface Frontmatter {
  /** Parsed data, or an empty object when there is no frontmatter. */
  data: Record<string, unknown>;
  /** Offset of the opening fence; blank lines may precede it, as Astro allows. */
  start: number;
  /** Offset of the first body character. */
  bodyStart: number;
  /** Offsets of the YAML text between the fences, when present. */
  yaml?: { start: number; end: number };
  /** Why the block is not valid YAML; `data` is then empty. */
  invalid?: string;
}

const FENCE = /^(\uFEFF?(?:[ \t]*\r?\n)*)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function readFrontmatter(source: string): Frontmatter {
  const match = source.match(FENCE);
  if (!match) return { data: {}, start: 0, bodyStart: 0 };
  const start = match[1].length;
  const yamlStart = source.indexOf("\n", start) + 1;
  const frontmatter: Frontmatter = { data: {}, start, bodyStart: match[0].length, yaml: { start: yamlStart, end: yamlStart + match[2].length } };
  try {
    const data = match[2].trim() ? parseYaml(match[2]) : {};
    if (data && typeof data === "object" && !Array.isArray(data)) frontmatter.data = data as Record<string, unknown>;
  } catch (error) {
    frontmatter.invalid = (error as Error).message.split("\n")[0];
  }
  return frontmatter;
}

/**
 * Edits to top-level frontmatter keys. Untouched keys keep their bytes;
 * a removed key takes its nested lines with it; new keys are appended.
 */
export function frontmatterEdits(
  source: string,
  frontmatter: Frontmatter,
  changes: { set?: Record<string, string | boolean | number>; remove?: string[] },
): TextEdit[] {
  const set = Object.entries(changes.set ?? {});
  const remove = new Set(changes.remove ?? []);
  if (!set.length && !remove.size) return [];
  // A flag or a number is written as YAML reads it back; text is quoted wherever it would read as one.
  const lines = (value: string | boolean | number, key: string) => `${key}: ${typeof value === "string" ? yamlScalar(value) : String(value)}`;
  if (!frontmatter.yaml) {
    return [{ start: 0, end: 0, text: `---\n${set.map(([key, value]) => lines(value, key)).join("\n")}\n---\n\n` }];
  }
  const { start, end } = frontmatter.yaml;
  // Entries are a top-level key line plus its indented or blank continuation lines, kept verbatim.
  const entries: { key?: string; text: string }[] = [];
  for (const line of source.slice(start, end).split("\n")) {
    const key = line.match(/^([A-Za-z_][\w-]*)[ \t]*:/)?.[1];
    if (key || !entries.length) entries.push({ key, text: line });
    else entries[entries.length - 1].text += `\n${line}`;
  }
  const pending = new Map(set);
  const output: string[] = [];
  for (const entry of entries) {
    if (entry.key && remove.has(entry.key)) continue;
    if (entry.key && pending.has(entry.key)) {
      output.push(lines(pending.get(entry.key)!, entry.key));
      pending.delete(entry.key);
      continue;
    }
    output.push(entry.text);
  }
  for (const [key, value] of pending) output.push(lines(value, key));
  // A block left empty goes entirely, with the blank line that separated it from the body.
  if (!output.join("").trim()) {
    const blank = source.slice(frontmatter.bodyStart).match(/^[ \t]*\r?\n/)?.[0].length ?? 0;
    return [{ start: frontmatter.start, end: frontmatter.bodyStart + blank, text: "" }];
  }
  return [{ start, end, text: output.join("\n") }];
}

function yamlScalar(value: string): string {
  if (/^[\w./@-][\w ./@-]*$/.test(value) && !/^(true|false|null|yes|no|on|off|~|-?\d[\d.e+-]*)$/i.test(value) && !value.endsWith(" "))
    return value;
  return JSON.stringify(value);
}

/** Offset just past the newline that ends the line containing `offset`. */
export function lineEnd(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline === -1 ? source.length : newline + 1;
}

/** 1-based line number of an offset. */
export function lineAt(source: string, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  let line = 1;
  for (let index = source.indexOf("\n"); index !== -1 && index < offset; index = source.indexOf("\n", index + 1)) line += 1;
  return line;
}

/** Escape text so Markdown renders it literally. */
export function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>{}#|]/g, (character) => `\\${character}`);
}
