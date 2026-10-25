import type { ResolvedTheme } from "../config.js";
import { heavyBuildJob } from "../core/build-jobs.js";
import { cachedArtifacts } from "../core/artifact-cache.js";
import { drawCard } from "./draw-card.js";

export interface OgImageOptions {
  title: string;
  description?: string;
  siteName: string;
  theme: ResolvedTheme;
  logo?: string; // data URI
  /** The logo is a mark without the name, so the name shows beside it, as in the site header. */
  logoMark?: boolean;
}

const LOGO_HEIGHT = 48;
const LOGO_MAX_WIDTH = 480;

/** The size an embedded image declares in its own header, so a logo keeps its proportions. */
function imageSize(dataUri: string): { width: number; height: number } | undefined {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return undefined;
  const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
  const type = match[1].toLowerCase();
  if (type === "image/png" && bytes.length >= 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type === "image/gif" && bytes.length >= 10)
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (type === "image/jpeg") {
    for (let i = 2; i + 9 < bytes.length && bytes[i] === 0xff; i += 2 + bytes.readUInt16BE(i + 2)) {
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    }
    return undefined;
  }
  if (type === "image/svg+xml") {
    const root = /<svg\b[^>]*>/i.exec(bytes.toString("utf8"))?.[0];
    if (!root) return undefined;
    const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
    const pixels = (value?: string) => (value && /^\s*[\d.]+(?:px)?\s*$/.test(value) ? Number.parseFloat(value) : undefined);
    const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const width = pixels(attribute("width")) ?? box?.[2];
    const height = pixels(attribute("height")) ?? box?.[3];
    return width && height ? { width, height } : undefined;
  }
  return undefined;
}

/** A logo LOGO_HEIGHT tall at its own proportions, narrowed to fit a long wordmark. */
function logoBox(logo: string): { width: number; height: number } {
  const size = imageSize(logo);
  if (!size) return { width: LOGO_HEIGHT, height: LOGO_HEIGHT };
  const width = Math.min(LOGO_MAX_WIDTH, Math.round((LOGO_HEIGHT * size.width) / size.height));
  return { width, height: Math.round((width * size.height) / size.width) };
}

/**
 * A logo the site names by URL, fetched once and embedded, as a local logo is.
 * The card renderer reads an image only by its exact media type, so an SVG
 * served as `image/svg+xml; charset=utf-8` would otherwise be dropped from
 * every card, and each page would fetch it again. A logo that cannot be
 * loaded leaves the cards with the coloured mark.
 */
