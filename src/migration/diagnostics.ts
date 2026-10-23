import type { MigrationDiagnostic } from "./types.js";

/** A conversion that cannot be applied. Nothing has been written when it is thrown. */
export class MigrationError extends Error {
  constructor(readonly diagnostics: MigrationDiagnostic[]) {
    super(formatFailure(diagnostics));
    this.name = "MigrationError";
  }
}

export class Diagnostics {
  readonly items: MigrationDiagnostic[] = [];

  error(diagnostic: Omit<MigrationDiagnostic, "severity">): void {
    this.add({ severity: "error", ...diagnostic });
  }

  review(diagnostic: Omit<MigrationDiagnostic, "severity">): void {
    this.add({ severity: "review", ...diagnostic });
  }

  /** Several builds can share a document; each finding is reported once. */
  private add(diagnostic: MigrationDiagnostic): void {
    const key = JSON.stringify(diagnostic);
    if (!this.keys.has(key)) {
      this.keys.add(key);
      this.items.push(diagnostic);
    }
  }

  private readonly keys = new Set<string>();

  /** These findings, reading `file`'s lines through `line`: for a document read after a rewrite that moves its lines. */
  withLines(file: string, line: (line: number) => number): Diagnostics {
    const view = Object.create(this) as Diagnostics;
    const mapped = (diagnostic: Omit<MigrationDiagnostic, "severity">) =>
      diagnostic.file === file && diagnostic.line !== undefined ? { ...diagnostic, line: line(diagnostic.line) } : diagnostic;
    view.error = (diagnostic) => this.error(mapped(diagnostic));
    view.review = (diagnostic) => this.review(mapped(diagnostic));
    return view;
  }

  get errors(): MigrationDiagnostic[] {
    return this.items.filter((item) => item.severity === "error");
  }

  /** Stop before anything is staged or written when any error was recorded. */
  assertClean(): void {
    if (this.errors.length) throw new MigrationError(this.sorted());
  }

  sorted(): MigrationDiagnostic[] {
    return [...this.items].sort(
      (a, b) =>
        Number(a.severity !== "error") - Number(b.severity !== "error") ||
        a.file.localeCompare(b.file) ||
        (a.line ?? 0) - (b.line ?? 0) ||
        (a.column ?? 0) - (b.column ?? 0),
    );
  }
}

export function formatDiagnostic(diagnostic: MigrationDiagnostic): string {
  const where = [diagnostic.file, diagnostic.line, diagnostic.column].filter((part) => part !== undefined).join(":");
  const suggestion = diagnostic.suggestion ? `\n    ${diagnostic.suggestion}` : "";
  return `${where}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${suggestion}`;
}

/** A count and its noun, singular for one: `1 page`, `3 pages`. */
export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatFailure(diagnostics: MigrationDiagnostic[]): string {
  const errors = diagnostics.filter((item) => item.severity === "error");
  return [
    `Migration stopped: ${counted(errors.length, "unsupported construct")}. No files were changed.`,
    ...errors.map(formatDiagnostic),
  ].join("\n");
}
