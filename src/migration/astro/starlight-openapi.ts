/**
 * starlight-openapi to native API reference tabs. Operations keep their URLs
 * through the native route pattern, and every fragment the plugin's pages
 * published becomes an alias of the native section that holds its content.
 */
import { posix } from "node:path";
import type { JsonValue } from "../../core/markdown-components.js";
import { slugify } from "../../utils/slug.js";
import { Call, type ConfigValue } from "../config-writer.js";
import { toJson, type Value } from "../javascript.js";
import { readApiReference, type ApiReference, type ReferenceOperation } from "../openapi.js";
import { githubSlugs } from "../slugs.js";
import { lineAt } from "../text-edits.js";
import { STARLIGHT_OPENAPI, type StarlightContext } from "./starlight-model.js";
import { isAbsoluteHttpUrl } from "../../site-url.js";

/** Header parameters starlight-openapi leaves out of its parameter lists. */
const IGNORED_HEADERS = new Set(["accept", "authorization", "content-type"]);

type Slug = (value: string) => string;
type SourceObject = Record<string, unknown>;

export interface OpenApiTabs {
  tabs: ConfigValue[];
  /** Mount-relative pages the plugin published, with the fragments each page had. */
  pages: { route: string; fragments: string[] }[];
}

export async function convertOpenApiPlugins(context: StarlightContext, plugins: Value | undefined): Promise<OpenApiTabs> {
  const { root, diagnostics } = context;
  const result: OpenApiTabs = { tabs: [], pages: [] };
  if (!plugins) return result;
  if (plugins.kind !== "array") {
    diagnostics.error({ file: root.configFile, line: lineAt(root.scope.source, plugins.node.start), code: "starlight-plugins", message: "Starlight plugins must be a static array" });
    return result;
  }
  const { slug } = await githubSlugs();
  for (const plugin of plugins.items) {
    const line = lineAt(root.scope.source, plugin.node.start);
    const fail = (message: string) => diagnostics.error({ file: root.configFile, line, code: "starlight-openapi", message });
    if (plugin.kind !== "call" || plugin.callee?.module !== STARLIGHT_OPENAPI || plugin.callee.export !== "default") {
      diagnostics.error({ file: root.configFile, line, code: "starlight-plugins", message: "This Starlight plugin has no native conversion" });
      continue;
    }
    const configs = plugin.args[0] ? toJson(plugin.args[0]) : undefined;
    if (!configs?.ok || !Array.isArray(configs.value)) {
      fail("starlight-openapi options must be a static array");
      continue;
    }
    for (const config of configs.value as Record<string, JsonValue>[]) {
      const base = String(config.base ?? "").replace(/^\/+|\/+$/g, "");
      const schema = String(config.schema ?? "");
      const spec = isAbsoluteHttpUrl(schema) ? schema : posix.join(root.dir, schema);
      const reference = await readApiReference(context.project, spec);
      if (reference.describedTags.length || reference.webhooks) fail(`${schema} publishes tag or webhook pages, which have no native reference view yet`);

      const routes: Record<string, string> = {};
      const anchors: Record<string, Record<string, string>> = {};
      const publish = (route: string, document: string, fragments: Map<string, string | undefined>) => {
        const aliases: Record<string, string> = {};
        for (const [fragment, section] of fragments) {
          if (!section) fail(`${base}/${route} published #${fragment}, which no native section holds`);
          else if (fragment !== section) aliases[fragment] = section;
        }
        if (Object.keys(aliases).length) anchors[document] = aliases;
        result.pages.push({ route: `${base}/${route}`, fragments: [...fragments.keys()] });
      };
      publish("", "introduction", overviewFragments(reference, slug));
      for (const operation of reference.operations) {
        // The plugin adds the method only where two operations would share a URL.
        const route = `operations/${slug(operation.operationId ?? operation.path)}`;
        if (operation.duplicateId) routes[operation.document] = `${route}/${slug(operation.method)}`;
        publish(`${routes[operation.document] ?? route}/`, operation.document, operationFragments(operation, reference.document, slug));
      }
      result.tabs.push({
        tab: typeof config.label === "string" ? config.label : "API",
        slug: base,
        source: new Call("openapi", [isAbsoluteHttpUrl(schema) ? schema : `./${posix.relative(root.dir, spec)}`]),
        reference: { split: "operations", operations: "operations/{operation}" },
        ...(Object.keys(routes).length ? { routes } : {}),
        ...(Object.keys(anchors).length ? { anchors } : {}),
      });
    }
  }
  return result;
}

/** The overview page's fragments, by the native section holding each. */
function overviewFragments(reference: ApiReference, slug: Slug): Map<string, string> {
  const fragments = new Map([["overview", "introduction"]]);
  const schemes = Object.keys(reference.securitySchemes);
  if (schemes.length) fragments.set("authentication", "authentication");
  for (const name of schemes) fragments.set(slug(name), "authentication");
  return fragments;
}

/**
 * An operation page's fragments as starlight-openapi 0.19 derives them, by
 * the native section holding each: undefined where native has none.
 */
function operationFragments(operation: ReferenceOperation, document: SourceObject, slug: Slug): Map<string, string | undefined> {
  const { operation: source, pathItem } = operation.source;
  const section = (anchor: string) => (operation.anchors.includes(anchor) ? anchor : undefined);
  const fragments = new Map<string, string | undefined>();
  if (((source.security ?? document.security) as unknown[] | undefined)?.length) fragments.set("authorizations", undefined);

  const parameters = [...((pathItem.parameters as SourceObject[]) ?? []), ...((source.parameters as SourceObject[]) ?? [])];
  const locations = new Set(
    parameters.filter((parameter) => parameter.in !== "body" && !(parameter.in === "header" && IGNORED_HEADERS.has(String(parameter.name).toLowerCase()))).map((parameter) => String(parameter.in)),
  );
  if (locations.size) {
    // Swagger form parameters are the request body in OpenAPI 3, which native renders.
    fragments.set("parameters", section("parameters") ?? section("request-body"));
    for (const location of locations)
      fragments.set(slug(`${location.charAt(0).toUpperCase()}${location.slice(1)} Parameters`), section(location === "formData" ? "request-body" : "parameters"));
  }
  if (source.requestBody || parameters.some((parameter) => parameter.in === "body")) fragments.set("request-body", section("request-body"));
  if (source.callbacks) fragments.set("callbacks", undefined);

  const responses = source.responses as Record<string, SourceObject> | undefined;
  if (responses) {
    fragments.set("responses", section("responses"));
    // The plugin lists the default response last.
    const codes = Object.keys(responses).sort((a, b) => Number(a === "default") - Number(b === "default"));
    for (const code of codes) fragments.set(slug(code), section(`response-${slugify(code)}`));
    const withHeaders = codes.find((code) => Object.keys((responses[code]?.headers as SourceObject | undefined) ?? {}).length);
    if (withHeaders) fragments.set("headers", section(`response-${slugify(withHeaders)}`));
  }
  return fragments;
}
