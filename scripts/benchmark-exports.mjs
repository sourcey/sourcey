import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { generateExports } from "../dist/exports/index.js";
import { configFromSpec } from "../dist/config.js";
import { buildSiteConfig, createMinimalSpec } from "../dist/site-assembly.js";

const count = Number(process.argv[2]);
if (!count) {
  const reports = [100, 1000, 10000].map((size) => {
    const child = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), String(size)], { encoding: "utf8" });
    if (child.status !== 0) throw new Error(child.stderr);
    return JSON.parse(child.stdout);
  });
  console.log(JSON.stringify({ phase: "export projection only; excludes parsing, HTML rendering and disk writes", reports }, null, 2));
} else {
  const config = configFromSpec(resolve("test/fixtures/cheese.yml"));
  config.name = "Benchmark";
  config.siteUrl = "https://docs.example.com";
  config.discovery.ard = true;
  config.tabs = [];
  const site = await buildSiteConfig(config);
  const spec = createMinimalSpec();
  const prose = "The cursor comes from the previous response. Keep its value unchanged and stop when the next cursor is absent. ".repeat(10);
  const pages = Array.from({ length: count }, (_, i) => ({
    outputPath: `guides/page-${i}.html`, tabSlug: "guides", pageSlug: `page-${i}`, spec,
    currentPage: { kind: "markdown", markdown: { kind: "markdown", title: `Guide ${i}`, description: "Read a page of results.", slug: `page-${i}`, html: "", markdown: `# Guide ${i}\n\n${prose}\n\n\`\`\`sh\ncurl \"$API/items?cursor=$CURSOR\"\n\`\`\`\n`, headings: [], sourcePath: `guides/page-${i}.md` } },
  }));
  const assembled = { pageMap: new Map(pages.map((page) => [page.outputPath, page])), extraFiles: new Map(), publicSpecs: new Map(), specsBySlug: new Map() };
  const navigation = { tabs: [{ slug: "guides", label: "Guides", groups: [] }] };
  global.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  const generated = generateExports(assembled, pages, navigation, site, config);
  const elapsed = performance.now() - start;
  const after = process.memoryUsage();
  const bytes = [...generated.files.values()].reduce((sum, body) => sum + Buffer.byteLength(body), 0);
  console.log(JSON.stringify({ pages: count, milliseconds: Math.round(elapsed * 10) / 10, files: generated.files.size, outputMiB: Math.round(bytes / 10485.76) / 100, heapDeltaMiB: Math.round((after.heapUsed - before.heapUsed) / 104857.6) / 10, rssMiB: Math.round(after.rss / 104857.6) / 10 }));
}
