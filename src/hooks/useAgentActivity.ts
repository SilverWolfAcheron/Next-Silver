import { MODEL_STREAM_PHASES } from "../constants/modelActivity";
import { useRuntimeStore } from "../stores/runtimeStore";
import type { AgentActivityView } from "../types/chat";
import type { ModelActivity, ModelStreamPhase } from "../types/modelActivity";
import type { RuntimeStore } from "../types/stores";
import { useI18n } from "./useI18n";

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
    return workingLocally ? { label: t.chat.runningStatus, details: [copy.local] } : undefined;
  }
  if (activity.outcome) {
    const label: string = activity.outcome !== "ended" ? copy.outcome[activity.outcome]
      : awaitingApproval ? copy.endedAwaitingApproval : workingLocally ? copy.endedWorking : copy.outcome.ended;
    return { label, details: [] };
  }

  const phase: ModelStreamPhase = activity.streaming ? "streaming" : activity.accepted ? "accepted" : "requesting";
  const rate: number | undefined = activity.estimatedTokensPerSecond;
  return {
    label: copy.phase[phase],
    details: MODEL_STREAM_PHASES.flatMap((stage: ModelStreamPhase): string[] =>
      activity[stage] ? [copy.details[stage](activity[stage])] : []
    ),
    rate: rate ? copy.rate(rate.toLocaleString(locale)) : undefined,
    rateHint: activity.streaming ? copy.rateHint : undefined,
  };
}
