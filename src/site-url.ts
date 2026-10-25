/**
 * Pretty-URL emission style. See `ResolvedConfig.prettyUrls`.
 */
export type PrettyUrls = false | "slash" | "strip";

export function isAbsoluteHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl?.trim();
  if (!raw || raw === "/") return "";

  const cleaned = raw.replace(/^\/+|\/+$/g, "");
  return cleaned ? `/${cleaned}/` : "";
}

export function normalizeSiteUrl(siteUrl?: string): string | undefined {
  const raw = siteUrl?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid siteUrl "${siteUrl}". Expected an absolute http(s) URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid siteUrl "${siteUrl}". Expected an absolute http(s) URL.`);
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Invalid siteUrl "${siteUrl}". Use siteUrl for the origin and baseUrl for any path prefix.`);
  }

  return url.origin;
}

/** Build a path under a tab, handling empty slugs (root-level tabs). */
export function tabPath(tabSlug: string, file: string): string {
  if (!tabSlug) return file;
  if (file.startsWith(`${tabSlug}/`)) return file;
  return `${tabSlug}/${file}`;
}

/** Build the on-disk output path for a tab landing page. */
export function tabIndexOutputPath(tabSlug: string, prettyUrls: PrettyUrls): string {
  if (!tabSlug) return "index.html";
  if (prettyUrls === "slash") return tabPath(tabSlug, "index.html");
  return `${tabSlug}.html`;
}

/**
 * Build the on-disk output path for a content page within a tab.
 * `"slash"` emits directory indexes. `false` and `"strip"` emit `.html`
 * files; `"strip"` only changes the public URL, not the file layout.
 */
export function pageOutputPath(tabSlug: string, slug: string, prettyUrls: PrettyUrls): string {
  if (slug === "index") {
    return tabIndexOutputPath(tabSlug, prettyUrls);
  }
  if (prettyUrls === "slash") {
    return tabPath(tabSlug, `${slug}/index.html`);
  }
  return tabPath(tabSlug, `${slug}.html`);
}

export function toPublicPath(outputPath: string, baseUrl = "", prettyUrls: PrettyUrls = false): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const prefix = normalizedBase || "/";
  const cleanOutputPath = outputPath.replace(/^\/+/, "");

  if (!cleanOutputPath || cleanOutputPath === "index.html") {
    if (prettyUrls === "strip" && normalizedBase) {
      return normalizedBase.slice(0, -1);
    }
    return prefix;
  }

  if (cleanOutputPath.endsWith("/index.html")) {
    const withSlash = cleanOutputPath.slice(0, -("index.html".length));
    if (prettyUrls === "strip") {
      return `${prefix}${withSlash.slice(0, -1)}`;
    }
    return `${prefix}${withSlash}`;
  }

  if (prettyUrls === "strip" && cleanOutputPath.endsWith(".html")) {
    return `${prefix}${cleanOutputPath.slice(0, -(".html".length))}`;
  }

  return `${prefix}${cleanOutputPath}`;
}

/** How pages address each other: the pretty-URL mode and the public base path. */
export type LinkStyle = Readonly<{ prettyUrls: PrettyUrls; baseUrl: string }>;

/**
 * Rewrite an output path into the target pages link it by, relative to the
 * site base.
 * - `"slash"`: trims trailing `index.html`, leaves a directory-style `foo/`.
 * - `"strip"`: trims both `index.html` and the trailing slash, so the browser
 *   sees `foo`. Under a base path the site root is the one page outside the
 *   base directory, so it is linked by its public path.
 * - `false`: returns the path unchanged.
 */
export function toPrettyLink(target: string, { prettyUrls, baseUrl }: LinkStyle): string {
  if (!prettyUrls) return target;
  if (!target || target === "index.html") {
    return prettyUrls === "strip" && normalizeBaseUrl(baseUrl)
      ? toPublicPath(target, baseUrl, prettyUrls)
      : "";
  }
  if (target.endsWith("/index.html")) {
    const withSlash = target.slice(0, -"index.html".length);
    return prettyUrls === "strip" ? withSlash.slice(0, -1) : withSlash;
  }
  if (prettyUrls === "strip" && target.endsWith(".html")) {
    return target.slice(0, -".html".length);
  }
  return target;
}

/** Resolve a link target against the linking page's base; public paths stand alone. */
/**
 * A file in the site's repository, as GitHub shows it at a revision: a page
 * that answers anyone, signed in or not, and offers its editor to whoever can
 * edit. `lines` marks a line, or a range.
 */
export function repositoryFileUrl(repo: string, revision: string, basePath: string | null | undefined, path: string, lines?: [number, number?]): string {
  const base = basePath?.replace(/^\/+|\/+$/g, "");
  const anchor = lines ? `#L${lines[0]}${lines[1] === undefined ? "" : `-L${lines[1]}`}` : "";
  return `${repo.replace(/\/+$/, "")}/blob/${revision}/${base ? `${base}/` : ""}${path}${anchor}`;
}

export function joinHref(base: string, target: string): string {
  if (target.startsWith("/")) return target;
  return `${base}${target}` || "./";
}

export function toAbsoluteUrl(publicPath: string, siteUrl?: string): string {
  if (!siteUrl) return publicPath;

  const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  return new URL(publicPath.replace(/^\/+/, ""), base).toString();
}

export function toPublicUrl(
  outputPath: string,
  siteUrl?: string,
  baseUrl = "",
  prettyUrls: PrettyUrls = false,
): string {
  return toAbsoluteUrl(toPublicPath(outputPath, baseUrl, prettyUrls), siteUrl);
}

export function stripBaseUrl(pathname: string, baseUrl = ""): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) return pathname;

  const bareBase = normalizedBase.slice(0, -1);
  if (pathname === bareBase || pathname === normalizedBase) {
    return "/";
  }

  if (pathname.startsWith(normalizedBase)) {
    return `/${pathname.slice(normalizedBase.length)}`;
  }

  return pathname;
}
