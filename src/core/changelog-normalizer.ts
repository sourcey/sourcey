import type { Token, Tokens } from "marked";
import { slugify } from "../utils/slug.js";
import { lexMarkdown, renderMarkdownInline, PAGE_CONTENT } from "../utils/markdown.js";
import type {
  ChangelogChangeType,
  ChangelogDiagnostic,
  ChangelogFormat,
  ChangelogInlineLink,
  ChangelogRef,
  NormalizedChangelog,
  NormalizedChangelogEntry,
  NormalizedChangelogVersion,
  VersionLink,
} from "./types.js";

export interface NormalizeChangelogOptions {
  title?: string;
  description?: string;
  repoUrl?: string;
}

interface ParsedVersionHeading {
  version: string | null;
  date: string | null;
  yanked: boolean;
  prerelease: boolean;
  key: string;
  label: string;
}

interface RawSection {
  label: string;
  kind: "standard" | "conventional" | "unknown" | "implicit";
  entries: NormalizedChangelogEntry[];
}

interface RawVersionBlock {
  heading: ParsedVersionHeading;
  line: number;
  sourceOrder: number;
  rawHeading: string;
  summary?: string;
  sections: RawSection[];
  rawSectionKinds: Set<RawSection["kind"]>;
}

const STANDARD_SECTION_TYPES: Record<string, ChangelogChangeType> = {
  added: "added",
  changed: "changed",
  fixed: "fixed",
  removed: "removed",
  deprecated: "deprecated",
  security: "security",
};

const CONVENTIONAL_SECTION_TYPES: Record<string, ChangelogChangeType> = {
  feat: "added",
  feature: "added",
  features: "added",
  "bug fix": "fixed",
  "bug fixes": "fixed",
  fix: "fixed",
  fixes: "fixed",
  "breaking change": "changed",
  "breaking changes": "changed",
  performance: "changed",
  "performance improvement": "changed",
  "performance improvements": "changed",
  revert: "removed",
  reverts: "removed",
  refactor: "changed",
  refactors: "changed",
};

export function normalizeChangelog(
  markdown: string,
  options: NormalizeChangelogOptions = {},
): NormalizedChangelog {
  const diagnostics: ChangelogDiagnostic[] = [];
  const tokens = lexMarkdown(markdown);
  const tokenLines = buildTokenLineMap(tokens);
  const versionLinks = parseReferenceLinks(markdown);
  const versionLinkMap = new Map(
    versionLinks.map((link) => [normalizeVersionKey(link.version), link.url]),
  );

  let title = options.title?.trim();
  const descriptionParts: string[] = [];
  const rawBlocks: RawVersionBlock[] = [];
  let currentBlock: RawVersionBlock | null = null;
  let seenFirstVersionHeading = false;

  for (const token of tokens) {
    if (token.type === "heading") {
      const heading = token as Tokens.Heading;
      const text = headingText(heading);

      if (heading.depth === 1 && !title) {
        title = text;
        continue;
      }

      if (heading.depth === 2) {
        if (currentBlock) rawBlocks.push(currentBlock);
        currentBlock = null;
        seenFirstVersionHeading = true;

        const parsed = parseVersionHeading(text);
        if (!parsed) {
          diagnostics.push({
            severity: "warning",
            code: "CHG003_INVALID_VERSION",
            message: `Heading "${text}" is not a supported changelog version heading.`,
            line: tokenLines.get(token),
          });
          continue;
        }

        currentBlock = {
          heading: parsed,
          line: tokenLines.get(token) ?? 1,
          sourceOrder: rawBlocks.length,
          rawHeading: heading.raw,
          sections: [],
          rawSectionKinds: new Set(),
        };
        continue;
      }
    }

    if (currentBlock) {
      appendTokenToVersion(token, currentBlock, diagnostics, options.repoUrl);
    } else if (!options.description && !seenFirstVersionHeading && shouldContributeToDescription(token)) {
      descriptionParts.push(token.raw);
    }
  }

  if (currentBlock) rawBlocks.push(currentBlock);

  title = title || "Changelog";
  const description = (options.description ?? joinMarkdownFragments(descriptionParts)) || undefined;

  const versions = rawBlocks.map((block) => {
    const versionLabel = block.heading.version ?? "Unreleased";

    if (block.heading.version && !block.heading.date) {
      diagnostics.push({
        severity: "warning",
        code: "CHG001_MISSING_DATE",
        message: `Version ${block.heading.version} does not include a release date.`,
        line: block.line,
        version: block.heading.version,
      });
    }

    if (!block.sections.length && !block.summary) {
      diagnostics.push({
        severity: "warning",
        code: "CHG006_EMPTY_VERSION",
        message: `Version ${versionLabel} has no release notes.`,
        line: block.line,
        version: block.heading.version ?? "Unreleased",
      });
    }

    for (const section of block.sections) {
      if (section.kind !== "unknown") continue;
      diagnostics.push({
        severity: "warning",
        code: "CHG002_UNKNOWN_TYPE",
        message: `Section "${section.label}" is not a recognized changelog type and will render as Other.`,
        line: block.line,
        version: block.heading.version ?? "Unreleased",
      });
    }

    if (!options.repoUrl && block.sections.some((section) => section.entries.some((entry) => entry.refs.length > 0))) {
      diagnostics.push({
        severity: "info",
        code: "CHG007_UNRESOLVED_REF",
        message: `Found repository references in ${versionLabel}, but no repo URL is configured.`,
        line: block.line,
        version: block.heading.version ?? "Unreleased",
      });
    }

    return normalizeVersionBlock(block, versionLinkMap);
  });

  validateDuplicates(versions, diagnostics);
  validateSourceOrder(versions, diagnostics);

  const format = detectFormat(rawBlocks);

  return {
    title,
    description,
    format,
    versions,
    links: versionLinks,
    diagnostics,
    rawMarkdown: markdown,
  };
}

