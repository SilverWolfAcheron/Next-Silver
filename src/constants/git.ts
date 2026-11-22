import type { DiffLineKind } from "../types/diff";
import type { GitFileStatus, GitStatusBadgeStyle } from "../types/git";

export const GIT_DIFF_MAX_LINES_PER_FILE: number = 1500;
export const GIT_DIFF_MAX_BUFFER_BYTES: number = 16 * 1024 * 1024;
export const GIT_UNTRACKED_MAX_FILES: number = 200;
export const GIT_UNTRACKED_MAX_BYTES: number = 256 * 1024;

export const GIT_STATUS_BADGES: Record<GitFileStatus, GitStatusBadgeStyle> = {
  added: {
    letter: "A",
    className: "text-success",
  },
  untracked: {
    letter: "U",
    className: "text-success",
  },
  modified: {
    letter: "M",
    className: "text-warning",
  },
  deleted: {
    letter: "D",
    className: "text-danger",
  },
  renamed: {
    letter: "R",
    className: "text-accent",
  },
};

export const GIT_DIFF_LINE_STYLES: Record<DiffLineKind, string> = {
  added: "bg-success/16 text-label",
  removed: "bg-danger/16 text-label",
  meta: "bg-fill/55 text-secondary",
  context: "text-label",
};

export const GIT_DIFF_GUTTER_STYLES: Record<DiffLineKind, string> = {
  added: "bg-success/20 text-success/85",
  removed: "bg-danger/20 text-danger/85",
  meta: "bg-fill/75 text-tertiary",
  context: "text-tertiary/75",
};

export const GIT_DIFF_SIGN_STYLES: Record<DiffLineKind, string> = {
  added: "bg-success/20 text-success font-semibold",
  removed: "bg-danger/20 text-danger font-semibold",
  meta: "bg-fill/75 text-tertiary",
  context: "text-tertiary/40",
};
