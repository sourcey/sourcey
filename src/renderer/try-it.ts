import type { ConsoleData } from "../core/try-it.js";
import type { NormalizedOperation, NormalizedSpec } from "../core/types.js";
import type { TryItConfig } from "../config.js";
import { slugify } from "../utils/slug.js";
import { createHash } from "node:crypto";

export function consoleArtifactPath(scope: string, operation: NormalizedOperation): string {
  const directory = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope) ? scope : "~" + digest(scope);
  return (
    "_sourcey/try-it/" +
    directory +
    "/" +
    `operation-${slugify(operation.path)}-${slugify(operation.method)}`.slice(0, 80) +
    "-" +
    digest(operation.method + " " + operation.path) +
    ".json"
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function consoleData(
  operation: NormalizedOperation,
  spec: NormalizedSpec,
  scope: string,
  languages: string[],
  options?: TryItConfig,
): ConsoleData {
  const { method, path, parameters, requestBody, security } = operation;
  return {
    operation: { method, path, parameters, ...(requestBody && { requestBody }), security },
    servers: operation.servers ?? spec.servers,
    securitySchemes: Object.fromEntries(
      [...new Set(operation.security.flatMap((r) => Object.keys(r)))]
        .filter((k) => spec.securitySchemes[k])
        .map((k) => [k, spec.securitySchemes[k]]),
    ),
    languages,
    credentials: options?.credentials ?? "same-origin",
    specKey: scope,
    version: spec.info.version,
    sourceUrl: spec.sourceUrl,
  };
}
