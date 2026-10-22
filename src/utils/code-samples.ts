import type { NormalizedOperation, SecurityScheme, ServerDefinition } from "../core/types.js";
import type { CodeSample } from "../core/types.js";
import { describeRequest, initialDraft, normalizeRequestHeaders, type RequestDescription } from "../core/request.js";
import { multipartSamples } from "./multipart-samples.js";
import { codeBlockString, codeString, sampleUrl, sampleOrigin } from "./code-literals.js";
import { isAbsoluteHttpUrl } from "../site-url.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RequestInfo = Pick<RequestDescription, "headers" | "url" | "method" | "credentials"> & { body?: string; originVariable?: boolean };

type CodeSampleGenerator = (req: RequestInfo) => CodeSample;

// ---------------------------------------------------------------------------
// Generator registry
// ---------------------------------------------------------------------------

const generators: Record<string, CodeSampleGenerator> = {
  curl({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const parts = [`curl -X ${method} ${sampleUrl(url, "curl", originVariable)}`];
    for (const [name, value] of headers)
      parts.push("  -H " + shellSingleQuoted(name + ": " + value));
    const binary = body?.includes("\0");
    if (body !== undefined) parts.push(binary ? "  --data-binary @-" : `  --data-raw ${shellSingleQuoted(body)}`);
    const pipe = binary ? `printf '%b' ${shellSingleQuoted(Array.from(new TextEncoder().encode(body!)).map(byte => `\\0${byte.toString(8).padStart(3, "0")}`).join(""))} | ` : "";
    return { lang: "bash", label: "cURL", source: (originVariable ? sampleOrigin("curl") + "\n" : "") + pipe + parts.join(" \\\n") };
  },

  javascript({ url, method, headers, body, credentials, originVariable }: RequestInfo): CodeSample {
    const block = body !== undefined ? codeBlockString(body, "javascript") : undefined;
    const lines = [...(originVariable ? [sampleOrigin("javascript")] : []), ...(block ? [`const body = ${block};`, ""] : []), `const response = await fetch(${sampleUrl(url, "javascript", originVariable)}, {`];
    lines.push(`  method: '${method}',`);
    if (headers.length)
      lines.push("  headers: {", ...Object.entries(Object.fromEntries(headers)).map(([name, value]) => `    ${codeString(name, "javascript")}: ${codeString(value, "javascript")},`), "  },");
    if (credentials !== "same-origin")
      lines.push("  credentials: " + singleLiteral(credentials) + ",");
    if (body !== undefined)
      lines.push(block ? "  body," : "  body: " + codeString(body, "javascript") + ",");
    lines.push(`});`, ``, `const data = await response.text();`);
    return { lang: "javascript", label: "JavaScript", source: lines.join("\n") };
  },

  typescript(req: RequestInfo): CodeSample {
    const sample = generators.javascript(req);
    return { ...sample, lang: "typescript", label: "TypeScript" };
  },

  python({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const lines = ["import requests", ""];
    if (originVariable) lines.push(sampleOrigin("python"));
    const block = body !== undefined ? codeBlockString(body, "python") : undefined;
    if (block) lines.push("body = " + block, "");
    const args = [...(pythonShortcutMethod(method) ? [] : [singleLiteral(method)]), sampleUrl(url, "python", originVariable)];
    if (body !== undefined) args.push("data=" + (block ? "body" : singleLiteral(body)) + ".encode('utf-8')");
    if (headers.length)
      args.push(["headers={", ...Object.entries(Object.fromEntries(headers)).map(([name, value]) => `    ${codeString(name, "python")}: ${codeString(value, "python")},`), "}"].join("\n    "));
    const call = pythonShortcutMethod(method) ? "requests." + method.toLowerCase() : "requests.request";
    // A call with more than an address takes one argument a line.
    lines.push("response = " + call + (args.length > (pythonShortcutMethod(method) ? 1 : 2) ? "(\n    " + args.join(",\n    ") + ",\n)" : "(" + args.join(", ") + ")"), "print(response.text)");
    return { lang: "python", label: "Python", source: lines.join("\n") };
  },

  go({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const lines = ["package main", "", "import (", `  "fmt"`, `  "io"`, `  "net/http"`];
    if (body !== undefined) lines.push(`  "strings"`);
    lines.push(")", "");
    lines.push("func main() {");
    if (originVariable) lines.push("  " + sampleOrigin("go"));
    if (body !== undefined) {
      lines.push("  body := strings.NewReader(" + (codeBlockString(body, "go") ?? JSON.stringify(body)) + ")");
      lines.push(`  req, _ := http.NewRequest(${codeString(method, "go")}, ${sampleUrl(url, "go", originVariable)}, body)`);
    } else {
      lines.push(`  req, _ := http.NewRequest(${codeString(method, "go")}, ${sampleUrl(url, "go", originVariable)}, nil)`);
    }
    for (const [name, value] of headers)
      lines.push("  req.Header.Set(" + JSON.stringify(name) + ", " + JSON.stringify(value) + ")");
    lines.push(`  resp, _ := http.DefaultClient.Do(req)`);
    lines.push(`  defer resp.Body.Close()`);
    lines.push(`  data, _ := io.ReadAll(resp.Body)`);
    lines.push(`  fmt.Println(string(data))`);
    lines.push("}");
    return { lang: "go", label: "Go", source: lines.join("\n") };
  },

  ruby({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const lines = [
      `require 'net/http'`,
      `require 'json'`,
      ``,
      ...(originVariable ? [sampleOrigin("ruby")] : []),
      `uri = URI(${sampleUrl(url, "ruby", originVariable)})`,
    ];
    const methodClass = rubyShortcutMethod(method);
    if (methodClass) {
      lines.push(`request = Net::HTTP::${methodClass}.new(uri)`);
      if (body !== undefined) lines.push(`request.body = ${codeBlockString(body, "ruby") ?? codeString(body, "ruby")}`);
    } else {
      lines.push(
        `request = Net::HTTPGenericRequest.new('${method}', ${body ? "true" : "false"}, true, uri.request_uri, {})`,
      );
      if (body !== undefined) lines.push(`request.body = ${codeBlockString(body, "ruby") ?? codeString(body, "ruby")}`);
    }
    for (const [name, value] of headers)
      lines.push("request[" + codeString(name, "ruby") + "] = " + codeString(value, "ruby"));
    lines.push(
      ``,
      `response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') { |http| http.request(request) }`,
    );
    lines.push(`data = JSON.parse(response.body)`);
    return { lang: "ruby", label: "Ruby", source: lines.join("\n") };
  },

  java({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const lines = [
      `import java.net.http.*;`,
      `import java.net.URI;`,
      ``,
      `HttpClient client = HttpClient.newHttpClient();`,
    ];
    if (originVariable) lines.push(sampleOrigin("java"));
    if (body !== undefined) {
      lines.push("String body = " + (codeBlockString(body, "java") ?? codeString(body, "java")) + ";", "");
      lines.push(`HttpRequest request = HttpRequest.newBuilder()`);
      lines.push(`    .uri(URI.create(${sampleUrl(url, "java", originVariable)}))`);
      lines.push(`    .method("${method}", HttpRequest.BodyPublishers.ofString(body))`);
    } else {
      lines.push(`HttpRequest request = HttpRequest.newBuilder()`);
      lines.push(`    .uri(URI.create(${sampleUrl(url, "java", originVariable)}))`);
      lines.push(`    .method("${method}", HttpRequest.BodyPublishers.noBody())`);
    }
    for (const [name, value] of headers)
      lines.push("    .header(" + codeString(name, "java") + ", " + codeString(value, "java") + ")");
    lines.push(`    .build();`, ``);
    lines.push(
      `HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`,
    );
    lines.push(`System.out.println(response.body());`);
    return { lang: "java", label: "Java", source: lines.join("\n") };
  },

  php({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const block = body !== undefined ? codeBlockString(body, "php") : undefined;
    const lines = [`<?php`, ...(originVariable ? [sampleOrigin("php")] : []), ...(block ? [`$body = ${block};`, ``] : []), `$ch = curl_init(${sampleUrl(url, "php", originVariable)});`];
    lines.push(`curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`);
    if (method !== "GET") {
      lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${phpSingleQuoted(method)}');`);
    }
    if (headers.length) {
      lines.push(
        "curl_setopt($ch, CURLOPT_HTTPHEADER, [" +
          headers.map(([k, v]) => codeString(k + ": " + v, "php")).join(", ") +
          "]);",
      );
    }
    if (body !== undefined) {
      lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${block ? "$body" : codeString(body, "php")});`);
    }
    lines.push(``, `$response = curl_exec($ch);`, `curl_close($ch);`);
    lines.push(`$data = json_decode($response, true);`);
    return { lang: "php", label: "PHP", source: lines.join("\n") };
  },

  rust({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const lines = [
      `use reqwest;`,
      ``,
      `#[tokio::main]`,
      `async fn main() -> Result<(), reqwest::Error> {`,
      `    let client = reqwest::Client::new();`,
    ];
    if (originVariable) lines.push("    " + sampleOrigin("rust"));
    const requestBuilder = rustShortcutMethod(method)
      ? `client.${method.toLowerCase()}(${sampleUrl(url, "rust", originVariable)})`
      : `client.request(reqwest::Method::from_bytes(b"${method}").unwrap(), ${sampleUrl(url, "rust", originVariable)})`;
    if (body !== undefined) {
      lines.push("    let body = " + (codeBlockString(body, "rust") ?? codeString(body, "rust")) + ";");
      lines.push(`    let response = ${requestBuilder}`);
      lines.push(`        .body(body)`);
    } else {
      lines.push(`    let response = ${requestBuilder}`);
    }
    for (const [name, value] of headers)
      lines.push("        .header(" + codeString(name, "rust") + ", " + codeString(value, "rust") + ")");
    lines.push(`        .send()`);
    lines.push(`        .await?`);
    lines.push(`        .text()`);
    lines.push(`        .await?;`);
    lines.push(`    println!("{}", response);`);
    lines.push(`    Ok(())`);
    lines.push(`}`);
    return { lang: "rust", label: "Rust", source: lines.join("\n") };
  },

  csharp({ url, method, headers, body, originVariable }: RequestInfo): CodeSample {
    const lines = [`using var client = new HttpClient();`, ``];
    if (originVariable) lines.push(sampleOrigin("csharp"));
    const httpMethod = csharpShortcutMethod(method)
      ? `HttpMethod.${method[0] + method.slice(1).toLowerCase()}`
      : `new HttpMethod("${method}")`;
    if (body !== undefined) {
      const block = codeBlockString(body, "csharp");
      if (block) lines.push("var body = " + block + ";");
      lines.push(
        "var content = new StringContent(" + (block ? "body" : codeString(body, "csharp")) + ", System.Text.Encoding.UTF8);",
      );
      lines.push(
        `var request = new HttpRequestMessage(${httpMethod}, ${sampleUrl(url, "csharp", originVariable)}) { Content = content };`,
      );
    } else {
      lines.push(`var request = new HttpRequestMessage(${httpMethod}, ${sampleUrl(url, "csharp", originVariable)});`);
    }
    for (const [name, value] of headers) {
      lines.push(
        name.toLowerCase() === "content-type"
          ? "request.Content!.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(" +
              codeString(value, "csharp") +
              ");"
          : "request.Headers.TryAddWithoutValidation(" +
              codeString(name, "csharp") +
              ", " +
              codeString(value, "csharp") +
              ");",
      );
    }
    lines.push(
      "var response = await client.SendAsync(request);",
      `var data = await response.Content.ReadAsStringAsync();`,
    );
    return { lang: "csharp", label: "C#", source: lines.join("\n") };
  },
};

/** Default languages when none configured. */
export const DEFAULT_CODE_SAMPLE_LANGS = ["curl", "javascript", "python"];
export const SUPPORTED_CODE_SAMPLE_LANGS = Object.freeze(Object.keys(generators));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate code samples for an operation.
 *
 * @param langs - Which languages to generate. Defaults to curl, JS, Python.
 *                Use keys from the generator registry: curl, javascript,
 *                python, go, ruby, java, php, rust, csharp.
 */
export function generateCodeSamples(
  op: NormalizedOperation,
  servers: readonly ServerDefinition[],
  langs: string[] = DEFAULT_CODE_SAMPLE_LANGS,
  securitySchemes: Record<string, SecurityScheme> = {},
  sourceUrl?: string,
): CodeSample[] {
  // Spec-defined samples always win
  if (op.codeSamples?.length) return op.codeSamples;

  const draft = initialDraft(op);
  for (const name of Object.keys(op.security[draft.securityIndex] ?? {}))
    draft.auth[name] = {
      value: "YOUR_TOKEN",
      username: "YOUR_USERNAME",
      password: "YOUR_PASSWORD",
    };
  const { server, unfilled, base } = operationServer(op, servers, sourceUrl);
  const originVariable = !isAbsoluteHttpUrl(base);
  const request = describeRequest(
    {
      operation: op,
      servers: [server],
      securitySchemes,
      baseUrl: !unfilled && sourceUrl ? sourceUrl : "https://sourcey.invalid/",
    },
    draft,
  );
  if (originVariable) request.url = request.url.replace(/^https:\/\/sourcey\.invalid(?=\/|$)/, "");
  return generateRequestSamples(request, langs, { originVariable });
}

/**
 * Where an operation's requests go, as its samples and its endpoint name it:
 * its own servers before the API's, each variable at its default, and a
 * relative address resolved against the published spec when that is known.
 * An origin with a variable that has no default (a self-hosted instance's
 * host) is the reader's to fill in, so it is left out, as is an origin a
 * relative address cannot be resolved against. `base` has no trailing slash.
 */
export function operationServer(op: NormalizedOperation, servers: readonly ServerDefinition[], sourceUrl?: string) {
  const declared = (op.servers?.length ? op.servers : servers)[0] ?? { url: "/" };
  const origin = declared.url.match(/^[^/]*\/\/[^/]*/)?.[0] ?? "";
  const unfilled = [...origin.matchAll(/\{([^}]+)\}/g)].some(([, name]) => !declared.variables?.[name]?.default);
  const server = unfilled ? { ...declared, url: declared.url.slice(origin.length) || "/" } : declared;
  const resolved = server.url.replace(/\{([^}]+)\}/g, (match, name: string) => server.variables?.[name]?.default ?? match);
  const located = !unfilled && sourceUrl && !isAbsoluteHttpUrl(resolved) ? decodeURI(new URL(resolved, sourceUrl).href) : resolved;
  return { server, unfilled, base: located.replace(/\/+$/, "") };
}

export function generateRequestSamples(
  request: RequestDescription,
  langs = DEFAULT_CODE_SAMPLE_LANGS,
  options: { originVariable?: boolean } = {},
): CodeSample[] {
  request = { ...request, headers: normalizeRequestHeaders(request.headers) };
  if (request.body?.kind === "multipart") return multipartSamples(request, langs, options);
  const req: RequestInfo = {
    url: request.url,
    method: request.method,
    headers: request.headers,
    credentials: request.credentials,
    body: request.body?.kind === "text" ? request.body.text : undefined,
    originVariable: options.originVariable,
  };
  return langs
    .map((lang) => generators[lang]?.(req))
    .filter((sample): sample is CodeSample => !!sample);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pythonShortcutMethod(method: string): boolean {
  return ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method);
}

function rubyShortcutMethod(method: string): string | undefined {
  switch (method) {
    case "GET":
      return "Get";
    case "POST":
      return "Post";
    case "PUT":
      return "Put";
    case "DELETE":
      return "Delete";
    case "PATCH":
      return "Patch";
    default:
      return undefined;
  }
}

function rustShortcutMethod(method: string): boolean {
  return ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method);
}

function csharpShortcutMethod(method: string): boolean {
  return ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method);
}

function shellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function phpSingleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function singleLiteral(value: string): string {
  return codeString(value, "javascript");
}
