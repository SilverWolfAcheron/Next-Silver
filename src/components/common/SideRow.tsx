import type { JSX } from "react";
import type { SideRowProps } from "../../types/common";

export function SideRow({
  label,
  selected = false,
  meta,
  icon,
  onClick,
}: SideRowProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 min-h-[44px] rounded-[10px] text-left transition-colors cursor-default select-none ${
        selected ? "bg-fill" : "hover:bg-fill/60"
      }`}
    >
      {icon && <span className="shrink-0 text-secondary">{icon}</span>}
      <span className="flex-1 truncate text-[17px] text-label">{label}</span>
      {meta && <span className="shrink-0 text-[13px] text-tertiary">{meta}</span>}
    </button>
  );
}
