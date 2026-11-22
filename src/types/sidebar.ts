import type { SyntheticEvent } from "react";
import type { Thread } from "../agent-core/types";

export interface GroupedThreads {
  filtered: Thread[];
  pinned: Thread[];
  regular: Thread[];
}

export interface RenameDraft {
  id: string;
  title: string;
}

export interface DataStatusNotice {
  text: string;
  error?: boolean;
}

export interface SessionSidebarProps {
  onNavigate?: () => void;
}

export interface SessionItemProps {
  thread: Thread;
  selected: boolean;
  running: boolean;
  menuOpen: boolean;
  renamingTitle: string | null;
  onSelect: () => void;
  onToggleMenu: () => void;
  onStartRename: () => void;
  onChangeRename: (title: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (event: SyntheticEvent<HTMLFormElement>) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export interface SettingsDrawerProps {
  onNavigate?: () => void;
  onAfterImport: () => void;
}

export interface ConcurrencyFormProps {
  draft: string;
  onChange: (value: string) => void;
  onSubmit: (value: number) => void;
}

export interface BackupMenuProps {
  onExport: () => void;
  onImport: () => void;
}

export interface LanguageMenuProps {
  onSelect?: () => void;
}