function buildTokenLineMap(tokens: Token[]): Map<Token, number> {
  const map = new Map<Token, number>();
  let line = 1;

  for (const token of tokens) {
    map.set(token, line);
    line += newlineCount(token.raw);
  }

  return map;
}

function newlineCount(input: string | undefined): number {
  if (!input) return 0;
  return (input.match(/\n/g) ?? []).length;
}

function parseReferenceLinks(markdown: string): VersionLink[] {
  const links: VersionLink[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(/^\[([^\]]+)\]:\s*(\S+)\s*$/gm)) {
    const version = match[1].trim();
    const url = match[2].trim();
    const key = normalizeVersionKey(version);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ version, url });
  }

  return links;
}

function headingText(heading: Tokens.Heading): string {
  return heading.tokens
    .map((token) => ("text" in token ? token.text : token.raw))
    .join("")
    .trim();
}

function shouldContributeToDescription(token: Token): boolean {
  return token.type === "paragraph" || token.type === "blockquote" || token.type === "list";
}

function appendTokenToVersion(
  token: Token,
  version: RawVersionBlock,
  diagnostics: ChangelogDiagnostic[],
  repoUrl?: string,
): void {
  if (token.type === "space") return;

  if (token.type === "heading" && (token as Tokens.Heading).depth === 3) {
    const heading = token as Tokens.Heading;
    const label = headingText(heading);
    const kind = resolveSectionKind(label);
    version.rawSectionKinds.add(kind);
    version.sections.push({
      label,
      kind,
      entries: [],
    });
    return;
  }

  if (version.sections.length === 0 && token.type === "paragraph") {
    const summaryParts = version.summary ? [version.summary, token.raw] : [token.raw];
    version.summary = joinMarkdownFragments(summaryParts);
    return;
  }

  const entries = entriesFromToken(token, repoUrl);
  if (entries.length === 0) return;

  const targetSection = ensureTargetSection(version);
  targetSection.entries.push(...entries);
}

function ensureTargetSection(version: RawVersionBlock): RawSection {
  if (version.sections.length === 0) {
    const section: RawSection = {
      label: "Other",
      kind: "implicit",
      entries: [],
    };
    version.sections.push(section);
    version.rawSectionKinds.add("implicit");
    return section;
  }

  return version.sections[version.sections.length - 1];
}

function entriesFromToken(
  token: Token,
  repoUrl: string | undefined,
): NormalizedChangelogEntry[] {
  if (token.type === "list") {
    const list = token as Tokens.List;
    return list.items.map((item) => createEntry(extractListItemMarkdown(item), repoUrl));
  }

  if (token.type === "paragraph") {
    return [createEntry(token.raw, repoUrl)];
  }

  if (token.type === "blockquote") {
    return [createEntry(stripBlockquotePrefix(token.raw), repoUrl)];
  }

  return [];
}

