import { CODING_TOOL_LIMITS } from "../src/constants/codingTools.ts";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import type { CodingReadWindow } from "../src/types/codingTools.ts";

export function assertCodingReadPath(path: string): void {
  if (!canReadCodingPath(path)) {
    throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
  }
}

function sensitiveSegment(raw: string): boolean {
  const name: string = raw.trim().toLowerCase();
  return name === ".git" || name === ".ssh" || name === ".aws" || name === ".npmrc" ||
    name === ".pypirc" || name === ".netrc" || name === ".git-credentials" ||
    /^credentials(?:\.|$)/u.test(name) ||
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.env(?:\..*)?)$/u.test(name) ||
    /\.(?:key|pem|pfx|p12|kdbx)$/u.test(name);
}

export function canReadCodingPath(path: string): boolean {
  return path.length <= CODING_TOOL_LIMITS.targetChars &&
    !path.split(/[\\/]/u).some(sensitiveSegment);
}

function lineValue(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
}

export function codingReadWindow(body: string, request: { startLine?: unknown; endLine?: unknown }, budget: number): CodingReadWindow {
  const lines: string[] = body ? body.split(/\r\n|\n|\r/u) : [];
  if (lines.at(-1) === "") lines.pop();
  const start: number = lineValue(request.startLine, 1);
  const askedEnd: number = lineValue(request.endLine, start + CODING_TOOL_LIMITS.readLines - 1);
  if (askedEnd < start) throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
  const end: number = Math.min(askedEnd, start + CODING_TOOL_LIMITS.readLines - 1, lines.length);
  const slice: string = lines.slice(start - 1, end).join("\n");
  const output: string = slice.slice(0, budget).replace(/[\uD800-\uDBFF]$/u, "");
  return {
    startLine: start,
    endLine: Math.max(start - 1, end),
    totalLines: lines.length,
    body: output,
    truncated: end < Math.min(askedEnd, lines.length) || slice.length > budget ||
      (request.endLine === undefined && end < lines.length),
  };
}
