import { defineConfig, godoc, markdown } from "sourcey";

export default defineConfig({
  name: "Sourcey",
  siteUrl: "https://sourcey.com",
  baseUrl: "/docs",
  discovery: { ard: true },
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
            {
              group: "Start Here",
              pages: ["introduction", "install", "configuration", "versions", "languages", "components", "try-it", "machine-readable"],
            },
            {
              group: "Migrating",
              pages: ["migrating", "migrating/astro", "migrating/mkdocs", "migrating/docusaurus", "migrating/mintlify"],
            },
            {
              group: "Project",
              pages: ["roadmap", "changelog"],
            },
            {
              group: "References",
              pages: ["gin-reference"],
            },
          ],
        }),
      },
      {
        tab: "Gin reference",
        slug: "gin-api",
        source: godoc({
          module: "./gin-src",
          packages: ["./..."],
          mode: "snapshot",
          snapshot: "./gin-reference.godoc.json",
          includeTests: true,
          sourceBasePath: "",
        }),
      },
    ],
  },
  navbar: {
    links: [{ type: "github", href: "https://github.com/sourcey/sourcey" }],
    primary: {
      type: "button",
      label: "Documentation",
      href: "https://sourcey.com/docs",
    },
  },
  footer: {
    socials: {
      github: "https://github.com/sourcey/sourcey",
    },
  },
});
