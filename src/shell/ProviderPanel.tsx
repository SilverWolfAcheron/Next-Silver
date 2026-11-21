import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSilver } from "../state/SilverContext";
import {
  isConfiguredProvider,
  PROTOCOL_ADDRESSES,
  PROTOCOL_LABELS,
  requiresProviderAddress,
  type ProviderConfig,
} from "../provider/presets";

const PROTOCOL_OPTIONS = ["openai", "anthropic", "gemini"] as const;
const fieldClass = "min-h-[44px] min-w-0 w-full rounded-[10px] border border-separator bg-group px-3 py-2 text-[17px] text-label outline-none placeholder:text-secondary focus:border-accent";
const buttonClass = "inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-separator px-3 text-[13px] text-secondary hover:bg-fill disabled:opacity-40";

export function ProviderPanel() {
  const { state, dispatch, saveProvider, testProvider } = useSilver();
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [replacementKey, setReplacementKey] = useState<string>();
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const modelTest = useRef<AbortController | null>(null);

  useEffect(() => () => modelTest.current?.abort(), []);

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
    <div className="flex h-full w-full max-w-full shrink-0 flex-col bg-canvas">
      <div className="flex items-center justify-between border-b border-separator px-4 py-2">
        <h2 className="text-[17px] font-semibold text-label">供应商</h2>
        <button
          type="button"
          aria-label="关闭供应商设置"
          onClick={() => dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false })}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-[17px] text-secondary hover:text-label"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {draft ? (
          <form onSubmit={save} className="flex flex-col gap-4 px-4 py-4">
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
                <input id="provider-protocol" className={fieldClass} value={PROTOCOL_LABELS[draft.protocol]} readOnly />
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
                <button type="button" className={`${buttonClass} self-start`} onClick={() => changeKey("")}>
                  清除密钥
                </button>
              )}
            </Field>

            <Field label="模型" id="provider-model">
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
              <datalist id="provider-models">
                {modelList?.map((model) => <option key={model} value={model} />)}
              </datalist>
              <button
                type="button"
                className={`${buttonClass} self-start`}
                onClick={() => void testConnection()}
                disabled={fetching || !(replacementKey?.trim() ?? config?.hasKey)}
              >
                {fetching ? "正在测试…" : "测试连接"}
              </button>
              {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
              {modelList && (
                <p role="status" className="text-[13px] text-secondary">
                  {modelList.length ? `连接成功，获取了 ${modelList.length} 个模型。` : "连接成功，供应商未返回可用模型。"}
                </p>
              )}
            </Field>

            <div className="flex gap-2">
              <button
                type="submit"
                className="min-h-[44px] flex-1 rounded-[10px] bg-accent px-3 text-[17px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
                disabled={!config?.label}
              >
                保存
              </button>
              <button type="button" className={`${buttonClass} flex-1 text-[17px]`} onClick={() => edit(null)}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1 px-2 py-3">
            {state.providers.map((provider) => (
              <button
                type="button"
                key={provider.id}
                onClick={() => edit(provider)}
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-[10px] px-3 text-left hover:bg-fill"
              >
                <span className="min-w-0 truncate text-[17px] text-label">{provider.label}</span>
                <span className="shrink-0 text-[13px] text-tertiary">
                  {isConfiguredProvider(provider) ? "已配置" : "未配置"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-secondary">{label}</label>
      {children}
    </div>
  );
}
