import { Fragment } from "react";
import type { JSX } from "react";
import type { AgentSeat, AuditVerdict, Iteration, Run, SeatRole } from "../../agent-core/types";
import { SEAT_ROLE_ORDER } from "../../constants/inspector";
import { RUN_STATUS_COLORS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatLocalizedText } from "../../i18n/errors";
import type {
  IterationRowProps,
  ParallelRunEntry,
  ProgressViewProps,
  RunRowProps,
  SeatProgressProps,
  SeatRowProps,
} from "../../types/inspector";
import { groupRunsByParallel } from "../../utils/inspectorData";
import { ProgressBar } from "../common/ProgressBar";

export function ProgressView({
  runs,
  artifactRunIds,
  artifactIds,
  selectedRunId,
  onSelect,
  onViewArtifact,
  onViewIteration,
  onRetry,
}: ProgressViewProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const completed: number = runs.filter((run: Run): boolean => run.status === "completed").length;
  const entries: ParallelRunEntry[] = groupRunsByParallel(runs);

  function renderRun(run: Run): JSX.Element {
    const hasArtifact: boolean = artifactRunIds.has(run.id);
    return (
      <RunRow
        key={run.id}
        run={run}
        selected={selectedRunId === run.id}
        onSelect={hasArtifact ? (): void => onSelect(run.id) : undefined}
        onViewArtifact={hasArtifact ? (): void => onViewArtifact(run.id) : undefined}
        artifactIds={artifactIds}
        onViewIteration={
          onViewIteration
            ? (artifactId: string): void => onViewIteration(run.id, artifactId)
            : undefined
        }
        onRetry={(): void => onRetry(run.id)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <ProgressBar value={completed} total={runs.length} />
        <p className="text-[13px] text-secondary">{t.progress.completedCount(completed, runs.length)}</p>
      </div>

      <ul className="flex flex-col gap-1">
        {entries.map((entry: ParallelRunEntry): JSX.Element =>
          entry.parallel ? (
            <li key={entry.key} className="flex flex-col gap-1 border-l-2 border-separator pl-2">
              <span className="px-2 text-[12px] text-secondary">{t.progress.parallelGroup}</span>
              <ul className="flex flex-col gap-1">{entry.runs.map(renderRun)}</ul>
            </li>
          ) : (
            renderRun(entry.runs[0])
          )
        )}
      </ul>
    </div>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
  onViewArtifact,
  artifactIds,
  onViewIteration,
  onRetry,
}: RunRowProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const label: string = t.progress.statuses[run.status];
  const color: string = RUN_STATUS_COLORS[run.status];
  const retryable: boolean = run.status === "blocked" || run.status === "paused";
  const auditRetryable: boolean =
    run.status === "in_progress" &&
    Boolean(
      run.seats?.some(
        ({ role, status }: AgentSeat): boolean => role === "audit" && status === "blocked"
      )
    );
  const iterations: Iteration[] = run.iterations ?? [];
  const note: string | undefined = retryable
    ? run.note || iterations.at(-1)?.note
    : iterations.at(-1)?.note || run.note;
  const showNote: boolean = run.status === "in_progress" || retryable || iterations.length > 0;
  const rowClass: string =
    "flex min-h-11 w-full min-w-0 flex-col gap-0.5 rounded-[10px] px-2 py-1.5 text-left";

  const details: JSX.Element = (
    <Fragment>
      <span
        className={`text-[17px] leading-[22px] wrap-anywhere ${
          run.status === "pending" || run.status === "paused" ? "text-secondary" : "text-label"
        }`}
      >
        {run.title}
      </span>
      <span className={`text-[13px] leading-[18px] ${color}`}>{label}</span>
      {note && showNote && (
        <span className="text-[13px] leading-[18px] wrap-anywhere text-secondary">
          {formatLocalizedText(note, t)}
        </span>
      )}
    </Fragment>
  );

  return (
    <li className={`flex min-w-0 flex-col rounded-[10px] ${selected ? "bg-fill" : ""}`}>
      {onSelect ? (
        <button type="button" className={`${rowClass} hover:bg-fill`} aria-pressed={selected} onClick={onSelect}>
          {details}
        </button>
      ) : (
        <div className={rowClass}>{details}</div>
      )}

      {!!run.seats?.length && <SeatProgress seats={run.seats} />}

      {!!iterations.length && (
        <ol
          aria-label={t.progress.iterationsLabel}
          className="mx-2 mb-2 flex flex-col gap-0.5 border-l border-separator pl-2"
        >
          {iterations.map((iteration: Iteration): JSX.Element => {
            const artifactId: string | undefined = iteration.artifactIds.find(
              (id: string): boolean => Boolean(artifactIds?.has(id))
            );
            return (
              <IterationRow
                key={iteration.id}
                iteration={iteration}
                onViewArtifact={
                  artifactId && onViewIteration
                    ? (): void => onViewIteration(artifactId)
                    : undefined
                }
              />
            );
          })}
        </ol>
      )}

      {(retryable || auditRetryable || (selected && onViewArtifact)) && (
        <div className="flex flex-wrap gap-x-2">
          {(retryable || auditRetryable) && (
            <button
              type="button"
              aria-label={
                auditRetryable
                  ? t.progress.retryAuditLabel(run.title)
                  : t.progress.retryRunLabel(run.title)
              }
              className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-group"
              onClick={onRetry}
            >
              {auditRetryable ? t.progress.retryAudit : t.common.retry}
            </button>
          )}
          {selected && onViewArtifact && (
            <button
              type="button"
              className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-group"
              onClick={onViewArtifact}
            >
              {t.progress.viewArtifact}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function IterationRow({ iteration, onViewArtifact }: IterationRowProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const label: string = t.progress.statuses[iteration.status];
  const color: string = RUN_STATUS_COLORS[iteration.status];
  const title: string = t.progress.iterationTitle(iteration.index, iteration.title);
  const rowClass: string =
    "flex min-h-11 w-full min-w-0 flex-col gap-0.5 rounded-[10px] px-2 py-1 text-left text-[13px] leading-[18px] wrap-anywhere";

  const details: JSX.Element = (
    <Fragment>
      <span className="text-label">{title}</span>
      <span className={color}>{label}</span>
      {iteration.note && (
        <span
          className="line-clamp-1 text-secondary"
          title={formatLocalizedText(iteration.note, t)}
        >
          {formatLocalizedText(iteration.note, t)}
        </span>
      )}
    </Fragment>
  );

  return (
    <li>
      {onViewArtifact ? (
        <button
          type="button"
          aria-label={t.progress.viewIterationArtifact(title)}
          className={`${rowClass} hover:bg-fill`}
          onClick={onViewArtifact}
        >
          {details}
        </button>
      ) : (
        <div className={rowClass}>{details}</div>
      )}
    </li>
  );
}

function SeatProgress({ seats }: SeatProgressProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const activeDevelopers: number = seats.filter(
    (seat: AgentSeat): boolean => seat.role === "develop" && seat.status === "in_progress"
  ).length;
  const activeAuditors: number = seats.filter(
    (seat: AgentSeat): boolean => seat.role === "audit" && seat.status === "in_progress"
  ).length;
  const titles: Map<string, string> = new Map(
    seats.map(({ id, title }: AgentSeat): [string, string] => [id, title])
  );

  return (
    <div className="mx-2 mb-2 flex min-w-0 flex-col gap-2 border-t border-separator pt-2">
      <p
        role="status"
        aria-label={t.progress.seatActiveLabel}
        className="text-[13px] leading-[18px] text-secondary"
      >
        {t.progress.seatActiveSummary(activeDevelopers, activeAuditors)}
      </p>
      <div className="grid grid-cols-2 gap-x-2">
        {SEAT_ROLE_ORDER.map((role: SeatRole): JSX.Element => {
          const title: string = t.progress.seatRoles[role];
          const group: AgentSeat[] = seats.filter((seat: AgentSeat): boolean => seat.role === role);
          return (
            <section key={role} aria-label={title} className="min-w-0">
              <h3 className="px-1 text-[12px] font-semibold text-secondary">{title}</h3>
              {group.length ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {group.map((seat: AgentSeat): JSX.Element => (
                    <SeatRow
                      key={seat.id}
                      seat={seat}
                      parentTitle={seat.parentId ? titles.get(seat.parentId) : undefined}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-1 py-1 text-[13px] text-secondary">{t.progress.noSeats}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SeatRow({ seat, parentTitle }: SeatRowProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const label: string = t.progress.statuses[seat.status];
  const color: string = RUN_STATUS_COLORS[seat.status];
  const expandable: boolean = Boolean(
    seat.summary || seat.scope.length || seat.findings.length || seat.refutations.length || parentTitle
  );
  const rowClass: string =
    "flex min-h-11 min-w-0 flex-col gap-0.5 rounded-[10px] px-1.5 py-1 text-[13px] leading-[18px] wrap-anywhere";

  const content: JSX.Element = (
    <Fragment>
      <span className="text-label">{seat.title}</span>
      <span className={color}>{label}</span>
      {seat.note && <span className="text-secondary">{formatLocalizedText(seat.note, t)}</span>}
    </Fragment>
  );

  return (
    <li>
      {expandable ? (
        <details className="group rounded-[10px] open:bg-group">
          <summary
            className={`${rowClass} relative cursor-pointer list-none pr-5 hover:bg-fill [&::-webkit-details-marker]:hidden`}
          >
            {content}
            <span aria-hidden="true" className="absolute top-1 right-1.5 text-secondary group-open:rotate-90">
              ›
            </span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-separator px-1.5 py-2 text-[13px] leading-[18px] wrap-anywhere text-secondary">
            {parentTitle && <p>{t.progress.parentSeat(parentTitle)}</p>}
            {seat.summary && <p className="whitespace-pre-wrap">{seat.summary}</p>}
            {seat.scope.length > 0 && (
              <div>
                <p className="font-medium">{t.progress.scope}</p>
                <ul>
                  {seat.scope.map((path: string): JSX.Element => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </div>
            )}
            {seat.findings.length > 0 && (
              <div>
                <p className="font-medium">{t.progress.findings}</p>
                <ul className="list-disc pl-4">
                  {seat.findings.map((finding: string, index: number): JSX.Element => (
                    <li key={index}>{finding}</li>
                  ))}
                </ul>
              </div>
            )}
            {seat.refutations.length > 0 && (
              <ul className="list-disc pl-4">
                {seat.refutations.map((reason: string, index: number): JSX.Element => {
                  const verdict: AuditVerdict | undefined = seat.verdicts?.[index];
                  return (
                    <li key={index}>
                      {verdict && (
                        <strong className="block font-medium text-label">
                          {verdict === "refuted" ? t.progress.refuted : t.progress.retained}
                        </strong>
                      )}
                      <p>{reason}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </details>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}
