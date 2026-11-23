import { extname, posix } from "node:path";
import { PROJECT_CONFIG_FILES, PROJECT_LIMITS, PROJECT_MANIFESTS, PROJECT_SOURCE_LANGUAGES } from "../src/constants/codingProject.ts";
import type {
  CodingProject, CodingProjectEcosystem, CodingProjectFile, CodingProjectFileKind, CodingProjectLanguage, CodingProjectLanguageCount,
  CodingProjectPackage, CodingProjectPackageManager, CodingProjectWarningReason,
} from "../src/types/codingProject.ts";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import {
  compareProjectStrings, lockPackageManager, owningProjectPackage, parseProjectManifest, readPnpmWorkspacePatterns,
} from "./codingProjectMetadata.ts";
import { projectScope, readProjectManifestText, scanProject } from "./codingProjectScan.ts";
import type { ProjectScan } from "./codingProjectScan.ts";
import { workspaceRoot } from "./workspace.ts";

interface CodingProjectOptions {
  directory?: string;
  signal?: AbortSignal;
}

interface RankedFile extends CodingProjectFile {
  depth: number;
  weight: number;
}

interface ProjectPackageCandidate {
  path: string;
  root: string;
  name: string;
  ecosystem: CodingProjectEcosystem;
  depth: number;
}

interface ProjectInventory {
  files: Set<string>;
  folders: Map<string, Set<string>>;
  manifests: ProjectPackageCandidate[];
}

interface PackageScanOptions {
  root: string;
  inventory: ProjectInventory;
  project: CodingProject;
  signal?: AbortSignal;
}

function manifestType(name: string): CodingProjectEcosystem | undefined {
  return PROJECT_MANIFESTS.get(name) ?? (/\.(?:cs|fs|vb)proj$/u.test(name) ? "dotnet" : undefined);
}

function directoryOf(path: string): string {
  const directory: string = posix.dirname(path);
  return directory === "." ? "" : directory;
}

function combinedPath(directory: string, file: string): string {
  return directory ? `${directory}/${file}` : file;
}

function inventoryOf(scan: ProjectScan): ProjectInventory {
  const inventory: ProjectInventory = { files: new Set(), folders: new Map(), manifests: [] };
  for (const { path, name, depth } of scan.files) {
    inventory.files.add(path);
    const root: string = directoryOf(path);
    const existing: Set<string> = inventory.folders.get(root) ?? new Set<string>();
    const lower: string = name.toLowerCase();
    existing.add(lower);
    inventory.folders.set(root, existing);
    const ecosystem: CodingProjectEcosystem | undefined = manifestType(lower);
    if (ecosystem) inventory.manifests.push({ path, root, name, depth, ecosystem });
  }
  inventory.manifests.sort((a: ProjectPackageCandidate, b: ProjectPackageCandidate): number =>
    a.depth - b.depth || compareProjectStrings(a.path, b.path));
  return inventory;
}

function warn(project: CodingProject, path: string, reason: CodingProjectWarningReason): void {
  if (project.warnings.length < PROJECT_LIMITS.warnings) project.warnings.push({ path, reason });
  if (reason !== "manifest-invalid") project.truncated = true;
}

async function manifestBody(path: string, options: PackageScanOptions): Promise<string | undefined> {
  const { root, signal, project }: PackageScanOptions = options;
  try {
    return await readProjectManifestText(root, path, signal);
  } catch {
    signal?.throwIfAborted();
    warn(project, path, "manifest-unreadable");
    return undefined;
  }
}

async function resolveManifest(candidate: ProjectPackageCandidate, options: PackageScanOptions): Promise<CodingProjectPackage> {
  const { inventory, project }: PackageScanOptions = options;
  const { path, name, root, ecosystem }: ProjectPackageCandidate = candidate;
  const output: CodingProjectPackage = { root, manifest: path, ecosystem };
  if (!["node", "cargo", "go", "composer", "python"].includes(ecosystem) || name.toLowerCase() === "setup.cfg") return output;
  const body: string | undefined = await manifestBody(path, options);
  if (body === undefined) return output;
  const fields: ReturnType<typeof parseProjectManifest> = parseProjectManifest(name, body);
  if (!fields) {
    warn(project, path, "manifest-invalid");
    return output;
  }
  if (fields.name) output.name = fields.name;
  if (fields.workspacePatterns?.length) output.workspacePatterns = fields.workspacePatterns;
  if (ecosystem !== "node") return output;

  const sameFolder: ReadonlySet<string> = inventory.folders.get(root) ?? new Set();
  const workspaceYaml: string = combinedPath(root, "pnpm-workspace.yaml");
  const detected: CodingProjectPackageManager | undefined = fields.packageManager ?? lockPackageManager(sameFolder);
  if (inventory.files.has(workspaceYaml) && (!detected || detected === "pnpm")) {
    const yaml: string | undefined = await manifestBody(workspaceYaml, options);
    const patterns: string[] = yaml === undefined ? [] : readPnpmWorkspacePatterns(yaml);
    if (patterns.length) output.workspacePatterns = patterns;
    output.packageManager = "pnpm";
  } else if (detected) {
    output.packageManager = detected;
  }
  if (fields.scripts?.length) output.scripts = fields.scripts;
  const confirmedEntrypoints: string[] = (fields.entrypoints ?? [])
    .map((entry: string): string => combinedPath(root, entry))
    .filter((entry: string): boolean => inventory.files.has(entry));
  if (confirmedEntrypoints.length) output.entrypoints = confirmedEntrypoints;
  return output;
}

