import type { NormalizedSpec, NormalizedTag } from "./types.js";

/** A reference's tag by name; a page names only tags its reference has. */
export function referenceTag(spec: Pick<NormalizedSpec, "tags">, name: string): NormalizedTag {
  const tag = spec.tags.find(candidate => candidate.name === name);
  if (!tag) throw new Error(`Reference has no tag ${JSON.stringify(name)}`);
  return tag;
}

export function tagDisplayName(tag: Pick<NormalizedTag, "name" | "summary">): string {
  return tag.summary ?? tag.name;
}

export function tagLineage(
  tag: Pick<NormalizedTag, "name" | "parent">,
  tagsByName: Map<string, NormalizedTag>,
): NormalizedTag[] {
  const lineage: NormalizedTag[] = [];
  const seen = new Set<string>([tag.name]);
  let parentName = tag.parent;

  while (parentName && !seen.has(parentName)) {
    const parent = tagsByName.get(parentName);
    if (!parent) break;
    lineage.unshift(parent);
    seen.add(parent.name);
    parentName = parent.parent;
  }

  return lineage;
}

