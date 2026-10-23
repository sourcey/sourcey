import { useContext } from "preact/hooks";
import { Breakable } from "../ui/Breakable.js";
import { OptionsContext, SpecContext } from "../../renderer/context.js";
import { kindTells, operationAnchor, operationKey, sectionBodies, tagAnchor } from "../../core/reference-identity.js";
import type { NormalizedTag } from "../../core/types.js";
import { tagLineage } from "../../core/tag-utils.js";
import { useTagLabel } from "./outline.js";
import { Markdown } from "../ui/Markdown.js";
import { Badge } from "../ui/Badge.js";
import { Operation } from "./Operation.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { ExternalDocsLink } from "./ExternalDocs.js";

interface TagsProps {
  tags: NormalizedTag[];
  showOperations?: boolean;
}

export function Tags({ tags, showOperations = true }: TagsProps) {
  return <>{tags.filter((tag) => !tag.hidden).map((tag) => <TagSection key={tag.name} tag={tag} showOperations={showOperations} />)}</>;
}

/**
 * A section of a reference: its heading, description and operations. Each
 * operation is shown in full under the first section that lists it and linked
 * from the others; an overview links them all. As a page of its own, the
 * section's name is the page's title.
 */
export function TagSection({ tag, showOperations, page = false }: { tag: NormalizedTag; showOperations: boolean; page?: boolean }) {
  const options = useContext(OptionsContext);
  const targets = options.referenceTargets;
  const spec = useContext(SpecContext);
  const displayLabel = useTagLabel();
  const tagsByName = new Map(spec.tags.map((candidate) => [candidate.name, candidate]));
  const parents = tagLineage(tag, tagsByName);
  const operations = tag.operations.filter(op => !op.hidden);
  const own = sectionBodies(spec).get(tag.name) ?? [];
  const bodies = showOperations ? own : [];
  const links = showOperations ? operations.filter(op => !own.includes(op)) : operations;
  // Listed without their sections, operations keep their single-page anchors, once each.
  const anchored = new Set(showOperations ? [] : own);
  const methods = operations.map(op => op.method);
  const Heading = page ? "h1" : "h2";

  return (
    <div class={page ? undefined : tag.parent ? "mt-8" : "mt-12"}>
      <div id={tagAnchor(tag.name, spec)} data-traverse-target={tagAnchor(tag.name, spec)} class={page ? "mb-8" : "mb-6"}>
        <AnchorAliases target={tagAnchor(tag.name, spec)} />
        {parents.length > 0 && (
          <div class="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
            {parents.map(displayLabel).join(" / ")}
          </div>
        )}
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <Heading class={`${page ? "reference-page-title" : "reference-tag-title"} text-2xl sm:text-3xl font-bold tracking-tight text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]`}>
            {displayLabel(tag)}
          </Heading>
          {/* The machine name, when the display name is more than its capitalisation. */}
          {tag.summary && tag.summary.toLowerCase() !== tag.name.toLowerCase() && (
            <Badge>
              <code>{tag.name}</code>
            </Badge>
          )}
          {tag.kind && <Badge>{tag.kind}</Badge>}
        </div>
        {tag.description && (
          <Markdown content={tag.description} class="text-sm max-w-none" />
        )}
        <ExternalDocsLink docs={tag.externalDocs} />
      </div>
      {links.length > 0 && <ul class="reference-operation-links">{links.map(op => <li id={anchored.has(op) ? operationAnchor(op, spec) : undefined}><a href={targets?.operations[operationKey(op)]?.href ?? `#${operationAnchor(op, spec)}`}>{kindTells(op.method, methods) && <span class={`reference-method method-${op.method}`}>{op.method.toUpperCase()}</span>}<span class="reference-operation-label"><strong><Breakable text={op.summary ?? op.path} /></strong>{op.mcpExtras && op.description && <span class="reference-operation-summary">{op.description.split(/\n\s*\n/)[0]}</span>}</span><svg class="reference-operation-arrow" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12h14m-6-6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" /></svg></a></li>)}</ul>}
      {bodies.map((op) => (
        <Operation key={`${op.method}-${op.path}`} operation={op} />
      ))}
    </div>
  );
}
