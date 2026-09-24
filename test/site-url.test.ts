import { describe, expect, it } from "vitest";
import {
  joinHref,
  normalizeBaseUrl,
  normalizeSiteUrl,
  stripBaseUrl,
  toPrettyLink,
  toPublicPath,
  toPublicUrl,
} from "../src/site-url.js";

describe("site-url helpers", () => {
  it("normalizes public base paths consistently", () => {
    expect(normalizeBaseUrl(undefined)).toBe("");
    expect(normalizeBaseUrl("/")).toBe("");
    expect(normalizeBaseUrl("reference")).toBe("/reference/");
    expect(normalizeBaseUrl("/reference/")).toBe("/reference/");
  });

  it("builds public paths and absolute URLs with a baseUrl", () => {
    expect(toPublicPath("changelog.html", "/reference/")).toBe("/reference/changelog.html");
    expect(toPublicPath("changelog/1-2-0/index.html", "/reference/")).toBe("/reference/changelog/1-2-0/");
    expect(toPublicUrl("feed.xml", "https://docs.example.com", "/reference/")).toBe("https://docs.example.com/reference/feed.xml");
  });

  it("renders pretty URLs with slash mode", () => {
    expect(toPublicPath("docs/intro/index.html", "", "slash")).toBe("/docs/intro/");
    expect(toPublicPath("intro/index.html", "/ref/", "slash")).toBe("/ref/intro/");
    expect(toPublicPath("index.html", "", "slash")).toBe("/");
  });

  it("renders pretty URLs with strip mode", () => {
    expect(toPublicPath("docs/intro.html", "", "strip")).toBe("/docs/intro");
    expect(toPublicPath("docs/intro/index.html", "", "strip")).toBe("/docs/intro");
    expect(toPublicPath("intro/index.html", "/ref/", "strip")).toBe("/ref/intro");
    expect(toPublicPath("index.html", "/ref/", "strip")).toBe("/ref");
    expect(toPublicPath("index.html", "", "strip")).toBe("/");
    expect(toPublicUrl("docs/intro.html", "https://docs.example.com", "", "strip"))
      .toBe("https://docs.example.com/docs/intro");
  });

  it("links pages relative to the site base, and the strip-mode root under a base by its public path", () => {
    const strip = { prettyUrls: "strip", baseUrl: "/specification/" } as const;
    expect(toPrettyLink("profile.html", strip)).toBe("profile");
    expect(toPrettyLink("guide/index.html", strip)).toBe("guide");
    expect(toPrettyLink("index.html", strip)).toBe("/specification");
    expect(toPrettyLink("", strip)).toBe("/specification");
    expect(toPrettyLink("index.html", { prettyUrls: "strip", baseUrl: "" })).toBe("");
    expect(toPrettyLink("index.html", { prettyUrls: "slash", baseUrl: "/specification/" })).toBe("");
    expect(toPrettyLink("guide/index.html", { prettyUrls: "slash", baseUrl: "" })).toBe("guide/");
    expect(toPrettyLink("index.html", { prettyUrls: false, baseUrl: "/specification/" })).toBe("index.html");
  });

  it("joins link targets onto a page's base without leaving an empty href", () => {
    expect(joinHref("../", "profile")).toBe("../profile");
    expect(joinHref("/specification/", "profile")).toBe("/specification/profile");
    expect(joinHref("../", "/specification")).toBe("/specification");
    expect(joinHref("../", "")).toBe("../");
    expect(joinHref("", "")).toBe("./");
  });

  it("strips the configured baseUrl for dev routing", () => {
    expect(stripBaseUrl("/reference", "/reference/")).toBe("/");
    expect(stripBaseUrl("/reference/changelog.html", "/reference/")).toBe("/changelog.html");
    expect(stripBaseUrl("/changelog.html", "/reference/")).toBe("/changelog.html");
  });

  it("requires siteUrl to be an origin and not a path-prefixed URL", () => {
    expect(normalizeSiteUrl("https://docs.example.com/")).toBe("https://docs.example.com");
    expect(() => normalizeSiteUrl("https://docs.example.com/reference")).toThrow(/baseUrl/);
    expect(() => normalizeSiteUrl("/reference")).toThrow(/absolute http\(s\) URL/);
  });
});
