import { AGENT_TOOL_KINDS, MODEL_STREAM_PHASES } from "../constants/modelActivity";
import { useRuntimeStore } from "../stores/runtimeStore";
import type { AgentActivityView } from "../types/chat";
import type { AgentOperation, AgentToolKind, ModelActivity, ModelStreamPhase } from "../types/modelActivity";
import type { RuntimeStore } from "../types/stores";
import { useI18n } from "./useI18n";

function isLocalOperation({ kind }: AgentOperation): boolean {
  return kind === "check" || kind === "apply" || kind === "preflight" || AGENT_TOOL_KINDS.some((tool: AgentToolKind): boolean => tool === kind);
}

export function useAgentActivity(): AgentActivityView | undefined {
  const { locale, t }: ReturnType<typeof useI18n> = useI18n();
  const activity: ModelActivity | undefined = useRuntimeStore((s: RuntimeStore): ModelActivity | undefined =>
    s.currentThread ? s.modelActivity?.[s.currentThread.id] : undefined
  );
  const workingLocally: boolean = useRuntimeStore((s: RuntimeStore): boolean =>
    Boolean(s.currentThread && !s.currentThread.pendingConfirmation && s.busyThreads.includes(s.currentThread.id))
  );
  const awaitingApproval: boolean = useRuntimeStore((s: RuntimeStore): boolean => Boolean(s.currentThread?.pendingConfirmation));
  const copy: typeof t.chat.modelActivity = t.chat.modelActivity;
  if (!activity) {
    if (awaitingApproval) return { label: copy.awaitingApproval, details: [] };
    return workingLocally ? { label: t.chat.runningStatus, details: [copy.local], active: true } : undefined;
  }

  const operations: AgentOperation[] = activity.operations ?? [];
  const active: AgentOperation[] = operations.filter(({ status }: AgentOperation): boolean => status === "running");
  const current: AgentOperation | undefined = active.filter(isLocalOperation).at(-1) ?? active.at(-1);
  const phase: ModelStreamPhase | undefined = activity.streaming ? "streaming" : activity.accepted ? "accepted"
    : activity.requesting ? "requesting" : undefined;
  const operationLabel = ({ kind, target }: AgentOperation): string => target ? `${copy.operations[kind]} · ${target}` : copy.operations[kind];
  let label: string;
  if (current) {
    label = operationLabel(current);
    if (phase && !isLocalOperation(current)) label = `${label} · ${copy.phase[phase]}`;
  } else if (phase) {
    label = copy.phase[phase];
  } else if (awaitingApproval) {
    label = activity.outcome === "ended" ? copy.endedAwaitingApproval : copy.awaitingApproval;
  } else if (!workingLocally && operations[0]?.status === "failed") {
    label = `${operationLabel(operations[0])} · ${copy.operationStatus.failed}`;
  } else if (activity.outcome) {
    label = activity.outcome === "ended" && workingLocally ? copy.endedWorking : copy.outcome[activity.outcome];
  } else {
    label = t.chat.runningStatus;
    if (!workingLocally && operations[0]) label = `${operationLabel(operations[0])} · ${copy.operationStatus[operations[0].status]}`;
  }

  const rate: number | undefined = activity.estimatedTokensPerSecond;
  return {
    label,
    active: current !== undefined || phase !== undefined || workingLocally,
    details: MODEL_STREAM_PHASES.flatMap((stage: ModelStreamPhase): string[] =>
      activity[stage] ? [copy.details[stage](activity[stage])] : []
    ),
    operations: operations.map((operation: AgentOperation): NonNullable<AgentActivityView["operations"]>[number] => ({
      id: operation.id, label: operationLabel(operation), status: copy.operationStatus[operation.status],
    })),
    operationCount: operations.length ? copy.operationCount(operations.length) : undefined,
    rate: rate ? copy.rate(rate.toLocaleString(locale)) : undefined,
    rateHint: activity.streaming ? copy.rateHint : undefined,
  };
}
