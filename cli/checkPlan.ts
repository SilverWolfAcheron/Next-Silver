import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { access, lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import { CHECK_MANIFEST_MAX_BYTES, TYPECHECK_SCRIPT_NAMES } from "../src/constants/check.ts";
import type { CheckCommand, CheckEnvironmentOptions, CheckName } from "../src/types/check.ts";
import { resolveWorkspaceDirectory, splitWorkspacePath, workspaceRoot } from "./workspace.ts";
import type { WorkspaceSummary } from "./workspace.ts";

interface PackageChecks {
  hasManifest: boolean;
  scripts: ReadonlySet<string>;
  hasLocalTypecheck: boolean;
}

interface CheckLocation {
  root: string;
  cwd: string;
}

function within(root: string, candidate: string): boolean {
  const path: string = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function fileExists(path: string): Promise<boolean> {
  return lstat(path).then((info: Stats): boolean => info.isFile() && !info.isSymbolicLink(), (): boolean => false);
}

export async function resolveCheckLocation(workspace: WorkspaceSummary, options: CheckEnvironmentOptions): Promise<CheckLocation> {
  options.signal?.throwIfAborted();
  const root: string = await workspaceRoot(workspace);
  const cwd: string = options.cwd ? resolve(root, options.cwd) : root;
  if (!within(root, cwd)) throw new AppError(ERROR_CODES.CHECK_DIR_OUTSIDE_WORKSPACE);
  // Resolve each component through the same workspace path policy as edits and reads.
  const path: string = relative(root, cwd).split(sep).join("/");
  const resolved: string = path ? await resolveWorkspaceDirectory(root, splitWorkspacePath(path)) : root;
  if (!(await lstat(resolved)).isDirectory()) throw new AppError(ERROR_CODES.CHECK_DIR_NOT_FOLDER);
  await access(resolved, constants.R_OK);
  options.signal?.throwIfAborted();
  return { root, cwd: resolved };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readScripts(path: string): Promise<ReadonlySet<string>> {
  const flags: number = constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0);
  const handle: FileHandle = await open(path, flags);
  try {
    const stats: Stats = await handle.stat();
    if (!stats.isFile() || stats.size > CHECK_MANIFEST_MAX_BYTES) {
      throw new AppError(ERROR_CODES.CHECK_EXECUTION_FAILED);
    }
    const buffer: Buffer = Buffer.alloc(stats.size + 1);
    let length: number = 0;
    while (length < buffer.length) {
      const { bytesRead }: { bytesRead: number } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stats.size) throw new AppError(ERROR_CODES.CHECK_EXECUTION_FAILED);
    const body: string = buffer.toString("utf8", 0, length).replace(/^\uFEFF/u, "");
    const manifest: unknown = JSON.parse(body);
    if (!isRecord(manifest)) throw new AppError(ERROR_CODES.CHECK_EXECUTION_FAILED);
    const scripts: unknown = manifest.scripts;
    if (!isRecord(scripts)) return new Set();
    return new Set(Object.keys(scripts).filter((name: string): boolean => {
      const value: unknown = scripts[name];
      return typeof value === "string" && Boolean(value.trim());
    }));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ERROR_CODES.CHECK_EXECUTION_FAILED, { cause: error });
  } finally {
    await handle.close();
  }
}

function tscFile(cwd: string): string {
  return join(cwd, "node_modules", "typescript", "bin", "tsc");
}

export async function readPackageChecks(cwd: string): Promise<PackageChecks> {
  const manifest: string = join(cwd, "package.json");
  const hasManifest: boolean = await fileExists(manifest);
  const scripts: ReadonlySet<string> = hasManifest ? await readScripts(manifest) : new Set();
  const tsc: string = tscFile(cwd);
  const hasLocalTypecheck: boolean = await fileExists(join(cwd, "tsconfig.json")) &&
    await fileExists(tsc) && within(cwd, await realpath(tsc));
  return { hasManifest, scripts, hasLocalTypecheck };
}

export async function findNpm(override?: string): Promise<string> {
  const bin: string = dirname(process.execPath);
  const configured: string | undefined = override || process.env.SILVER_NPM_CLI;
  const candidates: string[] = configured ? [configured] : [
    join(bin, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(bin, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(bin, "..", "share", "nodejs", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    const found: string | undefined = await realpath(candidate).catch((): undefined => undefined);
    if (found && await fileExists(found)) return found;
  }
  throw new AppError(ERROR_CODES.CHECK_NPM_NOT_FOUND);
}

function npmCommand(npm: string, name: string, cwd: string): CheckCommand {
  const args: string[] = ["run", name];
  return {
    command: name === "test" ? "npm test" : `npm ${args.join(" ")}`,
    // Do not run implicit pre/post hooks, recursive workspace scripts, or the default npm test command.
    argv: [npm, "--prefix", cwd, "--global=false", "--ignore-scripts", "--workspaces=false", "--if-present=false", "--no-audit", "--no-fund", ...args],
  };
}

export async function commandFor(
  check: CheckName, pkg: PackageChecks, options: { cwd: string; npm: () => Promise<string> }
): Promise<CheckCommand> {
  const cwd: string = options.cwd;
  if (check !== "typecheck") {
    if (!pkg.hasManifest) throw new AppError(ERROR_CODES.CHECK_MANIFEST_MISSING);
    if (!pkg.scripts.has(check)) throw new AppError(ERROR_CODES.CHECK_COMMAND_UNSUPPORTED);
    return npmCommand(await options.npm(), check, cwd);
  }
  const custom: string | undefined = TYPECHECK_SCRIPT_NAMES.find((name: string): boolean => pkg.scripts.has(name));
  if (custom) return npmCommand(await options.npm(), custom, cwd);
  if (pkg.hasLocalTypecheck) return { command: "tsc --noEmit", argv: [tscFile(cwd), "--noEmit"] };
  throw new AppError(ERROR_CODES.CHECK_TYPECHECK_UNAVAILABLE);
}
