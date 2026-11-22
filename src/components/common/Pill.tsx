import type { JSX } from "react";
import type { PillProps } from "../../types/common";

export function Pill({
  selected = false,
  className = "",
  children,
  ...rest
}: PillProps): JSX.Element {
  const base: string =
    "inline-flex items-center justify-center rounded-full font-medium border transition-colors cursor-default select-none";
  const state: string = selected
    ? "bg-fill border-transparent text-label"
    : "bg-transparent border-separator text-secondary hover:border-accent hover:text-accent";
  return (
    <button className={`${base} ${state} ${className}`} {...rest}>
      {children}
    </button>
  );
}
