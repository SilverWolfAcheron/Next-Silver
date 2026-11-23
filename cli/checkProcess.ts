import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import type { Dir, Dirent } from "node:fs";
import { opendir, readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { CHECK_CLEANUP_MAX_MS, CHECK_ENVIRONMENT, CHECK_KILL_HELPER_MAX_MS, CHECK_REAP_GRACE_MS, CHECK_REAP_MAX_PASSES, CHECK_MAX_PROC_ENTRIES } from "../src/constants/check.ts";
import type { CheckCommand, CheckProcessOptions, CheckProcessResult } from "../src/types/check.ts";
import { createCheckOutput } from "./checkOutput.ts";
import type { CheckOutputCollector } from "./checkOutput.ts";

interface ProcessStatus {
  exitCode: number | null;
  signalName: NodeJS.Signals | null;
}

interface GroupMember {
  pid: number;
  parent: number;
  state: string;
}

function checkEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]: [string, string | undefined]): boolean => CHECK_ENVIRONMENT.has(key.toLowerCase()))
  );
  const pathName: string = Object.keys(env).find((key: string): boolean => key.toLowerCase() === "path") ?? "PATH";
  env[pathName] = [dirname(process.execPath), env[pathName]].filter(Boolean).join(delimiter);
  env.NO_COLOR = "1";
  return env;
}

function kill(pid: number, signal: NodeJS.Signals = "SIGKILL"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function linuxGroup(group: number): Promise<GroupMember[] | undefined> {
  try {
    const dir: Dir = await opendir("/proc");
    const result: GroupMember[] = [];
    let seen: number = 0;
    for await (const entry of dir as AsyncIterable<Dirent>) {
      if (++seen > CHECK_MAX_PROC_ENTRIES) return;
      if (!/^\d+$/u.test(entry.name)) continue;
      const pid: number = Number(entry.name);
      const text: string = await readFile(join("/proc", entry.name, "stat"), "utf8").catch((): string => "");
      // Process names can themselves contain spaces and parentheses.
      const end: number = text.lastIndexOf(")");
      if (end === -1) continue;
      const fields: string[] = text.slice(end + 1).trim().split(/\s+/u);
      if (Number(fields[2]) === group) result.push({ pid, parent: Number(fields[1]), state: fields[0] });
    }
    return result;
  } catch {
    // /proc can be unavailable in a Linux sandbox; group signalling is the fallback.
  }
}

async function reapLinuxChildren(pid: number, stopFinished: () => boolean): Promise<void> {
  // npm ordinarily waits for its shell, which waits for the actual check program. Let the
  // surviving parents reap descendants first, including on hosts where PID 1 doesn't reap.
  for (let pass: number = 0; pass < CHECK_REAP_MAX_PASSES && !stopFinished(); pass += 1) {
    const members: GroupMember[] | undefined = await linuxGroup(pid);
    if (!members || stopFinished()) return;
    const live: GroupMember[] = members.filter(({ state }: GroupMember): boolean => state !== "Z");
    const parents: Set<number> = new Set(live.map(({ parent }: GroupMember): number => parent));
    const leaves: GroupMember[] = live.filter((member: GroupMember): boolean => member.pid !== pid && !parents.has(member.pid));
    if (!leaves.length) return;
    leaves.forEach((member: GroupMember): void => { kill(member.pid); });
    await delay(CHECK_REAP_GRACE_MS);
  }
}

async function windowsTree(pid: number, fallback: () => void): Promise<void> {
  await new Promise<void>((done: () => void): void => {
    const systemRoot: string = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const killer: ChildProcess = spawn(join(systemRoot, "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled: boolean = false;
    function settle(failed: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failed) fallback();
      done();
    }
    const timer: NodeJS.Timeout = setTimeout((): void => {
      killer.kill();
      settle(true);
    }, CHECK_KILL_HELPER_MAX_MS);
    killer.once("error", (): void => settle(true));
    killer.once("exit", (code: number | null): void => settle(code !== 0));
  });
}

async function terminate(child: ChildProcess, closed: () => boolean): Promise<void> {
  const pid: number | undefined = child.pid;
  if (!pid) return;
  const fallback: () => void = (): void => {
    if (!closed()) child.kill("SIGKILL");
  };
  if (process.platform === "win32") return windowsTree(pid, fallback);
  if (process.platform === "linux") await reapLinuxChildren(pid, closed);
  if (!closed() && !kill(-pid)) fallback();
}

export async function runCheckProcess(command: CheckCommand, options: CheckProcessOptions): Promise<CheckProcessResult> {
  const { cwd, signal, timeoutMs, maxOutputChars }: CheckProcessOptions = options;
  signal?.throwIfAborted();
  const started: number = performance.now();
  const collector: CheckOutputCollector = createCheckOutput(maxOutputChars);
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(process.execPath, command.argv, {
    cwd,
    env: checkEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let closed: boolean = false;
  let timedOut: boolean = false;
  let stopping: Promise<void> | undefined;
  let cleanupTime: NodeJS.Timeout | undefined;
  const closedPromise: Promise<ProcessStatus> = new Promise((
    done: (value: ProcessStatus) => void, reject: (reason?: unknown) => void
  ): void => {
    child.once("error", (error: Error): void => reject(error));
    child.once("close", (exitCode: number | null, signalName: NodeJS.Signals | null): void => {
      closed = true;
      done({ exitCode, signalName });
    });
  });

  let settleCleanup: ((value: ProcessStatus) => void) | undefined;
  const cleanupPromise: Promise<ProcessStatus> = new Promise((done: (value: ProcessStatus) => void): void => { settleCleanup = done; });

  function stop(): void {
    if (closed || stopping) return;
    stopping = terminate(child, (): boolean => closed).catch((): void => undefined);
    cleanupTime = setTimeout((): void => {
      if (!closed) {
        if (child.pid && process.platform !== "win32") kill(-child.pid);
        child.kill("SIGKILL");
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      settleCleanup?.({ exitCode: null, signalName: null });
    }, CHECK_CLEANUP_MAX_MS);
  }

  const timer: NodeJS.Timeout = setTimeout((): void => {
    if (!closed && !signal?.aborted) timedOut = true;
    stop();
  }, timeoutMs);
  child.stdout.on("data", (bytes: Buffer): void => collector.append("stdout", bytes));
  child.stderr.on("data", (bytes: Buffer): void => collector.append("stderr", bytes));
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try {
    const result: ProcessStatus = await Promise.race([closedPromise, cleanupPromise]);
    if (closed) await stopping;
    signal?.throwIfAborted();
    return {
      ...collector.finish(),
      exitCode: timedOut ? null : result.exitCode,
      signal: result.signalName ?? undefined,
      durationMs: Math.round(performance.now() - started),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(cleanupTime);
    signal?.removeEventListener("abort", stop);
  }
}
