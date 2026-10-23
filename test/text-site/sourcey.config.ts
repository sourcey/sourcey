import { defineConfig, markdown, openapi } from "sourcey";

// Every kind of text the build writes, from content that holds quotes, an
// apostrophe, ampersands and angle brackets in prose, headings and code.
export default defineConfig({
  name: "Text Fixture",
  siteUrl: "https://docs.example.com",
  navigation: {
    tabs: [
      {
        tab: "Docs",
        slug: "",
        source: markdown({ groups: [{ group: "Start", pages: ["introduction", "notes", "CHANGELOG"] }] }),
      },
      { tab: "API", slug: "api", source: openapi("./api.yaml") },
    ],
  },
});
