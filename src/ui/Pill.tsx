import type { ButtonHTMLAttributes, ReactNode } from "react";

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
}

export function Pill({ selected = false, className = "", children, ...rest }: PillProps) {
  const base =
    "inline-flex items-center justify-center rounded-full font-medium border transition-colors cursor-default select-none";
  const state = selected
    ? "bg-fill border-transparent text-label"
    : "bg-transparent border-separator text-secondary hover:border-accent hover:text-accent";
  return (
    <button className={`${base} ${state} ${className}`} {...rest}>
      {children}
    </button>
  );
}
