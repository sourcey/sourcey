/**
 * One-time migration of another documentation framework to native Sourcey.
 * Loaded only by `sourcey migrate`; normal builds never import this module.
 */
import { prepareAstro } from "./astro/index.js";
import { prepareDocusaurus } from "./docusaurus/index.js";
import { prepareMintlify } from "./mintlify/index.js";
import { prepareMkDocs } from "./mkdocs/index.js";
import { posix, resolve } from "node:path";
import { printConfig, Reference, type ConfigValue } from "./config-writer.js";
import { Diagnostics } from "./diagnostics.js";
import { loadMapping } from "./mapping.js";
import { parseMarkdown, textContent, walk } from "./mdx.js";
import { configFile, convertDocuments, type NativePlan, type PlannedDocument } from "./plan.js";
import { applyChanges, hasInterrupted, ProjectFiles, recoverInterrupted } from "./project-files.js";
import { applyEdits, readFrontmatter, type TextEdit } from "./text-edits.js";
import type { HostDependency, MigrationOptions, MigrationReport } from "./types.js";
import { verifyPlans, type MissingFragment } from "./verify.js";

export type { MigrationOptions, MigrationReport, MigrationChange, MigrationDiagnostic } from "./types.js";
export type { MigrationMapping } from "./mapping.js";
export { formatDiagnostic, MigrationError } from "./diagnostics.js";

/**
 * Prepare, verify and (unless `dryRun`) apply a migration. Throws
 * `MigrationError` with every blocking diagnostic; nothing is written then.
 */
export async function migrateProject(options: MigrationOptions): Promise<MigrationReport> {
  const root = resolve(options.root);
  if (await hasInterrupted(root)) {
    if (options.dryRun) throw new Error("An interrupted migration was found. Run without --dry-run to restore it first.");
    await recoverInterrupted(root);
  }
  const report = await prepareMigration(options);
  if (options.dryRun) return report;
  await applyChanges(root, report.changes);
  return { ...report, applied: true };
}

/** The verified change set and report, with nothing written. */
export async function prepareMigration(options: MigrationOptions): Promise<MigrationReport> {
  const project = new ProjectFiles(options.root);
  const diagnostics = new Diagnostics();
  const mapping = await loadMapping(project, options.mapping);

  let plans: NativePlan[] = [];
  let dependencies: HostDependency[] = [];
  switch (options.framework) {
    case "astro":
      ({ plans, dependencies } = await prepareAstro(project, diagnostics, mapping));
      break;
    case "mkdocs":
      ({ plans, dependencies } = await prepareMkDocs(project, diagnostics));
      break;
    case "docusaurus":
      ({ plans, dependencies } = await prepareDocusaurus(project, diagnostics, mapping));
      break;
    case "mintlify":
      ({ plans, dependencies } = await prepareMintlify(project, diagnostics));
      break;
    default:
      diagnostics.error({ file: ".", code: "framework", message: `sourcey migrate ${options.framework} is not available yet` });
  }
  diagnostics.assertClean();

  for (const plan of plans) {
    keepChangelogsAsPages(plan, diagnostics);
    await keepOwnAgentIndexes(plan, project, diagnostics);
    registerDefinitions(plan, mapping.definitions);
    const file = configFile(plan);
    if (await project.exists(file))
      diagnostics.error({ file, code: "native", message: "A native configuration already exists; this project looks migrated" });
    project.write(file, printConfig(plan.config), "Native Sourcey configuration");
    for (const [path, file] of plan.files) {
      if (file.bytes === null) project.remove(path, file.reason);
      else project.write(path, file.bytes, file.reason);
    }
  }
  await convertDocuments(
    [...uniqueDocuments(plans, diagnostics), ...plans.flatMap((plan) => plan.partials ?? [])],
    {
      project,
      diagnostics,
      converters: mapping.converters,
      elementOverrides: mapping.elementOverrides,
      // Keyed like the lookups: one trailing slash, whatever the site's URL style.
      sections: new Map(plans.flatMap((plan) => [...(plan.sections ?? [])].map(([path, group]) => [path.replace(/\/?$/, "/"), group] as const))),
      icons: plans.find((plan) => plan.icons)?.icons ?? "heroicons",
    },
  );
  diagnostics.assertClean();

  // Native heading IDs differ from some source fragments; add the source's explicitly, once.
  let verification = await verifyPlans(project, await project.changes(), plans, diagnostics);
  if (verification.missingFragments.length) {
    await writeFragments(project, verification.missingFragments, diagnostics);
    diagnostics.assertClean();
    verification = await verifyPlans(project, await project.changes(), plans, diagnostics);
    for (const fragment of verification.missingFragments)
      diagnostics.error({ file: fragment.file, code: "fragment", message: `#${fragment.id} ("${fragment.text}") is not preserved` });
  }
  diagnostics.assertClean();

  const changes = await project.changes();
  return {
    framework: options.framework,
    root: project.root,
    dryRun: options.dryRun === true,
    applied: false,
    changes,
    changed: changes.map((change) => change.path),
    unchanged: project.unchanged(),
    routes: verification.routes,
    diagnostics: diagnostics.sorted(),
    dependencies: [...dependencies, ...(await tsconfigPackages(project, plans))],
  };
}

/**
 * Packages the native configuration's `tsconfig.json` extends, which loading
 * `sourcey.config.ts` reads, so the host keeps them while the file names them.
 * The file is JSON with comments and trailing commas; strings match first, so
 * neither inside one is touched.
 */
