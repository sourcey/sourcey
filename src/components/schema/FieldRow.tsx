import type { ComponentChildren } from "preact";
import type { NormalizedSchema } from "../../core/types.js";
import { SchemaDatatype } from "./SchemaDatatype.js";
import { RequiredBadge, ReadOnlyBadge, DeprecatedBadge, Badge } from "../ui/Badge.js";
import { DisclosureIcon } from "../ui/DisclosureIcon.js";
import { Breakable } from "../ui/Breakable.js";

export interface FieldRowProps {
  name: string;
  /** The fragment the row answers to. */
  id?: string;
  /** Type, enum, range and default, drawn as the reference draws them. */
  schema?: NormalizedSchema;
  /** More of the type, such as a parameter's media types. */
  type?: ComponentChildren;
  required?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  /** Where an HTTP parameter is sent (`query`, `path`, ...). */
  location?: string;
  description?: ComponentChildren;
  /** Shown after the description, such as a property's examples. */
  examples?: ComponentChildren;
  /** Where the field's own fields are drawn, when they are drawn elsewhere rather than beneath it. */
  drawnAt?: ComponentChildren;
  /** Child fields, each group behind its own disclosure; an unlabelled group shows "Show child attributes". */
  nested?: { label?: string; content: ComponentChildren }[];
}

/** One named field: an API parameter, a schema property or an authored `<Field>`. */
export function FieldRow({ name, id, schema, type, required, readOnly, writeOnly, deprecated, location, description, examples, drawnAt, nested }: FieldRowProps) {
  return (
    <div class="param-item" id={id}>
      <div class="param-header not-prose">
        <code class="param-name"><Breakable text={name} /></code>
        {schema && <SchemaDatatype schema={schema} grouped />}
        {type}
        {required && <RequiredBadge />}
        {readOnly && <ReadOnlyBadge />}
        {writeOnly && <Badge>write only</Badge>}
        {deprecated && <DeprecatedBadge />}
        {location && <span class="param-in">{location}</span>}
      </div>
      {description && <div class="param-description">{description}</div>}
      {examples}
      {drawnAt}
      {nested?.map((group) => (
        <details class="schema-expandable">
          <summary class="schema-expandable-toggle">
            <DisclosureIcon />
            {group.label ?? "Show child attributes"}
          </summary>
          <div class="schema-expandable-content">{group.content}</div>
        </details>
      ))}
    </div>
  );
}