async function readPackages(options: PackageScanOptions): Promise<CodingProjectPackage[]> {
  const { inventory, project, signal }: PackageScanOptions = options;
  const found: CodingProjectPackage[] = [];
  for (const candidate of inventory.manifests.slice(0, PROJECT_LIMITS.packages)) {
    signal?.throwIfAborted();
    found.push(await resolveManifest(candidate, options));
  }
  if (inventory.manifests.length > PROJECT_LIMITS.packages) {
    warn(project, project.directory, "manifest-limit");
  }
  for (const pkg of found) {
    const owner: CodingProjectPackage | undefined = owningProjectPackage(pkg, found);
    if (!owner) continue;
    pkg.workspaceRoot = owner.root;
    pkg.packageManager ??= owner.packageManager;
  }
  return found;
}

function countLanguages(files: ProjectScan["files"]): CodingProjectLanguageCount[] {
  const counts: Map<CodingProjectLanguage, number> = new Map();
  for (const { name } of files) {
    const language: CodingProjectLanguage | undefined = PROJECT_SOURCE_LANGUAGES.get(extname(name.toLowerCase()));
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts].map(([language, files]: [CodingProjectLanguage, number]): CodingProjectLanguageCount => ({ language, files }))
    .sort((a: CodingProjectLanguageCount, b: CodingProjectLanguageCount): number =>
      b.files - a.files || compareProjectStrings(a.language, b.language));
}

function rankFile(path: string, depth: number, declared: ReadonlySet<string>): RankedFile | undefined {
  const name: string = posix.basename(path).toLowerCase();
  if (name === "agents.md" || name === "contributing.md") return { path, depth, kind: "instructions", weight: 0 };
  if (manifestType(name)) return { path, depth, kind: "manifest", weight: 0 };
  if (declared.has(path)) return { path, depth, kind: "entrypoint", weight: 0 };
  if (/^readme(?:\.[a-z0-9]+)*$/u.test(name)) return { path, depth, kind: "documentation", weight: 0 };
  if (/(?:^|\/)docs\/.*\.mdx?$/iu.test(path)) {
    return { path, depth, kind: "documentation", weight: /architecture|overview|setup|development|getting.started|design/u.test(name) ? 1 : 2 };
  }
  if (PROJECT_CONFIG_FILES.has(name) || /^tsconfig\.[a-z0-9_-]+\.json$/u.test(name)) {
    return { path, depth, kind: "configuration", weight: 0 };
  }
  if (!PROJECT_SOURCE_LANGUAGES.has(extname(name))) return undefined;
  if (/(?:^test_|[._-](?:test|spec)\.|(?:test|spec)s?\.(?:java|kt|py|rb|rs|php|cs|cpp|swift)$)/u.test(name) ||
    /(?:^|\/)(?:__tests__|tests?|specs?)\//iu.test(path)) {
    return { path, depth, kind: "test", weight: 0 };
  }
  if (/^(?:main|__main__|lib|app|index|server|manage|application)\./u.test(name)) {
    return { path, depth, kind: "entrypoint", weight: /^(?:main|__main__)\./u.test(name) ? 1 : 2 };
  }
  return undefined;
}

function compareRank(a: RankedFile, b: RankedFile): number {
  return a.weight - b.weight || a.depth - b.depth || compareProjectStrings(a.path, b.path);
}

function rankInventory(files: ProjectScan["files"], project: CodingProject): CodingProjectFile[] {
  const declared: Set<string> = new Set(project.packages.flatMap(({ entrypoints }: CodingProjectPackage): string[] => entrypoints ?? []));
  const byKind: Map<CodingProjectFileKind, RankedFile[]> = new Map([
    ["instructions", []], ["manifest", []], ["entrypoint", []], ["documentation", []], ["configuration", []], ["test", []],
  ]);
  for (const { path, depth } of files) {
    const candidate: RankedFile | undefined = rankFile(path, depth, declared);
    if (candidate) byKind.get(candidate.kind)?.push(candidate);
  }
  const shortlist: CodingProjectFile[] = [];
  const groups: RankedFile[][] = [...byKind.values()].map((group: RankedFile[]): RankedFile[] => group.sort(compareRank));
  if (groups.reduce((count: number, group: RankedFile[]): number => count + group.length, 0) > PROJECT_LIMITS.rankedFiles) {
    project.truncated = true;
  }
  // Round-robin categories so a workspace with many README files or tests still shows entrypoints and instructions.
  for (let index: number = 0; shortlist.length < PROJECT_LIMITS.rankedFiles; index += 1) {
    let found: boolean = false;
    for (const group of groups) {
      const file: RankedFile | undefined = group[index];
      if (!file) continue;
      found = true;
      shortlist.push({ path: file.path, kind: file.kind });
      if (shortlist.length >= PROJECT_LIMITS.rankedFiles) break;
    }
    if (!found) break;
  }
  return shortlist;
}

export async function discoverCodingProject(workspace: WorkspaceSummary, options: CodingProjectOptions = {}): Promise<CodingProject> {
  const { signal }: CodingProjectOptions = options;
  signal?.throwIfAborted();
  const directory: string = projectScope(options.directory ?? "");
  const root: string = await workspaceRoot(workspace);
  const scan: ProjectScan = await scanProject(root, { directory, signal });
  const project: CodingProject = {
    directory,
    topLevel: scan.topLevel,
    packages: [],
    files: [],
    languages: countLanguages(scan.files),
    warnings: scan.warnings,
    truncated: scan.truncated,
  };
  project.packages = await readPackages({ root, inventory: inventoryOf(scan), project, signal });
  project.files = rankInventory(scan.files, project);
  signal?.throwIfAborted();
  return project;
}
