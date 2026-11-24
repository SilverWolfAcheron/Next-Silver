import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import { CODING_PLUGIN_CATALOG } from "../src/constants/codingPlugins.ts";
import { CODING_TOOL_LIMITS } from "../src/constants/codingTools.ts";
import type { CodingPluginResult } from "../src/types/codingPlugins.ts";
import type { CodingSymbolMatch, CodingSymbolMode, CodingSymbolResult } from "../src/types/codingSymbols.ts";
import { inspectChecks } from "./check.ts";
import { discoverCodingProject } from "./codingProject.ts";
import { assertCodingReadPath, canReadCodingPath } from "./codingRead.ts";
import { findCodingSymbols } from "./codingSymbols.ts";

function invalid(): never {
  throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
}

function exactFields(fields: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  if (Object.keys(fields).some((field: string): boolean => !allowed.includes(field))) invalid();
}

/** This registry intentionally has no install, module loading, or command execution interface. */
export async function dispatchCodingPlugin(
  fields: Readonly<Record<string, unknown>>, workspace: WorkspaceSummary | undefined, signal: AbortSignal
): Promise<CodingPluginResult> {
  signal.throwIfAborted();
  if (fields.name === "plugin_list") {
    exactFields(fields, ["name"]);
    return { plugins: structuredClone(CODING_PLUGIN_CATALOG) };
  }
  if (fields.name !== "plugin_call") invalid();
  const directory: string = typeof fields.path === "string" ? fields.path : fields.path === undefined ? "" : invalid();
  const common: string[] = ["name", "plugin", "operation", "path"];
  assertCodingReadPath(directory);
  if (!workspace) throw new AppError(ERROR_CODES.WORKSPACE_NOT_BOUND);
  if (fields.plugin === "workspace" && fields.operation === "overview") {
    exactFields(fields, common);
    return { plugin: "workspace", operation: "overview", output: await discoverCodingProject(workspace, { directory, signal }) };
  }
  if (fields.plugin === "workspace" && fields.operation === "find-symbol") {
    exactFields(fields, [...common, "query", "mode"]);
    const { query, mode: requested }: Readonly<Record<string, unknown>> = fields;
    if (typeof query !== "string") invalid();
    const mode: CodingSymbolMode = requested === undefined || requested === "all" ? "all"
      : requested === "definitions" || requested === "references" ? requested : invalid();
    const symbols: CodingSymbolResult = await findCodingSymbols(workspace, query, { directory, mode, signal });
    const matches: CodingSymbolMatch[] = symbols.matches
      .filter((entry: CodingSymbolMatch): boolean => canReadCodingPath(entry.path))
      .slice(0, CODING_TOOL_LIMITS.navigationItems);
    return {
      plugin: "workspace", operation: "find-symbol",
      output: { ...symbols, matches, truncated: symbols.truncated || matches.length !== symbols.matches.length },
    };
  }
  if (fields.plugin === "verification" && fields.operation === "inspect-checks") {
    exactFields(fields, common);
    return { plugin: "verification", operation: "inspect-checks", output: await inspectChecks(workspace, { cwd: directory, signal }) };
  }
  return invalid();
}
