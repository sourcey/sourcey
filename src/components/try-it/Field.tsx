import type { TargetedInputEvent } from "preact";
import { Select } from "../ui/Select.js";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { NormalizedSchema } from "../../core/types.js";
import { effectiveSchema, formatSchemaType, isRecord, omittedField, validateValue } from "../../core/schema.js";
import type { RequestIssue } from "../../core/request.js";

interface FieldProps {
  name: string;
  path: string;
  schema?: NormalizedSchema;
  value: unknown;
  onChange(value: unknown): void;
  required?: boolean;
  description?: string;
  issues?: RequestIssue[];
  depth?: number;
  idPrefix?: string;
}
export function Field(props: FieldProps) {
  const { name, path, value, required, description, issues = [], depth = 0 } = props;
  const schema = effectiveSchema(props.schema);
  const alternatives = schema.oneOf ?? schema.anyOf;
  const [choice, setChoice] = useState(() =>
    Math.max(0, alternatives?.findIndex((s) => !validateValue(s, value, path).length) ?? 0),
  );
  const [raw, setRaw] = useState<string>();
  const emitted = useRef(value);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  function onChange(next: unknown) {
    emitted.current = next;
    props.onChange(next);
  }
  useLayoutEffect(() => {
    if (value === undefined && file.current) file.current.value = "";
    if (value !== emitted.current) {
      setRaw(undefined);
      textarea.current?.setCustomValidity("");
      emitted.current = value;
    }
  }, [value]);
  const id = (props.idPrefix ?? "tryit") + "-field-" + encodeURIComponent(path);
  const error = issues.find((issue) => issue.field === path)?.message;
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  const nested = !!schema.properties && !alternatives && depth < 12;
  const inputProps = {
    id,
    name: path,
    class: "sourcey-input",
    "aria-invalid": !!error,
    "aria-required": required || undefined,
    "aria-describedby":
      (description ? id + "-help " : "") + (error ? id + "-error" : "") || undefined,
  };
  // A value typed in: each input type takes its own element, as each takes its own roles.
  const textProps = {
    ...inputProps,
    value: value === undefined || value === null ? "" : String(value),
    placeholder: required ? undefined : "Not set",
    readOnly: schema.const !== undefined,
    onInput: (e: TargetedInputEvent<HTMLInputElement>) =>
      onChange(
        e.currentTarget.value === ""
          ? required
            ? ""
            : undefined
          : type === "number" || type === "integer"
            ? Number(e.currentTarget.value)
            : e.currentTarget.value,
      ),
  };
  const control = alternatives ? (
    <>
      <Select
        {...inputProps}
        class="sourcey-select"
        value={choice}
        onChange={(e) => {
          const index = Number(e.currentTarget.value);
          setChoice(index);
          onChange(undefined);
        }}
      >
        {alternatives.map((s, i) => (
          <option value={i}>{s.title ?? s.refName ?? formatSchemaType(s)}</option>
        ))}
      </Select>
      <Field
        {...props}
        name="Value"
        idPrefix={(props.idPrefix ?? "tryit") + "-variant"}
        schema={alternatives[choice]}
        description={alternatives[choice]?.description}
        onChange={onChange}
        depth={depth + 1}
      />
    </>
  ) : schema.enum ? (
    <Select
      {...inputProps}
      class="sourcey-select"
      value={
        value === undefined
          ? ""
          : String(schema.enum.findIndex((v) => JSON.stringify(v) === JSON.stringify(value)))
      }
      onChange={(e) =>
        onChange(
          e.currentTarget.value === "" ? undefined : schema.enum![Number(e.currentTarget.value)],
        )
      }
    >
      <option value="">{required ? "Choose a value" : "Not set"}</option>
      {schema.enum.map((v, i) => (
        <option value={i} title={schema.enumDescriptions?.[i]}>
          {schema.enumNames?.[i] ?? String(v)}
        </option>
      ))}
    </Select>
  ) : schema.format === "binary" ? (
    <input
      {...inputProps}
      ref={file}
      type="file"
      onChange={(e) => onChange(e.currentTarget.files?.[0])}
    />
  ) : type === "boolean" ? (
    <Select
      {...inputProps}
      class="sourcey-select"
      value={value === undefined ? "" : String(value)}
      onChange={(e) =>
        onChange(e.currentTarget.value === "" ? undefined : e.currentTarget.value === "true")
      }
    >
      <option value="">{required ? "Choose a value" : "Not set"}</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </Select>
  ) : nested ? (
    <div class="tryit-object" id={id} role="group" aria-labelledby={id + "-label"}>
      {Object.entries(schema.properties!)
        .filter(([, s]) => !omittedField(s, "request"))
        .map(([key, child]) => (
          <Field
            name={key}
            path={path + "." + key}
            schema={child}
            value={isRecord(value) ? value[key] : undefined}
            required={schema.required?.includes(key)}
            description={child.description}
            issues={issues}
            depth={depth + 1}
            idPrefix={props.idPrefix}
            onChange={(next) => {
              const entries = Object.entries(isRecord(value) ? value : {}).filter(
                ([k]) => k !== key,
              );
              onChange(
                Object.fromEntries(next === undefined ? entries : [...entries, [key, next]]),
              );
            }}
          />
        ))}
    </div>
  ) : type === "array" && depth < 12 ? (
    <div class="tryit-array" id={id} role="group" aria-labelledby={id + "-label"}>
      {(Array.isArray(value) ? value : []).map((item, i) => (
        <div class="tryit-array-item" key={i}>
          <Field
            name={"Item " + (i + 1)}
            path={path + "." + i}
            schema={schema.items}
            value={item}
            depth={depth + 1}
            issues={issues}
            idPrefix={props.idPrefix}
            onChange={(next) =>
              onChange((value as unknown[]).map((v, index) => (index === i ? next : v)))
            }
          />
          <button
            type="button"
            class="sourcey-button sourcey-button-quiet"
            aria-label={"Remove " + name + " item " + (i + 1)}
            onClick={() => onChange((value as unknown[]).filter((_, index) => index !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        class="sourcey-button sourcey-button-quiet"
        disabled={
          schema.maxItems !== undefined && Array.isArray(value) && value.length >= schema.maxItems
        }
        onClick={() => onChange([...(Array.isArray(value) ? value : []), undefined])}
      >
        Add item
      </button>
    </div>
  ) : type === "object" || !type || depth >= 12 ? (
    <textarea
      {...inputProps}
      ref={textarea}
      class="sourcey-input sourcey-textarea"
      rows={5}
      spellcheck={false}
      value={raw ?? (value === undefined ? "" : JSON.stringify(value, null, 2))}
      onInput={(e) => {
        const text = e.currentTarget.value;
        setRaw(text);
        if (!text.trim()) {
          e.currentTarget.setCustomValidity("");
          onChange(undefined);
          return;
        }
        try {
          const parsed = JSON.parse(text);
          e.currentTarget.setCustomValidity("");
          onChange(parsed);
        } catch {
          e.currentTarget.setCustomValidity("Enter valid JSON.");
        }
      }}
    />
  ) : schema.format === "password" ? (
    <input {...textProps} type="password" autoComplete="off" />
  ) : type === "integer" || type === "number" ? (
    <input
      {...textProps}
      type="number"
      min={schema.minimum}
      max={schema.maximum}
      step={type === "integer" ? 1 : "any"}
    />
  ) : schema.format === "date" ? (
    <input {...textProps} type="date" />
  ) : schema.format === "email" ? (
    <input {...textProps} type="email" />
  ) : (
    <input {...textProps} type="text" />
  );
  return (
    <div class="sourcey-field">
      <div class="tryit-field-heading">
        {nested || type === "array" ? (
          <span class="sourcey-label" id={id + "-label"}>
            <code>{name}</code>
          </span>
        ) : (
          <label class="sourcey-label" for={id}>
            <code>{name}</code>
          </label>
        )}
        <span class="tryit-field-meta">{required ? "Required" : (type ?? "")}</span>
        {(schema.nullable || (Array.isArray(schema.type) && schema.type.includes("null"))) && (
          <label class="tryit-null">
            <input
              type="checkbox"
              checked={value === null}
              onChange={(e) => onChange(e.currentTarget.checked ? null : undefined)}
            />{" "}
            null
          </label>
        )}
        {value !== undefined && !required && (
          <button
            type="button"
            class="tryit-unset"
            onClick={() => {
              setRaw(undefined);
              onChange(undefined);
            }}
          >
            Unset
          </button>
        )}
      </div>
      {description && (
        <p class="sourcey-help" id={id + "-help"}>
          {description}
        </p>
      )}
      <div class="sourcey-field-control">
        {value === null ? <p class="sourcey-help">null</p> : control}
      </div>
      {error && (
        <p class="sourcey-error" id={id + "-error"}>
          {error}
        </p>
      )}
    </div>
  );
}
