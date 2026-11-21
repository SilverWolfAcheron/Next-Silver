import type { ModelClient } from "../src/provider/client";
import { applyDiff, parseDiff } from "../src/model/diff";
import { getPreset } from "../src/model/presets";
import { isValidAudit } from "../src/model/seats";
import { askModel, conversationPrompt, modelRecord, modelString, readArtifacts, SessionError } from "../src/model/session";
import type { AgentSeat, Artifact, AuditVerdict, Run, Thread } from "../src/model/types";
import { readWorkspaceFileIfExists, workspaceErrorText } from "./workspace";
import { attachmentContext, toolContext } from "./workspaceContext";
import { iterationContext } from "./iterations";

const MAX_TOOLS_PER_ROUND = 4;
const MAX_FINDINGS = 20;
const MAX_ARTIFACTS = 20;
const MAX_SUMMARY = 6_000;
const MAX_FINDING = 2_000;
const MAX_AUDIT_PATCH_CONTEXT = 24_000;

const DEVELOP_RESPONSE = '{"status":"completed|blocked","summary":"工作摘要","findings":["具体发现"],"artifacts":[{"kind":"diff","title":"标题","body":"unified diff"}],"note":"阻塞原因（有时填写）"}';
const AUDIT_RESPONSE = '{"summary":"审计摘要","decisions":[{"index":0,"verdict":"refuted|retained","reason":"独立证据、反例或核验理由"}]}';

interface SeatResult {
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
    throw new SessionError("开发席位的发现列表无效，可以重试。");
  }
  return value.map((entry) => {
    const text = modelString(entry);
    if (!text || text.length > MAX_FINDING) {
      throw new SessionError("开发席位的发现为空或过长，可以重试。");
    }
    return text;
  });
}

function getAuditSubject(run: Run, seat: AgentSeat): AgentSeat {
  const developer = run.seats?.find(({ id }) => id === seat.auditFor);
  if (!developer || developer.role !== "develop" || !developer.findings.length
      || (developer.status !== "completed" && developer.status !== "blocked")) {
    throw new SessionError("没有可审计的开发发现。");
  }
  return developer;
}

function auditEvidence(developer: AgentSeat): string {
  let remaining = MAX_AUDIT_PATCH_CONTEXT;
  const drafts = (developer.drafts ?? []).flatMap(({ title, body }) => {
    if (!remaining) return [];
    const excerpt = body.slice(0, remaining);
    remaining -= excerpt.length;
    return [{ title, body: excerpt, truncated: excerpt.length < body.length }];
  });
  return JSON.stringify({
    developer: developer.title,
    findings: developer.findings.map((finding, index) => ({ index, finding })),
    drafts,
  });
}

function auditResult(reply: Record<string, unknown>, seat: AgentSeat, developer: AgentSeat): SeatResult {
  if (!Array.isArray(reply.decisions) || reply.decisions.length !== developer.findings.length
      || reply.artifacts !== undefined || reply.findings !== undefined) {
    throw new SessionError("审计必须逐条反驳或保留发现，并提供独立理由。");
  }
  const verdicts: AuditVerdict[] = [];
  const refutations: string[] = [];
  for (const [index, raw] of reply.decisions.entries()) {
    const entry = modelRecord(raw);
    const reason = modelString(entry.reason);
    if (entry.index !== index || (entry.verdict !== "refuted" && entry.verdict !== "retained")
        || !reason || reason.length > MAX_FINDING) {
      throw new SessionError("审计结论缺少发现编号、有效判定或独立理由，可以重试。");
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
    throw new SessionError("审计理由重复或只是复述开发发现，可以重试。");
  }
  return result;
}

async function developDrafts(
  value: unknown, thread: Thread, run: Run, seat: AgentSeat, signal: AbortSignal,
): Promise<Artifact[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARTIFACTS
      || value.some((raw) => {
        const item = modelRecord(raw);
        return item.kind !== "diff" || !modelString(item.title) || !modelString(item.body)
          || (item.workspaceId !== undefined && item.workspaceId !== thread.workspace?.id);
      })) {
    throw new SessionError("开发席位只能提交属于当前工作区的完整文本差异。");
  }
  const drafts = readArtifacts(value, thread, run.id);
  const scope = new Set(seat.scope);
  const changedPaths = new Set<string>();
  for (const draft of drafts) {
    for (const file of parseDiff(draft.body)) {
      const { change } = file;
      if (!change) throw new SessionError("差异含有无法验证的文件或差异块。");
      if (!scope.has(change.path)) throw new SessionError(`差异超出席位范围：${change.path}`);
      const key = change.path.normalize("NFC").toLowerCase();
      if (changedPaths.has(key)) throw new SessionError(`差异中重复提交了文件：${change.path}`);
      changedPaths.add(key);
      signal.throwIfAborted();
      if (thread.workspace) {
        try {
          const original = await readWorkspaceFileIfExists(thread.workspace, change.path, {
            allowMissingParent: change.operation === "create",
          });
          signal.throwIfAborted();
          applyDiff(change, original);
        } catch (error) {
          signal.throwIfAborted();
          throw new SessionError(`无法核对差异 ${change.path}。 ${workspaceErrorText(error)}`);
        }
      }
    }
  }
  return drafts;
}

