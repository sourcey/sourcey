import { MethodBadge } from "../ui/Badge.js";

/**
 * MCP equivalent of EndpointBar: a tool's or prompt's name, or a resource's
 * address, with its kind where that tells the reader something.
 */
export function McpEndpointBar({ method, path }: { method?: string; path: string }) {
  // Split path on {param} segments for dimmed rendering
  const segments = path.split(/(\{[^}]+\})/);

  return (
    <div class="sourcey-endpoint flex items-center gap-2 rounded-[var(--radius)] border border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-border-dark-subtle)/0.1)] px-3 py-2.5 mb-6 overflow-hidden">
      {method && <MethodBadge method={method} />}
      <span class="flex items-center overflow-x-auto flex-1 no-scrollbar font-mono text-sm text-[rgb(var(--color-gray-800))] dark:text-[rgb(var(--color-gray-200))]">
        {segments.map((seg, i) =>
          seg.startsWith("{") ? (
            <span key={i} class="text-[rgb(var(--color-gray-500))] dark:text-[rgb(var(--color-gray-400))]">{seg}</span>
          ) : (
            <span key={i}>{seg}</span>
          ),
        )}
      </span>
    </div>
  );
}