async function tsconfigPackages(project: ProjectFiles, plans: readonly NativePlan[]): Promise<HostDependency[]> {
  const packages = new Map<string, string>();
  for (const plan of plans) {
    const file = posix.join(plan.configDir, "tsconfig.json");
    if (!(await project.exists(file))) continue;
    let extended: unknown;
    try {
      extended = JSON.parse((await project.readText(file)).replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*[}\]])/g, (match) => (match.startsWith('"') ? match : ""))).extends;
    } catch {
      continue;
    }
    for (const name of [extended].flat())
      if (typeof name === "string" && !/^[./]/.test(name)) packages.set(name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/"), file);
  }
  return [...packages].map(([name, file]) => ({ name, status: "still-used", detail: `${file} extends it, and loading sourcey.config.ts reads ${file}` }));
}

/**
 * Native builds read a `CHANGELOG.md` as a structured changelog; source
 * frameworks published it as an ordinary page. Keep it a page, and say how to opt in.
 */
function keepChangelogsAsPages(plan: NativePlan, diagnostics: Diagnostics): void {
  const changelogs = plan.documents.filter((document) => /(^|\/)changelog\.md$/i.test(document.file));
  if (!changelogs.length) return;
  plan.config.config.changelog = false;
  diagnostics.review({
    file: configFile(plan),
    code: "changelog",
    message: `${changelogs.map((document) => document.file).join(", ")} stay ordinary pages; remove \`changelog: false\` for native changelog pages, feeds and version links`,
  });
}

/** The agent indexes a native build writes, by the file each is published as. */
const AGENT_INDEXES = { index: "llms.txt", full: "llms-full.txt" } as const;

/**
 * A site that publishes its own `llms.txt` or `llms-full.txt` from its public
 * files keeps it as written: the native build does not generate that index
 * over it, and the report says so.
 */
async function keepOwnAgentIndexes(plan: NativePlan, project: ProjectFiles, diagnostics: Diagnostics): Promise<void> {
  const { publicDir, exports } = plan.config.config;
  if (typeof publicDir !== "string" || exports === false) return;
  const own: (keyof typeof AGENT_INDEXES)[] = [];
  for (const kind of ["index", "full"] as const) {
    const path = posix.join(plan.configDir, publicDir, AGENT_INDEXES[kind]);
    const planned = plan.files.get(path);
    if (planned ? planned.bytes !== null : await project.exists(path)) own.push(kind);
  }
  if (!own.length) return;
  const written = (exports ?? {}) as Record<string, ConfigValue>;
  const llms = (typeof written.llms === "object" && written.llms ? written.llms : {}) as Record<string, ConfigValue>;
  plan.config.config.exports = { ...written, llms: { ...llms, ...Object.fromEntries(own.map((kind) => [kind, false])) } };
  const names = own.map((kind) => AGENT_INDEXES[kind]).join(" and ");
  const one = own.length === 1;
  diagnostics.review({ file: configFile(plan), code: "exports", message: `The site's own ${names} ${one ? "is" : "are"} published as written, and the native build does not generate ${one ? "one" : "them"}` });
}

/** Native component definitions the project authored for its own components, registered by name. */
function registerDefinitions(plan: NativePlan, definitions: ReadonlyMap<string, string>): void {
  if (!definitions.size) return;
  for (const [name, module] of definitions) {
    const path = posix.relative(plan.configDir, module);
    plan.config.imports.push({ default: name, from: path.startsWith(".") ? path : `./${path}` });
  }
  plan.config.config.components = Object.fromEntries([...definitions.keys()].map((name) => [name, new Reference(name)]));
}

/** Documents shared by several builds are converted once and must agree on their edits. */
function uniqueDocuments(plans: NativePlan[], diagnostics: Diagnostics): PlannedDocument[] {
  const byFile = new Map<string, PlannedDocument>();
  for (const document of plans.flatMap((plan) => plan.documents)) {
    const existing = byFile.get(document.file);
    if (!existing) byFile.set(document.file, document);
    else if (JSON.stringify(existing.frontmatter) !== JSON.stringify(document.frontmatter))
      diagnostics.error({ file: document.file, code: "builds", message: "Two builds need different frontmatter for this document" });
  }
  return [...byFile.values()];
}

/** Append `{#id}` to each heading whose source fragment the native build would not publish. */
async function writeFragments(project: ProjectFiles, missing: MissingFragment[], diagnostics: Diagnostics): Promise<void> {
  const byFile = new Map<string, MissingFragment[]>();
  for (const fragment of missing) byFile.set(fragment.file, [...(byFile.get(fragment.file) ?? []), fragment]);
  for (const [file, fragments] of byFile) {
    const text = await project.readText(file);
    const headings = [...walk(await parseMarkdown(text, readFrontmatter(text).bodyStart))].map(({ node }) => node).filter((node) => node.type === "heading");
    const edits: TextEdit[] = [];
    for (const fragment of fragments) {
      const heading = headings[fragment.index];
      const last = heading?.children?.at(-1);
      if (!heading || !last?.position || textContent(heading).trim() !== fragment.text.trim()) {
        diagnostics.error({ file, code: "fragment", message: `Cannot place #${fragment.id} on "${fragment.text}"` });
        continue;
      }
      edits.push({ start: last.position.end.offset, end: last.position.end.offset, text: ` {#${fragment.id}}` });
    }
    project.write(file, applyEdits(text, edits), "Native Sourcey Markdown");
  }
}
