import type { ChangeEvent, JSX, UIEvent } from "react";
import { EDITOR_LINE_HEIGHT } from "../../constants/editor";
import { useEditorController } from "../../hooks/useEditorController";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { EditorPaneProps } from "../../types/editor";
import { EmptyState } from "../common/EmptyState";
import { CodeView } from "./CodeView";
import { EditorFindBar } from "./EditorFindBar";
import { EditorTabBar } from "./EditorTabBar";
import { EditorToolbar } from "./EditorToolbar";

export function EditorPane({
  onOpenSidebar,
  onOpenAgent,
  onOpenQuickFiles,
  onAttachFile,
  onAllTabsClosed,
  showSidebarButton = false,
  showAgentButton = false,
  embedded = false,
}: EditorPaneProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const {
    workspace,
    preview,
    path,
    body,
    paths,
    activePath,
    findOpen,
    query,
    matchIndex,
    isEditing,
    isDirty,
    saving,
    savedNotice,
    saveError,
    source,
    highlighted,
    detectedLabel,
    gutter,
    targetLine,
    offsets,
    selection,
    findInputRef,
    sectionRef,
    viewportRef,
    textareaRef,
    activeMarkRef,
    openFolder,
    openFind,
    closeFind,
    stepMatch,
    updateQuery,
    openTab,
    closeTab,
    reloadCurrent,
    toggleEdit,
    updateDraft,
    saveCurrent,
    discardChanges,
    saveScrollPosition,
    handleKeyDown,
    handleTextareaKeyDown,
  }: ReturnType<typeof useEditorController> = useEditorController(onAllTabsClosed);

  return (
    <section
      ref={sectionRef}
      aria-label={t.editor.sectionLabel}
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface"
    >
      <EditorTabBar
        paths={paths}
        activePath={activePath}
        dirtyPath={isDirty ? path : undefined}
        onSelect={(entry: string): void => openTab(entry)}
        onClose={closeTab}
      />

      <EditorToolbar
        embedded={embedded}
        showSidebarButton={showSidebarButton}
        showAgentButton={showAgentButton}
        path={path}
        workspaceName={workspace?.name}
        hasBody={body !== undefined}
        findOpen={findOpen}
        isEditing={isEditing}
        isDirty={isDirty}
        saving={saving}
        savedNotice={savedNotice}
        saveError={saveError}
        detectedLabel={detectedLabel}
        onOpenSidebar={onOpenSidebar}
        onOpenAgent={onOpenAgent}
        onOpenFind={openFind}
        onReload={reloadCurrent}
        onToggleEdit={toggleEdit}
        onSave={(): void => {
          void saveCurrent();
        }}
        onDiscard={discardChanges}
        onAttachFile={onAttachFile}
      />

      {findOpen && path && (
        <EditorFindBar
          inputRef={findInputRef}
          query={query}
          matchIndex={matchIndex}
          matchCount={offsets.length}
          onChangeQuery={updateQuery}
          onStep={stepMatch}
          onClose={closeFind}
        />
      )}

      {path ? (
        <div
          id="editor-file"
          role="tabpanel"
          aria-labelledby={`editor-tab-${paths.indexOf(path)}`}
          className="flex min-h-0 flex-1"
        >
          {preview?.error ? (
            <p role="alert" className="px-4 py-3 text-[13px] text-danger">
              {formatError(preview.error, t)}
            </p>
          ) : body === undefined ? (
            <p role="status" className="px-4 py-3 text-[13px] text-secondary">
              {t.editor.readingFile}
            </p>
          ) : (
            <div
              ref={viewportRef}
              tabIndex={isEditing ? -1 : 0}
              aria-label={t.editor.fileContentLabel(path)}
              onScroll={(event: UIEvent<HTMLDivElement>): void =>
                saveScrollPosition(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)
              }
              className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <div className="relative flex min-w-full w-max font-mono text-[13px] leading-[20px] text-label">
                {targetLine && !isEditing && (
                  <span
                    aria-hidden="true"
                    data-editor-line={targetLine}
                    className="pointer-events-none absolute inset-x-0 h-[20px] bg-accent/15"
                    style={{ top: (targetLine - 1) * EDITOR_LINE_HEIGHT }}
                  />
                )}
                <pre
                  aria-hidden="true"
                  className="relative m-0 shrink-0 select-none pr-4 text-right font-mono text-[13px] leading-[20px] text-tertiary"
                >
                  {gutter}
                </pre>

                {isEditing ? (
                  <div className="grid min-w-0 flex-1 grid-cols-1 grid-rows-1">
                    <pre
                      aria-hidden="true"
                      className="pointer-events-none col-start-1 row-start-1 m-0 min-h-full font-mono text-[13px] leading-[20px] whitespace-pre"
                    >
                      <CodeView
                        source={source}
                        root={highlighted?.root}
                        language={highlighted?.language}
                        offsets={offsets}
                        activeOffset={selection}
                        queryLength={findOpen ? query.length : 0}
                        activeMarkRef={activeMarkRef}
                      />
                      {source.endsWith("\n") ? " " : ""}
                    </pre>
                    <textarea
                      ref={textareaRef}
                      aria-label={t.editor.fileContentLabel(path)}
                      value={source}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      wrap="off"
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                        updateDraft(event.target.value)
                      }
                      onKeyDown={handleTextareaKeyDown}
                      className="col-start-1 row-start-1 m-0 min-h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-[13px] leading-[20px] whitespace-pre text-transparent caret-accent outline-none selection:bg-accent/25"
                    />
                  </div>
                ) : (
                  <pre className="m-0 font-mono text-[13px] leading-[20px]">
                    <CodeView
                      source={source}
                      root={highlighted?.root}
                      language={highlighted?.language}
                      offsets={offsets}
                      activeOffset={selection}
                      queryLength={findOpen ? query.length : 0}
                      activeMarkRef={activeMarkRef}
                    />
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          className="flex-1"
          title={workspace?.name ?? t.editor.emptyOpenProject}
          description={
            workspace ? t.editor.emptyWithWorkspaceHint : t.editor.emptyWithoutWorkspaceHint
          }
          action={
            workspace ? (
              onOpenQuickFiles ? (
                <button
                  type="button"
                  onClick={onOpenQuickFiles}
                  className="inline-flex min-h-10 items-center rounded-full border border-separator bg-group px-4 text-[13px] font-medium text-label hover:bg-fill"
                >
                  {t.editor.selectFileShortcut}
                </button>
              ) : undefined
            ) : (
              <button
                type="button"
                onClick={(): void => {
                  void openFolder();
                }}
                className="inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-[14px] font-medium text-on-accent hover:opacity-90"
              >
                {t.common.openFolder}
              </button>
            )
          }
        />
      )}
    </section>
  );
}
