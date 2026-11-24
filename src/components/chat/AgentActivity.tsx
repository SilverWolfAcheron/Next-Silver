import { Fragment } from "react";
import type { JSX } from "react";
import { useAgentActivity } from "../../hooks/useAgentActivity";
import type { AgentActivityView } from "../../types/chat";
import { ChevronRightIcon } from "../common/Icons";

export function AgentActivity(): JSX.Element {
  const activity: AgentActivityView | undefined = useAgentActivity();

  return (
    <Fragment>
      <span role="status" className="sr-only">{activity?.label}</span>
      {activity && (activity.details.length || activity.operations?.length ? (
        <div className="shrink-0 px-4">
          <details className="group mx-auto max-w-4xl rounded-[10px] border border-separator bg-group text-[12px] text-secondary">
            <summary className="flex min-h-8 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[9px] px-2.5 py-1 hover:bg-fill [&::-webkit-details-marker]:hidden">
              {activity.active && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />}
              <span className="min-w-0 flex-1 basis-36 wrap-anywhere">{activity.label}</span>
              {activity.rate && <span className="shrink-0 font-mono tabular-nums">{activity.rate}</span>}
              {activity.operationCount && <span className="shrink-0">{activity.operationCount}</span>}
              <ChevronRightIcon className="h-3 w-3 shrink-0 group-open:rotate-90" />
            </summary>
            <div className="max-h-48 space-y-1.5 overflow-y-auto border-t border-separator px-3 py-2">
              {activity.operations && activity.operations.length > 0 && (
                <ul className="space-y-1">
                  {activity.operations.map(({ id, label, status }: NonNullable<AgentActivityView["operations"]>[number]): JSX.Element => (
                    <li key={id} className="flex items-start justify-between gap-2">
                      <span className="min-w-0 wrap-anywhere text-label">{label}</span>
                      <span className="shrink-0 text-secondary">{status}</span>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="space-y-0.5">
                {activity.details.map((detail: string): JSX.Element => <li key={detail}>{detail}</li>)}
              </ul>
              {activity.rateHint && <p>{activity.rateHint}</p>}
            </div>
          </details>
        </div>
      ) : (
        <div className="shrink-0 px-4">
          <p aria-hidden="true" className="mx-auto max-w-4xl rounded-[10px] border border-separator bg-group px-2.5 py-1.5 text-[12px] text-secondary">
            {activity.label}
          </p>
        </div>
      ))}
    </Fragment>
  );
}
