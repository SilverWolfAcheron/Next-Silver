import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { workspaceRoot, type WorkspaceSummary } from "./workspace.ts";

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
  throw new Error("只允许 npm test、类型检查或 npm run build。");
}

async function fileExists(path: string) {
  return lstat(path).then((info) => info.isFile() && !info.isSymbolicLink(), () => false);
}

async function findNpm(override?: string) {
  const bin = dirname(process.execPath);
  const configured = override || process.env.SILVER_NPM_CLI;
  const candidates = configured ? [configured] : [
    join(bin, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(bin, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(bin, "..", "share", "nodejs", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    const found = await realpath(candidate).catch(() => undefined);
    if (found && await fileExists(found)) return found;
  }
  throw new Error("无法找到 Silver 自带的 npm 运行时。");
}

function npmCommand(npm: string, name: string, cwd: string): CheckCommand {
  const args = name === "test" ? ["test"] : ["run", name];
  return {
    command: `npm ${args.join(" ")}`,
    // npm runs the explicitly requested script with ignore-scripts, suppressing pre/post hooks.
    argv: [npm, "--prefix", cwd, "--global=false", "--ignore-scripts", "--no-audit", "--no-fund", ...args],
  };
}

async function commandFor(check: CheckName, cwd: string, npmCli?: string): Promise<CheckCommand> {
  const packagePath = join(cwd, "package.json");
  const hasManifest = await fileExists(packagePath);
  if (check !== "typecheck") {
    if (!hasManifest) throw new Error("检查目录没有自己的 package.json。");
    return npmCommand(await findNpm(npmCli), check, cwd);
  }
  const scripts = hasManifest
    ? (JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, unknown> }).scripts : undefined;
  const custom = ["typecheck", "type-check", "check:types"].find((name) => typeof scripts?.[name] === "string");
  if (custom) return npmCommand(await findNpm(npmCli), custom, cwd);
  const tsc = join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (await fileExists(join(cwd, "tsconfig.json")) && await fileExists(tsc)) {
    return { command: "tsc --noEmit", argv: [tsc, "--noEmit"] };
  }
  throw new Error("工作区没有类型检查脚本或已安装的 TypeScript 编译器。");
}

const ENVIRONMENT = new Set([
  "allusersprofile", "appdata", "commonprogramfiles", "comspec", "home", "homedrive", "homepath",
  "lang", "lc_all", "localappdata", "logname", "os", "path", "pathext", "processor_architecture",
  "programdata", "programfiles", "programfiles(x86)", "shell", "systemdrive", "systemroot",
  "temp", "term", "tmp", "tmpdir", "timezone", "user", "username", "userprofile", "windir",
]);

function checkEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ENVIRONMENT.has(key.toLowerCase())));
  const pathName = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const delimiter = process.platform === "win32" ? ";" : ":";
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
  return new Promise((done) => {
    const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const taskkill = join(systemRoot, "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(processId), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => { fallback(); done(); });
    killer.once("exit", (code) => { if (code !== 0) fallback(); done(); });
  });
}

async function checkDirectory(workspace: WorkspaceSummary, override?: string) {
  const root = await workspaceRoot(workspace);
  if (!override) return root;
  const cwd = await realpath(resolve(root, override));
  const path = relative(root, cwd);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("检查目录必须位于工作区中。");
  if (!(await lstat(cwd)).isDirectory()) throw new Error("检查目录不是文件夹。");
  return cwd;
}

export async function runCheck(
  workspace: WorkspaceSummary, requested: CheckName, options: CheckOptions = {},
): Promise<CheckResult> {
  const check = checkName(requested);
  const { signal, npmCli } = options;
  signal?.throwIfAborted();
  const cwd = await checkDirectory(workspace, options.cwd);
  await access(cwd, constants.R_OK);
  const { command, argv } = await commandFor(check, cwd, npmCli);
  signal?.throwIfAborted();
  const child = spawn(process.execPath, argv, {
    cwd,
    env: checkEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const stdout = new StringDecoder("utf8");
  const stderr = new StringDecoder("utf8");
  const pieces = { stdout: [] as string[], stderr: [] as string[], combined: [] as string[] };
  function record(kind: "stdout" | "stderr", value: string) {
    pieces[kind].push(value);
    pieces.combined.push(value);
  }
  child.stdout.on("data", (bytes: Buffer) => record("stdout", stdout.write(bytes)));
  child.stderr.on("data", (bytes: Buffer) => record("stderr", stderr.write(bytes)));
  let stopping: Promise<void> | undefined;
  function abort() {
    if (!child.pid || stopping) return;
    stopping = stopProcessTree(child.pid, () => child.kill("SIGKILL"));
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const finished = await new Promise<{ exitCode: number | null; signalName: string | null }>((done, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signalName) => done({ exitCode, signalName }));
    });
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
