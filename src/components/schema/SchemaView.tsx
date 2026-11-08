import type { NormalizedSchema } from "../../core/types.js";
import { useContext } from "preact/hooks";
import { OptionsContext, SpecContext } from "../../renderer/context.js";
import { formatSchemaType, type SchemaUsage } from "../../core/schema.js";
import { Markdown } from "../ui/Markdown.js";
import { SchemaDatatype } from "./SchemaDatatype.js";
import { SchemaExamples } from "./SchemaExamples.js";
import { DisclosureIcon } from "../ui/DisclosureIcon.js";
import { FieldRow } from "./FieldRow.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { Select } from "../ui/Select.js";
import { referenceFieldPath, hasObjectFields, hasReferenceFields, innerSchema, objectFields, onlyFields, schemaPlan, definitionAnchor, REFERENCE_SCHEMA_MAX_DEPTH, type SchemaHome, type SchemaPlan } from "../../core/reference-identity.js";

interface SchemaViewProps {
  schema: NormalizedSchema;
  requiredFields?: string[];
  depth?: number;
  maxDepth?: number;
  showDescription?: boolean;
  /** The anchor of the schema this view is part of; each field's is this followed by its path. */
  anchorRoot?: string;
  /** This view's path below that schema. */
  at?: string;
  /** The way the schema travels; fields that never travel that way are left out. */
  usage?: SchemaUsage;
  /** How the whole schema is drawn: which rows link to where their type is drawn. */
  plan?: SchemaPlan;
  /** A view drawing more of the view at the same path, which marks where it starts. */
  continued?: boolean;
}

/**
 * Recursive schema renderer — stacked property layout.
 * Each property: name + type on one line, description below, children indented.
 */
export function SchemaView(props: SchemaViewProps) {
  const plan = props.plan ?? schemaPlan(props.schema, props.usage);
  const at = props.at ?? "";
  const view = <SchemaParts {...props} plan={plan} at={at} />;
  // A row elsewhere links here, so the view marks where it starts.
  return plan.views.has(at) && !props.continued && props.anchorRoot !== undefined ? <div id={props.anchorRoot + at}>{view}</div> : view;
}

