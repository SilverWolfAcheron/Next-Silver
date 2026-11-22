import type { ChangeEvent, JSX } from "react";
import {
  PROTOCOL_ADDRESSES,
  PROTOCOL_LABELS,
  requiresProviderAddress,
} from "../../agent-core/provider/presets";
import type { ProviderConfig } from "../../agent-core/provider/presets";
import type { Protocol } from "../../agent-core/types";
import { PROTOCOL_OPTIONS } from "../../constants/provider";
import { PROVIDER_BUTTON_CLASS, PROVIDER_FIELD_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { ProviderFieldProps, ProviderFormProps } from "../../types/provider";

export function ProviderForm({
  draft,
  replacementKey,
  modelList,
  fetching,
  error,
  canSave,
  canTest,
  onChangeDraft,
  onChangeConnection,
  onChangeKey,
  onTest,
  onCancel,
  onSubmit,
}: ProviderFormProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const canChangeProtocol: boolean = draft.id === "custom";
  const showAddress: boolean =
    requiresProviderAddress(draft) ||
    (Boolean(draft.baseUrl) && draft.baseUrl !== PROTOCOL_ADDRESSES[draft.protocol]);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5 px-4 py-4">
      <Field label={t.provider.fieldName} id="provider-name">
        <input
          id="provider-name"
          className={PROVIDER_FIELD_CLASS}
          value={draft.label}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChangeDraft({ ...draft, label: event.target.value })
          }
        />
      </Field>

      <Field label={t.provider.fieldProtocol} id="provider-protocol">
        {canChangeProtocol ? (
          <select
            id="provider-protocol"
            className={PROVIDER_FIELD_CLASS}
            value={draft.protocol}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              onChangeConnection({
                protocol: event.target.value as ProviderConfig["protocol"],
                model: "",
              })
            }
          >
            {PROTOCOL_OPTIONS.map((protocol: Protocol): JSX.Element => (
              <option key={protocol} value={protocol}>
                {PROTOCOL_LABELS[protocol]}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="provider-protocol"
            className={`${PROVIDER_FIELD_CLASS} text-secondary`}
            value={PROTOCOL_LABELS[draft.protocol]}
            readOnly
          />
        )}
      </Field>

      {showAddress && (
        <Field label={t.provider.fieldAddress} id="provider-address">
          <input
            id="provider-address"
            className={PROVIDER_FIELD_CLASS}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={draft.baseUrl ?? ""}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChangeConnection({ baseUrl: event.target.value })
            }
            placeholder={PROTOCOL_ADDRESSES[draft.protocol]}
          />
        </Field>
      )}

      <Field label={t.provider.fieldKey} id="provider-key">
        <div className="flex items-center gap-2">
          <input
            id="provider-key"
            className={PROVIDER_FIELD_CLASS}
            type="password"
            autoComplete="new-password"
            value={replacementKey ?? ""}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => onChangeKey(event.target.value)}
            placeholder={
              draft.hasKey && replacementKey === undefined
                ? t.provider.keySavedPlaceholder
                : t.provider.keyInputPlaceholder
            }
          />
          {draft.hasKey && replacementKey === undefined && (
            <button
              type="button"
              className={`${PROVIDER_BUTTON_CLASS} h-9 shrink-0`}
              onClick={(): void => onChangeKey("")}
            >
              {t.provider.clearKey}
            </button>
          )}
        </div>
      </Field>

      <Field label={t.provider.fieldModel} id="provider-model">
        <div className="flex items-center gap-2">
          <input
            id="provider-model"
            className={PROVIDER_FIELD_CLASS}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            list={modelList?.length ? "provider-models" : undefined}
            value={draft.model}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              onChangeDraft({ ...draft, model: event.target.value })
            }
            placeholder={t.provider.modelPlaceholder}
          />
          <button
            type="button"
            className={`${PROVIDER_BUTTON_CLASS} h-9 shrink-0`}
            onClick={onTest}
            disabled={fetching || !canTest}
          >
            {fetching ? t.provider.testing : t.provider.testConnection}
          </button>
        </div>
        <datalist id="provider-models">
          {modelList?.map((model: string): JSX.Element => <option key={model} value={model} />)}
        </datalist>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {formatError(error, t)}
          </p>
        )}
        {modelList && (
          <p role="status" className="text-[12px] text-secondary">
            {modelList.length ? t.provider.modelsFetched(modelList.length) : t.provider.noModelsReturned}
          </p>
        )}
      </Field>

      <div className="mt-1 flex items-center justify-end gap-2 border-t border-separator pt-3">
        <button type="button" className={PROVIDER_BUTTON_CLASS} onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          className="inline-flex h-8 items-center justify-center rounded-[8px] bg-accent px-4 text-[12px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-45"
          disabled={!canSave}
        >
          {t.common.save}
        </button>
      </div>
    </form>
  );
}

function Field({ label, id, children }: ProviderFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
