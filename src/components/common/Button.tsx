import type { JSX } from "react";
import type { ButtonProps } from "../../types/common";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const base: string =
    "inline-flex items-center justify-center min-h-[44px] px-4 rounded-[10px] text-[17px] font-medium transition-opacity disabled:opacity-40 cursor-default select-none";
  const variants: Record<"primary" | "ghost", string> = {
    primary: "bg-accent text-on-accent hover:opacity-90 active:opacity-75",
    ghost: "bg-transparent text-accent hover:bg-fill active:opacity-75",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
