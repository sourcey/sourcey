---
title: Doxygen / C++ Docs
description: A C or C++ library's reference from Doxygen's XML.
---

A `doxygen()` tab draws a library's reference from Doxygen's XML: its classes, structs, functions, enums, typedefs, macros and their comments, beside your guides.

## Before you start

- Doxygen, set to write XML
- The XML folder it writes, usually `xml/` inside its output folder

## Setup

:::steps

1. Have Doxygen write XML
   In your `Doxyfile`:

   ```text
   GENERATE_XML = YES
   XML_OUTPUT   = xml
   ```

   Then run it:

   ```bash
   doxygen Doxyfile
   ```

2. Add a Doxygen tab

   ```ts
   import { defineConfig, doxygen, markdown } from "sourcey";

   export default defineConfig({
     name: "My C++ Library",
     navigation: {
       tabs: [
         {
           tab: "Documentation",
           slug: "",
           source: markdown({
             groups: [{ group: "Getting Started", pages: ["introduction"] }],
           }),
         },
         {
           tab: "C++ API",
           slug: "cpp",
           source: doxygen({ xml: "./doxygen-output/xml" }),
         },
       ],
     },
   });
   ```

3. Build it
   ```bash
   npx sourcey build
   ```

:::

[`sourcey init`](../cli/init.md) adds the tab for you when it finds a `Doxyfile`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `xml` | | The Doxygen XML folder |
| `language` | `"cpp"` | `"cpp"` for C and C++, or `"java"` |
| `groups` | `false` | `true` makes each Doxygen group (`@defgroup`) a section with an overview of its own; otherwise each namespace is a section |
| `index` | `"auto"` | The reference's opening page: `"rich"`, a card for each group with its description; `"structured"`, its types listed by group or namespace; `"flat"`, every type by kind; `"none"` or `false`, no opening page; `"auto"` chooses from what the XML holds |
| `sourceUrl` | | Where "Defined in" links lead: a base URL, a template with `{path}`, `{fullPath}` and `{line}`, a function, or a map of path prefixes to either. See [Sources](../configuration.md#sources) |

Each group, namespace and type gets a page. Functions, variables and macros at global scope that no group claims share a Globals page beside the overview.

Sourcey reads the XML with [moxygen](https://www.npmjs.com/package/moxygen), which comes with it, and draws its pages with the same layout, search and exports as every other page.
