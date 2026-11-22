import { Fragment, useId } from "react";
import type { ChangeEvent, JSX, MouseEvent } from "react";
import { WORKSPACE_SEARCH_MAX_QUERY_LENGTH } from "../../constants/workspace";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import { useWorkspaceSearch } from "../../hooks/useWorkspaceSearch";
import type { WorkspaceSearchModalProps, WorkspaceSearchResult } from "../../types/workspace";
import { ModalDialog } from "../common/ModalDialog";

export function WorkspaceSearchModal({
  mode,
  workspace,
  onMode,
  onClose,
  onOpenFolder,
  onOpen,
  onAttach,
}: WorkspaceSearchModalProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const titleId: string = useId();
  const listId: string = useId();

  const {
    query,
    active,
    matches,
    error,
    loading,
    more,
    isAttach,
    inputRef,
    selectedRef,
    setActive,
    updateQuery,
    selectResult,
    handleKeyDown,
  }: ReturnType<typeof useWorkspaceSearch> = useWorkspaceSearch({
    mode,
    workspace,
    listId,
    onClose,
    onOpen,
    onAttach,
  });

  let status: string = "";
  if (loading) status = t.search.searching;
  else if (mode === "text" && !query.trim()) status = t.search.enterTextPrompt;
  else if (!matches.length) status = t.search.noResults;
  else if (more) status = t.search.moreResults(matches.length);

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={onClose}
      restoreFocus={(): boolean => !selectedRef.current}
      className="fixed inset-x-0 top-[14vh] mx-auto my-0 max-h-[74vh] w-[min(42rem,calc(100%-1.5rem))] overflow-hidden rounded-[12px] border border-separator bg-group p-0 text-label shadow-[0_18px_48px_rgba(44,36,27,0.20)] dark:shadow-[0_22px_56px_rgba(0,0,0,0.48)]"
    >
      <section className="flex max-h-[74vh] min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-separator px-3">
          {isAttach ? (
            <h2 id={titleId} className="flex min-h-11 items-center px-1 text-[13px] font-semibold text-label">
              {t.search.attachTitle}
            </h2>
          ) : (
            <Fragment>
              <h2 id={titleId} className="sr-only">
                {t.search.dialogTitle}
              </h2>
              <button
                type="button"
                aria-pressed={mode === "files"}
                onClick={(): void => {
                  onMode("files");
                  inputRef.current?.focus();
                }}
                className="min-h-11 rounded-[10px] px-3 text-[13px] hover:bg-fill aria-pressed:font-semibold aria-pressed:text-accent"
              >
                {t.search.tabOpenFile}
              </button>
              <button
                type="button"
                aria-pressed={mode === "text"}
                onClick={(): void => {
                  onMode("text");
                  inputRef.current?.focus();
                }}
                className="min-h-11 rounded-[10px] px-3 text-[13px] hover:bg-fill aria-pressed:font-semibold aria-pressed:text-accent"
              >
                {t.search.tabSearchText}
              </button>
            </Fragment>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto min-h-11 px-2 text-[13px] text-secondary hover:text-label"
          >
            {t.common.close}
          </button>
        </div>

        {workspace ? (
          <Fragment>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={matches.length > 0}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
              aria-label={
                isAttach
                  ? t.search.inputAttachLabel
                  : mode === "files"
                    ? t.search.inputFileLabel
                    : t.search.inputTextLabel
              }
              placeholder={
                isAttach
                  ? t.search.inputAttachPlaceholder
                  : mode === "files"
                    ? t.search.inputFilePlaceholder
                    : t.search.inputTextPlaceholder
              }
              value={query}
              maxLength={WORKSPACE_SEARCH_MAX_QUERY_LENGTH}
              onKeyDown={handleKeyDown}
              onChange={(event: ChangeEvent<HTMLInputElement>): void => updateQuery(event.target.value)}
              className="mx-3 my-3 min-h-11 rounded-[10px] border border-separator bg-surface px-3 outline-none focus:border-accent"
            />

            <div id={listId} role="listbox" aria-label={t.search.resultsLabel} className="min-h-0 overflow-y-auto px-2">
              {matches.map((result: WorkspaceSearchResult, index: number): JSX.Element => (
                <div
                  key={`${result.path}:${result.line ?? ""}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={active === index}
                  onPointerMove={(): void => setActive(index)}
                  onMouseDown={(event: MouseEvent<HTMLDivElement>): void => event.preventDefault()}
                  onClick={(): void => selectResult(result)}
                  className={`flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-[10px] px-3 py-1.5 text-[13px] ${
                    active === index ? "bg-fill" : ""
                  }`}
                >
                  <span className="truncate font-mono text-label" title={result.path}>
                    {result.path}
                    {result.line !== undefined && <span className="text-tertiary">:{result.line}</span>}
                  </span>
                  {result.text !== undefined && (
                    <span className="truncate text-secondary">{result.text.trim()}</span>
                  )}
                </div>
              ))}
            </div>

            {(status || error) && (
              <p role={error ? "alert" : "status"} className={`p-3 text-[13px] ${error ? "text-danger" : "text-secondary"}`}>
                {error ? formatError(error, t) : status}
              </p>
            )}
            {!status && !error && <div className="h-2 shrink-0" />}
          </Fragment>
        ) : (
          <div className="flex items-center gap-3 p-3 text-[13px]">
            <p className="text-secondary">{t.search.openFolderFirst}</p>
            <button
              type="button"
              onClick={(): void => {
                onClose();
                onOpenFolder();
              }}
              className="min-h-11 rounded-[10px] px-2 text-accent hover:bg-fill"
            >
              {t.common.openFolder}
            </button>
          </div>
        )}
      </section>
    </ModalDialog>
  );
}
