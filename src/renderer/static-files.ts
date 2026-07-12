import { extname } from "node:path";
import type { PrettyUrls } from "../site-url.js";
import { normalizeBaseUrl, stripBaseUrl } from "../site-url.js";

export function outputPathFromRequestPath(pathname: string, baseUrl: string): string {
  let path = pathname;
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (normalizedBase && path.startsWith(normalizedBase)) {
    path = path.slice(normalizedBase.length);
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path; a malformed escape cannot match generated output.
  }

  return path.replace(/^\/+/, "");
}

export function outputPathCandidatesForRequest(
  pathname: string,
  baseUrl: string,
  prettyUrls: PrettyUrls,
): string[] {
  const requestPath = stripBaseUrl(pathname, baseUrl);
  const clean = outputPathFromRequestPath(requestPath, "");

  if (!clean) return ["index.html"];
  if (extname(clean)) return [clean];

  const candidates =
    prettyUrls === "strip"
      ? [`${clean}.html`, `${clean}/index.html`]
      : [`${clean}/index.html`, `${clean}.html`];
  return [...candidates, clean];
}

export function requestPathMatchesBase(pathname: string, baseUrl: string): boolean {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) return true;

  const bareBase = normalizedBase.slice(0, -1);
  return pathname === bareBase || pathname === normalizedBase || pathname.startsWith(normalizedBase);
}

export function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".ico":
      return "image/x-icon";
    case ".txt":
    case ".xml":
      return "text/plain; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}
