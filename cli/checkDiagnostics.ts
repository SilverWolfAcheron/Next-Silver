import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { CHECK_MAX_DIAGNOSTIC_LINE, CHECK_MAX_DIAGNOSTICS } from "../src/constants/check.ts";
import type { CheckDiagnostic } from "../src/types/check.ts";
import { splitWorkspacePath } from "./workspace.ts";

interface DiagnosticLocation {
  root: string;
  cwd: string;
}

interface RustHeading {
  severity: CheckDiagnostic["severity"];
  code?: string;
  message: string;
}

// These are display hints; output remains the source of truth. Do not infer success/failure from them.
const TYPESCRIPT: RegExp = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/u;
const RUST_HEADING: RegExp = /^(error|warning)(?:\[([A-Za-z][A-Za-z0-9_-]*)\])?:\s*(.+)$/u;
const RUST_LOCATION: RegExp = /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/u;
const GOLANG: RegExp = /^(.+?\.go):(\d+)(?::(\d+))?:\s*(.+)$/u;
const ESCAPES: RegExp = new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "gu");
function hasControls(value: string): boolean {
  for (const char of value) {
    const code: number = char.charCodeAt(0);
    if (code <= 8 || (code >= 11 && code <= 31) || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function workspacePath(path: string, location: DiagnosticLocation): string | undefined {
  if (!path || hasControls(path) || (process.platform !== "win32" && win32.isAbsolute(path) && !isAbsolute(path))) return;
  const absolute: string = resolve(location.cwd, path.replaceAll("\\", sep));
  const relativePath: string = relative(location.root, absolute);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(".." + sep) || isAbsolute(relativePath)) return;
  try {
    return splitWorkspacePath(relativePath.split(sep).join("/")).join("/");
  } catch {
    // Invalid workspace names are not navigable diagnostics.
  }
}

function number(value?: string): number | undefined {
  if (!value) return;
  const n: number = Number(value);
  if (Number.isSafeInteger(n) && n > 0) return n;
}

function diagnostic(
  match: RegExpExecArray, detail: RustHeading, location: DiagnosticLocation
): CheckDiagnostic | undefined {
  const path: string | undefined = workspacePath(match[1], location);
  const line: number | undefined = number(match[2]);
  const column: number | undefined = number(match[3]);
  if (!path || line === undefined || (match[3] && column === undefined)) return;
  return { path, line, ...(column === undefined ? {} : { column }), ...detail };
}

export function extractCheckDiagnostics(output: string, location: DiagnosticLocation): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = [];
  const seen: Set<string> = new Set();
  let heading: RustHeading | undefined;
  for (const raw of output.split(/\r?\n/u)) {
    if (diagnostics.length >= CHECK_MAX_DIAGNOSTICS) break;
    if (raw.length > CHECK_MAX_DIAGNOSTIC_LINE) {
      heading = undefined;
      continue;
    }
    const text: string = raw.replace(ESCAPES, "");
    const ts: RegExpExecArray | null = TYPESCRIPT.exec(text);
    const rustLocation: RegExpExecArray | null = RUST_LOCATION.exec(text);
    const go: RegExpExecArray | null = GOLANG.exec(text);
    let result: CheckDiagnostic | undefined;
    if (ts) {
      result = diagnostic(ts, { severity: ts[4] === "error" ? "error" : "warning", code: ts[5], message: ts[6] }, location);
    } else if (rustLocation && heading) {
      result = diagnostic(rustLocation, heading, location);
    } else if (go) {
      result = diagnostic(go, { severity: "error", message: go[4] }, location);
    }
    if (result && !hasControls(result.message)) {
      const key: string = JSON.stringify(result);
      if (!seen.has(key)) {
        diagnostics.push(result);
        seen.add(key);
      }
    }
    const rust: RegExpExecArray | null = RUST_HEADING.exec(text);
    heading = rust ? { severity: rust[1] === "error" ? "error" : "warning", ...(rust[2] ? { code: rust[2] } : {}), message: rust[3] } : undefined;
  }
  return diagnostics;
}
