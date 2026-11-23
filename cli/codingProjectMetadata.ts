import { PROJECT_LIMITS, PROJECT_LOCK_MANAGERS } from "../src/constants/codingProject.ts";
import type {
  CodingProjectPackage, CodingProjectPackageManager, CodingProjectScript, CodingProjectScriptKind,
} from "../src/types/codingProject.ts";
import { splitWorkspacePath } from "./workspace.ts";

interface ManifestFields {
  name?: string;
  packageManager?: CodingProjectPackageManager;
  scripts?: CodingProjectScript[];
  workspacePatterns?: string[];
  entrypoints?: string[];
}

const SCRIPT_NAMES: ReadonlyMap<string, CodingProjectScriptKind> = new Map([
  ["build", "build"], ["compile", "build"],
  ["test", "test"], ["tests", "test"],
  ["lint", "lint"], ["typecheck", "typecheck"], ["type-check", "typecheck"],
  ["check:types", "typecheck"], ["types:check", "typecheck"],
]);

const KNOWN_MANAGERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);
const SCRIPT_PRIORITY: Record<CodingProjectScriptKind, number> = { build: 0, test: 0, lint: 0, typecheck: 0, other: 1 };

export function compareProjectStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeName(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 120 && /^[\p{L}\p{N}@_][\p{L}\p{N}@_./-]*$/u.test(value)
    ? value : undefined;
}

function safeRelativePath(value: string): string | undefined {
  const path: string = value.replace(/^\.\//u, "");
  if (path.length > PROJECT_LIMITS.pathLength) return undefined;
  try {
    splitWorkspacePath(path);
    return path;
  } catch {
    return undefined;
  }
}

function scriptKind(name: string): CodingProjectScriptKind {
  return SCRIPT_NAMES.get(name) ?? SCRIPT_NAMES.get(name.split(":", 1)[0]) ?? "other";
}

function readScripts(raw: unknown): CodingProjectScript[] | undefined {
  const scripts: Record<string, unknown> | undefined = record(raw);
  if (!scripts) return undefined;
  return Object.entries(scripts)
    .filter(([name, command]: [string, unknown]): boolean => typeof command === "string" && command.trim() !== "" &&
      /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,59}$/u.test(name))
    .map(([name]: [string, unknown]): CodingProjectScript => ({ name, kind: scriptKind(name) }))
    .sort((a: CodingProjectScript, b: CodingProjectScript): number =>
      SCRIPT_PRIORITY[a.kind] - SCRIPT_PRIORITY[b.kind] || compareProjectStrings(a.name, b.name))
    .slice(0, PROJECT_LIMITS.scripts);
}

function readPackageManager(value: unknown): CodingProjectPackageManager | undefined {
  if (typeof value !== "string" || !/^[a-z]+@[^\s/]+$/u.test(value)) return undefined;
  const name: string = value.split("@", 1)[0];
  return KNOWN_MANAGERS.has(name) ? name as CodingProjectPackageManager : undefined;
}

export function lockPackageManager(files: ReadonlySet<string>): CodingProjectPackageManager | undefined {
  const managers: Set<CodingProjectPackageManager> = new Set();
  for (const [name, manager] of PROJECT_LOCK_MANAGERS) {
    if (files.has(name)) managers.add(manager);
  }
  return managers.size === 1 ? managers.values().next().value : undefined;
}

function safePattern(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 150) return undefined;
  const exclusion: boolean = value.startsWith("!");
  const pattern: string = (exclusion ? value.slice(1) : value).replace(/^\.\//u, "").replace(/\/$/u, "");
  const parts: string[] = pattern.split("/");
  if (parts.length > PROJECT_LIMITS.depth ||
    parts.some((part: string): boolean => part !== "*" && part !== "**" && !/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(part))) {
    return undefined;
  }
  return exclusion ? `!${pattern}` : pattern;
}

function readPatterns(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const patterns: Set<string> = new Set();
  for (const item of value as unknown[]) {
    const valid: string | undefined = safePattern(item);
    if (valid) patterns.add(valid);
    if (patterns.size >= PROJECT_LIMITS.patterns) break;
  }
  return [...patterns];
}

