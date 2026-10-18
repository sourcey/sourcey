/**
 * Internal normalized representation of an API specification.
 * All Swagger 2.0 and OpenAPI 3.x specs are converted to this format
 * before rendering, so components never need to know the source format.
 */

// ── Top-level normalized spec ──────────────────────────────────────

export interface NormalizedSpec {
  info: ApiInfo;
  servers: ServerDefinition[];
  tags: NormalizedTag[];
  operations: NormalizedOperation[];
  schemas: Record<string, NormalizedSchema>;
  securitySchemes: Record<string, SecurityScheme>;
  webhooks: NormalizedOperation[];
  externalDocs?: ExternalDocs;
}

// ── API Info ───────────────────────────────────────────────────────

export interface ApiInfo {
  title: string;
  summary?: string;
  version: string;
  description?: string;
  termsOfService?: string;
  contact?: ContactInfo;
  license?: LicenseInfo;
  logo?: string;
  favicon?: string;
}

export interface ContactInfo {
  name?: string;
  url?: string;
  email?: string;
}

export interface LicenseInfo {
  name: string;
  url?: string;
  identifier?: string;
}

// ── Server ─────────────────────────────────────────────────────────

export interface ServerDefinition {
  url: string;
  description?: string;
  variables?: Record<string, ServerVariable>;
}

export interface ServerVariable {
  default: string;
  description?: string;
  enum?: string[];
}

// ── Tags ───────────────────────────────────────────────────────────

export interface NormalizedTag {
  name: string;
  summary?: string;
  description?: string;
  parent?: string;
  kind?: string;
  externalDocs?: ExternalDocs;
  operations: NormalizedOperation[];
  /** Vendor extension: hide this tag from navigation */
  hidden?: boolean;
}

// ── Operations ─────────────────────────────────────────────────────

export type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "delete"
  | "patch"
  | "options"
  | "head"
  | "trace"
  | "query"
  | "tool"
  | "resource"
  | "prompt";

export interface NormalizedOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  method: HttpMethod;
  path: string;
  tags: string[];
  parameters: NormalizedParameter[];
  requestBody?: NormalizedRequestBody;
  responses: NormalizedResponse[];
  security: SecurityRequirement[];
  deprecated: boolean;
  servers?: ServerDefinition[];
  externalDocs?: ExternalDocs;
  callbacks?: Record<string, NormalizedCallback>;
  /** Vendor extension: hide this operation from docs */
  hidden?: boolean;
  /** Vendor extension: custom code samples */
  codeSamples?: CodeSample[];
  /** MCP-specific rendering data (undefined for OpenAPI operations) */
  mcpExtras?: McpOperationExtras;
}

export interface McpOperationExtras {
  type: "tool" | "resource" | "prompt";
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  outputSchema?: NormalizedSchema;
  connection?: McpConnectionInfo;
}

export interface McpConnectionInfo {
  transport?: {
    type: string;
    command?: string;
    args?: string[];
    url?: string;
  };
  serverName: string;
  mcpVersion?: string;
  capabilities?: Record<string, unknown>;
}

export interface NormalizedParameter {
  name: string;
  in: "query" | "querystring" | "header" | "path" | "cookie" | "argument";
  description?: string;
  required: boolean;
  deprecated: boolean;
  schema?: NormalizedSchema;
  content?: Record<string, MediaTypeContent>;
  example?: unknown;
  examples?: Record<string, ExampleObject>;
}

export interface NormalizedRequestBody {
  description?: string;
  required: boolean;
  content: Record<string, MediaTypeContent>;
}

export interface MediaTypeContent {
  schema?: NormalizedSchema;
  example?: unknown;
  examples?: Record<string, ExampleObject>;
  encoding?: Record<string, EncodingObject>;
  prefixEncoding?: EncodingObject[];
  itemEncoding?: EncodingObject;
}

export interface EncodingObject {
  contentType?: string;
  headers?: Record<string, NormalizedParameter>;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  prefixEncoding?: EncodingObject[];
  itemEncoding?: EncodingObject;
}

export interface NormalizedResponse {
  statusCode: string;
  summary?: string;
  description: string;
  content?: Record<string, MediaTypeContent>;
  headers?: Record<string, NormalizedParameter>;
  links?: Record<string, LinkObject>;
}

export interface NormalizedCallback {
  expression: string;
  operations: NormalizedOperation[];
}

// ── Schema ─────────────────────────────────────────────────────────

export interface NormalizedSchema {
  /** Original schema name (from components/schemas key or definition name) */
  name?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;

  // Object
  properties?: Record<string, NormalizedSchema>;
  additionalProperties?: boolean | NormalizedSchema;
  required?: string[];

