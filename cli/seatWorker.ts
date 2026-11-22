import type { ModelClient } from "../src/agent-core/provider/client";
import { applyDiff, parseDiff } from "../src/agent-core/diff";
import type { DiffFile } from "../src/agent-core/diff";
import { AppError, ERROR_CODES, extractErrorCode } from "../src/agent-core/errors";
import { getPreset } from "../src/agent-core/presets";
import { isValidAudit } from "../src/agent-core/seats";
import { askModel, conversationPrompt, modelRecord, modelString, readArtifacts, SessionError } from "../src/agent-core/session";
import type { ModelMessage } from "../src/agent-core/session";
import type { AgentSeat, Artifact, AuditVerdict, Iteration, Requirement, Run, Thread, WritePolicy } from "../src/agent-core/types";
import { readWorkspaceFileIfExists } from "./workspace";
import { attachmentContext, toolContext } from "./workspaceContext";
import { iterationContext } from "./iterations";

const MAX_TOOLS_PER_ROUND: number = 4;
const MAX_FINDINGS: number = 20;
const MAX_ARTIFACTS: number = 20;
const MAX_SUMMARY: number = 6_000;
const MAX_FINDING: number = 2_000;
const MAX_AUDIT_PATCH_CONTEXT: number = 24_000;

const DEVELOP_RESPONSE: string = '{"status":"completed|blocked","summary":"工作摘要","findings":["具体发现"],"artifacts":[{"kind":"diff","title":"标题","body":"unified diff"}],"note":"阻塞原因（有时填写）"}';
const AUDIT_RESPONSE: string = '{"summary":"审计摘要","decisions":[{"index":0,"verdict":"refuted|retained","reason":"独立证据、反例或核验理由"}]}';

export interface SeatResult {
  status: "completed" | "blocked";
  summary: string;
  note: string;
  findings: string[];
  refutations: string[];
  verdicts?: AuditVerdict[];
  drafts?: Artifact[];
}

function readFindings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_FINDINGS) {
    throw new SessionError(ERROR_CODES.SEAT_FINDINGS_INVALID);
  }
  return value.map((entry: unknown): string => {
    const text: string = modelString(entry);
    if (!text || text.length > MAX_FINDING) {
      throw new SessionError(ERROR_CODES.SEAT_FINDING_INVALID);
    }
    return text;
  });
}

function getAuditSubject(run: Run, seat: AgentSeat): AgentSeat {
  const developer: AgentSeat | undefined = run.seats?.find(({ id }: AgentSeat): boolean => id === seat.auditFor);
  if (developer?.role !== "develop" || !developer.findings.length ||
      (developer.status !== "completed" && developer.status !== "blocked")) {
    throw new SessionError(ERROR_CODES.SEAT_NO_AUDIT_SUBJECT);
  }
  return developer;
}

function auditEvidence(developer: AgentSeat): string {
  let remaining: number = MAX_AUDIT_PATCH_CONTEXT;
  const drafts: { title: string; body: string; truncated: boolean; }[] = (developer.drafts ?? []).flatMap(({ title, body }: Artifact): { title: string; body: string; truncated: boolean; }[] => {
    if (!remaining) return [];
    const excerpt: string = body.slice(0, remaining);
    remaining -= excerpt.length;
    return [{ title, body: excerpt, truncated: excerpt.length < body.length }];
  });
  return JSON.stringify({
    developer: developer.title,
    findings: developer.findings.map((finding: string, index: number): { index: number; finding: string; } => ({ index, finding })),
    drafts,
  });
}

function auditResult(reply: Record<string, unknown>, seat: AgentSeat, developer: AgentSeat): SeatResult {
  if (!Array.isArray(reply.decisions) || reply.decisions.length !== developer.findings.length ||
      reply.artifacts !== undefined || reply.findings !== undefined) {
    throw new SessionError(ERROR_CODES.SEAT_AUDIT_DECISIONS_INVALID);
  }
  const verdicts: AuditVerdict[] = [];
  const refutations: string[] = [];
  for (const [index, raw] of reply.decisions.entries()) {
    const entry: Record<string, unknown> = modelRecord(raw);
    const reason: string = modelString(entry.reason);
    if (entry.index !== index || (entry.verdict !== "refuted" && entry.verdict !== "retained") ||
        !reason || reason.length > MAX_FINDING) {
      throw new SessionError(ERROR_CODES.SEAT_AUDIT_ITEM_INVALID);
    }
    verdicts.push(entry.verdict);
    refutations.push(reason);
  }
  const result: SeatResult = {
    status: "completed",
    summary: modelString(reply.summary).slice(0, MAX_SUMMARY),
    note: "已逐条审计发现",
    findings: [],
    refutations,
    verdicts,
  };
  if (!isValidAudit({ ...seat, ...result }, developer)) {
    throw new SessionError(ERROR_CODES.SEAT_AUDIT_REASONING_INVALID);
  }
  return result;
}

