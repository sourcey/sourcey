---
title: Build Ask AI with Sourcey and LangChain
description: Implement your own Ask AI feature over a Sourcey docs site.
---

The Sourcey retriever finds the pages, operations and schemas that answer a question and supplies each as a LangChain document, with its browser URL kept as the citation source.

Sourcey already ships the files a retriever needs:

- `documents.json`, its index of every page, operation and schema
- each document's own Markdown
- stable page URLs

Publish the static docs and point the retriever at their root URL. It can read the files from your existing host.

## Install

Python:

```bash
pip install -U langchain-sourcey
```

JavaScript:

```bash
npm install langchain-sourcey @langchain/core
```

## What it reads

Both `langchain-sourcey` packages work against a published Sourcey docs root.

It uses:

- `documents.json` to find candidates: each page, and each operation and schema of an API reference, is a match of its own
- each match's own Markdown for its content
- the page URL as the LangChain citation source

When a document's Markdown cannot be read, it uses the page in `llms-full.txt`, then the text of the page's HTML. A site built before Sourcey 3.7.1 publishes `search-index.json` in place of `documents.json`, and the retriever reads that instead.

The same [document index and readable exports](../machine-readable.md#default-outputs) serve any client of your own. For an MCP client, the [separate docs MCP package](../machine-readable.md#query-built-docs-over-mcp) searches and reads the built index directly.

## Quickstart

Python:

```python
from langchain_sourcey import SourceyRetriever

retriever = SourceyRetriever(
    site_url="https://sourcey.com/docs",
    top_k=3,
)

docs = retriever.invoke("mcp integration")

for doc in docs:
    print(doc.metadata["title"])
    print(doc.metadata["source"])
    print(doc.page_content[:160])
    print()
```

`site_url` should be the root of a published Sourcey build:

- `https://sourcey.com/docs`
- `https://sourcey.com/cheesestore`
- `https://cheesestore.github.io`

JavaScript:

```typescript
import { SourceyRetriever } from "langchain-sourcey";

const retriever = new SourceyRetriever({
  siteUrl: "https://sourcey.com/docs",
  topK: 3,
});

const docs = await retriever.invoke("mcp integration");

for (const doc of docs) {
  console.log(doc.metadata.title);
  console.log(doc.metadata.source);
  console.log(doc.pageContent.slice(0, 160));
  console.log();
}
```

## Implement Ask AI

Install a chat model package. This example uses OpenAI.

Python:

```bash
pip install -U langchain-openai
```

```python
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_openai import ChatOpenAI

from langchain_sourcey import SourceyRetriever

retriever = SourceyRetriever(site_url="https://sourcey.com/docs", top_k=3)

prompt = ChatPromptTemplate.from_template(
    """Answer the question using the documentation context below.

{context}

Question: {question}"""
)

chain = (
    RunnablePassthrough.assign(context=(lambda x: x["question"]) | retriever)
    | prompt
    | ChatOpenAI(model="gpt-4.1-mini")
    | StrOutputParser()
)

print(chain.invoke({"question": "How does Sourcey document MCP servers?"}))
```

JavaScript:

```bash
npm install @langchain/openai
```

```typescript
import type { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { SourceyRetriever } from "langchain-sourcey";

const retriever = new SourceyRetriever({
  siteUrl: "https://sourcey.com/docs",
  topK: 3,
});

const prompt = ChatPromptTemplate.fromTemplate(
  `Answer the question using the documentation context below.

{context}

Question: {question}`
);

const formatDocs = (docs: Document[]) =>
  docs.map((doc) => doc.pageContent).join("\n\n");

const chain = RunnableSequence.from([
  {
    context: retriever.pipe(formatDocs),
    question: new RunnablePassthrough(),
  },
  prompt,
  new ChatOpenAI({ model: "gpt-4.1-mini" }),
  new StringOutputParser(),
]);

console.log(await chain.invoke("How does Sourcey document MCP servers?"));
```

## The contract

If you want this to work cleanly on your own docs site, keep these stable:

- publish `documents.json` and each document's Markdown, as a build does by default
- set `siteUrl` so page URLs are canonical

That is the whole trick. Sourcey emits the retrieval surface as part of the
normal docs build, so the LangChain integration stays thin.

## Package

- PyPI: [langchain-sourcey](https://pypi.org/project/langchain-sourcey/)
- npm: [langchain-sourcey](https://www.npmjs.com/package/langchain-sourcey)
- GitHub: [sourcey/langchain-sourcey](https://github.com/sourcey/langchain-sourcey)
