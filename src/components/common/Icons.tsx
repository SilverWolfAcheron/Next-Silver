import type { JSX } from "react";
import type {
  ActiveIconProps,
  ExpandIconProps,
  IconProps,
  ModeIconProps,
  ToggleIconProps,
} from "../../types/common";

export function CloseIcon({ className = "h-3 w-3" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className={className}>
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({
  open = false,
  className = "h-3 w-3 shrink-0 opacity-70",
}: ToggleIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={`${className} transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M4.25 6.25 8 10l3.75-3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRightIcon({
  expanded = false,
  className = "h-3.5 w-3.5 shrink-0",
}: ExpandIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={`${className} transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BackIcon({ className = "h-3.5 w-3.5" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M9.75 4 5.75 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ className = "h-3.5 w-3.5 shrink-0 text-accent" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3.5 8.25 6.5 11.25 12.5 5.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ className = "h-3.5 w-3.5" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="7.25" cy="7.25" r="4.25" stroke="currentColor" strokeWidth="1.35" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon({ className = "h-3.5 w-3.5" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M13 8a5 5 0 1 1-1.35-3.42M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CollapseAllIcon({ className = "h-3.5 w-3.5" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3.5 5.5h9M5 8.5l3-2.5 3 2.5M5 12l3-2.5 3 2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderOutlineIcon({ className = "h-3.5 w-3.5" }: IconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.6l1.3 1.4h5.6A1.25 1.25 0 0 1 14 5.65v6.1A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75v-7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function SidebarLeftIcon({
  active = false,
  className = "h-4 w-4 shrink-0",
}: ActiveIconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      {active && (
        <path d="M3.5 2.5h2.25v11H3.5A1.5 1.5 0 0 1 2 12V4a1.5 1.5 0 0 1 1.5-1.5Z" fill="currentColor" />
      )}
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.75 2.5v11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function SidebarRightIcon({
  active = false,
  className = "h-4 w-4 shrink-0",
}: ActiveIconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
      {active && (
        <path d="M10.25 2.5h2.25A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5h-2.25v-11Z" fill="currentColor" />
      )}
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.25 2.5v11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function ModeIcon({ id, className = "h-3.5 w-3.5 shrink-0" }: ModeIconProps): JSX.Element {
  switch (id) {
    case "review":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <rect x="2.5" y="2.25" width="11" height="11.5" rx="1.75" stroke="currentColor" strokeWidth="1.35" />
          <path d="M5.25 5.75h5.5M5.25 8.5h5.5M5.25 11.25h3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case "explain":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M2.25 3.5A1.25 1.25 0 0 1 3.5 2.25h3A2.5 2.5 0 0 1 8 2.8a2.5 2.5 0 0 1 1.5-.55h3a1.25 1.25 0 0 1 1.25 1.25v8.25A1.25 1.25 0 0 1 12.5 13H9.25A1.75 1.75 0 0 0 8 13.55 1.75 1.75 0 0 0 6.75 13H3.5a1.25 1.25 0 0 1-1.25-1.25V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M8 3v10.25" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "academic":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M2.5 4.25A1.75 1.75 0 0 1 4.25 2.5h5.5A1.75 1.75 0 0 1 11.5 4.25v3.5A1.75 1.75 0 0 1 9.75 9.5H6l-2.5 2v-2h-.25A.75.75 0 0 1 2.5 8.75v-4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M11.5 6.25h.75A1.75 1.75 0 0 1 14 8v3.25a.75.75 0 0 1-.75.75H13v1.75l-2.1-1.75H7.75A1.5 1.5 0 0 1 6.3 10.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M8 1.75 9.55 6.45 14.25 8 9.55 9.55 8 14.25 6.45 9.55 1.75 8 6.45 6.45 8 1.75Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function SettingsGearIcon({
  active = false,
  className = "h-4 w-4 shrink-0",
}: ActiveIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} transition-transform duration-200 ${active ? "rotate-45" : ""}`}
    >
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}
