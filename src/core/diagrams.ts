import { HelperProcess } from "./helper-process.js";
import { createHash } from "node:crypto";
import { heavyBuildJob } from "./build-jobs.js";
import { cachedArtifacts } from "./artifact-cache.js";
/** The renderer could not read a diagram's source: a type it does not draw, or invalid syntax. */
export class DiagramSourceError extends Error {
  override name = "DiagramSourceError";
}
/** Mermaid draws in a process of its own: it loads a DOM and the whole Mermaid library to parse a diagram. */
const renderer = new HelperProcess<{ source: string }, { svg?: string; error?: string }>(new URL("./diagram-worker.js", import.meta.url));
let diagramQueue = Promise.resolve();
/** What a diagram's SVG keeps: shapes, text, links, their presentation, and the style that names its colours. */
const SVG_CONTENT = {
  allowedTags: [
    "svg",
    "style",
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
      "paint-order",
      "opacity",
      "transform",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "text-anchor",
      "text-decoration",
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
      "data-*",
    ],
  },
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
  allowedSchemes: ["http", "https", "mailto"],
  // The renderer writes the style itself, naming the theme's colours; no label reaches it.
  allowVulnerableTags: true,
};

/**
 * A diagram drawn once for every theme: its colours are CSS variables the
 * page sets (`--diagram-bg`, `--diagram-fg`) and its text is set in Inter.
 */
export async function diagramSvg(source: string): Promise<string> {
  const files = await cachedArtifacts(
    "diagram",
    createHash("sha256").update(source).digest("hex"),
    ["@sourcey/beautiful-mermaid", "jsdom", "mermaid", "sanitize-html"],
    async () => {
      const job = diagramQueue.then(() =>
        heavyBuildJob(async () => {
          const reply = await renderer.request({ source });
          if (reply.error !== undefined) throw new DiagramSourceError(reply.error);
          return reply.svg!;
        }),
      );
      diagramQueue = job.then(
        () => undefined,
        () => undefined,
      );
      const { default: sanitizeHtml } = await import("sanitize-html");
      return new Map([["diagram.svg", Buffer.from(sanitizeHtml(await job, SVG_CONTENT))]]);
    },
  );
  return files.get("diagram.svg")!.toString();
}

/** Ends the renderer and gives back what it held; the next diagram starts another. */
export async function closeDiagramRenderer(): Promise<void> {
  await renderer.close();
}
