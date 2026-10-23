import { useContext } from "preact/hooks";
import { Breakable, bareName } from "../ui/Breakable.js";
import type { NormalizedOperation, NormalizedRequestBody } from "../../core/types.js";
import { kindTells, operationAnchor, operationFieldRoot, operationSectionName, referenceFieldPath, operationSectionAnchor, operationSections, type OperationSection } from "../../core/reference-identity.js";
import { referenceTag } from "../../core/tag-utils.js";
import { SECTION_LABELS } from "./outline.js";
import { PageContext, SiteContext, SpecContext, isOperationPage } from "../../renderer/context.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { Markdown } from "../ui/Markdown.js";
import { DeprecatedBadge } from "../ui/Badge.js";
import { SectionLabel } from "../ui/SectionLabel.js";
import { Parameters } from "./Parameters.js";
import { RequestBody, RequestBodyExample } from "./RequestBody.js";
import { ResponsesCopy, ResponsesExamples } from "./Responses.js";
import { SecurityCopy } from "./Security.js";
import { CodeSamplesExamples } from "./CodeSamples.js";
import { EndpointBar } from "./EndpointBar.js";
import { ExternalDocsLink } from "./ExternalDocs.js";
import { McpEndpointBar } from "../mcp/McpEndpointBar.js";
import { AnnotationBadges } from "../mcp/AnnotationBadges.js";
import { McpReturnsCopy, McpReturnsExample } from "../mcp/McpReturns.js";
import { ConsoleExamples, ConsoleIdentity } from "../try-it/Activation.js";

interface OperationProps {
  operation: NormalizedOperation;
}

/**
 * Single operation with sticky code panel:
 * - Endpoint bar at top
 * - Single-column content (left) + sticky code panel (right, xl+ only)
 *
 * The full-width theme renders the split layout instead.
 */
export function Operation({ operation: op }: OperationProps) {
  const site = useContext(SiteContext);
  const spec = useContext(SpecContext);
  const page = useContext(PageContext);
  const id = operationAnchor(op, spec);
  const standalone = isOperationPage(page);
  return (
    // One console per operation on a page, named by the operation.
    <ConsoleIdentity.Provider value={`tryit-${id}`}>
      {site.theme.name === "api-first" ? (
        <section id={id} class="operation-split" data-traverse-target={id} data-sourcey-operation data-mcp={op.mcpExtras ? "" : undefined}>
          <AnchorAliases target={id} />
          <SplitOperationIdentity operation={op} />
          <SplitOperationDetail operation={op} />
        </section>
      ) : (
        <div
          id={id}
          class={standalone ? "pb-8" : "py-8 border-t border-[rgb(var(--color-gray-100))] dark:border-[rgb(var(--color-gray-800))]"}
          data-traverse-target={id}
          data-sourcey-operation
        >
          <AnchorAliases target={id} />
          {/* An MCP tool's title heads its content column. */}
          {!op.mcpExtras && <OperationIdentity operation={op} />}
          <DefaultOperationDetail operation={op} />
        </div>
      )}
    </ConsoleIdentity.Provider>
  );
}

function OperationIdentity({ operation: op }: OperationProps) {
  const page = useContext(PageContext);
  const standalone = isOperationPage(page);
  const Heading = standalone ? "h1" : "h2";
  const mcp = op.mcpExtras;
  const { kind, named } = useMcpLine(op);
  return (
    <>
      <header class="mb-6">
        <div class="flex items-baseline gap-2 flex-wrap">
          <Heading class={`${standalone ? "reference-page-title " : ""}text-2xl sm:text-3xl text-[rgb(var(--color-gray-900))] dark:text-[rgb(var(--color-gray-200))] tracking-tight font-bold mb-2`}>
            {op.summary ? bareName(op.summary) ? <Breakable text={op.summary} /> : <Markdown content={op.summary} inline /> : op.path}
          </Heading>
          {op.deprecated && <DeprecatedBadge />}
          {mcp?.annotations && <AnnotationBadges annotations={mcp.annotations} />}
        </div>
      </header>
      {!mcp ? <EndpointBar operation={op} /> : (kind || named) && <McpEndpointBar method={kind ? op.method : undefined} path={op.path} />}
    </>
  );
}

/**
 * What an MCP entry's line under its title says: its kind where its section
 * holds several, and its name or address where the title is not already that.
 */
function useMcpLine(op: NormalizedOperation): { kind: boolean; named: boolean } {
  const spec = useContext(SpecContext);
  if (!op.mcpExtras) return { kind: true, named: true };
  const section = operationSectionName(op, spec);
  const listed = section ? referenceTag(spec, section).operations.filter(other => !other.hidden).map(other => other.method) : [];
  return { kind: kindTells(op.method, listed), named: (op.summary ?? op.path) !== op.path };
}

/**
 * The description, the examples and the fields, in that order: the examples
 * move beside the copy where the column has room for both.
 */
