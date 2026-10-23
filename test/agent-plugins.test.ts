import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const pkg = json("package.json");

// Each agent host reads its own manifest; together they ship one plugin, the Sourcey skill.
const manifests = [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".grok-plugin/plugin.json", "plugin.json", "gemini-extension.json"];

describe("agent plugins", () => {
  it("ship the Sourcey skill under one name, at the package's version, to every host", () => {
    const [first, ...rest] = manifests.map(json);
    expect(first).toMatchObject({ name: "sourcey-docs", version: pkg.version });
    for (const manifest of rest) expect(manifest).toMatchObject({ name: first.name, version: pkg.version, description: first.description });
    const skill = readFileSync(new URL("skills/sourcey/SKILL.md", root), "utf8");
    expect(skill).toMatch(/^---\nname: sourcey\ndescription: .+\n---\n/);
  });

  it("list the plugin in the repository's own Claude marketplace, and the skill in the npm package", () => {
    const marketplace = json(".claude-plugin/marketplace.json");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "sourcey-docs", source: "./" })]);
    expect(pkg.files).toContain("skills");
    for (const path of [json(".cursor-plugin/plugin.json").logo, json("plugin.json").extensions["com.openai"].interface.logo]) expect(existsSync(new URL(path, root))).toBe(true);
  });
});
