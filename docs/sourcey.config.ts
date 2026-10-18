import { defineConfig, markdown } from "sourcey";

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
              pages: ["introduction", "install", "configuration", "machine-readable"],
            },
            {
              group: "Project",
              pages: ["roadmap", "changelog"],
            },
          ],
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
