import { useState } from "react";
import type { ChangeEvent, Dispatch, JSX, SetStateAction, SyntheticEvent } from "react";
import type { DomainField } from "../../agent-core/domains/pcb";
import type { Autonomy, Brief, Requirement } from "../../agent-core/types";
import { AUTONOMY_OPTIONS } from "../../constants/inspector";
import { BRIEF_FIELD_INPUT_CLASS, BRIEF_FIELD_LABEL_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import type {
  BriefEditorProps,
  BriefFieldProps,
  BriefTextFieldProps,
  BriefViewProps,
} from "../../types/inspector";
import { Button } from "../common/Button";

function Field({ label, value }: BriefFieldProps): JSX.Element | null {
  if (!value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={BRIEF_FIELD_LABEL_CLASS}>{label}</dt>
      <dd className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">
        {value}
      </dd>
    </div>
  );
}

export function BriefView({
  brief,
  domain,
  requirementSequence,
  confirmationPending,
  onSave,
}: BriefViewProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [editing, setEditing]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const visibleDomainFields: DomainField[] =
    domain?.fields.filter((field: DomainField): boolean =>
      Boolean(brief.domainFields[field.key]?.trim())
    ) ?? [];

  if (editing && !confirmationPending) {
    return (
      <BriefEditor
        brief={brief}
        domain={domain}
        requirementSequence={requirementSequence}
        onCancel={(): void => setEditing(false)}
        onSave={(next: Brief): void => {
          onSave(next);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-end">
        {confirmationPending ? (
          <span className="text-[13px] text-secondary">{t.brief.pendingConfirmNotice}</span>
        ) : (
          <Button variant="ghost" type="button" className="text-[13px]" onClick={(): void => setEditing(true)}>
            {t.brief.editBrief}
          </Button>
        )}
      </div>

      <dl className="flex flex-col gap-4">
        <Field label={t.brief.goal} value={brief.intent} />
        <Field label={t.brief.outcome} value={brief.outcome} />
        {brief.requirements.map((requirement: Requirement): JSX.Element => (
          <Field key={requirement.id} label={requirement.id} value={requirement.text} />
        ))}
        <Field label={t.brief.constraints} value={brief.constraints} />
        {brief.outOfScope.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <dt className={BRIEF_FIELD_LABEL_CLASS}>{t.brief.outOfScope}</dt>
            <dd>
              <ul className="list-disc space-y-1 pl-5 text-[17px] leading-[22px] wrap-anywhere text-label">
                {brief.outOfScope.map((item: string, index: number): JSX.Element => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <Field label={t.brief.autonomy} value={t.brief.autonomyLabels[brief.autonomy]} />
      </dl>

      {domain && visibleDomainFields.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-separator pt-3">
          <h2 className={BRIEF_FIELD_LABEL_CLASS}>{domain.label}</h2>
          <dl className="flex flex-col gap-3">
            {visibleDomainFields.map((field: DomainField): JSX.Element => (
              <Field key={field.key} label={field.label} value={brief.domainFields[field.key]} />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function BriefEditor({
  brief,
  domain,
  requirementSequence,
  onCancel,
  onSave,
}: BriefEditorProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [draft, setDraft]: [
    Brief & { requirementSequence: number },
    Dispatch<SetStateAction<Brief & { requirementSequence: number }>>
  ] = useState<Brief & { requirementSequence: number }>({ ...brief, requirementSequence });
  const [outOfScope, setOutOfScope]: [string, Dispatch<SetStateAction<string>>] = useState<string>(
    brief.outOfScope.join("\n")
  );

  function addRequirement(): void {
    const next: number = draft.requirementSequence + 1;
    setDraft({
      ...draft,
      requirementSequence: next,
      requirements: [...draft.requirements, { id: `R${next}`, text: "" }],
    });
  }

  function save(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft.intent.trim()) return;
    onSave({
      ...draft,
      intent: draft.intent.trim(),
      outcome: draft.outcome.trim(),
      constraints: draft.constraints.trim(),
      requirements: draft.requirements
        .map((requirement: Requirement): Requirement => ({
          ...requirement,
          text: requirement.text.trim(),
        }))
        .filter((requirement: Requirement): boolean => Boolean(requirement.text)),
      outOfScope: outOfScope
        .split("\n")
        .map((item: string): string => item.trim())
        .filter(Boolean),
      domainFields: Object.fromEntries(
        Object.entries(draft.domainFields)
          .map(([key, value]: [string, string]): [string, string] => [key, value.trim()])
          .filter(([, value]: [string, string]): boolean => Boolean(value))
      ),
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 p-4">
      <TextField
        label={t.brief.goal}
        value={draft.intent}
        required
        onChange={(intent: string): void => setDraft({ ...draft, intent })}
      />
      <TextField
        label={t.brief.outcome}
        value={draft.outcome}
        onChange={(outcome: string): void => setDraft({ ...draft, outcome })}
      />

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className={`${BRIEF_FIELD_LABEL_CLASS} mb-2`}>{t.brief.requirements}</legend>
        {draft.requirements.map((requirement: Requirement): JSX.Element => (
          <div key={requirement.id} className="flex items-end gap-1">
            <div className="min-w-0 flex-1">
              <TextField
                label={requirement.id}
                value={requirement.text}
                onChange={(text: string): void =>
                  setDraft({
                    ...draft,
                    requirements: draft.requirements.map(
                      (item: Requirement): Requirement =>
                        item.id === requirement.id ? { ...item, text } : item
                    ),
                  })
                }
              />
            </div>
            <button
              type="button"
              aria-label={t.brief.removeRequirement(requirement.id)}
              onClick={(): void =>
                setDraft({
                  ...draft,
                  requirements: draft.requirements.filter(
                    (item: Requirement): boolean => item.id !== requirement.id
                  ),
                })
              }
              className="min-h-11 shrink-0 rounded-[10px] px-2 text-[13px] text-danger hover:bg-fill"
            >
              {t.common.remove}
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          type="button"
          className="self-start text-[13px]"
          disabled={draft.requirementSequence >= Number.MAX_SAFE_INTEGER}
          onClick={addRequirement}
        >
          {t.brief.addRequirement}
        </Button>
      </fieldset>

      <TextField
        label={t.brief.constraints}
        value={draft.constraints}
        onChange={(constraints: string): void => setDraft({ ...draft, constraints })}
      />
      <TextField label={t.brief.outOfScopeMultiline} value={outOfScope} onChange={setOutOfScope} />

      <label className="flex flex-col gap-1">
        <span className={BRIEF_FIELD_LABEL_CLASS}>{t.brief.autonomy}</span>
        <select
          className={BRIEF_FIELD_INPUT_CLASS}
          value={draft.autonomy}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            setDraft({ ...draft, autonomy: event.target.value as Autonomy })
          }
        >
          {AUTONOMY_OPTIONS.map((mode: Autonomy): JSX.Element => (
            <option key={mode} value={mode}>
              {t.brief.autonomyLabels[mode]}
            </option>
          ))}
        </select>
      </label>

      {domain && (
        <fieldset className="flex min-w-0 flex-col gap-3 border-t border-separator pt-3">
          <legend className={BRIEF_FIELD_LABEL_CLASS}>{domain.label}</legend>
          {domain.fields.map((field: DomainField): JSX.Element => (
            <TextField
              key={field.key}
              label={field.label}
              value={draft.domainFields[field.key] ?? ""}
              onChange={(value: string): void =>
                setDraft({
                  ...draft,
                  domainFields: { ...draft.domainFields, [field.key]: value },
                })
              }
            />
          ))}
        </fieldset>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" className="text-[13px]" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" className="text-[13px]" disabled={!draft.intent.trim()}>
          {t.brief.saveBrief}
        </Button>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  required = false,
}: BriefTextFieldProps): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className={BRIEF_FIELD_LABEL_CLASS}>{label}</span>
      <textarea
        className={`${BRIEF_FIELD_INPUT_CLASS} resize-y`}
        rows={1}
        required={required}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => onChange(event.target.value)}
      />
    </label>
  );
}
