import { useId } from "react";
import type { JSX, SyntheticEvent } from "react";
import { useI18n } from "../../hooks/useI18n";
import { useProviderEditor } from "../../hooks/useProviderEditor";
import { BackIcon, CloseIcon } from "../common/Icons";
import { ModalDialog } from "../common/ModalDialog";
import { ProviderForm } from "./ProviderForm";
import { ProviderList } from "./ProviderList";

export function ProviderModal(): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const titleId: string = useId();
  const {
    providers,
    draft,
    replacementKey,
    modelList,
    fetching,
    error,
    canSave,
    canTest,
    setDraft,
    closeModal,
    edit,
    changeConnection,
    changeKey,
    save,
    testConnection,
  }: ReturnType<typeof useProviderEditor> = useProviderEditor();

  const title: string = draft
    ? draft.id === "custom"
      ? t.provider.customProviderLabel
      : draft.label || t.provider.editFallbackTitle
    : t.provider.modalTitle;

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={closeModal}
      onEscape={(): void => (draft ? edit(null) : closeModal())}
      className="fixed inset-0 m-auto max-h-[82vh] w-[min(32rem,calc(100%-2rem))] overflow-hidden rounded-[14px] border border-separator bg-group p-0 text-label shadow-[0_18px_48px_rgba(44,36,27,0.22)] dark:shadow-[0_22px_56px_rgba(0,0,0,0.48)]"
    >
      <section className="flex max-h-[82vh] min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-separator bg-canvas/70 px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {draft && (
              <button
                type="button"
                aria-label={t.provider.backToList}
                onClick={(): void => edit(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-secondary transition-colors hover:bg-fill hover:text-label"
              >
                <BackIcon />
              </button>
            )}
            <h2 id={titleId} className="truncate text-[14px] font-semibold text-label">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t.provider.closeSettings}
            onClick={closeModal}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {draft ? (
            <ProviderForm
              draft={draft}
              replacementKey={replacementKey}
              modelList={modelList}
              fetching={fetching}
              error={error}
              canSave={canSave}
              canTest={canTest}
              onChangeDraft={setDraft}
              onChangeConnection={changeConnection}
              onChangeKey={changeKey}
              onTest={(): void => {
                void testConnection();
              }}
              onCancel={(): void => edit(null)}
              onSubmit={(event: SyntheticEvent<HTMLFormElement>): void => {
                void save(event);
              }}
            />
          ) : (
            <ProviderList providers={providers} onSelect={edit} />
          )}
        </div>
      </section>
    </ModalDialog>
  );
}
