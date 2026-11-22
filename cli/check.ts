import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import { workspaceRoot } from "./workspace.ts";
import type { WorkspaceSummary } from "./workspace.ts";

export type CheckName = "test" | "typecheck" | "build";

const CHECK_LABELS: Record<CheckName, string> = {
  test: "npm test",
  typecheck: "类型检查",
  build: "npm run build",
};

export function checkLabel(check: CheckName): string {
  return CHECK_LABELS[check];
}

export interface CheckResult {
  command: string;
  exitCode: number | null;
  signal?: string;
  output: string;
  stdout: string;
  stderr: string;
}

interface CheckOptions {
  signal?: AbortSignal;
  npmCli?: string;
  cwd?: string;
}

interface CheckCommand {
  command: string;
  argv: string[];
}

export function isCheckName(value: unknown): value is CheckName {
  return value === "test" || value === "typecheck" || value === "build";
}

export function checkName(value: unknown): CheckName {
  if (isCheckName(value)) return value;
  if (value === "npm test") return "test";
  if (value === "npm run build") return "build";
  if (value === "npm run typecheck" || value === "npm run type-check") return "typecheck";
  throw new AppError(ERROR_CODES.CHECK_COMMAND_UNSUPPORTED);
}

async function fileExists(path: string): Promise<boolean> {
  return lstat(path).then((info: Stats): boolean => info.isFile() && !info.isSymbolicLink(), (): boolean => false);
}

async function findNpm(override?: string): Promise<string> {
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
  const args: string[] = name === "test" ? ["test"] : ["run", name];
  return {
    command: `npm ${args.join(" ")}`,
    // npm runs the explicitly requested script with ignore-scripts, suppressing pre/post hooks.
    argv: [npm, "--prefix", cwd, "--global=false", "--ignore-scripts", "--no-audit", "--no-fund", ...args],
  };
}

async function commandFor(check: CheckName, cwd: string, npmCli?: string): Promise<CheckCommand> {
  const packagePath: string = join(cwd, "package.json");
  const hasManifest: boolean = await fileExists(packagePath);
  if (check !== "typecheck") {
    if (!hasManifest) throw new AppError(ERROR_CODES.CHECK_MANIFEST_MISSING);
    return npmCommand(await findNpm(npmCli), check, cwd);
  }
  const scripts: Record<string, unknown> | undefined = hasManifest
    ? (JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, unknown> }).scripts : undefined;
  const custom: string | undefined = ["typecheck", "type-check", "check:types"].find((name: string): boolean => typeof scripts?.[name] === "string");
  if (custom) return npmCommand(await findNpm(npmCli), custom, cwd);
  const tsc: string = join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (await fileExists(join(cwd, "tsconfig.json")) && await fileExists(tsc)) {
    return { command: "tsc --noEmit", argv: [tsc, "--noEmit"] };
  }
  throw new AppError(ERROR_CODES.CHECK_TYPECHECK_UNAVAILABLE);
}

const ENVIRONMENT: Set<string> = new Set([
  "allusersprofile", "appdata", "commonprogramfiles", "comspec", "home", "homedrive", "homepath",
  "lang", "lc_all", "localappdata", "logname", "os", "path", "pathext", "processor_architecture",
  "programdata", "programfiles", "programfiles(x86)", "shell", "systemdrive", "systemroot",
  "temp", "term", "tmp", "tmpdir", "timezone", "user", "username", "userprofile", "windir",
]);

function checkEnvironment(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([key]: [string, string | undefined]): boolean => ENVIRONMENT.has(key.toLowerCase())));
  const pathName: string = Object.keys(env).find((key: string): boolean => key.toLowerCase() === "path") ?? "PATH";
  const delimiter: ";" | ":" = process.platform === "win32" ? ";" : ":";
  env[pathName] = [dirname(process.execPath), env[pathName]].filter(Boolean).join(delimiter);
  env.NO_COLOR = "1";
  return env;
}

function stopProcessTree(processId: number, fallback: () => void): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-processId, "SIGKILL");
    } catch {
      fallback();
    }
    return Promise.resolve();
  }
  return new Promise((done: (value: void | PromiseLike<void>) => void): void => {
    const systemRoot: string = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const taskkill: string = join(systemRoot, "System32", "taskkill.exe");
    const killer: ChildProcess = spawn(taskkill, ["/PID", String(processId), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", (): void => { fallback(); done(); });
    killer.once("exit", (code: number | null): void => { if (code !== 0) fallback(); done(); });
  });
}

async function checkDirectory(workspace: WorkspaceSummary, override?: string): Promise<string> {
  const root: string = await workspaceRoot(workspace);
  if (!override) return root;
  const cwd: string = await realpath(resolve(root, override));
  const path: string = relative(root, cwd);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new AppError(ERROR_CODES.CHECK_DIR_OUTSIDE_WORKSPACE);
  }
  if (!(await lstat(cwd)).isDirectory()) throw new AppError(ERROR_CODES.CHECK_DIR_NOT_FOLDER);
  return cwd;
}

export async function runCheck(
  workspace: WorkspaceSummary, requested: CheckName, options: CheckOptions = {}
): Promise<CheckResult> {
  const check: CheckName = checkName(requested);
  const { signal, npmCli }: CheckOptions = options;
  signal?.throwIfAborted();
  const cwd: string = await checkDirectory(workspace, options.cwd);
  await access(cwd, constants.R_OK);
  const { command, argv }: CheckCommand = await commandFor(check, cwd, npmCli);
  signal?.throwIfAborted();
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(process.execPath, argv, {
    cwd,
    env: checkEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const stdout: StringDecoder = new StringDecoder("utf8");
  const stderr: StringDecoder = new StringDecoder("utf8");
  const pieces: { stdout: string[]; stderr: string[]; combined: string[]; } = { stdout: [] as string[], stderr: [] as string[], combined: [] as string[] };
  function record(kind: "stdout" | "stderr", value: string): void {
    pieces[kind].push(value);
    pieces.combined.push(value);
  }
  child.stdout.on("data", (bytes: Buffer): void => record("stdout", stdout.write(bytes)));
  child.stderr.on("data", (bytes: Buffer): void => record("stderr", stderr.write(bytes)));
  let stopping: Promise<void> | undefined;
  function abort(): void {
    if (!child.pid || stopping) return;
    stopping = stopProcessTree(child.pid, (): boolean => child.kill("SIGKILL"));
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const finished: { exitCode: number | null; signalName: string | null; } = await new Promise<{ exitCode: number | null; signalName: string | null }>(
      (
        done: (value: { exitCode: number | null; signalName: string | null; }) => void,
        reject: (reason?: unknown) => void
      ): void => {
        child.once("error", reject);
        child.once("close", (exitCode: number | null, signalName: NodeJS.Signals | null): void => done({ exitCode, signalName }));
      }
    );
    await stopping;
    signal?.throwIfAborted();
    record("stdout", stdout.end());
    record("stderr", stderr.end());
    return {
      command, exitCode: finished.exitCode, signal: finished.signalName ?? undefined,
      stdout: pieces.stdout.join(""), stderr: pieces.stderr.join(""), output: pieces.combined.join(""),
    };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
