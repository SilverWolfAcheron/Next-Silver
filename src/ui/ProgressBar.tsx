interface ProgressBarProps {
  value: number;
  total: number;
  className?: string;
}

export function ProgressBar({ value, total, className = "" }: ProgressBarProps) {
  const pct = total === 0 ? 0 : Math.min(1, value / total);
  return (
    <div
      className={`h-1 w-full rounded-full bg-fill overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div
        className="h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out"
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}
