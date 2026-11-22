import type { JSX, UIEvent } from "react";
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
    activeMarkRef,
    openFolder,
    openFind,
    closeFind,
    stepMatch,
    updateQuery,
    openTab,
    closeTab,
    reloadCurrent,
    saveScrollPosition,
    handleKeyDown,
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
        detectedLabel={detectedLabel}
        onOpenSidebar={onOpenSidebar}
        onOpenAgent={onOpenAgent}
        onOpenFind={openFind}
        onReload={reloadCurrent}
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
              tabIndex={0}
              aria-label={t.editor.fileContentLabel(path)}
              onScroll={(event: UIEvent<HTMLDivElement>): void =>
                saveScrollPosition(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)
              }
              className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <pre className="relative flex min-w-full w-max font-mono text-[13px] leading-[20px] text-label">
                {targetLine && (
                  <span
                    aria-hidden="true"
                    data-editor-line={targetLine}
                    className="pointer-events-none absolute inset-x-0 h-[20px] bg-accent/15"
                    style={{ top: (targetLine - 1) * EDITOR_LINE_HEIGHT }}
                  />
                )}
                <span aria-hidden="true" className="relative select-none pr-4 text-right text-tertiary">
                  {gutter}
                </span>
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
