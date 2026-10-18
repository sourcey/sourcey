# Sourcey docs MCP server

Search and read a built Sourcey documentation directory over MCP stdio.

```sh
sourcey build
npx sourcey-docs-mcp /absolute/path/to/dist
```

Requires Sourcey 3.7.1 or newer with Markdown exports enabled. The directory must contain `documents.json` and its referenced Markdown files.

The server provides:

- `search_docs`: find guides, API operations, schemas and library reference.
- `read_document`: read an exact document ID returned by search.
- `lookup_symbol`: find a library symbol and its canonical page and anchor.
- `sourcey://docs/index`: the documentation index.
- `sourcey://docs/{id}`: an individual document, with its ID URI-encoded.

It reads the index at startup and document bodies on demand. Restart the server after replacing a build. Only files listed in the index and contained inside the build directory can be read. The server does not invoke documented APIs.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "project-docs": {
      "command": "npx",
      "args": ["-y", "sourcey-docs-mcp", "/absolute/path/to/dist"]
    }
  }
}
```

The MCP SDK stays in this package; static Sourcey builds and browser pages do not depend on it. [Export configuration](https://sourcey.com/docs/context-exports).