function extractListItemMarkdown(item: Tokens.ListItem): string {
  if (typeof item.text === "string" && item.text.trim()) return item.text.trim();
  return item.tokens
    .map((token) => token.raw)
    .join("")
    .trim();
}

function stripBlockquotePrefix(input: string): string {
  return input
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
}

function createEntry(
  markdown: string,
  repoUrl: string | undefined,
): NormalizedChangelogEntry {
  const compact = markdown.replace(/\n+/g, " ").trim();
  const html = renderMarkdownInline(compact, PAGE_CONTENT);
  const text = stripHtml(html);
  const links = extractInlineLinks(compact);
  const refs = extractRefs(compact, repoUrl);

  return { text, html, links, refs };
}

function extractInlineLinks(markdown: string): ChangelogInlineLink[] {
  const links: ChangelogInlineLink[] = [];
  for (const match of markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    links.push({
      text: match[1].trim(),
      href: match[2].trim(),
    });
  }
  return links;
}

function extractRefs(markdown: string, repoUrl?: string): ChangelogRef[] {
  const refs: ChangelogRef[] = [];
  const seen = new Set<string>();
  const repoBase = repoUrl?.replace(/\.git$/, "").replace(/\/$/, "");

  const pushRef = (type: ChangelogRef["type"], id: string, url?: string) => {
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ type, id, url });
  };

  for (const match of markdown.matchAll(/(?:^|[^\w])(?:pr|pull request)\s*#(\d+)/gi)) {
    const id = match[1];
    pushRef("pr", id, repoBase ? `${repoBase}/pull/${id}` : undefined);
  }

  for (const match of markdown.matchAll(/(?:^|[^\w])#(\d+)/g)) {
    const id = match[1];
    const prefix = markdown.slice(Math.max(0, (match.index ?? 0) - 20), match.index ?? 0);
    if (/(?:pr|pull request)\s*$/i.test(prefix)) continue;
    pushRef("issue", id, repoBase ? `${repoBase}/issues/${id}` : undefined);
  }

  for (const match of markdown.matchAll(/\b([0-9a-f]{7,40})\b/gi)) {
    const sha = match[1];
    pushRef("commit", sha, repoBase ? `${repoBase}/commit/${sha}` : undefined);
  }

  return refs;
}

function normalizeVersionBlock(
  block: RawVersionBlock,
  versionLinkMap: Map<string, string>,
): NormalizedChangelogVersion {
  return {
    id: slugify(block.heading.version ?? "unreleased"),
    version: block.heading.version,
    date: block.heading.date,
    yanked: block.heading.yanked,
    prerelease: block.heading.prerelease,
    summary: block.summary?.trim() || undefined,
    sections: block.sections.map((section) => ({
      type: mapSectionType(section.label),
      label: section.label,
      entries: section.entries,
    })),
    compareUrl: versionLinkMap.get(block.heading.key),
    sourceOrder: block.sourceOrder,
  };
}

function validateDuplicates(
  versions: NormalizedChangelogVersion[],
  diagnostics: ChangelogDiagnostic[],
): void {
  const seen = new Map<string, NormalizedChangelogVersion>();

  for (const version of versions) {
    const key = version.version ?? "unreleased";
    const existing = seen.get(key);
    if (existing) {
      diagnostics.push({
        severity: "error",
        code: "CHG005_DUPLICATE_VERSION",
        message: `Version ${key === "unreleased" ? "Unreleased" : key} appears more than once.`,
        version: version.version ?? "Unreleased",
      });
      continue;
    }
    seen.set(key, version);
  }
}

function validateSourceOrder(
  versions: NormalizedChangelogVersion[],
  diagnostics: ChangelogDiagnostic[],
): void {
  const releaseVersions = versions.filter((version) => version.version);
  for (let i = 1; i < releaseVersions.length; i += 1) {
    const prev = releaseVersions[i - 1];
    const current = releaseVersions[i];
    if (!prev.version || !current.version) continue;
    if (compareSemverDesc(prev.version, current.version) > 0) continue;

    diagnostics.push({
      severity: "info",
      code: "CHG004_OUT_OF_ORDER",
      message: `Version ${current.version} appears after ${prev.version}, but is newer by semver.`,
      version: current.version,
    });
  }
}

function detectFormat(blocks: RawVersionBlock[]): ChangelogFormat {
  const kinds = new Set<RawSection["kind"]>();
  let conventionalHeading = false;

  for (const block of blocks) {
    for (const kind of block.rawSectionKinds) kinds.add(kind);
    if (/\]\([^)]*\)\s*\([^)]*\)/.test(block.rawHeading)) conventionalHeading = true;
  }

  if (conventionalHeading || kinds.has("conventional")) return "conventional";
  if (kinds.has("standard") && !kinds.has("unknown") && !kinds.has("implicit")) return "keepachangelog";
  return "loose";
}

