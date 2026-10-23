import { useContext } from "preact/hooks";
import type { PageHeading } from "../../core/markdown-loader.js";
import type { NormalizedTag } from "../../core/types.js";
import { walkNavGroups } from "../../core/navigation.js";
import { operationSectionAnchor, operationSections, referenceOperation, tagAnchor } from "../../core/reference-identity.js";
import { tagDisplayName } from "../../core/tag-utils.js";
import { extractHeadings } from "../../utils/markdown.js";
import { NavigationContext, PageContext, SpecContext } from "../../renderer/context.js";

/** The heading over each section of an operation. */
export const SECTION_LABELS: Record<ReturnType<typeof operationSections>[number], string> = {
  "request-body": "Body",
  parameters: "Parameters",
  returns: "Returns",
  responses: "Response",
  authentication: "Authorization",
};

/** A tag's name as the reference shows it: authored navigation can rename it. */
export function useTagLabel(): (tag: NormalizedTag) => string {
  const spec = useContext(SpecContext);
  const nav = useContext(NavigationContext);
  const labels = new Map([...walkNavGroups(nav.tabs.find((tab) => tab.slug === nav.activeTabSlug)?.groups ?? [])].map((group) => [group.id, group.label]));
  return (tag) => labels.get(tagAnchor(tag.name, spec)) || tagDisplayName(tag);
}

/**
 * What a page of a split reference lists under "On this page": an operation's
 * sections, or the headings of the overview's introduction. The sidebar lists
 * the reference's sections, authentication and models, so the overview's
 * contents do not again; the reference on one page, and a section's page,
 * leave their operations to the sidebar too.
 */
export function useReferenceOutline(): PageHeading[] {
  const page = useContext(PageContext);
  const spec = useContext(SpecContext);
  if (page.kind !== "spec" || !page.view || page.view.kind === "schema" || page.view.kind === "section") return [];
  if (page.view.kind === "operation") {
    const operation = referenceOperation(spec, page.view.id);
    return operationSections(operation).map((section) => ({ level: 2, text: SECTION_LABELS[section], id: operationSectionAnchor(operation, spec, section, true) }));
  }
  return extractHeadings(spec.info.description ?? "");
}
