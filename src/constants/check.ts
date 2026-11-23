import type { CheckName } from "../types/check.ts";

export const CHECK_NAMES: readonly CheckName[] = ["test", "typecheck", "build"];
export const CHECK_LABELS: Readonly<Record<CheckName, string>> = {
  test: "npm test",
  typecheck: "类型检查",
  build: "npm run build",
};
export const TYPECHECK_SCRIPT_NAMES: readonly string[] = ["typecheck", "type-check", "check:types"];
export const CHECK_TIMEOUT_DEFAULT_MS: number = 120_000;
export const CHECK_TIMEOUT_MAX_MS: number = 600_000;
export const CHECK_OUTPUT_DEFAULT_CHARS: number = 32_000;
export const CHECK_OUTPUT_MAX_CHARS: number = 256_000;
export const CHECK_OUTPUT_MIN_CHARS: number = 128;
export const CHECK_MANIFEST_MAX_BYTES: number = 1_048_576;
export const CHECK_TIMEOUT_NOTICE: string = "检查超时，已请求终止进程。";
export const CHECK_OUTPUT_OMISSION: string = "\n[中间检查输出已截断]\n";
export const CHECK_CLEANUP_MAX_MS: number = 2_000;
export const CHECK_KILL_HELPER_MAX_MS: number = 1_000;
export const CHECK_REAP_GRACE_MS: number = 120;
export const CHECK_REAP_MAX_PASSES: number = 6;
export const CHECK_MAX_PROC_ENTRIES: number = 8_192;
export const CHECK_MAX_DIAGNOSTICS: number = 40;
export const CHECK_MAX_DIAGNOSTIC_LINE: number = 2_000;
export const CHECK_ENVIRONMENT: ReadonlySet<string> = new Set([
  "allusersprofile", "appdata", "commonprogramfiles", "comspec", "home", "homedrive", "homepath",
  "lang", "lc_all", "localappdata", "logname", "os", "path", "pathext", "processor_architecture",
  "programdata", "programfiles", "programfiles(x86)", "shell", "systemdrive", "systemroot",
  "temp", "term", "tmp", "tmpdir", "timezone", "user", "username", "userprofile", "windir",
]);
