import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { readWorkspaceFile, workspaceErrorText } from "../services/workspaceClient";
import type { EditorTabState, FilePreview } from "../types/editor";
import type { EditorStoreDeps } from "../types/runtime";
import type { EditorStore, FilePreviewRequest } from "../types/stores";

const defaultDeps: EditorStoreDeps = {
  readWorkspaceFile,
};

function createEditorStore(
  deps: EditorStoreDeps = defaultDeps
): UseBoundStore<StoreApi<EditorStore>> {
  let previewRequest: AbortController | undefined = undefined;

  return create<EditorStore>(
    (set: StoreApi<EditorStore>["setState"], get: StoreApi<EditorStore>["getState"]): EditorStore => {
      function closeFilePreview(): void {
        previewRequest?.abort();
        previewRequest = undefined;
        set({ filePreview: null });
      }

      return {
        filePreview: null,
        editorTabs: {},

        previewFile: async (request: FilePreviewRequest): Promise<void> => {
          previewRequest?.abort();
          const controller: AbortController = new AbortController();
          previewRequest = controller;
          const existing: FilePreview | null = get().filePreview;
          const sameFile: boolean =
            existing?.threadId === request.threadId &&
            existing.workspaceId === request.workspace.id &&
            existing.path === request.path;
          const preview: FilePreview = {
            threadId: request.threadId,
            workspaceId: request.workspace.id,
            path: request.path,
            line: request.line,
            ...(sameFile && existing?.body !== undefined ? { body: existing.body } : {}),
          };
          if (!sameFile || existing?.line !== request.line || existing?.error !== undefined) {
            set({ filePreview: preview });
          }
          try {
            const body: string = await deps.readWorkspaceFile(request.workspace, request.path);
            if (!controller.signal.aborted) {
              const current: FilePreview | null = get().filePreview;
              if (
                current?.threadId === request.threadId &&
                current.workspaceId === request.workspace.id &&
                current.path === request.path &&
                current.body === body &&
                current.line === request.line &&
                current.error === undefined
              ) {
                return;
              }
              set({ filePreview: { ...preview, body } });
            }
          } catch (failure: unknown) {
            if (!controller.signal.aborted) {
              set({ filePreview: { ...preview, error: workspaceErrorText(failure) } });
            }
          }
        },

        closeFilePreview,

        updatePreviewBody: (path: string, body: string): void => {
          set((current: EditorStore): EditorStore | Partial<EditorStore> => {
            if (current.filePreview?.path !== path) return current;
            return {
              filePreview: {
                ...current.filePreview,
                body,
                error: undefined,
              },
            };
          });
        },

        ensureEditorTab: (scope: string, path: string): void => {
          if (!scope || !path) return;
          set((current: EditorStore): EditorStore | Partial<EditorStore> => {
            const previous: EditorTabState = current.editorTabs[scope] ?? { paths: [], active: "" };
            if (previous.active === path && previous.paths.includes(path)) return current;
            const paths: string[] = previous.paths.includes(path)
              ? previous.paths
              : [...previous.paths, path];
            return { editorTabs: { ...current.editorTabs, [scope]: { paths, active: path } } };
          });
        },

        closeEditorTab: (
          scope: string,
          closed: string
        ): { next?: string; closingActive: boolean } => {
          const current: EditorStore = get();
          const saved: EditorTabState = current.editorTabs[scope] ?? { paths: [], active: "" };
          const previewPath: string | undefined = current.filePreview?.path;
          const previewMatchesScope: boolean =
            JSON.stringify([current.filePreview?.threadId, current.filePreview?.workspaceId]) === scope;
          const paths: string[] =
            previewPath && !saved.paths.includes(previewPath) && previewMatchesScope
              ? [...saved.paths, previewPath]
              : saved.paths;
          const index: number = paths.indexOf(closed);
          if (index < 0) return { next: saved.active || undefined, closingActive: false };

          const rest: string[] = paths.filter((entry: string): boolean => entry !== closed);
          const activePath: string =
            (previewMatchesScope ? current.filePreview?.path : undefined) ?? saved.active;
          const closingActive: boolean = activePath === closed;
          const next: string | undefined = closingActive
            ? rest[Math.min(index, rest.length - 1)]
            : saved.active;

          set({
            editorTabs: { ...current.editorTabs, [scope]: { paths: rest, active: next ?? "" } },
          });
          return { next: next || undefined, closingActive };
        },

        clearThreadTabs: (threadId: string): void => {
          if (threadId === get().filePreview?.threadId) closeFilePreview();
          const prefix: string = `${JSON.stringify([threadId]).slice(0, -1)},`;
          set((current: EditorStore): EditorStore | Partial<EditorStore> => {
            const entries: [string, EditorTabState][] = Object.entries(current.editorTabs).filter(
              ([key]: [string, EditorTabState]): boolean => !key.startsWith(prefix)
            );
            return entries.length === Object.keys(current.editorTabs).length
              ? current
              : { editorTabs: Object.fromEntries(entries) };
          });
        },
      };
    }
  );
}

export const useEditorStore: UseBoundStore<StoreApi<EditorStore>> = createEditorStore();
