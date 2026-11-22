import type { JSX } from "react";
import type { FileTreeIconProps, FolderTreeIconProps } from "../../types/common";
import { getFileIconTone } from "../../utils/workspaceData";

export function FolderTreeIcon({ open }: FolderTreeIconProps): JSX.Element {
  if (open) {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-amber-600/85 dark:text-amber-400/80">
        <path
          d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h2.7a1.25 1.25 0 0 1 .92.4l.83.9H13a1.25 1.25 0 0 1 1.25 1.25V6H2.75l-1 6.5V3.75Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M2.2 12.75 3.3 6.5h11.15l-1.15 5.45a1.1 1.1 0 0 1-1.08.8H2.2Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-amber-600/80 dark:text-amber-400/75">
      <path
        d="M2 4a1.25 1.25 0 0 1 1.25-1.25h2.65a1.25 1.25 0 0 1 .93.42l.82.93H12.75A1.25 1.25 0 0 1 14 5.35v6.4A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75V4Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FileTreeIcon({ name }: FileTreeIconProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={`h-4 w-4 shrink-0 ${getFileIconTone(name)}`}>
      <path
        d="M4 2.25h5.2L12.75 5.8v7.95a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75V3a.75.75 0 0 1 .75-.75Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 2.5v3.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
