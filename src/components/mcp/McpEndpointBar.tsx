/**
 * MCP equivalent of EndpointBar: a tool's or prompt's name, or a resource's
 * address, with its kind where that tells the reader something.
 */

const methodColors: Record<string, string> = {
  tool: "bg-purple-400/20 dark:bg-purple-400/20 text-purple-700 dark:text-purple-400",
  resource: "bg-green-400/20 dark:bg-green-400/20 text-green-800 dark:text-green-400",
  prompt: "bg-blue-400/20 dark:bg-blue-400/20 text-blue-700 dark:text-blue-400",
};

export function McpEndpointBar({ method, path }: { method?: string; path: string }) {
  // Split path on {param} segments for dimmed rendering
  const segments = path.split(/(\{[^}]+\})/);

  return (
    <div class="flex items-center gap-2 rounded-[var(--radius)] border border-[rgb(var(--color-gray-200)/0.7)] dark:border-[rgb(var(--color-border-dark-subtle)/0.1)] px-3 py-2.5 mb-6 overflow-hidden">
      {method && (
        <span class={`rounded-lg font-bold px-1.5 py-0.5 text-sm leading-5 shrink-0 ${methodColors[method] ?? "bg-gray-400/20 text-gray-700"}`}>
          {method.toUpperCase()}
        </span>
      )}
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
