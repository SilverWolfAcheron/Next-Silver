import { useState, type FormEvent } from "react";
import type { Autonomy, Brief } from "../model/types";
import type { DomainPack } from "../model/domains/pcb";
import { AUTONOMY_LABELS } from "../model/presets";
import { Button } from "../ui/Button";

interface BriefViewProps {
  brief: Brief;
  domain?: DomainPack;
  requirementSequence: number;
  confirmationPending: boolean;
  onSave: (brief: Brief) => void;
}

const fieldLabel = "text-[12px] font-semibold text-secondary";
const fieldInput = "min-h-11 w-full rounded-[10px] border border-separator bg-group px-3 py-2 text-[17px] leading-[22px] text-label focus-visible:outline-2 focus-visible:outline-accent";

function Field({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={fieldLabel}>{label}</dt>
      <dd className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">{value}</dd>
    </div>
  );
}

export function BriefView({ brief, domain, requirementSequence, confirmationPending, onSave }: BriefViewProps) {
  const [editing, setEditing] = useState(false);
  const visibleDomainFields = domain?.fields.filter((field) => brief.domainFields[field.key]?.trim()) ?? [];

  if (editing && !confirmationPending) {
    return (
      <BriefEditor
        brief={brief}
        domain={domain}
        requirementSequence={requirementSequence}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
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
          <span className="text-[13px] text-secondary">请先处理对话中的确认</span>
        ) : (
          <Button variant="ghost" type="button" className="text-[13px]" onClick={() => setEditing(true)}>
            编辑简报
          </Button>
        )}
      </div>

      <dl className="flex flex-col gap-4">
        <Field label="目标" value={brief.intent} />
        <Field label="完成" value={brief.outcome} />
        {brief.requirements.map((requirement) => (
          <Field key={requirement.id} label={requirement.id} value={requirement.text} />
        ))}
        <Field label="约束" value={brief.constraints} />
        {brief.outOfScope.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <dt className={fieldLabel}>不做</dt>
            <dd>
              <ul className="list-disc space-y-1 pl-5 text-[17px] leading-[22px] wrap-anywhere text-label">
                {brief.outOfScope.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </dd>
          </div>
        )}
        <Field label="自主度" value={AUTONOMY_LABELS[brief.autonomy]} />
      </dl>

      {domain && visibleDomainFields.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-separator pt-3">
          <h2 className={fieldLabel}>{domain.label}</h2>
          <dl className="flex flex-col gap-3">
            {visibleDomainFields.map((field) => (
              <Field key={field.key} label={field.label} value={brief.domainFields[field.key]} />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

interface BriefEditorProps {
  brief: Brief;
  domain?: DomainPack;
  requirementSequence: number;
  onCancel: () => void;
  onSave: (brief: Brief) => void;
}

function BriefEditor({ brief, domain, requirementSequence, onCancel, onSave }: BriefEditorProps) {
  const [draft, setDraft] = useState({ ...brief, requirementSequence });
  const [outOfScope, setOutOfScope] = useState(brief.outOfScope.join("\n"));

  function addRequirement() {
    const next = draft.requirementSequence + 1;
    setDraft({
      ...draft,
      requirementSequence: next,
      requirements: [...draft.requirements, { id: `R${next}`, text: "" }],
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.intent.trim()) return;
    onSave({
      ...draft,
      intent: draft.intent.trim(),
      outcome: draft.outcome.trim(),
      constraints: draft.constraints.trim(),
      requirements: draft.requirements
        .map((requirement) => ({ ...requirement, text: requirement.text.trim() }))
        .filter((requirement) => requirement.text),
      outOfScope: outOfScope.split("\n").map((item) => item.trim()).filter(Boolean),
      domainFields: Object.fromEntries(
        Object.entries(draft.domainFields)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value),
      ),
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 p-4">
      <TextField label="目标" value={draft.intent} required onChange={(intent) => setDraft({ ...draft, intent })} />
      <TextField label="完成" value={draft.outcome} onChange={(outcome) => setDraft({ ...draft, outcome })} />
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className={`${fieldLabel} mb-2`}>需求</legend>
        {draft.requirements.map((requirement) => (
          <div key={requirement.id} className="flex items-end gap-1">
            <div className="min-w-0 flex-1">
              <TextField
                label={requirement.id}
                value={requirement.text}
                onChange={(text) =>
                  setDraft({
                    ...draft,
                    requirements: draft.requirements.map((item) =>
                      item.id === requirement.id ? { ...item, text } : item,
                    ),
                  })
                }
              />
            </div>
            <button
              type="button"
              aria-label={`移除需求 ${requirement.id}`}
              onClick={() => setDraft({
                ...draft,
                requirements: draft.requirements.filter((item) => item.id !== requirement.id),
              })}
              className="min-h-11 shrink-0 rounded-[10px] px-2 text-[13px] text-danger hover:bg-fill"
            >
              移除
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
          添加需求
        </Button>
      </fieldset>
      <TextField label="约束" value={draft.constraints} onChange={(constraints) => setDraft({ ...draft, constraints })} />
      <TextField label="不做（每行一项）" value={outOfScope} onChange={setOutOfScope} />
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>自主度</span>
        <select
          className={fieldInput}
          value={draft.autonomy}
          onChange={(event) => setDraft({ ...draft, autonomy: event.target.value as Autonomy })}
        >
          {Object.entries(AUTONOMY_LABELS).map(([mode, label]) => (
            <option key={mode} value={mode}>{label}</option>
          ))}
        </select>
      </label>
      {domain && (
        <fieldset className="flex min-w-0 flex-col gap-3 border-t border-separator pt-3">
          <legend className={fieldLabel}>{domain.label}</legend>
          {domain.fields.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              value={draft.domainFields[field.key] ?? ""}
              onChange={(value) => setDraft({
                ...draft,
                domainFields: { ...draft.domainFields, [field.key]: value },
              })}
            />
          ))}
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" className="text-[13px]" onClick={onCancel}>取消</Button>
        <Button type="submit" className="text-[13px]" disabled={!draft.intent.trim()}>保存简报</Button>
      </div>
    </form>
  );
}

function TextField({ label, value, onChange, required = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      <textarea
        className={`${fieldInput} resize-y`}
        rows={1}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
