import { describe, expect, it } from "vitest";
import {
  findPlaceholderServerUrls,
  isPlaceholderServerUrl,
} from "../../src/utils/server-warnings.js";

describe("server warning helpers", () => {
  it("detects placeholder hosts used by quick-build examples", () => {
    expect(isPlaceholderServerUrl("http://localhost:3000/v1")).toBe(true);
    expect(isPlaceholderServerUrl("https://127.0.0.1/api")).toBe(true);
    expect(isPlaceholderServerUrl("https://example.com/api")).toBe(true);
    expect(isPlaceholderServerUrl("https://api.example.com/v1")).toBe(true);
  });

  it("ignores relative and production-looking server URLs", () => {
    expect(isPlaceholderServerUrl("/api/v3")).toBe(false);
    expect(isPlaceholderServerUrl("https://api.sourcey.com/v1")).toBe(false);
  });

  it("returns unique placeholder server URLs from a normalized spec", () => {
    expect(
      findPlaceholderServerUrls({
        servers: [
          { url: "http://localhost:3000" },
          { url: "http://localhost:3000" },
          { url: "https://api.sourcey.com" },
          { url: "https://example.net" },
        ],
      }),
    ).toEqual(["http://localhost:3000", "https://example.net"]);
  });
});
