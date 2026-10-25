import type { TargetedInputEvent } from "preact";
import { Select } from "../ui/Select.js";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  describeRequest,
  initialDraft,
  parameterKey,
  type RequestDraft,
  type RequestIssue,
} from "../../core/request.js";
import { generateRequestSamples } from "../../utils/code-samples.js";
import { generateExample } from "../../utils/example-generator.js";
import type { ConsoleData } from "../../core/try-it.js";
import { useDraft } from "./use-draft.js";
import { useRequest } from "./use-request.js";
import { filterDraft } from "./values.js";
import { Field } from "./Field.js";
import { CopyAction, ResponseView } from "./Response.js";
import { showRequestUrl } from "./request-url.js";

interface Props {
  data: ConsoleData;
  id: string;
  onClose(): void;
  /** The level of the operation's own sections, which the console's sit beside. */
  headingLevel?: 2 | 3;
}
export function Console({ data, id, onClose, headingLevel = 3 }: Props) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const Subheading = headingLevel === 2 ? "h3" : "h4";
  const { draft, update, saving, clearSaved } = useDraft(data);
  const execution = useRequest(id);
  const { sending, message, response, sentDraft, setMessage, abort } = execution;
  const [issues, setIssues] = useState<RequestIssue[]>([]);
  const [language, setLanguage] = useState(data.languages[0] ?? "curl");
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [fieldEpoch, setFieldEpoch] = useState(0);
  const [jsonBody, setJsonBody] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const context = {
    ...data,
    baseUrl: data.sourceUrl ?? location.href,
    browserOrigin: location.origin,
  };
  const request = describeRequest(context, draft);
  const safeRequest = describeRequest(context, filterDraft(draft, data, "preview"));
  const preview = includeCredentials ? request : safeRequest;
  const samples = generateRequestSamples(
    preview,
    data.languages.length ? data.languages : ["curl"],
  );
  const sample =
    samples.find(
      (s) =>
        s.label === language || s.lang === language || (language === "curl" && s.label === "cURL"),
    ) ?? samples[0];
  const parameters = data.operation.parameters;
  const prominent = parameters.filter((p) => p.required);
  const optional = parameters.filter((p) => !p.required);
  const visible = [...prominent, ...optional.slice(0, 2)];
  const extra = optional.slice(2);
  const requirements = data.operation.security;
  const requirement = requirements[draft.securityIndex] ?? {};
  const authNames = Object.keys(requirement);
  const server = data.servers[draft.serverIndex] ?? data.servers[0] ?? { url: "/" };
  const media = data.operation.requestBody?.content[draft.mediaType];
  const examples = Object.entries(media?.examples ?? {}).filter(
    ([, value]) => value.value !== undefined,
  );
  function change(next: Partial<RequestDraft>, persist = true) {
    update(next, persist);
    setIssues([]);
  }
  useEffect(() => {
    const mount = document.getElementById(id);
    if (!mount) return;
    mount.dataset.tryItUrl = safeRequest.url;
    const url = mount.closest("[data-sourcey-operation]")?.querySelector("[data-endpoint-url]");
    if (!mount.hidden && url && safeRequest.url) showRequestUrl(url, safeRequest.url);
  }, [safeRequest.url]);
  async function send() {
    if (sending) return;
    if (request.issues.length) {
      setIssues(request.issues);
      setAuthOpen(request.issues.some((e) => e.field.startsWith("auth.")));
      setOptionalOpen(true);
      setMessage("Check the highlighted fields before sending.");
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const invalid = form.current?.querySelector<HTMLInputElement>(
      "input:invalid, select:invalid, textarea:invalid",
    );
    if (invalid) {
      setIssues([{ field: invalid.name, message: invalid.validationMessage }]);
      setMessage("Check the highlighted fields before sending.");
      invalid.focus();
      return;
    }
    setIssues([]);
    await execution.send(request, draft);
  }

  const renderParameter = (p: (typeof parameters)[number]) => (
    <Field
      key={parameterKey(p)}
      idPrefix={id}
      name={p.name}
      path={parameterKey(p)}
      schema={p.schema ?? Object.values(p.content ?? {})[0]?.schema}
      value={draft.parameters[parameterKey(p)]}
      required={p.required}
      description={p.description}
      issues={issues}
      onChange={(value) => {
        const next = { ...draft.parameters };
        if (value === undefined) delete next[parameterKey(p)];
        else next[parameterKey(p)] = value;
        change({ parameters: next });
      }}
    />
  );

  return (
    <div class="tryit-panel">
      <form
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void send();
          }
          if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div class="tryit-heading">
          <Heading>Request</Heading>
          <button
            type="button"
            class="sourcey-button sourcey-button-quiet"
            disabled={sending}
            onClick={() => {
              const defaults = initialDraft(data.operation);
              change({
                ...defaults,
                serverIndex: draft.serverIndex,
                serverVariables: draft.serverVariables,
                auth: draft.auth,
              });
              execution.reset();
              setFieldEpoch((value) => value + 1);
              clearSaved();
            }}
          >
            Reset
          </button>
        </div>
        <fieldset key={fieldEpoch} class="tryit-fields" disabled={sending}>
          <div class="tryit-server">
            {data.servers.length > 1 ? (
              <label class="sourcey-label" for={id + "-server"}>
                Server
              </label>
            ) : (
              <span class="sourcey-label">Server</span>
            )}
            {data.servers.length > 1 ? (
              <Select
                id={id + "-server"}
                class="sourcey-select"
                value={draft.serverIndex}
                onChange={(event) => {
                  change({
                    ...filterDraft(draft, data, "clear"),
                    serverIndex: Number(event.currentTarget.value),
                    serverVariables: {},
                  });
                  setIncludeCredentials(false);
                }}
              >
                {data.servers.map((s, index) => (
                  <option value={index}>{s.description ?? s.url}</option>
                ))}
              </Select>
            ) : (
              <span class="sourcey-help">{server.description ?? server.url}</span>
            )}
          </div>
          {Object.entries(server.variables ?? {}).map(([name, definition]) => (
            <Field
              name={name}
              path={"server." + name}
              idPrefix={id}
              required
              schema={{ type: "string", enum: definition.enum }}
              description={definition.description}
              issues={issues}
              value={draft.serverVariables[name] ?? definition.default}
              onChange={(value) =>
                change({
                  ...filterDraft(draft, data, "clear"),
                  serverVariables: { ...draft.serverVariables, [name]: String(value ?? "") },
                })
              }
            />
          ))}
          {requirements.length > 0 && (
            <details
              class="tryit-auth"
              open={authOpen}
              onToggle={(event) => setAuthOpen(event.currentTarget.open)}
            >
              <summary>
                <span>Authentication</span>
                <span class="sourcey-help">
                  {!authNames.length
                    ? "Not required"
                    : authNames.every((n) => {
                          const a = draft.auth[n];
                          const scheme = data.securitySchemes[n];
                          return (
                            (scheme?.type === "apiKey" && scheme.in === "cookie") ||
                            !!(a?.value || a?.username || a?.password)
                          );
                        })
                      ? "Added for this tab"
                      : "Required"}
                </span>
              </summary>
              {requirements.length > 1 && (
                <div class="sourcey-field">
                  <label class="sourcey-label" for={id + "-security"}>
                    Authentication method
                  </label>
                  <Select
                    class="sourcey-select"
                    id={id + "-security"}
                    value={draft.securityIndex}
                    onChange={(event) =>
                      change({ securityIndex: Number(event.currentTarget.value), auth: {} }, false)
                    }
                  >
                    {requirements.map((r, index) => (
                      <option value={index}>
                        {Object.keys(r).join(" + ") || "No authentication"}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {authNames.map((name) => {
                const scheme = data.securitySchemes[name];
                if (!scheme) return <p class="sourcey-error">Missing security scheme: {name}</p>;
                if (scheme.type === "apiKey" && scheme.in === "cookie")
                  return (
                    <p class="sourcey-help">
                      {name} uses your existing browser session. Cookies are managed by the browser.
                    </p>
                  );
                const basic = scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic";
                const fields = basic ? (["username", "password"] as const) : (["value"] as const);
                const error = issues.find((issue) => issue.field === "auth." + name)?.message;
                const errorId = id + "-auth-" + encodeURIComponent(name) + "-error";
                return (
                  <div class="tryit-auth-fields" key={name}>
                    {scheme.type === "oauth2" || scheme.type === "openIdConnect" ? (
                      <p class="sourcey-help">
                        Paste an existing access token for {name}. This console does not run an
                        authorization flow.
                      </p>
                    ) : null}
                    {fields.map((field) => {
                      const input = {
                        class: "sourcey-input",
                        id: id + "-auth-" + encodeURIComponent(name) + "-" + field,
                        autoComplete: "off",
                        spellcheck: false,
                        value: draft.auth[name]?.[field] ?? "",
                        "aria-invalid": !!error,
                        "aria-describedby": error ? errorId : undefined,
                        onInput: (event: TargetedInputEvent<HTMLInputElement>) =>
                          change(
                            {
                              auth: {
                                ...draft.auth,
                                [name]: {
                                  ...draft.auth[name],
                                  [field]: event.currentTarget.value,
                                },
                              },
                            },
                            false,
                          ),
                      };
                      return (
                        <div class="sourcey-field">
                          <label class="sourcey-label" for={input.id}>
                            {basic
                              ? field === "username"
                                ? "Username"
                                : "Password"
                              : scheme.type === "apiKey"
                                ? (scheme.name ?? name)
                                : name + " access token"}
                          </label>
                          {field === "username" ? (
                            <input {...input} type="text" />
                          ) : (
                            <input {...input} type="password" />
                          )}
                        </div>
                      );
                    })}
                    {error && (
                      <p class="sourcey-error" id={errorId}>
                        {error}
                      </p>
                    )}
                  </div>
                );
              })}
              <div class="tryit-auth-note">
                <p class="sourcey-help">
                  Credentials stay in this tab and are sent to the selected server.
                </p>
                <button
                  type="button"
                  class="sourcey-button sourcey-button-quiet"
                  onClick={() => {
                    change(filterDraft(draft, data, "clear"), false);
                    setIncludeCredentials(false);
                  }}
                >
                  Clear credentials
                </button>
              </div>
            </details>
          )}
          {visible.length > 0 && <div class="tryit-parameters">{visible.map(renderParameter)}</div>}
          {extra.length > 0 && (
            <details
              class="tryit-optional"
              open={optionalOpen}
              onToggle={(event) => setOptionalOpen(event.currentTarget.open)}
            >
              <summary>
                More parameters <span class="sourcey-help">({extra.length})</span>
              </summary>
              {extra.map(renderParameter)}
            </details>
          )}
          {data.operation.requestBody && (
            <section class="tryit-body">
              <div class="tryit-heading">
                <Subheading>Body{data.operation.requestBody.required ? " · required" : ""}</Subheading>
                {draft.mediaType.includes("json") && (
                  <button
                    type="button"
                    class="sourcey-button sourcey-button-quiet"
                    aria-pressed={jsonBody}
                    onClick={() => {
                      const invalid = form.current?.querySelector<HTMLTextAreaElement>(
                        'textarea[name="body"]:invalid',
                      );
                      if (invalid) {
                        invalid.focus();
                        setIssues([{ field: "body", message: invalid.validationMessage }]);
                        return;
                      }
                      setJsonBody(!jsonBody);
                    }}
                  >
                    {jsonBody ? "Use fields" : "Edit JSON"}
                  </button>
                )}
                <label class="tryit-media">
                  <span class="sr-only">Request body media type</span>
                  <Select
                    class="sourcey-select"
                    value={draft.mediaType}
                    onChange={(event) => {
                      const mediaType = event.currentTarget.value;
                      const m = data.operation.requestBody!.content[mediaType];
                      change({
                        mediaType,
                        body:
                          m.example ??
                          Object.values(m.examples ?? {})[0]?.value ??
                          (m.schema ? generateExample(m.schema, "request") : ""),
                      });
                    }}
                  >
                    {Object.keys(data.operation.requestBody.content).map((type) => (
                      <option value={type}>{type}</option>
                    ))}
                  </Select>
                </label>
              </div>
              {examples.length > 0 && (
                <div class="sourcey-field">
                  <label class="sourcey-label" for={id + "-example"}>
                    Use an example
                  </label>
                  <Select
                    class="sourcey-select"
                    id={id + "-example"}
                    value=""
                    onChange={(event) => {
                      const example = media?.examples?.[event.currentTarget.value];
                      if (example) change({ body: example.value });
                    }}
                  >
                    <option value="">Choose an example</option>
                    {examples.map(([name, example]) => (
                      <option value={name}>{example.summary ?? name}</option>
                    ))}
                  </Select>
                </div>
              )}
              <Field
                key={draft.mediaType + ":" + jsonBody}
                name="Request body"
                path="body"
                idPrefix={id}
                schema={
                  jsonBody && draft.mediaType.includes("json")
                    ? {}
                    : (media?.schema ??
                      (/json|form/.test(draft.mediaType) ? {} : { type: "string" }))
                }
                required={data.operation.requestBody.required}
                description={data.operation.requestBody.description}
                value={draft.body}
                issues={issues}
                onChange={(body) => change({ body })}
              />
            </section>
          )}
        </fieldset>
        {issues.length > 0 && (
          <div class="sourcey-error tryit-errors" role="alert">
            <ul>
              {issues.map((issue) => (
                <li key={issue.field + issue.message}>
                  <strong>
                    {issue.field.replace(/^(auth\.|body\.|query:|path:|header:)/, "")}:
                  </strong>{" "}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div class="tryit-actions">
          <span class="sourcey-help tryit-saved" role="status">
            {saving}
          </span>
          <span class="tryit-shortcut" aria-hidden="true">
            {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} Enter
          </span>
          {sending ? (
            <button
              key="cancel"
              type="button"
              class="sourcey-button sourcey-button-primary"
              onClick={(event) => {
                event.preventDefault();
                abort();
              }}
            >
              Cancel request
            </button>
          ) : (
            <button key="send" type="submit" class="sourcey-button sourcey-button-primary">
              Send request <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        <p class="sourcey-help tryit-send-target">
          Sends {request.method} to{" "}
          <code>{request.url ? new URL(request.url).origin : server.url}</code>
          {data.credentials === "include" ? " with browser session credentials." : "."}
        </p>
        <div class="tryit-feedback" role="status" aria-live="polite">
          {sending ? "Sending request…" : message}
        </div>
        <details class="tryit-preview">
          <summary>
            View request <span class="sourcey-help">{sample?.label ?? "cURL"}</span>
          </summary>
          <div class="tryit-preview-tools">
            <label>
              <span class="sr-only">Code sample language</span>
              <Select
                class="sourcey-select"
                value={sample?.label}
                onChange={(event) => setLanguage(event.currentTarget.value)}
              >
                {samples.map((s) => (
                  <option value={s.label}>{s.label}</option>
                ))}
              </Select>
            </label>
            {sample && <CopyAction text={sample.source} />}
          </div>
          <pre class="tryit-code" tabIndex={0}>
            <code>{sample?.source}</code>
          </pre>
          <label class="tryit-include">
            <input
              type="checkbox"
              checked={includeCredentials}
              onChange={(event) => setIncludeCredentials(event.currentTarget.checked)}
            />{" "}
            Include credentials in the preview and copied code
          </label>
        </details>
      </form>
      {response && <ResponseView response={response} stale={sentDraft !== draft} id={id} headingLevel={headingLevel} />}
    </div>
  );
}