// Parse only the conventional YAML block list, leaving aliases, flow maps and other YAML constructs untouched.
export function readPnpmWorkspacePatterns(body: string): string[] {
  const lines: string[] = body.split(/\r?\n/u);
  const start: number = lines.findIndex((line: string): boolean => /^packages:\s*(?:#.*)?$/u.test(line));
  if (start < 0) return [];
  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/u.test(line)) continue;
    const item: RegExpExecArray | null = /^\s*-\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*(?:#.*)?$/u.exec(line);
    if (!item) break;
    values.push(item[1] ?? item[2] ?? item[3]);
  }
  return readPatterns(values) ?? [];
}

function matchesPattern(pattern: string, value: string): boolean {
  const patternParts: string[] = pattern.split("/");
  const valueParts: string[] = value.split("/");
  let previous: boolean[] = Array<boolean>(valueParts.length + 1).fill(false);
  previous[0] = true;
  for (const part of patternParts) {
    const next: boolean[] = Array<boolean>(valueParts.length + 1).fill(false);
    next[0] = part === "**" && previous[0];
    for (let index: number = 0; index < valueParts.length; index += 1) {
      next[index + 1] = part === "**"
        ? previous[index + 1] || next[index]
        : previous[index] && (part === "*" || part === valueParts[index]);
    }
    previous = next;
  }
  return previous[valueParts.length];
}

function packageWithin(child: string, parent: string): string | undefined {
  if (parent === child) return undefined;
  if (!parent) return child;
  return child.startsWith(`${parent}/`) ? child.slice(parent.length + 1) : undefined;
}

export function owningProjectPackage(
  child: CodingProjectPackage, packages: CodingProjectPackage[]
): CodingProjectPackage | undefined {
  let owner: CodingProjectPackage | undefined;
  for (const candidate of packages) {
    if (candidate.ecosystem !== child.ecosystem || !candidate.workspacePatterns?.length) continue;
    const relative: string | undefined = packageWithin(child.root, candidate.root);
    if (relative === undefined || owner && owner.root.length >= candidate.root.length) continue;
    const positive: boolean = candidate.workspacePatterns.some((pattern: string): boolean =>
      !pattern.startsWith("!") && matchesPattern(pattern, relative));
    const excluded: boolean = candidate.workspacePatterns.some((pattern: string): boolean =>
      pattern.startsWith("!") && matchesPattern(pattern.slice(1), relative));
    if (positive && !excluded) owner = candidate;
  }
  return owner;
}

function readEntrypointValues(manifest: Record<string, unknown>): string[] {
  const targets: unknown[] = [manifest.source, manifest.module, manifest.main, manifest.types, manifest.typings];
  if (typeof manifest.bin === "string") {
    targets.push(manifest.bin);
  } else {
    const bins: Record<string, unknown> | undefined = record(manifest.bin);
    if (bins) targets.push(...Object.values(bins).slice(0, PROJECT_LIMITS.entrypoints));
  }
  const exportsObject: Record<string, unknown> | undefined = record(manifest.exports);
  const entries: unknown[] = [exportsObject && Object.hasOwn(exportsObject, ".") ? exportsObject["."] : manifest.exports];
  for (let index: number = 0; index < entries.length && index < 64; index += 1) {
    const current: unknown = entries[index];
    const conditional: Record<string, unknown> | undefined = record(current);
    if (typeof current === "string") {
      targets.push(current);
    } else if (conditional) {
      const keys: string[] = Object.keys(conditional).sort(compareProjectStrings);
      for (const key of keys.slice(0, 16)) {
        if (!key.startsWith("./")) entries.push(conditional[key]);
      }
    } else if (Array.isArray(current)) {
      entries.push(...(current as unknown[]).slice(0, 16));
    }
  }
  const paths: Set<string> = new Set();
  for (const target of targets) {
    if (typeof target !== "string") continue;
    const clean: string | undefined = safeRelativePath(target);
    if (clean) paths.add(clean);
    if (paths.size >= PROJECT_LIMITS.entrypoints) break;
  }
  return [...paths];
}

function parseNode(body: string): ManifestFields | undefined {
  const value: unknown = JSON.parse(body);
  const manifest: Record<string, unknown> | undefined = record(value);
  if (!manifest) return undefined;
  const workspace: unknown = Array.isArray(manifest.workspaces) ? manifest.workspaces : record(manifest.workspaces)?.packages;
  return {
    name: safeName(manifest.name),
    packageManager: readPackageManager(manifest.packageManager),
    scripts: readScripts(manifest.scripts),
    workspacePatterns: readPatterns(workspace),
    entrypoints: readEntrypointValues(manifest),
  };
}

function parseComposer(body: string): ManifestFields | undefined {
  const value: unknown = JSON.parse(body);
  const manifest: Record<string, unknown> | undefined = record(value);
  if (!manifest) return undefined;
  return { name: safeName(manifest.name) };
}

// Extract only common literal TOML fields. This is not a TOML validator and does not infer inherited values.
function parseToml(body: string, sectionName: "package" | "project"): ManifestFields {
  const lines: string[] = body.split(/\r?\n/u);
  const value: ManifestFields = {};
  let section: string = "";
  let multiline: "\"\"\"" | "'''" | undefined;
  for (let index: number = 0; index < lines.length; index += 1) {
    const line: string = lines[index];
    if (multiline) {
      if (line.includes(multiline)) multiline = undefined;
      continue;
    }
    const longString: RegExpExecArray | null = /^\s*[^#=]+?=\s*("""|''')/u.exec(line);
    if (longString && !line.slice(longString[0].length).includes(longString[1])) {
      multiline = longString[1] === `"""` ? `"""` : `'''`;
      continue;
    }
    const header: RegExpExecArray | null = /^\s*\[{1,2}([^\]]+)\]{1,2}\s*(?:#.*)?$/u.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section === sectionName) {
      const name: RegExpExecArray | null = /^\s*name\s*=\s*(?:"([^"]+)"|'([^']+)')\s*(?:#.*)?$/u.exec(line);
      if (name) value.name = safeName(name[1] ?? name[2]);
    }
    if (sectionName === "package" && section === "workspace") {
      const include: RegExpExecArray | null = /^\s*(members|exclude)\s*=\s*\[(.*)$/u.exec(line);
      if (!include) continue;
      let rest: string = include[2];
      // The supported literals cannot include brackets, inline comments or escapes.
      for (let count: number = 0; count < 24 && !rest.includes("]") && index + 1 < lines.length; count += 1) {
        index += 1;
        rest += lines[index].replace(/#.*$/u, "");
      }
      const payload: RegExpExecArray | null = /^((?:\s*(?:"[^"\\]+"|'[^']+')\s*,)*\s*(?:"[^"\\]+"|'[^']+')?\s*)\]\s*(?:#.*)?$/u.exec(rest);
      if (!payload) continue;
      const raw: string[] = [...payload[1].matchAll(/"([^"]+)"|'([^']+)'/gu)].map((match: RegExpMatchArray): string =>
        `${include[1] === "exclude" ? "!" : ""}${match[1] ?? match[2]}`);
      value.workspacePatterns = readPatterns([...(value.workspacePatterns ?? []), ...raw]);
    }
  }
  return value;
}

export function parseProjectManifest(name: string, body: string): ManifestFields | undefined {
  const content: string = body.replace(/^\uFEFF/u, "");
  try {
    switch (name.toLowerCase()) {
      case "package.json":
        return parseNode(content);
      case "composer.json":
        return parseComposer(content);
      case "go.mod": {
        const module: RegExpMatchArray | null = /^\s*module[ \t]+(?:"([^"]+)"|([^\s]+))[ \t]*(?:\/\/.*)?$/mu.exec(content);
        return { name: safeName(module?.[1] ?? module?.[2]) };
      }
      case "cargo.toml":
        return parseToml(content, "package");
      case "pyproject.toml":
        return parseToml(content, "project");
      default:
        return {};
    }
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
