import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";
import { z } from "zod";
import { openDocumentation } from "sourcey/documents";

const { version } = createRequire(import.meta.url)("./package.json");

export async function createDocsServer(directory) {
  const docs = await openDocumentation(directory);
  const server = new McpServer(
    { name: "sourcey-docs", version },
    {
      instructions:
        "Search the built documentation, then read the matching document. These are documentation examples; reading them does not invoke the documented API.",
    },
  );
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const results = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const uri = (id) => `sourcey://docs/${encodeURIComponent(id)}`;
  server.registerTool(
    "search_docs",
    {
      description:
        "Find guides, API operations, schemas and library reference in this documentation build.",
      inputSchema: {
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(20).default(10),
      },
      annotations,
    },
    async ({ query, limit }) =>
      results(docs.search(query, limit).map((entry) => ({ ...entry, resource: uri(entry.id) }))),
  );
  server.registerTool(
    "read_document",
    {
      description:
        "Read an exact document ID returned by search_docs. Preserves code, parameters and examples.",
      inputSchema: { id: z.string().min(1).max(2000) },
      annotations,
    },
    async ({ id }) => {
      const document = await docs.read(id);
      return { content: [{ type: "text", text: `${document.entry.url}\n\n${document.text}` }] };
    },
  );
  server.registerTool(
    "lookup_symbol",
    {
      description: "Find a Go, Rust or Doxygen symbol and its canonical page and anchor.",
      inputSchema: {
        name: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(20).default(10),
      },
      annotations,
    },
    async ({ name, limit }) => results(docs.symbols(name, limit)),
  );
  server.registerResource(
    "documentation-index",
    "sourcey://docs/index",
    {
      description: "The documentation index for this build.",
      mimeType: "application/json",
    },
    async (resource) => ({
      contents: [
        { uri: resource.href, mimeType: "application/json", text: JSON.stringify(docs.index) },
      ],
    }),
  );
  server.registerResource(
    "document",
    new ResourceTemplate("sourcey://docs/{id}", { list: undefined }),
    {
      description: "A readable documentation page, operation or schema.",
      mimeType: "text/markdown",
    },
    async (resource, { id }) => {
      const document = await docs.read(decodeURIComponent(Array.isArray(id) ? id.join("") : id));
      return { contents: [{ uri: resource.href, mimeType: "text/markdown", text: document.text }] };
    },
  );
  return server;
}
