import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { resolveConfigFromRaw } from "../src/config.js";
import { closeCardDrawer, drawCard } from "../src/og/draw-card.js";
import { embedRemoteLogo, generateOgImage } from "../src/og/generate-og-image.js";

vi.mock("../src/og/draw-card.js", async (original) => {
  const module = await original<typeof import("../src/og/draw-card.js")>();
  return { ...module, drawCard: vi.fn(module.drawCard) };
});

describe("social image rendering", () => {
  it("draws the card on its dark ground, the primary colour glowing low on the left", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-ground-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      const png = await generateOgImage({
        title: "Ground",
        siteName: `Ground ${root.split("-").at(-1)}`,
        theme: { ...config.theme, colors: { ...config.theme.colors, primary: "220 20 20" } },
      });
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([1200, 630]);
      const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
      for (const [x, y] of [[1199, 0], [1000, 441]]) expect(pixel(x, y)).toEqual([15, 23, 42]);
      const [red, green, blue] = pixel(240, 441);
      expect(red).toBeGreaterThan(45);
      expect([green, blue]).toEqual([expect.closeTo(23, -1), expect.closeTo(42, -1)]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("wraps a name too wide for a line between its words, inside the card and beside its bar", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-name-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      vi.mocked(drawCard).mockClear();
      const png = await generateOgImage({
        title: "AccountingTemplatePreviewRequestDTO",
        description: "Built with JavaScript.",
        siteName: `Name ${root.split("-").at(-1)}`,
        theme: { ...config.theme, colors: { ...config.theme.colors, primary: "220 20 20" } },
      });
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
      const ink = (x0: number, x1: number, y: number) => {
        for (let x = x0; x < x1; x++) if (pixel(x, y).every((channel) => channel > 128)) return true;
        return false;
      };
      const rows = Array.from({ length: 630 - 140 }, (_, i) => 140 + i);
      expect(pixel(73, 315)[0]).toBeGreaterThan(150);
      // Nothing is drawn in the right margin, and the name takes two lines of the column.
      expect(rows.some((y) => ink(1129, 1200, y))).toBe(false);
      const lines = rows.filter((y) => ink(108, 1129, y) && !ink(108, 1129, y - 1));
      expect(lines).toHaveLength(3);
      // The name may break only between its words; a word that fits a line stays whole.
      const text = JSON.stringify(vi.mocked(drawCard).mock.calls[0][0].card);
      expect(text).toContain("Accounting​Template​Preview​Request​DTO");
      expect(text).toContain("Built with JavaScript.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("draws again after the drawer is closed, as each build closes it", async () => {
    const card = { type: "div", props: { style: { display: "flex", width: "100%", height: "100%" }, children: "Closed" } };
    const ground = '<rect width="1200" height="630" fill="#0f172a"/>';
    const first = await drawCard({ card, ground, width: 1200, height: 630 });
    await closeCardDrawer();
    expect(await drawCard({ card, ground, width: 1200, height: 630 })).toEqual(first);
    await closeCardDrawer();
  });

  it("reuses the rendered card and changes it only when a visual input changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-fixture-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      const input = {
        title: "Field reference",
        description: "The declared inputs and their constraints.",
        siteName: `Fixture ${root.split("-").at(-1)}`,
        theme: config.theme,
      };
      vi.mocked(drawCard).mockClear();
      const first = await generateOgImage(input);
      expect(drawCard).toHaveBeenCalledTimes(1);
      const unrelated = {
        ...input,
        theme: { ...input.theme, fonts: { ...input.theme.fonts, sans: "system-ui" } },
      };
      expect(await generateOgImage(unrelated)).toEqual(first);
      expect(drawCard).toHaveBeenCalledTimes(1);
      const title = await generateOgImage({ ...input, title: "Updated field reference" });
      const color = await generateOgImage({
        ...input,
        theme: { ...input.theme, colors: { ...input.theme.colors, primary: "220 20 20" } },
      });
      const logo = await generateOgImage({
        ...input,
        logo:
          "data:image/svg+xml;base64," +
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="red"/></svg>',
          ).toString("base64"),
      });
      for (const image of [title, color, logo]) expect(image.equals(first)).toBe(false);
      expect(await generateOgImage(input)).toEqual(first);
      expect(drawCard).toHaveBeenCalledTimes(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("draws a logo at its own proportions, with the name beside a mark and never beside a wordmark", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-logo-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      const svg = (width: number, height: number) =>
        `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="red"/></svg>`).toString("base64")}`;
      const input = { title: "Logos", siteName: `Logo ${root.split("-").at(-1)}`, theme: config.theme };
      type Node = { type?: string; props?: { src?: string; width?: number; height?: number; children?: unknown } };
      const nodes = (node: unknown): Node[] => {
        if (!node || typeof node !== "object") return [];
        const children = (node as Node).props?.children;
        return [node as Node, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
      };
      vi.mocked(drawCard).mockClear();
      await generateOgImage({ ...input, logo: svg(500, 100) });
      await generateOgImage({ ...input, logo: svg(64, 64), logoMark: true });
      await generateOgImage({ ...input, logo: svg(2000, 50) });
      const cards = vi.mocked(drawCard).mock.calls.map(([drawing]) => nodes(drawing.card));
      const logo = (card: Node[]) => card.find((node) => node.type === "img")?.props;
      const named = (card: Node[]) => card.some((node) => node.props?.children === input.siteName);
      expect(logo(cards[0])).toMatchObject({ width: 240, height: 48 });
      expect(named(cards[0])).toBe(false);
      expect(logo(cards[1])).toMatchObject({ width: 48, height: 48 });
      expect(named(cards[1])).toBe(true);
      expect(logo(cards[2])).toMatchObject({ width: 480, height: 12 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ends a title or summary too long for the card at a whole word", async () => {
    const root = await mkdtemp(join(tmpdir(), "sourcey-og-clip-"));
    try {
      const config = await resolveConfigFromRaw({ navigation: { tabs: [] } }, root);
      const description = "The Tommy API is organized around the REST methodology, and it uses resource-oriented URLs, and common HTTP response codes to indicate API errors. All requests are authenticated.";
      const title = `${"Reference ".repeat(9)}overview`;
      const texts = (node: unknown): string[] => {
        if (typeof node === "string") return [node];
        if (!node || typeof node !== "object") return [];
        const children = (node as { props?: { children?: unknown } }).props?.children;
        return (Array.isArray(children) ? children : [children]).flatMap(texts);
      };
      vi.mocked(drawCard).mockClear();
      await generateOgImage({ title, description, siteName: `Clip ${root.split("-").at(-1)}`, theme: config.theme });
      const drawn = texts(vi.mocked(drawCard).mock.calls[0][0].card);
      expect(drawn).toContain("The Tommy API is organized around the REST methodology, and it uses resource-oriented URLs, and common HTTP response codes to indicate API errors. All requests\u2026");
      expect(drawn).toContain(`${"Reference ".repeat(8)}Reference\u2026`);
      expect(drawn.every((text) => text.length <= 160)).toBe(true);
      // A title with no space to end at is cut where it fits.
      await generateOgImage({ title: "x".repeat(120), siteName: `Clip ${root.split("-").at(-1)}`, theme: config.theme });
      expect(texts(vi.mocked(drawCard).mock.calls[1][0].card)).toContain(`${"x".repeat(89)}\u2026`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("draws a logo named by URL, as served with a charset, and leaves the mark when it cannot load", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="red"/></svg>';
    const server = createServer((request, response) => {
      if (request.url !== "/logo.svg") return void response.writeHead(404).end();
      response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" }).end(svg);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const logo = await embedRemoteLogo(`${origin}/logo.svg`);
      expect(logo).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
      expect(warn).not.toHaveBeenCalled();
      expect(await embedRemoteLogo(`${origin}/missing.svg`)).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("HTTP 404");
    } finally {
      warn.mockRestore();
      await new Promise((done) => server.close(done));
    }
  });
});