function resolveSectionKind(label: string): RawSection["kind"] {
  const normalized = normalizeSectionLabel(label);
  if (STANDARD_SECTION_TYPES[normalized]) return "standard";
  if (CONVENTIONAL_SECTION_TYPES[normalized]) return "conventional";
  return "unknown";
}

function mapSectionType(label: string): ChangelogChangeType {
  const normalized = normalizeSectionLabel(label);
  return STANDARD_SECTION_TYPES[normalized]
    ?? CONVENTIONAL_SECTION_TYPES[normalized]
    ?? "other";
}

function normalizeSectionLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[:\s]+$/g, "")
    .replace(/\s+/g, " ");
}

function joinMarkdownFragments(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function parseVersionHeading(text: string): ParsedVersionHeading | null {
  let value = text.trim();
  if (!value) return null;

  let yanked = false;
  if (/\s+\[yanked\]\s*$/i.test(value)) {
    yanked = true;
    value = value.replace(/\s+\[yanked\]\s*$/i, "").trim();
  }

  if (/^\[?unreleased\]?$/i.test(value)) {
    return {
      version: null,
      date: null,
      yanked,
      prerelease: false,
      key: "unreleased",
      label: "Unreleased",
    };
  }

  const conventional = value.match(/^\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]?\s*\(([^)]+)\)$/);
  if (conventional) {
    const version = conventional[1];
    return buildParsedVersion(version, conventional[2], yanked);
  }

  const bracketed = value.match(/^\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]?$/);
  if (bracketed) {
    return buildParsedVersion(bracketed[1], null, yanked);
  }

  const match = value.match(/^\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]?\s*(?:[-—]\s*(.+)|\(([^)]+)\))?$/);
  if (!match) return null;

  const version = match[1];
  const dateText = match[2]?.trim() || match[3]?.trim() || null;
  return buildParsedVersion(version, dateText, yanked);
}

function buildParsedVersion(
  version: string,
  dateText: string | null,
  yanked: boolean,
): ParsedVersionHeading {
  return {
    version,
    date: parseDate(dateText),
    yanked,
    prerelease: /-/.test(version),
    key: normalizeVersionKey(version),
    label: version,
  };
}

function parseDate(input: string | null): string | null {
  if (!input) return null;

  const value = input.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;

  const namedOne = value.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (namedOne) {
    const month = monthNumber(namedOne[2]);
    if (!month) return null;
    return `${namedOne[3]}-${month}-${pad2(Number(namedOne[1]))}`;
  }

  const namedTwo = value.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (namedTwo) {
    const month = monthNumber(namedTwo[1]);
    if (!month) return null;
    return `${namedTwo[3]}-${month}-${pad2(Number(namedTwo[2]))}`;
  }

  return null;
}

function monthNumber(month: string): string | null {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const index = months.indexOf(month.toLowerCase());
  if (index === -1) return null;
  return pad2(index + 1);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function normalizeVersionKey(version: string): string {
  const cleaned = version.trim().replace(/^\[|\]$/g, "");
  if (/^unreleased$/i.test(cleaned)) return "unreleased";
  return cleaned.replace(/^v/i, "").toLowerCase();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(value: string): ParsedSemver | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemverDesc(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = a.prerelease[i];
    const rightPart = b.prerelease[i];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNum = Number(leftPart);
    const rightNum = Number(rightPart);
    const leftIsNum = Number.isInteger(leftNum) && leftPart === String(leftNum);
    const rightIsNum = Number.isInteger(rightNum) && rightPart === String(rightNum);

    if (leftIsNum && rightIsNum && leftNum !== rightNum) return leftNum > rightNum ? 1 : -1;
    if (leftIsNum !== rightIsNum) return leftIsNum ? -1 : 1;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}
