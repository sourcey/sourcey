import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSourceySite, writeSourceySite } from "../../src/site.js";
import { resolveConfigFromRaw } from "../../src/config.js";

it("serves current Markdown, context, contracts and discovery over the real CLI dev server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sourcey-dev-exports-"));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const config = join(dir, "sourcey.config.ts");
  await writeFile(
    join(dir, "guide.md"),
    '# Guide\n\nFirst revision.\n\n```sh\necho "$VALUE"\n```\n',
  );
  await writeFile(
    config,
    `export default { name:'Docs proof',siteUrl:'https://docs.example.com',baseUrl:'/docs',theme:{fonts:{google:false}},discovery:{ard:true,apiCatalog:true},exports:{openapi:true},navigation:{tabs:[{tab:'Guides',slug:'',groups:[{group:'Start',pages:['guide']}]},{tab:'API',openapi:${JSON.stringify(resolve(import.meta.dirname, "../fixtures/cheese.yml"))}}]}};`,
  );
  const child = spawn(
    process.execPath,
    [
      resolve(import.meta.dirname, "../../dist/cli.js"),
      "dev",
      "--config",
      config,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
    ],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (data) => (logs += data));
  child.stderr.on("data", (data) => (logs += data));
  const until = async (path: string, includes: string) => {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      const result = await fetch(origin + path)
        .then(async (response) => ({ response, text: await response.text() }))
        .catch(() => null);
      if (result?.response.ok && result.text.includes(includes)) return result;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`Did not serve ${path}: ${logs}`);
  };
  try {
    const guide = await until("/docs/guide.md", "First revision.");
    expect(guide.response.headers.get("content-type")).toContain("text/markdown");
    expect(guide.text).toContain('echo "$VALUE"');
    await until("/docs/llms-full.txt", "First revision.");
    await until("/docs/ard.json", '"entries"');
    await until("/docs/api/openapi.json", '"openapi"');
    const catalog = await until("/docs/api-catalog.json", '"linkset"');
    expect(catalog.response.headers.get("content-type")).toContain("application/linkset+json");
    const head = await fetch(origin + "/docs/api-catalog.json", { method: "HEAD" });
    expect(head.headers.get("link")).toContain('rel="api-catalog"');
    expect(await head.text()).toBe("");
    await writeFile(join(dir, "guide.md"), "# Guide\n\nSecond revision.\n");
    await until("/docs/guide.md", "Second revision.");
    const full = await until("/docs/llms-full.txt", "Second revision.");
    expect(full.text).not.toContain("First revision.");
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((done) =>
      child.exitCode !== null ? done() : child.once("exit", () => done()),
    );
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("adds no client JavaScript and removes exports when disabled in a subsequent build", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sourcey-static-exports-"));
  try {
    const configDir = resolve(import.meta.dirname, "../llms-site");
    const raw = {
      name: "Build proof",
      theme: { fonts: { google: false } },
      navigation: {
        tabs: [{ tab: "Docs", slug: "", groups: [{ group: "Start", pages: ["introduction"] }] }],
      },
    };
    const withExports = await buildSourceySite({
      config: await resolveConfigFromRaw(raw, configDir),
      outputDir: dir,
      generateOgImages: false,
    });
    await writeSourceySite(withExports);
    const client = await readFile(join(dir, "sourcey.js"));
    expect(await readFile(join(dir, "introduction.md"), "utf8")).toContain("Welcome to Mixed Docs");
    const withoutExports = await buildSourceySite({
      config: await resolveConfigFromRaw({ ...raw, exports: false }, configDir),
      outputDir: dir,
      generateOgImages: false,
    });
    await writeSourceySite(withoutExports);
    expect(await readFile(join(dir, "sourcey.js"))).toEqual(client);
    await expect(readFile(join(dir, "introduction.md"))).rejects.toThrow();
    await expect(readFile(join(dir, "documents.json"))).rejects.toThrow();
    await expect(readFile(join(dir, "llms-full.txt"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
