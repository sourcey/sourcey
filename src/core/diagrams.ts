import { HelperProcess } from "./helper-process.js";
import { createHash } from "node:crypto";
import { heavyBuildJob } from "./build-jobs.js";
import { cachedArtifacts } from "./artifact-cache.js";
/** The renderer could not read a diagram's source: a type it does not draw, or invalid syntax. */
export class DiagramSourceError extends Error {
  override name = "DiagramSourceError";
}
/** Mermaid draws in a process of its own: it loads a DOM and the whole Mermaid library to parse a diagram. */
const renderer = new HelperProcess<
  { source: string; prefixes: { light: string; dark: string } },
  { light?: string; dark?: string; error?: string }
>(new URL("./diagram-worker.js", import.meta.url));
let diagramQueue = Promise.resolve();
/** What a diagram's SVG keeps: shapes, text, links and their presentation. */
const SVG_CONTENT = {
  allowedTags: [
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "marker",
    "clipPath",
    "title",
    "desc",
    "a",
  ],
  allowedAttributes: {
    "*": [
      "id",
      "class",
      "xmlns",
      "width",
      "height",
      "viewBox",
      "x",
      "y",
      "x1",
      "x2",
      "y1",
      "y2",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "d",
      "points",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "stroke-linecap",
      "stroke-linejoin",
      "opacity",
      "transform",
      "font-family",
      "font-size",
      "font-weight",
      "text-anchor",
      "dominant-baseline",
      "dy",
      "dx",
      "marker-end",
      "marker-start",
      "markerWidth",
      "markerHeight",
      "markerUnits",
      "refX",
      "refY",
      "orient",
      "clip-path",
      "href",
      "target",
      "rel",
      "style",
    ],
  },
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
  allowedSchemes: ["http", "https", "mailto"],
};
/** Each theme's drawing names its parts apart, by the source and the theme. */
const prefix = (source: string, dark: boolean) =>
  `diagram-${createHash("sha256")
    .update(JSON.stringify([source, dark]))
    .digest("hex")
    .slice(0, 16)}`;

/** A diagram in the light and dark themes, drawn from one reading and one layout of its source. */
export async function diagramSvgs(source: string): Promise<{ light: string; dark: string }> {
  const files = await cachedArtifacts(
    "diagram",
    createHash("sha256").update(source).digest("hex"),
    ["@speajus/mermaid-to-svg", "mermaid", "sanitize-html"],
    async () => {
      const job = diagramQueue.then(() =>
        heavyBuildJob(async () => {
          const reply = await renderer.request({
            source,
            prefixes: { light: prefix(source, false), dark: prefix(source, true) },
          });
          if (reply.error !== undefined) throw new DiagramSourceError(reply.error);
          return { light: reply.light!, dark: reply.dark! };
        }),
      );
      diagramQueue = job.then(
        () => undefined,
        () => undefined,
      );
      const { default: sanitizeHtml } = await import("sanitize-html");
      const { light, dark } = await job;
      return new Map([
        ["light.svg", Buffer.from(sanitizeHtml(light, SVG_CONTENT))],
        ["dark.svg", Buffer.from(sanitizeHtml(dark, SVG_CONTENT))],
      ]);
    },
  );
  return { light: files.get("light.svg")!.toString(), dark: files.get("dark.svg")!.toString() };
}

/** Ends the renderer and gives back what it held; the next diagram starts another. */
export async function closeDiagramRenderer(): Promise<void> {
  await renderer.close();
}