function DefaultOperationDetail({ operation: op }: OperationProps) {
  return (
    <div class="operation-layout">
      {(op.mcpExtras || op.description || op.externalDocs) && (
        <div class="operation-intro">
          {op.mcpExtras && <OperationIdentity operation={op} />}
          {op.description && <Markdown content={op.description} class="mb-6 max-w-none" />}
          <ExternalDocsLink docs={op.externalDocs} />
        </div>
      )}
      <aside class="sourcey-operation-examples"><OperationExamples operation={op} /></aside>
      {operationSections(op).length > 0 && <div class="operation-details"><OperationSections operation={op} sectionClass="mt-6" /></div>}
    </div>
  );
}

/**
 * The full-width theme's operation: two equal columns. The left starts with
 * the title and a one-line method and path, then the description, body,
 * parameters and responses. The right holds the request and response examples
 * level with the title and stays on screen through the operation. Below the
 * large breakpoint the examples follow the description.
 */
function SplitOperationIdentity({ operation: op }: OperationProps) {
  const page = useContext(PageContext);
  const standalone = isOperationPage(page);
  const Heading = standalone ? "h1" : "h2";
  const mcp = op.mcpExtras;
  const { kind, named } = useMcpLine(op);
  return (
    <>
      <header class="operation-split-header">
        <div class="flex items-baseline gap-2 flex-wrap">
          <Heading class={`${standalone ? "reference-page-title " : ""}operation-split-title`}>
            {op.summary ? bareName(op.summary) ? <Breakable text={op.summary} /> : <Markdown content={op.summary} inline /> : op.path}
          </Heading>
          {op.deprecated && <DeprecatedBadge />}
          {mcp?.annotations && <AnnotationBadges annotations={mcp.annotations} />}
        </div>
        {mcp && (kind || named) && (
          <div class="operation-line" data-method={op.method.toLowerCase()}>
            {kind && <span class="operation-line-method">{op.method.toUpperCase()}</span>}
            {named && <span class="operation-line-path">{op.path}</span>}
          </div>
        )}
      </header>
      {!mcp && (
        <EndpointBar operation={op} />
      )}
    </>
  );
}

function SplitOperationDetail({ operation: op }: OperationProps) {
  return (
    <>
      {(op.description || op.externalDocs) && (
        <div class="operation-split-intro">
          {op.description && <Markdown content={op.description} class="operation-split-description max-w-none" />}
          <ExternalDocsLink docs={op.externalDocs} />
        </div>
      )}
      <aside class="operation-split-examples"><OperationExamples operation={op} /></aside>
      {operationSections(op).length > 0 && <div class="operation-split-content"><OperationSections operation={op} sectionClass="operation-split-section" /></div>}
    </>
  );
}

/** An operation's body, parameters, responses and authentication, each section under its anchor. */
function OperationSections({ operation: op, sectionClass }: { operation: NormalizedOperation; sectionClass: string }) {
  const sectionId = useSectionId(op);
  const mcp = op.mcpExtras;
  return (
    <>
      {op.requestBody && (
        <div class={sectionClass} id={sectionId("request-body")}>
          <AnchorAliases target={sectionId("request-body")} />
          <SectionLabel meta={bodyMediaType(op.requestBody)}>{SECTION_LABELS["request-body"]}</SectionLabel>
          <RequestBody body={op.requestBody} anchorRoot={referenceFieldPath(operationFieldRoot(op), "request-body")} />
        </div>
      )}

      {op.parameters.length > 0 && (
        <div class={sectionClass} id={sectionId("parameters")}>
          <AnchorAliases target={sectionId("parameters")} />
          <SectionLabel>{SECTION_LABELS.parameters}</SectionLabel>
          <Parameters parameters={op.parameters} anchorRoot={referenceFieldPath(operationFieldRoot(op), "parameters")} />
        </div>
      )}

      {mcp ? (
        <McpReturnsCopy schema={mcp.outputSchema} id={sectionId("returns")} anchorRoot={referenceFieldPath(operationFieldRoot(op), "returns")} />
      ) : (
        op.responses.length > 0 && (
          <div class={sectionClass} id={sectionId("responses")}>
            <AnchorAliases target={sectionId("responses")} />
            <SectionLabel>{SECTION_LABELS.responses}</SectionLabel>
            <ResponsesCopy responses={op.responses} operation={op} />
          </div>
        )
      )}

      {!mcp && <SecurityCopy security={op.security} id={sectionId("authentication")} />}
    </>
  );
}

/** The request samples, body example and response examples, with the console that opens over them. */
function OperationExamples({ operation: op }: { operation: NormalizedOperation }) {
  const site = useContext(SiteContext);
  return (
    <ConsoleExamples operation={op}>
      <CodeSamplesExamples operation={op} codeSampleLangs={site.codeSamples} />
      {op.requestBody && <RequestBodyExample body={op.requestBody} />}
      {op.mcpExtras ? <McpReturnsExample schema={op.mcpExtras.outputSchema} /> : <ResponsesExamples responses={op.responses} />}
    </ConsoleExamples>
  );
}

function useSectionId(operation: NormalizedOperation) {
  const spec = useContext(SpecContext);
  const page = useContext(PageContext);
  return (section: OperationSection) => operationSectionAnchor(operation, spec, section, page?.kind === "spec" && page.view?.kind === "operation");
}

/** The body's one media type; several are labelled on their field lists instead. */
function bodyMediaType(body: NormalizedRequestBody): string | undefined {
  const types = Object.keys(body.content);
  return types.length === 1 ? types[0] : undefined;
}
