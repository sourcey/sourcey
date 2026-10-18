import type { SourceyConfig } from "../config.js";

export interface ExportsConfig {
  /** Emit readable Markdown pages, operation/schema documents and documents.json. On by default. */
  markdown?: boolean;
  /** The existing documentation index and full export. Both on by default. */
  llms?: false | { index?: boolean; full?: boolean };
  /** Publish a reference-preserving OpenAPI bundle. Explicit opt-in. */
  openapi?: boolean;
}

export interface DiscoveryResource {
  identifier: string;
  displayName: string;
  type: string;
  /** Canonical descriptor URL. Exactly one of url or data is required. */
  url?: string;
  /** An explicitly authored descriptor, published inline in the ARD entry. */
  data?: Record<string, unknown>;
  description?: string;
  representativeQueries?: string[];
}

export interface DiscoveryConfig {
  ard?: boolean;
  apiCatalog?: boolean;
  /** Publish well-known paths only when this build owns the origin root. */
  wellKnown?: boolean;
  /** Additional real services; documentation sources are discovered automatically. */
  resources?: DiscoveryResource[];
}

export interface ResolvedExports {
  markdown: boolean;
  llms: { index: boolean; full: boolean };
  openapi: boolean;
}

export interface ResolvedDiscovery {
  ard: boolean;
  apiCatalog: boolean;
  wellKnown: boolean;
  resources: DiscoveryResource[];
}

export function resolveExports(value: SourceyConfig["exports"]): ResolvedExports {
  if (value === false)
    return { markdown: false, llms: { index: false, full: false }, openapi: false };
  return {
    markdown: value?.markdown !== false,
    llms: {
      index: value?.llms !== false && value?.llms?.index !== false,
      full: value?.llms !== false && value?.llms?.full !== false,
    },
    openapi: value?.openapi === true,
  };
}

export function resolveDiscovery(
  value: SourceyConfig["discovery"],
  siteUrl?: string,
  baseUrl = "",
): ResolvedDiscovery {
  const result: ResolvedDiscovery = {
    ard: !!value && value.ard === true,
    apiCatalog: !!value && value.apiCatalog === true,
    wellKnown: !!value && value.wellKnown === true,
    resources: value ? (value.resources ?? []) : [],
  };
  if ((result.ard || result.apiCatalog) && !siteUrl)
    throw new Error("discovery requires siteUrl, the public origin.");
  if (result.wellKnown && baseUrl)
    throw new Error(
      "discovery.wellKnown requires an origin-root build. A mounted docs site must let its host publish root discovery.",
    );
  const identifiers = new Set<string>();
  for (const resource of result.resources) {
    if (
      !/^urn:air:[a-zA-Z0-9.-]+(?::[a-zA-Z0-9._-]+)+$/.test(resource.identifier) ||
      identifiers.has(resource.identifier)
    )
      throw new Error(`Invalid or duplicate discovery identifier: ${resource.identifier}`);
    identifiers.add(resource.identifier);
    if (
      !resource.displayName?.trim() ||
      !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:;.*)?$/.test(resource.type)
    )
      throw new Error(
        `Discovery resource ${resource.identifier} needs a displayName and media type.`,
      );
    if ((resource.url !== undefined) === (resource.data !== undefined))
      throw new Error(
        `Discovery resource ${resource.identifier} needs exactly one of url or data.`,
      );
    if (resource.url !== undefined) {
      let url: URL;
      try {
        url = new URL(resource.url);
      } catch {
        throw new Error(`Discovery resource ${resource.identifier} needs an absolute HTTP(S) URL.`);
      }
      if (
        !["https:", "http:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        throw new Error(
          `Discovery resource ${resource.identifier} needs an absolute HTTP(S) URL without credentials.`,
        );
    }
    if (
      resource.data !== undefined &&
      (!resource.data || typeof resource.data !== "object" || Array.isArray(resource.data))
    )
      throw new Error(
        `Discovery resource ${resource.identifier} needs an inline descriptor object.`,
      );
    if (
      resource.representativeQueries &&
      (resource.representativeQueries.length < 2 ||
        resource.representativeQueries.length > 5 ||
        resource.representativeQueries.some((query) => !query.trim()))
    )
      throw new Error(
        `Discovery resource ${resource.identifier} needs two to five nonblank representativeQueries.`,
      );
  }
  return result;
}
