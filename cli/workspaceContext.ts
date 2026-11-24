import { createCodingTasks } from "./codingTasks.ts";
import { dispatchCodingPlugin } from "./codingPlugins.ts";
import { createCodingToolLoop } from "./codingToolLoop.ts";
import type { CodingTasks, CodingTaskResult } from "../src/types/codingTasks.ts";
import type { CodingPluginResult } from "../src/types/codingPlugins.ts";
import type { CodingToolLoop, CodingToolLoopOptions, CodingToolRequest } from "../src/types/codingToolLoop.ts";
import { listWorkspace, readWorkspaceFile, workspaceErrorText } from "./workspace.ts";
import { CODING_TOOL_LIMITS } from "../src/constants/codingTools.ts";
import { AGENT_TOOL_KINDS } from "../src/constants/modelActivity.ts";
import type { AgentToolKind, TrackAgentOperation } from "../src/types/modelActivity.ts";
import { isDiffPath } from "../src/utils/diff.ts";
import type { CodingReadWindow, CodingSearchResult, CodingToolBase } from "../src/types/codingTools.ts";
import type { CodingProject } from "../src/types/codingProject.ts";
import type { CodingSymbolMatch, CodingSymbolResult, CodingSymbolOptions } from "../src/types/codingSymbols.ts";
import { assertCodingReadPath, canReadCodingPath, codingReadWindow } from "./codingRead.ts";
import { searchCodingText } from "./codingSearch.ts";
import { discoverCodingProject } from "./codingProject.ts";
import { findCodingSymbols } from "./codingSymbols.ts";
import { inspectChecks } from "./check.ts";
import { AppError, ERROR_CODES, extractErrorCode } from "../src/agent-core/errors.ts";
import { modelRecord, modelString } from "../src/agent-core/session.ts";
import type { ModelMessage } from "../src/agent-core/session.ts";
import type {
  ChatMessage,
  Thread,
  WorkspaceEntry,
  WorkspaceSummary,
} from "../src/agent-core/types";

type ToolResultItem = CodingToolBase & (
  | { entries: WorkspaceEntry[] }
  | CodingReadWindow
  | CodingSearchResult
  | { project: CodingProject }
  | { symbols: CodingSymbolResult }
  | { checks: Awaited<ReturnType<typeof inspectChecks>> }
  | CodingTaskResult
  | CodingPluginResult
  | { error: string }
);

function excerpt(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + "\n[后续内容已截断]";
}

function contextMessage(title: string, data: unknown): ModelMessage {
  return {
    role: "user",
    content: `${title}。以下是工作区数据：\n${JSON.stringify(data)}`,
  };
}

export async function attachmentContext(thread: Thread, messageId?: string): Promise<ModelMessage[]> {
  const message: ChatMessage | undefined = messageId
    ? thread.messages.find(({ id }: ChatMessage): boolean => id === messageId)
    : thread.messages.filter(({ role }: ChatMessage): boolean => role === "user").at(-1);
  if (!message?.attachments?.length) return [];
  const workspace: WorkspaceSummary | undefined = thread.workspace;
  if (!workspace || (message.workspaceId && workspace.id !== message.workspaceId)) {
    throw new AppError(ERROR_CODES.WORKSPACE_ATTACHMENT_WORKSPACE_MISMATCH);
  }
  const paths: string[] = message.attachments.slice(0, CODING_TOOL_LIMITS.attachmentFiles);
  const settled: PromiseSettledResult<{ path: string; body: string; }>[] = await Promise.allSettled(
    paths.map(async (path: string): Promise<{ path: string; body: string; }> => {
      try {
        return { path, body: excerpt(await readWorkspaceFile(workspace, path), Math.floor(CODING_TOOL_LIMITS.resultChars / paths.length)) };
      } catch (error) {
        throw new AppError(ERROR_CODES.WORKSPACE_ATTACHMENT_READ_FAILED, {
          params: {
            path,
            detailCode: extractErrorCode(error, ERROR_CODES.WORKSPACE_ACCESS_FAILED).code,
          },
          cause: error,
        });
      }
    })
  );
  const files: { path: string; body: string; }[] = settled.map(
    (item: PromiseSettledResult<{ path: string; body: string; }>): { path: string; body: string; } => {
      if (item.status === "fulfilled") return item.value;
      throw item.reason;
    }
  );
  return [contextMessage("用户点名的附件", files)];
}