export async function embedRemoteLogo(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!type || !["image/svg+xml", "image/png", "image/jpeg", "image/gif"].includes(type))
      throw new Error(`unsupported type ${type ?? "(none)"}`);
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Sourcey: drawing social images without the logo ${url}: ${message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// OG card template
// ---------------------------------------------------------------------------

const WIDTH = 1200;
const HEIGHT = 630;

function rgbCss(triplet: string): string {
  return `rgb(${triplet.replace(/ /g, ", ")})`;
}

function rgbaCss(triplet: string, alpha: number): string {
  return `rgba(${triplet.replace(/ /g, ", ")}, ${alpha})`;
}

/** A title or summary too long for the card ends at the last whole word that fits. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const fits = text.slice(0, max - 1);
  const end = /\s/.test(text[max - 1]) ? fits.length : fits.search(/\s\S*$/);
  return `${(end > 0 ? fits.slice(0, end) : fits).replace(/[\s,;:.\u2013\u2014-]+$/, "")}\u2026`;
}

/**
 * The most characters of a word a title or summary line always holds: the card's
 * text column over the widest glyph, Inter Bold's W at 64px and Inter's at 26px.
 */
const TITLE_WORD = 15;
const SUMMARY_WORD = 40;

/**
 * A name longer than a line may be, with a break opportunity between its words:
 * before each camelCase hump, after an acronym and after an underscore, so a
 * name too wide for the card wraps between its words rather than inside one.
 * Shorter words, brand names among them, stay whole, as does each part of a path
 * short enough to fit between the slashes and hyphens a line already breaks at.
 */
function breakable(text: string, longest: number): string {
  return text.replace(/[^\s/-]+/g, (word) =>
    word.length <= longest
      ? word
      : word.replace(/(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=_)(?=.)/g, "\u200b"),
  );
}

/**
 * The card's ground: dark, with the primary colour glowing low on the left, in an
 * ellipse 70% of the card wide and 50% high that fades out by 70% of its radius.
 * It is one gradient drawn beneath the card, because satori draws a CSS gradient as
 * a masked pattern, which takes resvg three times as long as the rest of the card.
 */
function ground(color: string): string {
  const [cx, cy, rx, ry] = [0.2 * WIDTH, 0.7 * HEIGHT, 0.7 * WIDTH, 0.5 * HEIGHT];
  return (
    `<defs><radialGradient id="card-ground" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${rx}" ` +
    `gradientTransform="translate(${cx} ${cy}) scale(1 ${ry / rx}) translate(${-cx} ${-cy})">` +
    `<stop offset="0" stop-color="${rgbaCss(color, 0.18)}"/><stop offset="0.7" stop-color="transparent"/></radialGradient></defs>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#0f172a"/><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#card-ground)"/>`
  );
}

type OgCardInput = Omit<OgImageOptions, "theme"> & { primary: string };
function ogCard({ title, description, siteName, primary: color, logo, logoMark }: OgCardInput) {
  const primary = rgbCss(color);

  const displayTitle = breakable(clip(title, 90), TITLE_WORD);
  const displayDesc = description ? breakable(clip(description, 160), SUMMARY_WORD) : undefined;

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        // The padding sits inside the card's frame rather than around it.
        boxSizing: "border-box",
        padding: "72px",
        fontFamily: "Inter",
      },
      children: [
        // Brand block: logo (or coloured mark) + site name, top-left
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: "14px" },
            children: [
              logo
                ? {
                    type: "img",
                    props: {
                      src: logo,
                      ...logoBox(logo),
                      style: logoMark ? { borderRadius: "8px" } : {},
                    },
                  }
                : {
                    type: "div",
                    props: {
                      style: {
                        width: "14px",
                        height: "14px",
                        backgroundColor: primary,
                        borderRadius: "4px",
                      },
                    },
                  },
              // A logo is the full wordmark, so the name is not repeated beside it.
              ...(siteName && (!logo || logoMark)
                ? [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: 28,
                          fontWeight: 700,
                          color: "#ffffff",
                          letterSpacing: "-0.02em",
                        },
                        children: siteName,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
        // Middle: vertical accent bar + title + description
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flex: 1,
              alignItems: "center",
              marginTop: "48px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: "4px",
                    alignSelf: "stretch",
                    backgroundColor: primary,
                    borderRadius: "2px",
                    marginRight: "32px",
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", flex: 1 },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: 64,
                          fontWeight: 700,
                          color: "#ffffff",
                          lineHeight: 1.1,
                          letterSpacing: "-0.02em",
                          overflowWrap: "anywhere",
                          display: "-webkit-box",
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        },
                        children: displayTitle,
                      },
                    },
                    ...(displayDesc
                      ? [
                          {
                            type: "div",
                            props: {
                              style: {
                                fontSize: 26,
                                fontWeight: 400,
                                color: "#cbd5e1",
                                marginTop: "24px",
                                lineHeight: 1.4,
                                letterSpacing: "-0.005em",
                                overflowWrap: "anywhere",
                                display: "-webkit-box",
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              },
                              children: displayDesc,
                            },
                          },
                        ]
                      : []),
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateOgImage(options: OgImageOptions): Promise<Buffer> {
  const card: OgCardInput = {
    title: options.title,
    description: options.description,
    siteName: options.siteName,
    primary: options.theme.colors.primary,
    logo: options.logo,
    logoMark: options.logo ? options.logoMark : undefined,
  };
  const files = await cachedArtifacts(
    "og-image",
    JSON.stringify(card),
    ["satori", "@resvg/resvg-js"],
    async () => {
      const image = await heavyBuildJob(() =>
        drawCard({ card: ogCard(card), ground: ground(card.primary), width: WIDTH, height: HEIGHT }),
      );
      return new Map([["image.png", image]]);
    },
  );
  return files.get("image.png")!;
}
