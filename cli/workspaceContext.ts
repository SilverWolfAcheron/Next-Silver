import { listWorkspace, readWorkspaceFile, searchWorkspaceText, workspaceErrorText } from "./workspace";
import { modelRecord, modelString, type ModelMessage } from "../src/model/session";
import type { Thread } from "../src/model/types";

const MAX_CHARS = 32_000;

function excerpt(text: string, limit: number) {
  return text.length <= limit ? text : text.slice(0, limit) + "\n[后续内容已截断]";
}

function contextMessage(title: string, data: unknown): ModelMessage {
  return {
    role: "user",
    content: `${title}。以下是工作区数据：\n${JSON.stringify(data)}`,
  };
}

export async function attachmentContext(thread: Thread, messageId?: string): Promise<ModelMessage[]> {
  const message = messageId
    ? thread.messages.find(({ id }) => id === messageId)
    : thread.messages.filter(({ role }) => role === "user").at(-1);
  if (!message?.attachments?.length) return [];
  const workspace = thread.workspace;
  if (!workspace || (message.workspaceId && workspace.id !== message.workspaceId)) {
    throw new Error("附件所属的文件夹已更换，请绑定原文件夹或重新附加文件。");
  }
  const paths = message.attachments.slice(0, 8);
  const files = await Promise.all(paths.map(async (path) => {
    try {
      return { path, body: excerpt(await readWorkspaceFile(workspace, path), Math.floor(MAX_CHARS / paths.length)) };
    } catch (error) {
      throw new Error(`无法读取附件 ${path}。 ${workspaceErrorText(error)}`);
    }
  }));
  return [contextMessage("用户点名的附件", files)];
}

export async function toolContext(thread: Thread, tools: unknown[], signal: AbortSignal): Promise<ModelMessage> {
  const requested = tools.slice(0, 4);
  const workspace = thread.workspace;
  const results = await Promise.all(requested.map(async (raw) => {
    const fields = modelRecord(raw);
    const name = modelString(fields.name);
    const path = modelString(fields.path);
    try {
      signal.throwIfAborted();
      if (!workspace) throw new Error("请先绑定工作区文件夹。");
      switch (name) {
        case "list":
          return { name, path, entries: (await listWorkspace(workspace, path)).slice(0, 120) };
        case "read":
          return { name, path, body: excerpt(await readWorkspaceFile(workspace, path), Math.floor(MAX_CHARS / requested.length)) };
        case "search": {
          const query = modelString(fields.query);
          if (!query) throw new Error("搜索文字为空。");
          return { name, query, matches: await searchWorkspaceText(workspace, query, 24, signal) };
        }
        default:
          throw new Error("此操作不可用。可以列出目录、读取文件或搜索文字。");
      }
    } catch (error) {
      signal.throwIfAborted();
      return { name, path, error: workspaceErrorText(error) };
    }
  }));
  return contextMessage("工具结果", results);
}