export function createWorkspaceToolLoop(
  thread: Thread, options: Pick<CodingToolLoopOptions, "signal" | "limits" | "limitError"> & { track?: TrackAgentOperation }
): CodingToolLoop {
  const tasks: CodingTasks = createCodingTasks();
  const { track, ...loopOptions }: typeof options = options;
  return createCodingToolLoop({
    ...loopOptions,
    execute: (tools: unknown[], signal: AbortSignal): Promise<ModelMessage> => toolContext({ thread, tasks, track }, tools, signal),
    // A snapshot or a previously blocked mutation may be useful again after
    // the plan has changed. Unchanged duplicates still consume no tool work.
    refreshKey: (tool: CodingToolRequest): string | undefined =>
      tool.name === "task_list" || tool.name === "task_update" || tool.name === "task_plan"
        ? String(tasks.revision) : undefined,
  });
}

async function toolContext(
  { thread, tasks, track }: { thread: Thread; tasks: CodingTasks; track?: TrackAgentOperation }, tools: unknown[], signal: AbortSignal
): Promise<ModelMessage> {
  const requested: unknown[] = tools.slice(0, 4);
  const workspace: WorkspaceSummary | undefined = thread.workspace;
  const settled: PromiseSettledResult<ToolResultItem>[] = await Promise.allSettled(
    requested.map((raw: unknown): Promise<ToolResultItem> => {
      const fields: Record<string, unknown> = modelRecord(raw);
      const name: string = modelString(fields.name);
      const path: string = modelString(fields.path);
      const execute = async (): Promise<ToolResultItem> => {
        signal.throwIfAborted();
        // These task calls are synchronous and therefore dispatch in input order.
        // Read-only plugin/workspace work in the same batch can overlap.
        const taskResult: CodingTaskResult | undefined = tasks.dispatch(fields);
        if (taskResult) return { name, path, ...taskResult };
        if (name === "plugin_list" || name === "plugin_call") {
          return { name, path, ...await dispatchCodingPlugin(fields, workspace, signal) };
        }
        if (!workspace) throw new AppError(ERROR_CODES.WORKSPACE_NOT_BOUND);
        assertCodingReadPath(path);
        switch (name) {
          case "list":
            return {
              name, path, entries: (await listWorkspace(workspace, path))
                .filter((entry: WorkspaceEntry): boolean => canReadCodingPath(entry.path)).slice(0, CODING_TOOL_LIMITS.listEntries),
            };
          case "read":
            return {
              name, path, ...codingReadWindow(await readWorkspaceFile(workspace, path),
                { startLine: fields.startLine, endLine: fields.endLine },
                Math.floor(CODING_TOOL_LIMITS.resultChars / requested.length)),
            };
          case "search": {
            const result: CodingSearchResult = await searchCodingText(workspace, modelString(fields.query), { directory: path, signal });
            return { name, path, ...result };
          }
          case "project": {
            const project: CodingProject = await discoverCodingProject(workspace, { directory: path, signal });
            return { name, path, project };
          }
          case "symbol": {
            const mode: CodingSymbolOptions["mode"] = fields.mode === "definitions" || fields.mode === "references" ? fields.mode : "all";
            const symbols: CodingSymbolResult = await findCodingSymbols(workspace, modelString(fields.query), { directory: path, mode, signal });
            return {
              name, path, symbols: {
                ...symbols,
                truncated: symbols.truncated || symbols.matches.length > CODING_TOOL_LIMITS.navigationItems,
                matches: symbols.matches.filter((entry: CodingSymbolMatch): boolean => canReadCodingPath(entry.path))
                  .slice(0, CODING_TOOL_LIMITS.navigationItems),
              },
            };
          }
          case "checks":
            return { name, path, checks: await inspectChecks(workspace, { cwd: path, signal }) };
          default:
            throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
        }
      };
      const kind: AgentToolKind = AGENT_TOOL_KINDS.find((entry: AgentToolKind): boolean => entry === name) ?? "tool";
      const target: string | undefined = isDiffPath(path) && canReadCodingPath(path) ? path : undefined;
      return (track ? track({ kind, target }, execute) : execute()).catch((error: unknown): ToolResultItem => {
        signal.throwIfAborted();
        return { name, path, error: workspaceErrorText(error) };
      });
    })
  );
  const results: ToolResultItem[] = settled.map((item: PromiseSettledResult<ToolResultItem>): ToolResultItem => {
    if (item.status === "fulfilled") return item.value;
    throw item.reason;
  });
  return contextMessage("工具结果", results);
}
