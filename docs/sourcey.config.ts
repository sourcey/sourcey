import { defineConfig, markdown } from "sourcey";

const repo = "https://github.com/sourcey/sourcey";

export default defineConfig({
  name: "Sourcey",
  siteUrl: "https://sourcey.com",
  baseUrl: "/docs",
  repo,
  discovery: { ard: true },
  brokenLinks: "error",
  theme: {
    name: "default",
    colors: {
      primary: "#0f766e",
    },
  },
  navigation: {
    tabs: [
      {
        tab: "Docs",
        slug: "",
        source: markdown({
          groups: [
            { group: "Start here", pages: ["introduction", "quickstart", "install", "project"] },
            { group: "Content", pages: ["pages", "components", "navigation", "versions", "languages"] },
            { group: "Sources", pages: ["adapters/openapi", "try-it", "adapters/mcp", "adapters/rustdoc"] },
            { group: "The site", pages: ["configuration", "themes", "search", "machine-readable", "deploying"] },
            { group: "Command line", pages: ["cli/init", "cli/dev", "cli/build", "cli/check", "cli/validate", "cli/migrate", "cli/godoc"] },
            {
              group: "Guides",
              pages: [
                "guides/first-site",
                "guides/custom-branding",
                "guides/multi-tab-sites",
                "guides/mcp-docs",
                "guides/mcp-snapshot",
                "guides/godoc-go",
                "guides/doxygen-cpp",
                "guides/embedding",
                "guides/langchain-retriever",
              ],
            },
            { group: "Migrating", pages: ["migrating", "migrating/astro", "migrating/mkdocs", "migrating/docusaurus", "migrating/mintlify"] },
            { group: "Project", pages: ["roadmap"] },
          ],
        }),
      },
      {
        tab: "Changelog",
        slug: "changelog",
        routes: { changelog: "index" },
        source: markdown({ root: "..", groups: [{ group: "Releases", pages: ["CHANGELOG"] }] }),
      },
    ],
  },
  navbar: {
    links: [{ type: "github", href: repo }],
    primary: {
      type: "button",
      label: "Documentation",
      href: "https://sourcey.com/docs",
    },
  },
  footer: {
    links: [{ type: "github", href: repo }],
  },
});
