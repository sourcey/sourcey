import { describe, it, expect } from "vitest";
import { slugify } from "../../src/utils/slug.js";

describe("slugify", () => {
  it("converts simple strings", () => {
    expect(slugify("Pet")).toBe("pet");
    expect(slugify("my-path")).toBe("my-path");
  });

  it("replaces special characters with hyphens", () => {
    expect(slugify("/pets/{petId}")).toBe("pets-petid");
  });

  it("strips leading/trailing hyphens", () => {
    expect(slugify("/hello/")).toBe("hello");
  });

  it("collapses multiple special chars", () => {
    expect(slugify("a  b--c")).toBe("a-b-c");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});
