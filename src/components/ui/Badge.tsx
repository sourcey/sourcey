interface BadgeProps {
  children: preact.ComponentChildren;
  class?: string;
  style?: Record<string, string>;
}

export function Badge({ children, class: className, style }: BadgeProps) {
  return (
    <span
      class={`inline-flex items-center gap-1 break-all rounded-md px-2 py-0.5 text-xs font-medium ${className ?? "bg-[rgb(var(--color-gray-100)/0.5)] text-[rgb(var(--color-gray-600))] dark:bg-[rgb(var(--color-surface-dark-tint)/0.05)] dark:text-[rgb(var(--color-gray-200))]"}`}
      style={style}
    >
      {children}
    </span>
  );
}

/**
 * An operation's method, as the sidebar, a list of operations, the operation's
 * own head and search name it. The theme draws it once, by method, so it reads
 * alike in each; a narrow column shortens DELETE.
 */
export function MethodBadge({ method, short = false }: { method: string; short?: boolean }) {
  const name = method.toUpperCase();
  return <span class="method-badge" data-method={method.toLowerCase()}>{short && name === "DELETE" ? "DEL" : name}</span>;
}

export function RequiredBadge() {
  return (
    <span class="required-badge">
      required
    </span>
  );
}

export function DeprecatedBadge() {
  return (
    <span class="deprecated-badge">
      deprecated
    </span>
  );
}

export function ReadOnlyBadge() {
  return (
    <span class="read-only-badge">
      read only
    </span>
  );
}
