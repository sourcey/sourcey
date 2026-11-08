import { Fragment } from "preact";
import { useContext } from "preact/hooks";
import { SpecContext } from "../../renderer/context.js";
import { safeUrl } from "../../utils/html.js";
import { Markdown } from "../ui/Markdown.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { ExternalDocsLink } from "./ExternalDocs.js";

/**
 * API introduction: description, contact info, server URLs.
 * Single-column layout; servers shown as a simple list.
 */
export function Introduction() {
  const spec = useContext(SpecContext);
  const { info, servers } = spec;
  const termsUrl = info.termsOfService
    ? safeUrl(info.termsOfService, {
        allowedProtocols: ["http:", "https:"],
        allowRelative: false,
        allowAnchor: false,
      })
    : null;
  const contactEmailUrl = info.contact?.email
    ? safeUrl(`mailto:${info.contact.email}`, {
        allowedProtocols: ["mailto:"],
        allowRelative: false,
        allowAnchor: false,
      })
    : null;

  return (
    <div id="introduction" data-traverse-target="introduction" class="mb-8">
      <AnchorAliases target="introduction" />
      {termsUrl && (
        <p class="mt-4 text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
          <a
            href={termsUrl}
            class="text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-primary-light))]"
          >
            Terms of Service
          </a>
        </p>
      )}

      {info.contact?.email && contactEmailUrl && (
        <p class="mt-2 text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
          Contact:{" "}
          <a
            href={contactEmailUrl}
            class="text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-primary-light))]"
          >
            {info.contact.email}
          </a>
        </p>
      )}

      {servers.length > 0 && (
        <div class="mt-6 rounded-[var(--radius)] border border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-border-dark-subtle)/0.1)] overflow-x-auto">
          <div class="px-4 py-2.5 text-xs font-semibold text-[rgb(var(--color-gray-600))] dark:text-[rgb(var(--color-gray-300))] border-b border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-border-dark-subtle)/0.1)]">
            Base URL{servers.length > 1 ? "s" : ""}
          </div>
          {servers.map((s, i) => (
            <div
              key={i}
              class={`px-4 py-2 ${i > 0 ? "border-t border-[rgb(var(--color-gray-100))] dark:border-[rgb(var(--color-gray-800))]" : ""}`}
            >
              {/* Where the description does not fit beside the URL, it goes beneath it rather than breaking it. */}
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <code class="font-mono text-sm text-[rgb(var(--color-gray-800))] dark:text-[rgb(var(--color-gray-200))]">
                  {s.url}
                </code>
                {s.description && (
                  <span class="text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">{s.description}</span>
                )}
              </div>
              {/* A templated URL names what each placeholder takes. */}
              {s.variables && Object.keys(s.variables).length > 0 && (
                <dl class="mt-1.5 space-y-0.5 text-xs text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">
                  {Object.entries(s.variables).map(([name, variable]) => (
                    <div key={name} class="flex flex-wrap items-baseline gap-x-1.5">
                      <dt><code class="font-mono text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">{name}</code></dt>
                      <dd>
                        {variable.default ? <>default <code class="font-mono">{variable.default}</code></> : "no default"}
                        {variable.enum && variable.enum.length > 1 && <>; one of {variable.enum.map((value, index) => <Fragment key={value}>{index > 0 && ", "}<code class="font-mono">{value}</code></Fragment>)}</>}
                        {variable.description && <>. {variable.description}</>}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      )}

      {info.description && <Markdown content={info.description} class="max-w-none mt-8" sections />}
      <ExternalDocsLink docs={spec.externalDocs} />
    </div>
  );
}