  // Array
  items?: NormalizedSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // Numeric
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;

  // String
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Composition
  allOf?: NormalizedSchema[];
  anyOf?: NormalizedSchema[];
  oneOf?: NormalizedSchema[];
  not?: NormalizedSchema;
  discriminator?: DiscriminatorObject;

  // Metadata
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  example?: unknown;
  examples?: unknown[];
  externalDocs?: ExternalDocs;

  /** Reference name for display linking (e.g. "User", "Pet") */
  refName?: string;
}

export interface DiscriminatorObject {
  propertyName: string;
  mapping?: Record<string, string>;
}

// ── Security ───────────────────────────────────────────────────────

export type SecuritySchemeType = "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS";

export interface SecurityScheme {
  type: SecuritySchemeType;
  name?: string;
  description?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
  flows?: OAuthFlows;
  openIdConnectUrl?: string;
  oauth2MetadataUrl?: string;
  deprecated?: boolean;
}

export interface OAuthFlows {
  implicit?: OAuthFlow;
  password?: OAuthFlow;
  clientCredentials?: OAuthFlow;
  authorizationCode?: OAuthFlow;
  deviceAuthorization?: OAuthFlow;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  deviceAuthorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export type SecurityRequirement = Record<string, string[]>;

// ── Shared ─────────────────────────────────────────────────────────

export interface ExternalDocs {
  url: string;
  description?: string;
}

export interface ExampleObject {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
}

export interface LinkObject {
  operationId?: string;
  operationRef?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  requestBody?: unknown;
  server?: ServerDefinition;
}

export interface CodeSample {
  lang: string;
  label?: string;
  source: string;
}

// ── Changelog ──────────────────────────────────────────────────────

export type ChangelogFormat = "keepachangelog" | "conventional" | "loose";

export type ChangelogChangeType =
  "added" | "changed" | "fixed" | "removed" | "deprecated" | "security" | "other";

export type ChangelogDiagnosticSeverity = "error" | "warning" | "info";

export interface ChangelogDiagnostic {
  severity: ChangelogDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  version?: string;
}

export interface ChangelogInlineLink {
  href: string;
  text: string;
}

export interface ChangelogRef {
  type: "pr" | "issue" | "commit";
  id: string;
  url?: string;
}

export interface NormalizedChangelogEntry {
  text: string;
  html: string;
  links: ChangelogInlineLink[];
  refs: ChangelogRef[];
}

export interface NormalizedChangelogSection {
  type: ChangelogChangeType;
  label: string;
  entries: NormalizedChangelogEntry[];
}

export interface NormalizedChangelogVersion {
  id: string;
  version: string | null;
  date: string | null;
  yanked: boolean;
  prerelease: boolean;
  summary?: string;
  sections: NormalizedChangelogSection[];
  compareUrl?: string;
  sourceOrder: number;
}

export interface VersionLink {
  version: string;
  url: string;
}

export interface NormalizedChangelog {
  title: string;
  description?: string;
  format: ChangelogFormat;
  versions: NormalizedChangelogVersion[];
  links: VersionLink[];
  diagnostics: ChangelogDiagnostic[];
  rawMarkdown: string;
}

// ── Loader / Pipeline types ────────────────────────────────────────

export type SpecFormat = "json" | "yaml";
export type SpecVersion = "swagger-2.0" | "openapi-3.0" | "openapi-3.1" | "openapi-3.2";

export interface LoadedSpec {
  /** Raw parsed object (before dereferencing) */
  raw: Record<string, unknown>;
  /** Detected format */
  format: SpecFormat;
  /** Detected spec version */
  version: SpecVersion;
  /** Resolved file path or URL the spec was loaded from */
  source: string;
}

export interface ParsedSpec {
  /** Public bundle, produced only when explicitly requested, before dereferencing. */
  publicDocument?: Record<string, unknown>;
  /** Fully dereferenced OpenAPI 3.x document */
  document: OpenApiDocument;
  /** Original source path/URL */
  source: string;
}

/**
 * Minimal typed shape of an OpenAPI 3.x document after dereferencing.
 * We use this rather than a full OpenAPI type to keep things lightweight;
 * the normalizer handles the detailed field extraction.
 */
export interface OpenApiDocument {
  openapi: string;
  $self?: string;
  info: Record<string, unknown>;
  servers?: Record<string, unknown>[];
  paths?: Record<string, Record<string, unknown>>;
  webhooks?: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
    pathItems?: Record<string, unknown>;
    [key: string]: unknown;
  };
  security?: Record<string, string[]>[];
  tags?: Record<string, unknown>[];
  externalDocs?: Record<string, unknown>;
  [key: string]: unknown;
}
