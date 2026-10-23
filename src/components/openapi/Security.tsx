import { useContext } from "preact/hooks";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { OptionsContext, SpecContext } from "../../renderer/context.js";
import { english } from "../../core/messages.js";
import type { SecurityRequirement } from "../../core/types.js";
import { SECTION_LABELS } from "./outline.js";
import { safeUrl } from "../../utils/html.js";
import { SectionLabel } from "../ui/SectionLabel.js";
import { Markdown } from "../ui/Markdown.js";
import { DeprecatedBadge } from "../ui/Badge.js";
import { Breakable } from "../ui/Breakable.js";

interface SecurityProps {
  security: SecurityRequirement[];
  id?: string;
}

/**
 * Per-operation security requirements.
 */
export function SecurityCopy({ security, id }: SecurityProps) {
  const spec = useContext(SpecContext);

  if (!security.length) return null;

  const hasEntries = security.some((req) => Object.keys(req).length > 0);
  if (!hasEntries) return null;

  return (
    <div class="mt-6" id={id}>
      {id && <AnchorAliases target={id} />}
      <SectionLabel>{SECTION_LABELS.authentication}</SectionLabel>
      <div>
        {security.map((req, i) => (
          <div key={i} class="params-list">
            {Object.entries(req).map(([name, scopes]) => {
              const scheme = spec.securitySchemes[name];
              return (
                <div key={name} class="param-item">
                  <div class="param-header">
                    <code class="param-name"><Breakable text={name} /></code>
                    {scheme && (
                      <span class="param-type">
                        <span class="json-property-type">
                          {scheme.type}
                          {scheme.scheme && ` (${scheme.scheme})`}
                          {scheme.in && ` in ${scheme.in}`}
                        </span>
                      </span>
                    )}
                    {scheme?.deprecated && <DeprecatedBadge />}
                  </div>
                  {(scheme?.description || scopes.length > 0) && (
                    <div class="param-description">
                      {scheme?.description && (
                        <Markdown content={scheme.description} class="prose-sm" />
                      )}
                      {scopes.length > 0 && (
                        <p class="mt-1">
                          Scopes: <code class="text-xs font-medium">{scopes.join(", ")}</code>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Global authentication/security definitions section.
 */
export function SecurityDefinitions() {
  const spec = useContext(SpecContext);
  const { messages = english } = useContext(OptionsContext);
  const schemes = Object.entries(spec.securitySchemes);

  if (!schemes.length) return null;

  return (
    <div
      id="authentication"
      class="py-8 border-t border-[rgb(var(--color-gray-100))] dark:border-[rgb(var(--color-gray-800))]"
      data-traverse-target="authentication"
    >
      <AnchorAliases target="authentication" />
      <h2 class="text-xl font-bold text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] mb-4">
        {messages.authentication}
      </h2>
      <div class="params-list">
        {schemes.map(([name, scheme]) => {
          const oauth2MetadataUrl = scheme.oauth2MetadataUrl
            ? safeExternalSpecUrl(scheme.oauth2MetadataUrl)
            : null;
          const openIdConnectUrl = scheme.openIdConnectUrl
            ? safeExternalSpecUrl(scheme.openIdConnectUrl)
            : null;
          return (
            <div key={name} class="param-item">
              <div class="param-header">
                <code class="param-name"><Breakable text={name} /></code>
                <span class="param-type">
                  <span class="json-property-type">{scheme.type}</span>
                </span>
                {scheme.deprecated && <DeprecatedBadge />}
              </div>
              <div class="param-description">
                {scheme.description && <Markdown content={scheme.description} class="prose-sm" />}
                {scheme.type === "apiKey" && (
                  <p class="mt-1">
                    API Key: <code class="text-xs font-medium">{scheme.name}</code> in {scheme.in}
                  </p>
                )}
                {scheme.type === "http" && (
                  <p class="mt-1">
                    Scheme: {scheme.scheme}
                    {scheme.bearerFormat && ` (${scheme.bearerFormat})`}
                  </p>
                )}
                {scheme.type === "oauth2" && oauth2MetadataUrl && (
                  <p class="mt-1">
                    OAuth2 Metadata:{" "}
                    <a
                      href={oauth2MetadataUrl}
                      class="text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-primary-light))]"
                    >
                      {scheme.oauth2MetadataUrl}
                    </a>
                  </p>
                )}
                {scheme.type === "oauth2" && scheme.flows && (
                  <div class="mt-2 space-y-4">
                    {Object.entries(scheme.flows).map(([flowType, flow]) => (
                      <div key={flowType}>
                        <strong class="text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))]">
                          {flowType}
                        </strong>
                        <dl class="mt-2 text-sm">
                          {flow?.authorizationUrl && (
                            <>
                              <dt class="text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] mt-2">
                                Authorization URL
                              </dt>
                              <dd>
                                <code class="text-xs">{flow.authorizationUrl}</code>
                              </dd>
                            </>
                          )}
                          {flow?.deviceAuthorizationUrl && (
                            <>
                              <dt class="text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] mt-2">
                                Device Authorization URL
                              </dt>
                              <dd>
                                <code class="text-xs">{flow.deviceAuthorizationUrl}</code>
                              </dd>
                            </>
                          )}
                          {flow?.tokenUrl && (
                            <>
                              <dt class="text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] mt-2">Token URL</dt>
                              <dd>
                                <code class="text-xs">{flow.tokenUrl}</code>
                              </dd>
                            </>
                          )}
                        </dl>
                        {flow?.scopes && Object.keys(flow.scopes).length > 0 && (
                          <div class="mt-3">
                            <span class="text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">Scopes</span>
                            <ul class="mt-1 space-y-1">
                              {Object.entries(flow.scopes).map(([s, desc]) => (
                                <li key={s} class="text-sm">
                                  <code class="text-xs font-medium text-[rgb(var(--color-gray-800))] dark:text-[rgb(var(--color-gray-200))]">
                                    {s}
                                  </code>
                                  <span class="text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] ml-2">
                                    - {desc}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {scheme.type === "openIdConnect" && openIdConnectUrl && (
                  <p class="mt-1">
                    OpenID Connect:{" "}
                    <a
                      href={openIdConnectUrl}
                      class="text-[rgb(var(--color-primary-ink))] dark:text-[rgb(var(--color-primary-light))]"
                    >
                      {scheme.openIdConnectUrl}
                    </a>
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function safeExternalSpecUrl(value: string): string | null {
  return safeUrl(value, {
    allowedProtocols: ["http:", "https:"],
    allowRelative: false,
    allowAnchor: false,
  });
}