function SchemaParts({
  schema,
  requiredFields,
  depth = 0,
  maxDepth = REFERENCE_SCHEMA_MAX_DEPTH,
  showDescription = true,
  anchorRoot,
  at,
  usage,
  plan,
}: SchemaViewProps & { at: string; plan: SchemaPlan }) {
  const { messages } = useContext(OptionsContext);
  if (depth >= maxDepth) {
    return <div class="schema-max-depth">Max depth reached</div>;
  }
  const field = { anchorRoot, usage, plan, maxDepth };

  // Handle allOf composition
  if (schema.allOf?.length) {
    const { fields, parts } = compositionFields(schema, at, requiredFields, usage, depth, maxDepth);
    return (
      <div class="schema-composition">
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        {fields.length > 0 && <FieldList fields={fields} {...field} />}
        {parts.map((part, index) => (
          <SchemaView key={index} schema={part.schema} requiredFields={part.required} depth={part.depth} maxDepth={maxDepth} anchorRoot={anchorRoot} at={part.at} usage={usage} plan={plan} />
        ))}
        <SchemaExamples schema={schema} />
      </div>
    );
  }

  // Handle anyOf/oneOf
  if (schema.oneOf?.length || schema.anyOf?.length) {
    const variants = schema.oneOf ?? schema.anyOf ?? [];
    const label = schema.oneOf ? messages.oneOf : messages.anyOf;
    const discriminator = schema.discriminator?.propertyName ?? Object.keys(variants[0].properties ?? {}).find(name => {
      const values = variants.map(variant => discriminantLabel(variant.properties?.[name]));
      return values.every(value => value !== undefined) && new Set(values).size === variants.length;
    });
    return (
      <div class="schema-variants" data-schema-variants>
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        <div class="schema-variant-label" data-schema-fallback>{label}</div>
        {hasObjectFields(schema) && <SchemaView schema={{ ...schema, oneOf: undefined, anyOf: undefined, description: undefined, example: undefined, examples: undefined }} depth={depth + 1} maxDepth={maxDepth} anchorRoot={anchorRoot} at={at} usage={usage} plan={plan} continued />}
        <label class="schema-variant-control not-prose" hidden>
          <span class="schema-variant-label">{label}</span>
          <Select data-schema-picker>
            {variants.map((sub, i) => <option value={String(i)}>{variantLabel(sub, i, discriminator, messages.option)}</option>)}
          </Select>
        </label>
        {variants.map((sub, i) => (
          <div key={i} class="schema-variant-option" data-schema-variant={String(i)}>
            <SchemaView schema={sub} depth={depth + 1} maxDepth={maxDepth} anchorRoot={anchorRoot} at={referenceFieldPath(at, schema.oneOf ? "oneOf" : "anyOf", String(i))} usage={usage} plan={plan} />
          </div>
        ))}
        <SchemaExamples schema={schema} />
      </div>
    );
  }

  // Named properties and typed map values use the same field presentation.
  if (hasObjectFields(schema)) {
    const fields = fieldRows(schema, at, requiredFields, usage, depth);
    return (
      <>
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        {fields.length > 0 && <FieldList fields={fields} {...field} />}
        <SchemaExamples schema={schema} />
      </>
    );
  }

  // Array
  if (schema.type === "array" && schema.items) {
    return (
      <>
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        <div class="schema-array-info">
          <SchemaDatatype schema={schema} />
        </div>
        {hasReferenceFields(schema.items, usage) && (
          <details class="schema-expandable">
            <summary class="schema-expandable-toggle">
              <DisclosureIcon />
              Show child attributes
            </summary>
            <div class="schema-expandable-content">
              <SchemaView
                schema={schema.items}
                depth={depth + 1}
                maxDepth={maxDepth}
                anchorRoot={anchorRoot}
                at={referenceFieldPath(at, "items")}
                usage={usage}
                plan={plan}
              />
            </div>
          </details>
        )}
        <SchemaExamples schema={schema} />
      </>
    );
  }

  // Simple type
  return (
    <>
      {showDescription && schema.description && (
        <div class="schema-description">
          <Markdown content={schema.description} />
        </div>
      )}
      <SchemaDatatype schema={schema} />
      <SchemaExamples schema={schema} />
    </>
  );
}

/** A field list row, by its path below the schema. */
interface FieldEntry {
  name: string;
  schema: NormalizedSchema;
  required: boolean;
  depth: number;
  at: string;
}

/** A composition part shown as a view of its own. */
interface CompositionPart {
  schema: NormalizedSchema;
  at: string;
  required: string[];
  depth: number;
}

/** An object's rows. A field is required by the object or by a composition it is part of. */
function fieldRows(schema: NormalizedSchema, at: string, inherited: string[] | undefined, usage: SchemaUsage | undefined, depth: number): FieldEntry[] {
  const required = new Set([...inherited ?? [], ...schema.required ?? []]);
  return objectFields(schema, usage, required).map(({ name, schema, required, path }) => ({ name, schema, required, depth, at: referenceFieldPath(at, ...path) }));
}

/**
 * An allOf reads as one object: its own fields and those of each part that is
 * only fields, nested compositions included, form one list, each row keeping
 * its part's anchor. A part with more to show (a description, examples or
 * alternatives) stays a view of its own after the list.
 */
