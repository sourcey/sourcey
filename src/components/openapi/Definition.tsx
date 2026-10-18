import type { NormalizedSchema } from "../../core/types.js";
import { definitionAnchor } from "../../utils/html-id.js";
import { SchemaView } from "../schema/SchemaView.js";
import { ExampleView } from "../schema/ExampleView.js";

interface DefinitionProps {
  name: string;
  schema: NormalizedSchema;
}

/**
 * Schema definition with single-column content + sticky example panel.
 */
export function Definition({ name, schema }: DefinitionProps) {
  const id = definitionAnchor(name);

  return (
    <div id={id} class="py-8 border-t border-[rgb(var(--color-gray-100))] dark:border-[rgb(var(--color-gray-800))]" data-traverse-target={id}>
      <a id={`/definitions/${name}`} />
      <header class="mb-4">
        <div class="flex items-baseline gap-2">
          <h2 class="text-xl font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">{name}</h2>
          <span class="text-sm text-[rgb(var(--color-gray-500))] font-normal">{schema.type ?? "object"}</span>
        </div>
      </header>

      <div class="flex flex-col xl:flex-row gap-8">
        {/* Content column */}
        <div class="flex-1 min-w-0">
          <SchemaView schema={schema} />
        </div>

        {/* Sticky example panel (xl+) */}
        <aside class="hidden xl:block w-[28rem] shrink-0 sticky self-start" style="top: calc(var(--header-height) + 2.5rem)">
          <ExampleView schema={schema} title="Example" />
        </aside>
      </div>

      {/* Mobile example */}
      <div class="xl:hidden mt-6">
        <ExampleView schema={schema} title="Example" />
      </div>
    </div>
  );
}