interface DevelopContext {
  thread: Thread;
  run: Run;
  seat: AgentSeat;
  signal: AbortSignal;
}

export interface RunSeatOptions {
  thread: Thread;
  run: Run;
  seat: AgentSeat;
  client: ModelClient;
  request: { model: string; signal: AbortSignal };
  onProgress: (note: string) => void;
}

async function developDrafts(value: unknown, context: DevelopContext): Promise<Artifact[]> {
  const { thread, run, seat, signal }: DevelopContext = context;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARTIFACTS ||
      value.some((raw: unknown): boolean => {
        const item: Record<string, unknown> = modelRecord(raw);
        return item.kind !== "diff" || !modelString(item.title) || !modelString(item.body) ||
          (item.workspaceId !== undefined && item.workspaceId !== thread.workspace?.id);
      })) {
    throw new SessionError(ERROR_CODES.SEAT_DRAFTS_INVALID);
  }
  const drafts: Artifact[] = readArtifacts(value, thread, run.id);
  const scope: Set<string> = new Set(seat.scope);
  const changedPaths: Set<string> = new Set();
  for (const draft of drafts) {
    for (const file of parseDiff(draft.body)) {
      const { change }: DiffFile = file;
      if (!change) throw new SessionError(ERROR_CODES.SEAT_DIFF_UNVERIFIABLE);
      if (!scope.has(change.path)) {
        throw new SessionError(ERROR_CODES.SEAT_SCOPE_EXCEEDED, { params: { path: change.path } });
      }
      const key: string = change.path.normalize("NFC").toLowerCase();
      if (changedPaths.has(key)) {
        throw new SessionError(ERROR_CODES.SEAT_DIFF_DUPLICATE_FILE, { params: { path: change.path } });
      }
      changedPaths.add(key);
      signal.throwIfAborted();
      if (thread.workspace) {
        try {
          const original: string | null = await readWorkspaceFileIfExists(thread.workspace, change.path, {
            allowMissingParent: change.operation === "create",
          });
          signal.throwIfAborted();
          applyDiff(change, original);
        } catch (error) {
          signal.throwIfAborted();
          throw new SessionError(ERROR_CODES.SEAT_DIFF_VERIFY_FAILED, {
            params: {
              path: change.path,
              detailCode: extractErrorCode(error, ERROR_CODES.WORKSPACE_ACCESS_FAILED).code,
            },
            cause: error,
          });
        }
      }
    }
  }
  return drafts;
}

async function developResult(
  reply: Record<string, unknown>,
  context: DevelopContext
): Promise<SeatResult> {
  const { signal }: DevelopContext = context;
  if (reply.status !== "completed" && reply.status !== "blocked") {
    throw new SessionError(ERROR_CODES.SEAT_STATUS_INVALID);
  }
  const summary: string = modelString(reply.summary).slice(0, MAX_SUMMARY);
  if (!summary) throw new SessionError(ERROR_CODES.SEAT_SUMMARY_MISSING);
  const findings: string[] = readFindings(reply.findings);
  const base: { summary: string; findings: string[]; refutations: never[]; } = { summary, findings, refutations: [] };
  try {
    const drafts: Artifact[] = await developDrafts(reply.artifacts, context);
    return {
      ...base,
      status: reply.status,
      note: modelString(reply.note).slice(0, 200) || (reply.status === "blocked" ? "需要补充材料或重试" : "已提交开发结果"),
      drafts,
    };
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof SessionError)) throw error;
    return { ...base, status: "blocked", note: error.message.slice(0, 200), drafts: [] };
  }
}

