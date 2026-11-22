import type { ReactNode, SyntheticEvent } from "react";
import type { ProviderConfig } from "../agent-core/provider/presets";

export interface ProviderListProps {
  providers: ProviderConfig[];
  onSelect: (provider: ProviderConfig) => void;
}

export interface ProviderFormProps {
  draft: ProviderConfig;
  replacementKey: string | undefined;
  modelList: string[] | null;
  fetching: boolean;
  error: string;
  canSave: boolean;
  canTest: boolean;
  onChangeDraft: (next: ProviderConfig) => void;
  onChangeConnection: (change: Partial<ProviderConfig>) => void;
  onChangeKey: (key: string) => void;
  onTest: () => void;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}

export interface ProviderFieldProps {
  label: string;
  id: string;
  children: ReactNode;
}
