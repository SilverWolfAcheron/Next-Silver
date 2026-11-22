import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction, SyntheticEvent } from "react";
import { ERROR_CODES, serializeErrorCode } from "../agent-core/errors";
import type { ProviderConfig } from "../agent-core/provider/presets";
import { logError } from "../i18n/errors";
import { useRuntimeStore } from "../stores/runtimeStore";
import type { UIAction } from "../types/runtime";
import type { RuntimeStore } from "../types/stores";

export function useProviderEditor(): {
  providers: ProviderConfig[];
  draft: ProviderConfig | null;
  replacementKey: string | undefined;
  modelList: string[] | null;
  fetching: boolean;
  error: string;
  canSave: boolean;
  canTest: boolean;
  setDraft: Dispatch<SetStateAction<ProviderConfig | null>>;
  closeModal: () => void;
  edit: (config: ProviderConfig | null) => void;
  changeConnection: (change: Partial<ProviderConfig>) => void;
  changeKey: (key: string) => void;
  save: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  testConnection: () => Promise<void>;
} {
  const providers: ProviderConfig[] = useRuntimeStore(
    (s: RuntimeStore): ProviderConfig[] => s.state.providers
  );
  const dispatch: (action: UIAction) => void = useRuntimeStore(
    (s: RuntimeStore): ((action: UIAction) => void) => s.dispatch
  );
  const saveProvider: (config: ProviderConfig, replacementKey?: string) => Promise<void> =
    useRuntimeStore(
      (s: RuntimeStore): ((config: ProviderConfig, replacementKey?: string) => Promise<void>) =>
        s.saveProvider
    );
  const testProvider: (config: ProviderConfig, replacementKey?: string) => Promise<string[]> =
    useRuntimeStore(
      (s: RuntimeStore): ((config: ProviderConfig, replacementKey?: string) => Promise<string[]>) =>
        s.testProvider
    );

  const [draft, setDraft]: [
    ProviderConfig | null,
    Dispatch<SetStateAction<ProviderConfig | null>>
  ] = useState<ProviderConfig | null>(null);
  const [replacementKey, setReplacementKey]: [
    string | undefined,
    Dispatch<SetStateAction<string | undefined>>
  ] = useState<string | undefined>(undefined);
  const [modelList, setModelList]: [
    string[] | null,
    Dispatch<SetStateAction<string[] | null>>
  ] = useState<string[] | null>(null);
  const [fetching, setFetching]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [error, setError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const modelTestRef: RefObject<AbortController | null> = useRef<AbortController | null>(null);

  useEffect((): (() => void) => (): void => modelTestRef.current?.abort(), []);

  function resetModelTest(): void {
    modelTestRef.current?.abort();
    modelTestRef.current = null;
    setFetching(false);
    setModelList(null);
    setError("");
  }

  function closeModal(): void {
    resetModelTest();
    dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
  }

  function edit(config: ProviderConfig | null): void {
    resetModelTest();
    setReplacementKey(undefined);
    setDraft(config ? { ...config } : null);
  }

  const normalizedConfig: ProviderConfig | null = draft
    ? {
      ...draft,
      label: draft.label.trim(),
      baseUrl: draft.baseUrl?.trim(),
      key: "",
      model: draft.model.trim(),
    }
    : null;

  function changeConnection(change: Partial<ProviderConfig>): void {
    resetModelTest();
    setDraft((current: ProviderConfig | null): ProviderConfig | null =>
      current ? { ...current, ...change } : null
    );
  }

  function changeKey(key: string): void {
    resetModelTest();
    setReplacementKey(key);
  }

  async function save(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!normalizedConfig) return;
    try {
      await saveProvider(normalizedConfig, replacementKey);
      edit(null);
    } catch (failure: unknown) {
      logError(failure, undefined, ERROR_CODES.PROVIDER_SAVE_FAILED);
      setError(serializeErrorCode(failure, ERROR_CODES.PROVIDER_SAVE_FAILED));
    }
  }

  async function testConnection(): Promise<void> {
    if (
      !normalizedConfig ||
      !(replacementKey?.trim() ?? normalizedConfig.hasKey) ||
      modelTestRef.current
    ) {
      return;
    }
    const controller: AbortController = new AbortController();
    modelTestRef.current = controller;
    setFetching(true);
    setModelList(null);
    setError("");
    try {
      const models: string[] = await testProvider(normalizedConfig, replacementKey);
      if (modelTestRef.current === controller) setModelList(models);
    } catch (failure: unknown) {
      if (modelTestRef.current === controller) {
        logError(failure, undefined, ERROR_CODES.PROVIDER_CONNECT_FAILED);
        setError(serializeErrorCode(failure, ERROR_CODES.PROVIDER_CONNECT_FAILED));
      }
    } finally {
      if (modelTestRef.current === controller) {
        modelTestRef.current = null;
        setFetching(false);
      }
    }
  }

  return {
    providers,
    draft,
    replacementKey,
    modelList,
    fetching,
    error,
    canSave: Boolean(normalizedConfig?.label),
    canTest: Boolean(replacementKey?.trim() ?? normalizedConfig?.hasKey),
    setDraft,
    closeModal,
    edit,
    changeConnection,
    changeKey,
    save,
    testConnection,
  };
}