function compositionFields(
  schema: NormalizedSchema,
  at: string,
  inherited: string[] | undefined,
  usage: SchemaUsage | undefined,
  depth: number,
  maxDepth: number,
): { fields: FieldEntry[]; parts: CompositionPart[] } {
  const required = [...inherited ?? [], ...schema.required ?? []];
  const fields = depth + 1 < maxDepth ? fieldRows(schema, at, required, usage, depth + 1) : [];
  const parts: CompositionPart[] = [];
  schema.allOf!.forEach((part, index) => {
    const path = referenceFieldPath(at, "allOf", String(index));
    if (depth + 1 >= maxDepth || !onlyFields(part)) parts.push({ schema: part, at: path, required, depth: depth + 1 });
    else if (part.allOf?.length) {
      const nested = compositionFields(part, path, required, usage, depth + 1, maxDepth);
      fields.push(...nested.fields);
      parts.push(...nested.parts);
    } else fields.push(...fieldRows(part, path, required, usage, depth + 1));
  });
  return { fields, parts };
}

interface FieldContext { anchorRoot?: string; usage?: SchemaUsage; plan: SchemaPlan; maxDepth: number }

function FieldList({ fields, ...context }: { fields: FieldEntry[] } & FieldContext) {
  return (
    <div class="params-list">
      {fields.map((field, index) => <PropertyRow key={field.at || index} {...field} {...context} />)}
    </div>
  );
}

function variantLabel(schema: NormalizedSchema, index: number, discriminator: string | undefined, option: string): string {
  if (schema.title || schema.refName || schema.name) return schema.title ?? schema.refName ?? schema.name!;
  const tag = discriminator ? discriminantLabel(schema.properties?.[discriminator]) : undefined;
  if (tag !== undefined) return tag;
  return `${option} ${index + 1} · ${formatSchemaType(schema)}`;
}

function discriminantLabel(schema: NormalizedSchema | undefined): string | undefined {
  const value = schema?.const !== undefined ? schema.const : schema?.enum?.length === 1 ? schema.enum[0] : undefined;
  return value === null || ["string", "number", "boolean"].includes(typeof value) ? String(value) : undefined;
}

function PropertyRow({ at, name, schema, required, depth, maxDepth, usage, anchorRoot, plan }: FieldEntry & FieldContext) {
  const inner = innerSchema(schema);
  const hasInner = hasReferenceFields(inner, usage);
  const id = anchorRoot === undefined ? undefined : anchorRoot + at;
  // Its type is drawn elsewhere in this schema: above it, or at a shallower place in a schema too large to draw each time.
  const home = plan.links.get(at);

  return (
    <>
    {id && <AnchorAliases target={id} />}
    <FieldRow
      id={id}
      name={name}
      schema={schema}
      required={required}
      readOnly={schema.readOnly}
      writeOnly={schema.writeOnly}
      deprecated={schema.deprecated}
      description={schema.description && <Markdown content={schema.description} class="prose-sm" />}
      examples={!hasInner && <SchemaExamples schema={schema} />}
      drawnAt={home && <DrawnAt home={home} anchorRoot={anchorRoot} />}
      nested={hasInner && !home ? [{
        content: (
          <SchemaView
            schema={inner}
            depth={depth + 1}
            maxDepth={maxDepth}
            showDescription={inner !== schema}
            anchorRoot={anchorRoot}
            at={inner === schema ? at : referenceFieldPath(at, "items")}
            usage={usage}
            plan={plan}
          />
        ),
      }] : undefined}
    />
    </>
  );
}

/** Where a row's fields are drawn: the field there, the schema's own type, or the type's model. */
function DrawnAt({ home, anchorRoot }: { home: SchemaHome; anchorRoot?: string }) {
  const { messages, referenceTargets } = useContext(OptionsContext);
  const spec = useContext(SpecContext);
  const label = <code>{home.label}</code>;
  const href = home.model
    ? referenceTargets?.schemas[home.model]?.href ?? (spec?.schemas[home.model] ? `#${definitionAnchor(home.model, spec)}` : undefined)
    : anchorRoot === undefined ? undefined : `#${anchorRoot + home.at}`;
  return <p class="schema-drawn-at">{messages.sameFieldsAs} {href ? <a href={href}>{label}</a> : label}</p>;
}
