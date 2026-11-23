import {
  CODING_TOOL_MAX_ARGUMENT_DEPTH, CODING_TOOL_MAX_FIELDS, CODING_TOOL_MAX_LABEL,
} from "../src/constants/codingToolLoop.ts";
import type {
  CodingToolArgument, CodingToolBatch, CodingToolFields, CodingToolLimits, CodingToolRequest,
} from "../src/types/codingToolLoop.ts";

const VALID_NAME: RegExp = /^[a-z][a-z0-9_-]{0,31}$/u;
const VALID_KEY: RegExp = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u;
const RESERVED_KEYS: Set<string> = new Set(["constructor", "prototype", "__proto__"]);
const LABEL_CONTROL: RegExp = /[\p{Cc}\u2028\u2029]/gu;

function compareKeys(first: string, second: string): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype: object | null = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype;
}

function copyFields(value: Record<string, unknown>, depth: number, remaining: { chars: number }): CodingToolFields | undefined {
  const keys: string[] = Object.keys(value).sort(compareKeys);
  if (keys.length > CODING_TOOL_MAX_FIELDS || keys.length > remaining.chars) return;
  const fields: CodingToolFields = {};
  for (const key of keys) {
    if (RESERVED_KEYS.has(key) || !VALID_KEY.test(key)) return;
    remaining.chars -= key.length + 4;
    if (remaining.chars < 0) return;
    const property: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property)) return;
    const raw: unknown = property.value;
    const field: CodingToolArgument | undefined = copyValue(raw, depth, remaining);
    if (field === undefined) return;
    fields[key] = field;
  }
  return fields;
}

function copyList(value: readonly unknown[], depth: number, remaining: { chars: number }): CodingToolArgument[] | undefined {
  if (value.length > CODING_TOOL_MAX_FIELDS || value.length > remaining.chars) return;
  const items: CodingToolArgument[] = [];
  for (const raw of value) {
    const item: CodingToolArgument | undefined = copyValue(raw, depth, remaining);
    if (item === undefined) return;
    items.push(item);
  }
  return items;
}

function copyValue(value: unknown, depth: number, remaining: { chars: number }): CodingToolArgument | undefined {
  remaining.chars -= typeof value === "string" ? value.length + 3 : 2;
  if (depth > CODING_TOOL_MAX_ARGUMENT_DEPTH || remaining.chars < 0) return;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return copyList(value, depth + 1, remaining);
  if (isPlainRecord(value)) return copyFields(value, depth + 1, remaining);
  return undefined;
}

function readTool(value: unknown, requestChars: number): CodingToolRequest | undefined {
  if (!isPlainRecord(value)) return;
  const fields: CodingToolFields | undefined = copyFields(value, 0, { chars: requestChars });
  if (!fields || typeof fields.name !== "string" || !VALID_NAME.test(fields.name)) return;
  if (JSON.stringify(fields).length <= requestChars) return { ...fields, name: fields.name };
}

export function readCodingToolBatch(value: unknown, limits: CodingToolLimits): CodingToolBatch {
  if (!Array.isArray(value) || value.length === 0) return { tools: [], invalid: 1 };
  // Do not silently execute just the first requests of an oversized batch.
  if (value.length > limits.batchSize) return { tools: [], invalid: value.length };
  const tools: CodingToolRequest[] = [];
  let invalid: number = 0;
  for (const raw of value) {
    const tool: CodingToolRequest | undefined = readTool(raw, limits.requestChars);
    if (tool) tools.push(tool);
    else invalid++;
  }
  return { tools, invalid };
}

function normalizedField(value: CodingToolArgument): string {
  return typeof value === "string" ? value.trim() : "";
}

function workspaceKey(tool: CodingToolRequest): CodingToolFields | undefined {
  const path: string = normalizedField(tool.path);
  const query: string = normalizedField(tool.query);
  switch (tool.name) {
    case "list":
    case "project":
    case "checks":
      return { name: tool.name, path };
    case "read":
      return {
        name: tool.name, path,
        ...(tool.startLine !== undefined ? { startLine: tool.startLine } : {}),
        ...(tool.endLine !== undefined ? { endLine: tool.endLine } : {}),
      };
    case "search":
      // Search is workspace-wide and case insensitive; keep path in the key because
      // it is still subject to workspace path policy during dispatch.
      return { name: tool.name, path, query: query.toLocaleLowerCase() };
    case "symbol":
      return {
        name: tool.name, path, query,
        mode: tool.mode === "definitions" || tool.mode === "references" ? tool.mode : "all",
      };
    default:
      return undefined;
  }
}

export function codingToolKey(tool: CodingToolRequest): string {
  const projected: CodingToolFields = workspaceKey(tool) ?? tool;
  const sorted: CodingToolFields = {};
  for (const key of Object.keys(projected).sort(compareKeys)) sorted[key] = projected[key];
  return JSON.stringify(sorted);
}

export function codingToolLabel(tool: CodingToolRequest): string {
  const value: CodingToolArgument = tool.query || tool.path || tool.directory || tool.cwd || "";
  const target: string = typeof value === "string" && value ? value : "工作区根目录";
  return `${tool.name} ${target.replace(LABEL_CONTROL, " ").slice(0, CODING_TOOL_MAX_LABEL)}`;
}
