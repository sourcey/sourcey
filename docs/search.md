---
title: Search
description: Full-text search built with the site, searched in the reader's browser with no service behind it.
---

Every build indexes the site, and search runs in the reader's browser: no search service, no account, and nothing sent anywhere. It needs no configuration.

Press <kbd>Ctrl</kbd> <kbd>K</kbd>, <kbd>⌘</kbd> <kbd>K</kbd> or <kbd>/</kbd>, or the search box in the header. Results come as you type, ranked by where the words appear, and forgive a typo. A page whose title is the query, singular or plural, comes first.

## What is searched

| Source | Searched as |
| --- | --- |
| Pages | Each page's title and whole text, and each heading as a place on the page |
| References | Each operation, by its summary, method, path and fields, and each schema |
| Changelogs | Each release |
| Generated references | Each package, type and symbol a Doxygen, Go or Rust reference publishes |

A versioned or translated site searches the release and language the reader is in.

## Before anything is typed

Search opens on where each part of the site starts, under each tab's name: the pages `search.featured` names, then each tab's sections in turn, their first pages, or a reference's overview and the first operation of each tag, five to a tab.

```ts
search: { featured: ["quickstart", "authentication"] },
```

## How it loads

Nothing loads until a reader first searches. The index is written in shards under `_search/`: the first search downloads the list of documents and the shards its words can match, and later searches fetch only the shards they need, so a large site's index is never downloaded whole. Search runs in a worker, beside the page rather than in its way, and waits for a pause in typing.
