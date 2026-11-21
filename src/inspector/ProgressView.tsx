import type { AgentSeat, Iteration, Run, RunStatus, SeatRole } from "../model/types";
import { ProgressBar } from "../ui/ProgressBar";

interface ProgressViewProps {
  runs: Run[];
  artifactRunIds: ReadonlySet<string>;
  artifactIds?: ReadonlySet<string>;
  selectedRunId?: string;
  onSelect: (runId: string) => void;
  onViewArtifact: (runId: string) => void;
  onViewIteration?: (runId: string, artifactId: string) => void;
  onRetry: (runId: string) => void;
}

const statusInfo: Record<RunStatus, { label: string; color: string }> = {
  pending: { label: "待开始", color: "text-secondary" },
  in_progress: { label: "进行中", color: "text-accent" },
  completed: { label: "已完成", color: "text-success" },
  blocked: { label: "已阻塞", color: "text-warning" },
  paused: { label: "已暂停", color: "text-secondary" },
};

export function ProgressView({
  runs,
  artifactRunIds,
  artifactIds,
  selectedRunId,
  onSelect,
  onViewArtifact,
  onViewIteration,
  onRetry,
}: ProgressViewProps) {
  const completed = runs.filter((run) => run.status === "completed").length;
  const entries: { key: string; parallel: boolean; runs: Run[] }[] = [];
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    if (!run.parallelGroup) {
      entries.push({ key: `run:${run.id}`, parallel: false, runs: [run] });
      continue;
    }
    const existing = groups.get(run.parallelGroup);
    if (existing) {
      existing.push(run);
      continue;
    }
    const group = [run];
    groups.set(run.parallelGroup, group);
    entries.push({ key: `group:${run.parallelGroup}`, parallel: true, runs: group });
  }

  function renderRun(run: Run) {
    const hasArtifact = artifactRunIds.has(run.id);
    return (
      <RunRow
        key={run.id}
        run={run}
        selected={selectedRunId === run.id}
        onSelect={hasArtifact ? () => onSelect(run.id) : undefined}
        onViewArtifact={hasArtifact ? () => onViewArtifact(run.id) : undefined}
        artifactIds={artifactIds}
        onViewIteration={onViewIteration ? (artifactId) => onViewIteration(run.id, artifactId) : undefined}
        onRetry={() => onRetry(run.id)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <ProgressBar value={completed} total={runs.length} />
        <p className="text-[13px] text-secondary">{completed} / {runs.length} 完成</p>
      </div>

      <ul className="flex flex-col gap-1">
        {entries.map((entry) => entry.parallel ? (
          <li key={entry.key} className="flex flex-col gap-1 border-l-2 border-separator pl-2">
            <span className="px-2 text-[12px] text-secondary">同时进行</span>
            <ul className="flex flex-col gap-1">{entry.runs.map(renderRun)}</ul>
          </li>
        ) : renderRun(entry.runs[0]))}
      </ul>
    </div>
  );
}

function RunRow({ run, selected, onSelect, onViewArtifact, artifactIds, onViewIteration, onRetry }: {
  run: Run;
  selected: boolean;
  onSelect?: () => void;
  onViewArtifact?: () => void;
  artifactIds?: ReadonlySet<string>;
  onViewIteration?: (artifactId: string) => void;
  onRetry: () => void;
}) {
  const { label, color } = statusInfo[run.status];
  const retryable = run.status === "blocked" || run.status === "paused";
  const auditRetryable = run.status === "in_progress" &&
    run.seats?.some(({ role, status }) => role === "audit" && status === "blocked");
  const iterations = run.iterations ?? [];
  const note = retryable ? (run.note || iterations.at(-1)?.note) : (iterations.at(-1)?.note || run.note);
  const showNote = run.status === "in_progress" || retryable || iterations.length > 0;
  const details = (
    <>
      <span className={`text-[17px] leading-[22px] wrap-anywhere ${run.status === "pending" || run.status === "paused" ? "text-secondary" : "text-label"}`}>
        {run.title}
      </span>
      <span className={`text-[13px] leading-[18px] ${color}`}>{label}</span>
      {note && showNote && (
        <span className="text-[13px] leading-[18px] wrap-anywhere text-secondary">{note}</span>
      )}
    </>
  );
  const row = "flex min-h-11 w-full min-w-0 flex-col gap-0.5 rounded-[10px] px-2 py-1.5 text-left";

  return (
    <li className={`flex min-w-0 flex-col rounded-[10px] ${selected ? "bg-fill" : ""}`}>
      {onSelect ? (
        <button type="button" className={`${row} hover:bg-fill`} aria-pressed={selected} onClick={onSelect}>
          {details}
        </button>
      ) : (
        <div className={row}>{details}</div>
      )}
      {!!run.seats?.length && <SeatProgress seats={run.seats} />}
      {!!iterations.length && (
        <ol aria-label="工作轮次" className="mx-2 mb-2 flex flex-col gap-0.5 border-l border-separator pl-2">
          {iterations.map((iteration) => {
            const artifactId = iteration.artifactIds.find((id) => artifactIds?.has(id));
            return <IterationRow key={iteration.id} iteration={iteration} onViewArtifact={
              artifactId && onViewIteration ? () => onViewIteration(artifactId) : undefined
            } />;
          })}
        </ol>
      )}
      {(retryable || auditRetryable || (selected && onViewArtifact)) && (
        <div className="flex flex-wrap gap-x-2">
          {(retryable || auditRetryable) && (
            <button
              type="button"
              aria-label={auditRetryable ? `重试审计 ${run.title}` : `重试工作项 ${run.title}`}
              className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-group"
              onClick={onRetry}
            >
              {auditRetryable ? "重试审计" : "重试"}
            </button>
          )}
          {selected && onViewArtifact && (
            <button
              type="button"
              className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-group"
              onClick={onViewArtifact}
            >
              查看产物
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function IterationRow({ iteration, onViewArtifact }: { iteration: Iteration; onViewArtifact?: () => void }) {
  const { label, color } = statusInfo[iteration.status];
  const title = `第 ${iteration.index} 轮 · ${iteration.title}`;
  const row = "flex min-h-11 w-full min-w-0 flex-col gap-0.5 rounded-[10px] px-2 py-1 text-left text-[13px] leading-[18px] wrap-anywhere";
  const details = (
    <>
      <span className="text-label">{title}</span>
      <span className={color}>{label}</span>
      {iteration.note && <span className="line-clamp-1 text-secondary" title={iteration.note}>{iteration.note}</span>}
    </>
  );
  return (
    <li>
      {onViewArtifact ? (
        <button type="button" aria-label={`查看${title}的产物`} className={`${row} hover:bg-fill`} onClick={onViewArtifact}>
          {details}
        </button>
      ) : <div className={row}>{details}</div>}
    </li>
  );
}

const seatGroups: { role: SeatRole; title: string }[] = [
  { role: "develop", title: "开发" },
  { role: "audit", title: "审计" },
];

function SeatProgress({ seats }: { seats: AgentSeat[] }) {
  const activeDevelopers = seats.filter((seat) => seat.role === "develop" && seat.status === "in_progress").length;
  const activeAuditors = seats.filter((seat) => seat.role === "audit" && seat.status === "in_progress").length;
  const titles = new Map(seats.map(({ id, title }) => [id, title]));

  return (
    <div className="mx-2 mb-2 flex min-w-0 flex-col gap-2 border-t border-separator pt-2">
      <p role="status" aria-label="席位进行中计数" className="text-[13px] leading-[18px] text-secondary">
        开发 {activeDevelopers} 进行中 · 审计 {activeAuditors} 进行中
      </p>
      <div className="grid grid-cols-2 gap-x-2">
        {seatGroups.map(({ role, title }) => {
          const group = seats.filter((seat) => seat.role === role);
          return (
            <section key={role} aria-label={title} className="min-w-0">
              <h3 className="px-1 text-[12px] font-semibold text-secondary">{title}</h3>
              {group.length ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {group.map((seat) => (
                    <SeatRow
                      key={seat.id}
                      seat={seat}
                      parentTitle={seat.parentId ? titles.get(seat.parentId) : undefined}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-1 py-1 text-[13px] text-secondary">暂无席位</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SeatRow({ seat, parentTitle }: { seat: AgentSeat; parentTitle?: string }) {
  const { label, color } = statusInfo[seat.status];
  const expandable = Boolean(
    seat.summary || seat.scope.length || seat.findings.length || seat.refutations.length || parentTitle,
  );
  const row = "flex min-h-11 min-w-0 flex-col gap-0.5 rounded-[10px] px-1.5 py-1 text-[13px] leading-[18px] wrap-anywhere";
  const content = (
    <>
      <span className="text-label">{seat.title}</span>
      <span className={color}>{label}</span>
      {seat.note && <span className="text-secondary">{seat.note}</span>}
    </>
  );

  return (
    <li>
      {expandable ? (
        <details className="group rounded-[10px] open:bg-group">
          <summary className={`${row} relative cursor-pointer list-none pr-5 hover:bg-fill [&::-webkit-details-marker]:hidden`}>
            {content}
            <span aria-hidden="true" className="absolute top-1 right-1.5 text-secondary group-open:rotate-90">›</span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-separator px-1.5 py-2 text-[13px] leading-[18px] wrap-anywhere text-secondary">
            {parentTitle && <p>上级席位 {parentTitle}</p>}
            {seat.summary && <p className="whitespace-pre-wrap">{seat.summary}</p>}
            {seat.scope.length > 0 && (
              <div>
                <p className="font-medium">范围</p>
                <ul>{seat.scope.map((path) => <li key={path}>{path}</li>)}</ul>
              </div>
            )}
            {seat.findings.length > 0 && (
              <div>
                <p className="font-medium">发现</p>
                <ul className="list-disc pl-4">
                  {seat.findings.map((finding, index) => <li key={index}>{finding}</li>)}
                </ul>
              </div>
            )}
            {seat.refutations.length > 0 && (
              <ul className="list-disc pl-4">
                {seat.refutations.map((reason, index) => {
                  const verdict = seat.verdicts?.[index];
                  return (
                    <li key={index}>
                      {verdict && <strong className="block font-medium text-label">{verdict === "refuted" ? "已反驳" : "已保留"}</strong>}
                      <p>{reason}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </details>
      ) : <div className={row}>{content}</div>}
    </li>
  );
}
