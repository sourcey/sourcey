import type { NormalizedOperation, NormalizedSpec } from "./types.js";
import { operationAnchors, sectionBodies } from "./reference-identity.js";

/** What one page of a reference holds before it is slow to open and to search. */
const PAGE_OPERATIONS = 50;
/**
 * Field rows, as the operations' parameters, bodies and responses draw them, one
 * page holds: with the examples drawn beside them, about two megabytes of HTML,
 * a few tens of kilobytes compressed, which still opens at once.
 */
const PAGE_ROWS = 1000;

/** How an OpenAPI or MCP reference publishes: one page, a page per section, or a page per operation. */
export type ReferenceSplit = false | "sections" | "operations";

/**
 * The shape a reference publishes in when its config names none, and why. It
 * is one page while that page stays small; a page per section where it has
 * sections and each makes a page of that size; else a page per operation.
 * Weight is counted in operations and the field rows they draw, as a page with
 * a few large schemas outweighs one with many small tools.
 */
export function automaticSplit(spec: NormalizedSpec): { split: ReferenceSplit; reason: string } {
  const operations = spec.operations.filter(operation => !operation.hidden);
  const rows = (members: readonly NormalizedOperation[]) => members.reduce((total, operation) => total + operationAnchors(operation, spec, true).length, 0);
  const total = rows(operations);
  const count = (n: number, noun: string) => `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;
  const size = `${count(operations.length, "operation")} and ${count(total, "field row")}`;
  if (operations.length <= PAGE_OPERATIONS && total <= PAGE_ROWS) return { split: false, reason: `one page: ${size}` };
  const sections = [...sectionBodies(spec)].filter(([, members]) => members.length).map(([name, members]) => ({ name, operations: members.length, rows: rows(members) }));
  // How far past a page each section runs, by whichever limit it passes further.
  const load = (section: (typeof sections)[number]) => Math.max(section.operations / PAGE_OPERATIONS, section.rows / PAGE_ROWS);
  const heaviest = sections.reduce((max, section) => (load(section) > load(max) ? section : max), sections[0]);
  if (sections.length > 1 && load(heaviest) <= 1)
    return { split: "sections", reason: `a page per section: ${size} in ${count(sections.length, "section")}, the largest ${count(heaviest.operations, "operation")} and ${count(heaviest.rows, "field row")}` };
  const why = sections.length > 1 ? `and its section ${heaviest.name} alone holds ${count(heaviest.operations, "operation")} and ${count(heaviest.rows, "field row")}` : "all in one section";
  return { split: "operations", reason: `a page per operation: ${size}, ${why}` };
}
