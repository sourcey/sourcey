import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";
import { escapeAttr } from "../../utils/html.js";

const targetIndexes = new WeakMap<Record<string, string>, Map<string, string[]>>();
export function aliasesFor(aliases: Record<string, string> | undefined, target: string): readonly string[] {
  if (!aliases) return [];
  let index = targetIndexes.get(aliases);
  if (!index) {
    index = new Map();
    for (const [alias, section] of Object.entries(aliases)) {
      if (alias === section) continue;
      const group = index.get(section) ?? [];
      group.push(alias); index.set(section, group);
    }
    targetIndexes.set(aliases, index);
  }
  return index.get(target) ?? [];
}

/**
 * An imported fragment stays at the section it originally identified. On an overview's entry it
 * names that section's anchor (`carry`), so the entry can carry the reader to the page holding it.
 */
export function AnchorAliases({ target, carry = false }: { target: string; carry?: boolean }) {
  const { anchorAliases } = useContext(OptionsContext);
  return <>{aliasesFor(anchorAliases, target).map(alias => <span key={alias} class="reference-anchor-alias" id={alias} data-anchor={carry ? target : undefined} aria-hidden="true" />)}</>;
}

/** Authored HTML with each heading's imported fragments kept before it, as AnchorAliases keeps a section's. */
export function withHeadingAliases(html: string, aliases: Record<string, string> | undefined): string {
  if (!aliases) return html;
  return html.replace(/<h[1-6] id="([^"]+)"/g, (heading, id: string) =>
    aliasesFor(aliases, id).map(alias => `<span class="reference-anchor-alias" id="${escapeAttr(alias)}" aria-hidden="true"></span>`).join("") + heading);
}
