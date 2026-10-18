#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDocsServer } from "./server.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(
    "Usage: sourcey-docs-mcp <built-docs-directory>\n\nServes a Sourcey documents.json build over MCP stdio. Run sourcey build first.\n",
  );
} else {
  try {
    if (!process.argv[2] || process.argv.length !== 3)
      throw new Error("Usage: sourcey-docs-mcp <built-docs-directory>");
    const server = await createDocsServer(process.argv[2]);
    await server.connect(new StdioServerTransport());
  } catch (error) {
    process.stderr.write(`sourcey-docs-mcp: ${error.message}\n`);
    process.exitCode = 1;
  }
}
