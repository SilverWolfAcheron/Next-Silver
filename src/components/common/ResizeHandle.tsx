import type { JSX } from "react";
import type { ResizeHandleProps } from "../../types/common";

export function ResizeHandle({
  label,
  tooltip,
  value,
  min,
  max,
  active,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: ResizeHandleProps): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={tooltip}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className="group/resizer relative z-20 hidden w-2 shrink-0 cursor-col-resize select-none items-center justify-center min-[960px]:flex focus:outline-none"
    >
      <span
        aria-hidden="true"
        className={`w-1 rounded-full transition-all duration-150 ${
          active
            ? "h-24 bg-accent"
            : "h-12 bg-transparent group-hover/resizer:bg-accent/55 group-focus-visible/resizer:bg-accent"
        }`}
      />
    </div>
  );
}
