import { useContext } from "preact/hooks";
import type { NormalizedOperation } from "../../core/types.js";
import { operationFieldRoot, parameterFieldAnchor, referenceFieldPath } from "../../core/reference-identity.js";
import { SiteContext, SpecContext } from "../../renderer/context.js";
import { operationServer } from "../../utils/code-samples.js";
import { TryItButton } from "../try-it/Activation.js";
import { MethodBadge } from "../ui/Badge.js";

/**
 * An operation's endpoint, at the top of the operation: its method, then the
 * address its requests go to, named as its samples name it. Each path
 * parameter is drawn as one, linked to its entry below.
 */
export function EndpointBar({ operation }: { operation: NormalizedOperation }) {
  const spec = useContext(SpecContext);
  const site = useContext(SiteContext);
  const { base } = operationServer(operation, spec.servers, spec.sourceUrl ?? site.siteUrl);
  const fields = referenceFieldPath(operationFieldRoot(operation), "parameters");
  const declared = new Set(operation.parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name));
  const segment = (text: string) => text.split(/(\{[^}]+\})/).filter(Boolean).map((part) => {
    const name = part.match(/^\{(.+)\}$/)?.[1];
    if (!name) return part;
    return declared.has(name)
      ? <a class="sourcey-endpoint-param" href={`#${parameterFieldAnchor(fields, { in: "path", name })}`}>{part}</a>
      : <span class="sourcey-endpoint-param">{part}</span>;
  });

  return (
    <div class="sourcey-endpoint flex items-center gap-2 rounded-[var(--radius)] border border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-border-dark-subtle)/0.1)] px-3 py-2.5 mb-6 overflow-hidden">
      <MethodBadge method={operation.method} />

      {/* URL display: the whole endpoint, wrapping between path segments on a narrow screen. */}
      <div
        data-endpoint-url
        class="flex flex-wrap items-center flex-1 min-w-0 gap-x-0.5 gap-y-1 font-mono text-sm"
      >
        {base && (
          <span class="text-sm text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))] min-w-0 break-all">
            {base}
          </span>
        )}
        {operation.path.split("/").filter(Boolean).map((part, i) => (
          <span key={i} class="flex items-center shrink-0">
            <span class="text-sm text-[rgb(var(--color-gray-400))]">/</span>
            <span class="text-sm font-medium text-[rgb(var(--color-gray-800))] dark:text-[rgb(var(--color-gray-50))]">
              {segment(part)}
            </span>
          </span>
        ))}
      </div>
      <TryItButton operation={operation} />
    </div>
  );
}
