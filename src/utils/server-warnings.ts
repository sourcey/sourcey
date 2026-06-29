import type { NormalizedSpec } from "../core/types.js";

const PLACEHOLDER_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "::1",
  "example.com",
  "example.org",
  "example.net",
]);

export function findPlaceholderServerUrls(spec: Pick<NormalizedSpec, "servers">): string[] {
  const urls = new Set<string>();

  for (const server of spec.servers) {
    if (isPlaceholderServerUrl(server.url)) urls.add(server.url);
  }

  return [...urls];
}

export function isPlaceholderServerUrl(serverUrl: string): boolean {
  const hostname = extractHostname(serverUrl);
  if (!hostname) return false;

  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (PLACEHOLDER_HOSTS.has(normalized)) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;

  return (
    normalized.endsWith(".example.com") ||
    normalized.endsWith(".example.org") ||
    normalized.endsWith(".example.net")
  );
}

function extractHostname(serverUrl: string): string | null {
  const trimmed = serverUrl.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("{")) return null;

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    return new URL(candidate).hostname || null;
  } catch {
    return null;
  }
}
