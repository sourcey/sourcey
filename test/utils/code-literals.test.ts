import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeBlockString, codeString } from "../../src/utils/code-literals.js";
import { generateCodeSamples } from "../../src/utils/code-samples.js";

/**
 * The values a language reads from literals, by running one program that
 * prints each with a NUL after it, so a compiled language compiles once.
 */
const readers: Record<string, (literals: string[], dir: string) => string[]> = {
  javascript: (literals) => literals.map((literal) => new Function(`return ${literal};`)()),
  python: (literals, dir) => values(run("python3", [file(dir, "body.py", `import sys\n${each(literals, (body, literal) => `${body} = ${literal}\nsys.stdout.write(${body} + "\\0")`)}\n`)])),
  ruby: (literals, dir) => values(run("ruby", [file(dir, "body.rb", `${each(literals, (body, literal) => `${body} = ${literal}\nprint(${body}, "\\0")`)}\n`)])),
  go: (literals, dir) => values(run("go", ["run", file(dir, "body.go", `package main\n\nimport "fmt"\n\nfunc main() {\n${each(literals, (body, literal) => `  ${body} := ${literal}\n  fmt.Print(${body}, "\\x00")`)}\n}\n`)])),
  rust: (literals, dir) => {
    run("rustc", ["-o", join(dir, "body"), file(dir, "body.rs", `fn main() {\n${each(literals, (body, literal) => `    let ${body} = ${literal};\n    print!("{}\\0", ${body});`)}\n}\n`)]);
    return values(run(join(dir, "body"), []));
  },
  php: (literals, dir) => values(run("php", [file(dir, "body.php", `<?php\n${each(literals, (body, literal) => `$${body} = ${literal};\necho $${body}, "\\0";`)}\n`)])),
  java: (literals, dir) => values(run("java", [file(dir, "Main.java", `public class Main {\n  public static void main(String[] args) {\n${each(literals, (body, literal) => `    String ${body} = ${literal};\n    System.out.print(${body} + "\\0");`)}\n  }\n}\n`)])),
};

/** A program's lines for each literal, its variable named `body0`, `body1` and on. */
function each(literals: string[], lines: (body: string, literal: string) => string): string {
  return literals.map((literal, index) => lines(`body${index}`, literal)).join("\n");
}
/** The values a program printed, each ended by a NUL. */
function values(output: string): string[] {
  return output.split("\0").slice(0, -1);
}
function file(dir: string, name: string, content: string): string {
  writeFileSync(join(dir, name), content);
  return join(dir, name);
}
function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod" } });
}
function available(language: string): boolean {
  const command = { javascript: "node", python: "python3", ruby: "ruby", go: "go", rust: "rustc", php: "php", java: "java" }[language]!;
  try {
    execFileSync(command, [command === "go" ? "version" : "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const bodies = {
  json: JSON.stringify({ path: "C:\\temp\\new", quote: 'say "hi"', tick: "`cmd`", template: "${x}", apostrophe: "it's", triple: "'''", hash: '"#', unicode: "雪" }, null, 2),
  marker: "first\nBODY\nlast",
  quotes: 'a """ b\nends "',
  indented: "  one\n  two",
};

describe("codeBlockString", () => {
  for (const language of Object.keys(readers))
    it.skipIf(!available(language))(`writes ${language} that reads back every body exactly`, () => {
      const dir = mkdtempSync(join(tmpdir(), "sourcey-literal-"));
      try {
        const written = Object.entries(bodies).map(([name, body]) => ({ name, body, literal: codeBlockString(body, language) ?? codeString(body, language) }));
        const read = readers[language](written.map(({ literal }) => literal), dir);
        expect(read).toHaveLength(written.length);
        written.forEach(({ name, body, literal }, index) => expect(read[index], `${language} ${name}: ${literal}`).toBe(body));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

  it("keeps a body's lines at the margin, and falls back where the raw form cannot carry it", () => {
    expect(codeBlockString(bodies.json, "go")).toBeUndefined();
    expect(codeBlockString('{\n  "a": 1\n}', "go")).toBe('`{\n  "a": 1\n}`');
    expect(codeBlockString(bodies.json, "rust")).toMatch(/^r##"\{\n/);
    expect(codeBlockString(bodies.marker, "php")).toBeUndefined();
    expect(codeBlockString(bodies.marker, "ruby")).toBeUndefined();
    expect(codeBlockString(bodies.indented, "java")).toBeUndefined();
    expect(codeBlockString(bodies.json, "csharp")).toBe(`"""\n${bodies.json}\n"""`);
    expect(codeBlockString(bodies.quotes, "csharp")).toBe(`""""\n${bodies.quotes}\n""""`);
    expect(codeBlockString("one line", "python")).toBeUndefined();
    expect(codeBlockString("tab\there\nnext", "python")).toBeUndefined();
  });

  it("declares a JSON body over several lines before the request in every language", () => {
    const operation = { method: "post", path: "/cheeses", tags: [], parameters: [], responses: [], security: [], deprecated: false,
      requestBody: { required: true, content: { "application/json": { example: { name: "Gorgonzola", origin: "Italy" } } } } };
    const samples = Object.fromEntries(generateCodeSamples(operation, [{ url: "https://api.example.com" }], ["curl", "javascript", "python", "go", "ruby", "java", "php", "rust", "csharp"]).map((sample) => [sample.label, sample.source]));
    const json = '{\n  "name": "Gorgonzola",\n  "origin": "Italy"\n}';
    expect(samples.cURL).toContain(`--data-raw '${json}'`);
    expect(samples.JavaScript).toContain(`const body = \`${json}\`;\n\nconst response = await fetch('https://api.example.com/cheeses', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n  },\n  body,\n});`);
    expect(samples.Python).toContain(`body = '''${json}'''\n\nresponse = requests.post(\n    'https://api.example.com/cheeses',\n    data=body.encode('utf-8'),\n    headers={\n        'Content-Type': 'application/json',\n    },\n)`);
    expect(samples.Go).toContain(`body := strings.NewReader(\`${json}\`)`);
    expect(samples.Ruby).toContain(`request.body = <<-'BODY'.chomp\n${json}\nBODY`);
    expect(samples.Java).toContain(`String body = """\n${json}""";`);
    expect(samples.PHP).toContain(`$body = <<<'BODY'\n${json}\nBODY;`);
    expect(samples.Rust).toContain(`let body = r#"${json}"#;`);
    expect(samples["C#"]).toContain(`var body = """\n${json}\n""";`);
  });
});
