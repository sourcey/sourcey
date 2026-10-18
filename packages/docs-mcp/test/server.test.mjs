import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio client can discover, search, read and resolve symbols without invoking APIs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sourcey-docs-mcp-"));
  const client = new Client({ name: "docs-proof", version: "1" });
  try {
    await mkdir(join(directory, "api"));
    const entry = {
      id: "api/read.md",
      kind: "operation",
      title: "GET /cheeses",
      description: "Read a cheese",
      tab: "api",
      url: "https://example.com/api#read",
      markdown: "https://example.com/api/read.md",
      file: "api/read.md",
      symbols: [{ name: "Widget.Publish", kind: "method", anchor: "publish" }],
    };
    await writeFile(
      join(directory, "documents.json"),
      JSON.stringify({ version: 1, name: "Cheese", documents: [entry] }),
    );
    await writeFile(
      join(directory, entry.file),
      '# GET /cheeses\n\n```sh\ncurl "$API/cheeses"\n```\n',
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../cli.js", import.meta.url)), directory],
      stderr: "pipe",
    });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 3);
    const search = await client.callTool({ name: "search_docs", arguments: { query: "cheeses" } });
    const match = JSON.parse(search.content[0].text)[0];
    assert.equal(match.id, entry.id);
    const read = await client.callTool({ name: "read_document", arguments: { id: match.id } });
    assert.match(read.content[0].text, /curl "\$API\/cheeses"/);
    const resource = await client.readResource({ uri: match.resource });
    assert.match(resource.contents[0].text, /```sh/);
    const symbol = await client.callTool({
      name: "lookup_symbol",
      arguments: { name: "Widget.Publish" },
    });
    assert.equal(JSON.parse(symbol.content[0].text)[0].document, entry.id);
    assert.equal((await client.listResources()).resources.length, 1);
    const unknown = await client.callTool({
      name: "read_document",
      arguments: { id: "../../secret.md" },
    });
    assert.equal(unknown.isError, true);
    const invalid = await client.callTool({
      name: "search_docs",
      arguments: { query: "cheese", limit: 10000 },
    });
    assert.equal(invalid.isError, true);
    await rm(join(directory, entry.file));
    await symlink(fileURLToPath(import.meta.url), join(directory, entry.file));
    const escaped = await client.callTool({ name: "read_document", arguments: { id: entry.id } });
    assert.equal(escaped.isError, true);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
