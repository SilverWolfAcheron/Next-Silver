import { listWorkspace, readWorkspaceFile, searchWorkspaceText, workspaceErrorText } from "./workspace";
import { AppError, ERROR_CODES, extractErrorCode } from "../src/agent-core/errors";
import { modelRecord, modelString } from "../src/agent-core/session";
import type { ModelMessage } from "../src/agent-core/session";
import type {
  ChatMessage,
  Thread,
  WorkspaceEntry,
  WorkspaceSummary,
  WorkspaceTextMatch,
} from "../src/agent-core/types";

type ToolResultItem =
  | { name: string; path: string; entries: WorkspaceEntry[] }
  | { name: string; path: string; body: string }
  | { name: string; query: string; matches: WorkspaceTextMatch[] }
  | { name: string; path: string; error: string };

const MAX_CHARS: number = 32_000;

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
  const paths: string[] = message.attachments.slice(0, 8);
  const settled: PromiseSettledResult<{ path: string; body: string; }>[] = await Promise.allSettled(
    paths.map(async (path: string): Promise<{ path: string; body: string; }> => {
      try {
        return { path, body: excerpt(await readWorkspaceFile(workspace, path), Math.floor(MAX_CHARS / paths.length)) };
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

export async function toolContext(thread: Thread, tools: unknown[], signal: AbortSignal): Promise<ModelMessage> {
  const requested: unknown[] = tools.slice(0, 4);
  const workspace: WorkspaceSummary | undefined = thread.workspace;
  const settled: PromiseSettledResult<ToolResultItem>[] = await Promise.allSettled(
    requested.map(async (raw: unknown): Promise<ToolResultItem> => {
      const fields: Record<string, unknown> = modelRecord(raw);
      const name: string = modelString(fields.name);
      const path: string = modelString(fields.path);
      try {
        signal.throwIfAborted();
        if (!workspace) throw new AppError(ERROR_CODES.WORKSPACE_NOT_BOUND);
        switch (name) {
          case "list":
            return { name, path, entries: (await listWorkspace(workspace, path)).slice(0, 120) };
          case "read":
            return { name, path, body: excerpt(await readWorkspaceFile(workspace, path), Math.floor(MAX_CHARS / requested.length)) };
          case "search": {
            const query: string = modelString(fields.query);
            if (!query) throw new AppError(ERROR_CODES.WORKSPACE_SEARCH_QUERY_EMPTY);
            return { name, query, matches: await searchWorkspaceText(workspace, query, { limit: 24, signal }) };
          }
          default:
            throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
        }
      } catch (error) {
        signal.throwIfAborted();
        return { name, path, error: workspaceErrorText(error) };
      }
    })
  );
  const results: ToolResultItem[] = settled.map((item: PromiseSettledResult<ToolResultItem>): ToolResultItem => {
    if (item.status === "fulfilled") return item.value;
    throw item.reason;
  });
  return contextMessage("工具结果", results);
}
