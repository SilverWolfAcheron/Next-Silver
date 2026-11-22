import type { JSX } from "react";
import type { EmptyStateProps } from "../../types/common";

export function EmptyState({
  title,
  description,
  action,
  className = "",
}: EmptyStateProps): JSX.Element {
  return (
    <div className={`flex flex-col items-center justify-center px-6 text-center ${className}`}>
      {title && <h1 className="text-[24px] font-semibold tracking-tight text-label">{title}</h1>}
      <p className={`${title ? "mt-2" : ""} max-w-md text-[14px] leading-6 text-secondary`}>
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
