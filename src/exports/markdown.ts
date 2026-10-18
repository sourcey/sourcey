/** Fence source verbatim, including examples that themselves contain fences. */
export function fencedCode(source: string, language = ""): string {
  let longest = 2;
  for (const match of source.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${source.trimEnd()}\n${fence}`;
}

export function compactDescription(value: string, limit = 320): string {
  const paragraph = value
    .split(/\n\s*\n/, 1)[0]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return paragraph.length <= limit
    ? paragraph
    : paragraph.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}