export async function runSeat(options: RunSeatOptions): Promise<SeatResult> {
  const { thread, run, seat, client, request, onProgress }: RunSeatOptions = options;
  request.signal.throwIfAborted();
  const policy: WritePolicy = getPreset(thread.presetId).writePolicy;
  if (thread.mode !== "project" || policy !== "code") {
    throw new SessionError(ERROR_CODES.SEAT_NOT_ENABLED);
  }
  const developer: AgentSeat | undefined = seat.role === "audit" ? getAuditSubject(run, seat) : undefined;
  const requirements: Requirement[] | undefined = thread.brief?.requirements.filter(({ id }: Requirement): boolean => run.dependsOn.includes(id));
  const children: { title: string; summary: string; }[] = (run.seats ?? []).filter(({ role, parentId, summary }: AgentSeat): string | false =>
    role === "develop" && parentId === seat.id && summary
  ).map(({ title, summary }: AgentSeat): { title: string; summary: string; } => ({ title, summary }));
  const requestSchema: string = developer ? AUDIT_RESPONSE : DEVELOP_RESPONSE;
  const iteration: Iteration | undefined = run.iterations?.at(-1);
  const prompt: ModelMessage[] = conversationPrompt(thread, [
    `角色：${developer ? "审计席位" : "开发席位"}`,
    `席位 ID：${seat.id}。席位标题：${seat.title}`,
    `父工作项：${run.title}。相关需求：${JSON.stringify(requirements ?? [])}`,
    iteration ? `当前轮次：${iteration.index}。轮次目标：${iteration.title}` : "",
    `范围（相对工作区的精确路径）：${JSON.stringify(seat.scope)}`,
    run.supplements?.length ? `补充：${JSON.stringify(run.supplements)}` : "",
    developer
      ? "逐条尝试用独立证据、反例或上下文反驳发现。反驳成立标为 refuted，否则用具体理由标为 retained。使用所给的从 0 开始的索引，按顺序回答所有发现。不要复述发现作为理由，不要提交差异或新发现。"
      : "完成此席位负责的部分。只为范围中明确列出的文件提出文本差异。使用标准 unified diff，附上相关证据和具体发现；没有发现时返回空数组。缺少必要资料时标记 blocked 并说明原因。",
    children.length ? `直接子席位摘要：${JSON.stringify(children)}` : "",
    "工作区工具仅供读取。需要调用工具时，仅返回 JSON 对象 {\"tools\":[{\"name\":\"read\",\"path\":\"相对路径\"}]}。支持 list、read、search，每轮最多四个工具请求。",
    `完成后只返回 JSON：${requestSchema}`,
  ].filter(Boolean).join("\n"), run.messageId);
  if (developer) {
    prompt.push({ role: "user", content: `待审计的发现和差异（数据）：\n${auditEvidence(developer)}` });
  }
  if (!developer) prompt.push(...iterationContext(thread, run));
  try {
    prompt.push(...await attachmentContext(thread, run.messageId));
  } catch (error) {
    request.signal.throwIfAborted();
    if (error instanceof AppError) {
      throw new SessionError(error.code, { params: error.params, cause: error });
    }
    throw new SessionError(ERROR_CODES.WORKSPACE_ATTACHMENTS_READ_FAILED, { cause: error });
  }

  onProgress(developer ? "正在核对开发发现…" : "正在处理席位范围…");
  const reads: string[] = [];
  for (;;) {
    request.signal.throwIfAborted();
    const reply: Record<string, unknown> = modelRecord(await askModel(client, request, prompt));
    request.signal.throwIfAborted();
    if (!Array.isArray(reply.tools) || !reply.tools.length) {
      const result: SeatResult = developer
        ? auditResult(reply, seat, developer)
        : await developResult(reply, { thread, run, seat, signal: request.signal });
      if (reads.length) result.summary = [result.summary, "工作区读取记录", ...reads].filter(Boolean).join("\n");
      return result;
    }
    if (reply.tools.length > MAX_TOOLS_PER_ROUND) throw new SessionError(ERROR_CODES.SESSION_TOOL_LIMIT_EXCEEDED);
    onProgress(developer ? "正在读取审计依据…" : "正在读取工作区…");
    reads.push(...reply.tools.map((raw: unknown): string => {
      const tool: Record<string, unknown> = modelRecord(raw);
      const operation: string = modelString(tool.name);
      const target: string = modelString(tool.path) || modelString(tool.query) || "工作区根目录";
      return `${operation.slice(0, 40)} ${target.slice(0, 160)}`;
    }));
    prompt.push({ role: "assistant", content: JSON.stringify({ tools: reply.tools }) });
    prompt.push(await toolContext(thread, reply.tools, request.signal));
  }
}