async function developResult(
  reply: Record<string, unknown>, thread: Thread, run: Run, seat: AgentSeat, signal: AbortSignal,
): Promise<SeatResult> {
  if (reply.status !== "completed" && reply.status !== "blocked") {
    throw new SessionError("开发席位回复缺少有效状态，可以重试。");
  }
  const summary = modelString(reply.summary).slice(0, MAX_SUMMARY);
  if (!summary) throw new SessionError("开发席位回复缺少工作摘要，可以重试。");
  const findings = readFindings(reply.findings);
  const base = { summary, findings, refutations: [] };
  try {
    const drafts = await developDrafts(reply.artifacts, thread, run, seat, signal);
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

export async function runSeat(
  thread: Thread,
  run: Run,
  seat: AgentSeat,
  client: ModelClient,
  request: { model: string; signal: AbortSignal },
  onProgress: (note: string) => void,
): Promise<SeatResult> {
  request.signal.throwIfAborted();
  const policy = getPreset(thread.presetId).writePolicy;
  if (thread.mode !== "project" || policy !== "code") {
    throw new SessionError("当前预设未启用开发与审计席位。");
  }
  const developer = seat.role === "audit" ? getAuditSubject(run, seat) : undefined;
  const requirements = thread.brief?.requirements.filter(({ id }) => run.dependsOn.includes(id));
  const children = (run.seats ?? []).filter(({ role, parentId, summary }) =>
    role === "develop" && parentId === seat.id && summary,
  ).map(({ title, summary }) => ({ title, summary }));
  const requestSchema = developer ? AUDIT_RESPONSE : DEVELOP_RESPONSE;
  const iteration = run.iterations?.at(-1);
  const prompt = conversationPrompt(thread, [
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
    throw new SessionError(error instanceof Error ? error.message : "无法读取工作区附件。");
  }

  onProgress(developer ? "正在核对开发发现…" : "正在处理席位范围…");
  const reads: string[] = [];
  for (;;) {
    request.signal.throwIfAborted();
    const reply = modelRecord(await askModel(client, request, prompt));
    request.signal.throwIfAborted();
    if (!Array.isArray(reply.tools) || !reply.tools.length) {
      const result = developer
        ? auditResult(reply, seat, developer) : await developResult(reply, thread, run, seat, request.signal);
      if (reads.length) result.summary = [result.summary, "工作区读取记录", ...reads].filter(Boolean).join("\n");
      return result;
    }
    if (reply.tools.length > MAX_TOOLS_PER_ROUND) throw new SessionError("单次工具请求最多包含四项。");
    onProgress(developer ? "正在读取审计依据…" : "正在读取工作区…");
    reads.push(...reply.tools.map((raw) => {
      const tool = modelRecord(raw);
      const operation = modelString(tool.name);
      const target = modelString(tool.path) || modelString(tool.query) || "工作区根目录";
      return `${operation.slice(0, 40)} ${target.slice(0, 160)}`;
    }));
    prompt.push({ role: "assistant", content: JSON.stringify({ tools: reply.tools }) });
    prompt.push(await toolContext(thread, reply.tools, request.signal));
  }
}
