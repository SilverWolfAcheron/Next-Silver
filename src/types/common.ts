import type {
  ButtonHTMLAttributes,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";

export type RgbTuple = [number, number, number];

export interface WindowThemePayload {
  dark: boolean;
  bg: RgbTuple;
  fg: RgbTuple;
  border: RgbTuple;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

export interface CopyButtonProps {
  text: string;
}

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
}

export interface ProgressBarProps {
  value: number;
  total: number;
  className?: string;
}

export interface SideRowProps {
  label: string;
  selected?: boolean;
  meta?: string;
  icon?: ReactNode;
  onClick?: () => void;
}

export interface ResizeHandleProps {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  active: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export interface ModalDialogProps {
  labelledBy: string;
  className: string;
  onClose: () => void;
  onEscape?: () => void;
  restoreFocus?: () => boolean;
  children: ReactNode;
}

export interface EmptyStateProps {
  title?: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export interface IconProps {
  className?: string;
}

export interface ToggleIconProps {
  open?: boolean;
  className?: string;
}

export interface ExpandIconProps {
  expanded?: boolean;
  className?: string;
}

export interface ActiveIconProps {
  active?: boolean;
  className?: string;
}

export interface ModeIconProps {
  id: string;
  className?: string;
}

export interface FolderTreeIconProps {
  open: boolean;
}

export interface FileTreeIconProps {
  name: string;
}
