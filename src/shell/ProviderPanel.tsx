import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSilverStore } from "../state/silverStore";
import {
  isConfiguredProvider,
  PROTOCOL_ADDRESSES,
  PROTOCOL_LABELS,
  requiresProviderAddress,
  type ProviderConfig,
} from "../provider/presets";

const PROTOCOL_OPTIONS = ["openai", "anthropic", "gemini"] as const;
const fieldClass =
  "h-9 min-w-0 w-full rounded-[8px] border border-separator bg-surface px-3 text-[13px] text-label outline-none placeholder:text-tertiary focus:border-accent";
const buttonClass =
  "inline-flex h-8 items-center justify-center rounded-[8px] border border-separator bg-surface px-3 text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label disabled:opacity-45";

export function ProviderPanel() {
  const providers = useSilverStore((s) => s.state.providers);
  const dispatch = useSilverStore((s) => s.dispatch);
  const saveProvider = useSilverStore((s) => s.saveProvider);
  const testProvider = useSilverStore((s) => s.testProvider);
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [replacementKey, setReplacementKey] = useState<string>();
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const modelTest = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => () => modelTest.current?.abort(), []);

  useEffect(() => {
    const previous = document.activeElement;
    const panel = dialog.current;
    panel?.showModal();
    return () => {
      panel?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function closeModal() {
    resetModelTest();
    dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
  }

  function resetModelTest() {
    modelTest.current?.abort();
    modelTest.current = null;
    setFetching(false);
    setModelList(null);
    setError("");
  }

  function edit(config: ProviderConfig | null) {
    resetModelTest();
    setReplacementKey(undefined);
    setDraft(config && { ...config });
  }

  const config = draft && {
    ...draft,
    label: draft.label.trim(),
    baseUrl: draft.baseUrl?.trim(),
    key: "",
    model: draft.model.trim(),
  };

  function changeConnection(change: Partial<ProviderConfig>) {
    resetModelTest();
    setDraft((current) => current && { ...current, ...change });
  }

  function changeKey(key: string) {
    resetModelTest();
    setReplacementKey(key);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    try {
      await saveProvider(config, replacementKey);
      edit(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存供应商失败。");
    }
  }

  async function testConnection() {
    if (!config || !(replacementKey?.trim() ?? config.hasKey) || modelTest.current) return;
    const controller = new AbortController();
    modelTest.current = controller;
    setFetching(true);
    setModelList(null);
    setError("");
    try {
      const models = await testProvider(config, replacementKey);
      if (modelTest.current === controller) setModelList(models);
    } catch (failure) {
      if (modelTest.current === controller) setError(failure instanceof Error ? failure.message : "供应商连接失败。");
    } finally {
      if (modelTest.current === controller) {
        modelTest.current = null;
        setFetching(false);
      }
    }
  }

  const canChangeProtocol = draft?.id === "custom";
  const showAddress = draft && (
    requiresProviderAddress(draft) ||
    !!draft.baseUrl && draft.baseUrl !== PROTOCOL_ADDRESSES[draft.protocol]
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="fixed inset-0 m-auto max-h-[82vh] w-[min(32rem,calc(100%-2rem))] overflow-hidden rounded-[14px] border border-separator bg-group p-0 text-label shadow-[0_18px_48px_rgba(44,36,27,0.22)] dark:shadow-[0_22px_56px_rgba(0,0,0,0.48)]"
      onCancel={(event) => {
        event.preventDefault();
        closeModal();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (draft) edit(null);
          else closeModal();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <section className="flex max-h-[82vh] min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-separator bg-canvas/70 px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {draft && (
              <button
                type="button"
                aria-label="返回供应商列表"
                onClick={() => edit(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-secondary transition-colors hover:bg-fill hover:text-label"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                  <path d="M9.75 4 5.75 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <h2 id={titleId} className="truncate text-[14px] font-semibold text-label">
              {draft ? (draft.label || "编辑供应商") : "模型供应商设置"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="关闭供应商设置"
            onClick={closeModal}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className="h-3 w-3">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {draft ? (
            <form onSubmit={save} className="flex flex-col gap-3.5 px-4 py-4">
              <Field label="名称" id="provider-name">
                <input
                  id="provider-name"
                  className={fieldClass}
                  value={draft.label}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
              </Field>

              <Field label="协议" id="provider-protocol">
                {canChangeProtocol ? (
                  <select
                    id="provider-protocol"
                    className={fieldClass}
                    value={draft.protocol}
                    onChange={(event) =>
                      changeConnection({ protocol: event.target.value as ProviderConfig["protocol"], model: "" })
                    }
                  >
                    {PROTOCOL_OPTIONS.map((protocol) => (
                      <option key={protocol} value={protocol}>{PROTOCOL_LABELS[protocol]}</option>
                    ))}
                  </select>
                ) : (
                  <input id="provider-protocol" className={`${fieldClass} text-secondary`} value={PROTOCOL_LABELS[draft.protocol]} readOnly />
                )}
              </Field>

              {showAddress && (
                <Field label="地址" id="provider-address">
                  <input
                    id="provider-address"
                    className={fieldClass}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={draft.baseUrl ?? ""}
                    onChange={(event) => changeConnection({ baseUrl: event.target.value })}
                    placeholder={PROTOCOL_ADDRESSES[draft.protocol]}
                  />
                </Field>
              )}

              <Field label="密钥" id="provider-key">
                <div className="flex items-center gap-2">
                  <input
                    id="provider-key"
                    className={fieldClass}
                    type="password"
                    autoComplete="new-password"
                    value={replacementKey ?? ""}
                    onChange={(event) => changeKey(event.target.value)}
                    placeholder={draft.hasKey && replacementKey === undefined ? "已保存，输入以替换" : "输入供应商密钥"}
                  />
                  {draft.hasKey && replacementKey === undefined && (
                    <button type="button" className={`${buttonClass} h-9 shrink-0`} onClick={() => changeKey("")}>
                      清除密钥
                    </button>
                  )}
                </div>
              </Field>

              <Field label="模型" id="provider-model">
                <div className="flex items-center gap-2">
                  <input
                    id="provider-model"
                    className={fieldClass}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    list={modelList?.length ? "provider-models" : undefined}
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                    placeholder="选择或输入模型 ID"
                  />
                  <button
                    type="button"
                    className={`${buttonClass} h-9 shrink-0`}
                    onClick={() => void testConnection()}
                    disabled={fetching || !(replacementKey?.trim() ?? config?.hasKey)}
                  >
                    {fetching ? "测试中…" : "测试连接"}
                  </button>
                </div>
                <datalist id="provider-models">
                  {modelList?.map((model) => <option key={model} value={model} />)}
                </datalist>
                {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
                {modelList && (
                  <p role="status" className="text-[12px] text-secondary">
                    {modelList.length ? `连接成功，获取了 ${modelList.length} 个模型。` : "连接成功，供应商未返回可用模型。"}
                  </p>
                )}
              </Field>

              <div className="mt-1 flex items-center justify-end gap-2 border-t border-separator pt-3">
                <button type="button" className={buttonClass} onClick={() => edit(null)}>
                  取消
                </button>
                <button
                  type="submit"
                  className="inline-flex h-8 items-center justify-center rounded-[8px] bg-accent px-4 text-[12px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-45"
                  disabled={!config?.label}
                >
                  保存
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-1.5 p-3">
              {providers.map((provider) => {
                const configured = isConfiguredProvider(provider);
                return (
                  <button
                    type="button"
                    key={provider.id}
                    onClick={() => edit(provider)}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-[10px] border border-separator/70 bg-surface px-3.5 py-2 text-left transition-colors hover:bg-fill/75"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium text-label">{provider.label}</span>
                      <span className="truncate font-mono text-[11px] text-tertiary">
                        {provider.model || PROTOCOL_LABELS[provider.protocol]}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-[5px] px-1.5 py-0.5 text-[11px] ${
                          configured ? "bg-success/15 text-success" : "bg-fill text-tertiary"
                        }`}
                      >
                        {configured ? "已配置" : "未配置"}
                      </span>
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-tertiary">
                        <path d="M6.25 4 10.25 8l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </dialog>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-secondary">{label}</label>
      {children}
    </div>
  );
}
