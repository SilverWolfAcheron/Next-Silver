import { useId, useMemo } from "react";
import type { ChangeEvent, JSX, SyntheticEvent } from "react";
import { getPreset } from "../../agent-core/presets";
import type { Preset } from "../../agent-core/presets";
import type { ProviderConfig } from "../../agent-core/provider/presets";
import type { Thread } from "../../agent-core/types";
import { MAX_COMPOSER_TEXT_LENGTH, MIN_TEXTAREA_HEIGHT } from "../../constants/composer";
import { useComposerDraft } from "../../hooks/useComposerDraft";
import { useI18n } from "../../hooks/useI18n";
import { formatLocalizedText } from "../../i18n/errors";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { ModelMenuState } from "../../types/composer";
import type { RuntimeStore } from "../../types/stores";
import { makeComposerScope, resolveModelMenuState } from "../../utils/composerData";
import { Pill } from "../common/Pill";
import { ApprovalSelector } from "./ApprovalSelector";
import { MentionMenu } from "./MentionMenu";
import { ModeSelector } from "./ModeSelector";
import { ModelSelector } from "./ModelSelector";

export function Composer(): JSX.Element {
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const scope: string = makeComposerScope(currentThread?.id, currentThread?.workspace?.id);
  return <ScopedComposer key={scope} scope={scope} thread={currentThread} />;
}

function ScopedComposer({ scope, thread }: { scope: string; thread: Thread | null }): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const id: string | undefined = thread?.id;
  const allProviders: ProviderConfig[] = useRuntimeStore(
    (s: RuntimeStore): ProviderConfig[] => s.state.providers
  );
  const generating: boolean = useRuntimeStore((s: RuntimeStore): boolean =>
    id ? s.busyThreads.includes(id) : false
  );
  const selectModel: (
    threadId: string | undefined,
    modelId: string,
    modelName?: string
  ) => void = useRuntimeStore(
    (
      s: RuntimeStore
    ): ((threadId: string | undefined, modelId: string, modelName?: string) => void) =>
      s.selectModel
  );
  const changePreset: (threadId: string | undefined, presetId: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string | undefined, presetId: string) => void) => s.changePreset
  );
  const stop: (threadId: string) => boolean = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string) => boolean) => s.stop
  );

  const listId: string = useId();
  const preset: Preset = getPreset(thread?.presetId ?? "develop");
  const modelMenu: ModelMenuState = useMemo(
    (): ModelMenuState => resolveModelMenuState(allProviders, thread),
    [allProviders, thread]
  );

  const {
    formRef,
    textareaRef,
    draft,
    menu,
    setMenu,
    query,
    setQuery,
    matches,
    searching,
    fileError,
    draftError,
    activeIndex,
    setActiveIndex,
    sending,
    updateText,
    attach,
    removeAttachment,
    handleDragOver,
    handleDrop,
    submit,
    handleKeyDown,
  }: ReturnType<typeof useComposerDraft> = useComposerDraft(scope, thread, listId);

  return (
    <div className="bg-surface px-4 pt-2 pb-4">
      <form
        ref={formRef}
        onSubmit={(event: SyntheticEvent<HTMLFormElement>): void => {
          event.preventDefault();
          void submit();
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="relative mx-auto max-w-4xl rounded-[22px] border border-separator bg-group px-5 py-3.5 shadow-[0_2px_12px_rgba(44,36,27,0.06)] dark:shadow-[0_2px_14px_rgba(0,0,0,0.22)]"
      >
        {query && (
          <MentionMenu
            listId={listId}
            matches={matches}
            activeIndex={activeIndex}
            searching={searching}
            fileError={fileError}
            onHover={setActiveIndex}
            onSelect={(path: string): void => attach(path, true)}
          />
        )}

        {draft.attachments.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1" aria-label={t.composer.attachmentsLabel}>
            {draft.attachments.map((path: string): JSX.Element => (
              <li key={path}>
                <Pill
                  type="button"
                  className="h-7 px-2.5 text-[12px]"
                  aria-label={t.composer.removeAttachment(path)}
                  onClick={(): void => removeAttachment(path)}
                >
                  {path} ×
                </Pill>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={textareaRef}
          value={draft.text}
          aria-label={t.composer.inputLabel}
          aria-autocomplete="list"
          aria-controls={query ? listId : undefined}
          aria-activedescendant={query && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          maxLength={MAX_COMPOSER_TEXT_LENGTH}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
            updateText(event.target.value, event.target.selectionStart)
          }
          onKeyDown={handleKeyDown}
          placeholder={t.composer.inputPlaceholder}
          rows={2}
          className="block w-full resize-none bg-transparent py-0 text-[15px] leading-[22px] text-label outline-none placeholder:text-secondary"
          style={{ height: MIN_TEXTAREA_HEIGHT, overflowY: "hidden" }}
        />

        {draftError && (
          <p role="alert" className="mt-1 text-[12px] text-danger">
            {formatLocalizedText(draftError, t)}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1">
          <ModeSelector
            presetId={preset.id}
            presetLabel={preset.label}
            open={menu === "preset"}
            onToggle={(): void => {
              setQuery(null);
              setMenu(menu === "preset" ? null : "preset");
            }}
            onSelect={(nextPresetId: string): void => {
              changePreset(id, nextPresetId);
              setMenu(null);
            }}
          />

          <ModelSelector
            modelMenu={modelMenu}
            open={menu === "model"}
            onToggle={(): void => {
              setQuery(null);
              setMenu(menu === "model" ? null : "model");
            }}
            onSelect={(providerId: string, model: string): void => {
              selectModel(id, providerId, model);
              setMenu(null);
            }}
          />

          {thread && (
            <ApprovalSelector thread={thread} open={menu === "approval"} onToggle={(): void => {
              setQuery(null);
              setMenu(menu === "approval" ? null : "approval");
            }} />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {generating && id && (
              <Pill type="button" className="h-8 px-3 text-[12px]" onClick={(): void => { stop(id); }}>
                {t.composer.stop}
              </Pill>
            )}
            <button
              type="submit"
              disabled={!draft.text.trim() || sending}
              className="inline-flex h-8 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_80%,#1f1712)] bg-gradient-to-b from-[color-mix(in_srgb,var(--color-accent)_96%,#f6efe2)] to-[color-mix(in_srgb,var(--color-accent)_90%,#1f1712)] px-4 text-[13px] font-medium text-on-accent shadow-[inset_0_1px_0_rgba(255,245,230,0.1),inset_0_-1.5px_0_rgba(31,20,13,0.18),0_1px_3px_rgba(24,16,10,0.28),0_3px_8px_rgba(24,16,10,0.14)] transition-[transform,filter,box-shadow,opacity] duration-150 hover:brightness-[1.03] active:translate-y-[0.5px] active:brightness-95 active:shadow-[inset_0_1px_2px_rgba(31,20,13,0.24),0_1px_1px_rgba(24,16,10,0.18)] disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100"
            >
              <span aria-live="polite">{sending ? t.composer.sending : t.composer.send}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
