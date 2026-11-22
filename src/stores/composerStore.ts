import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatMessage, Thread } from "../agent-core/types";
import type { ComposerAttachment, ComposerPrompt } from "../types/composer";
import type { ComposerStore } from "../types/stores";

export const useComposerStore: UseBoundStore<StoreApi<ComposerStore>> = create<ComposerStore>(
  (set: StoreApi<ComposerStore>["setState"]): ComposerStore => ({
    composerPrompt: undefined,
    composerAttachment: undefined,

    chooseMessage: (thread: Thread | undefined, messageId: string, choice: string): void => {
      const target: ChatMessage | undefined = thread?.messages.find(
        ({ id }: ChatMessage): boolean => id === messageId
      );
      if (thread && target?.choices?.includes(choice)) {
        set({ composerPrompt: { threadId: thread.id, text: choice } });
      }
    },

    consumeComposerPrompt: (prompt: ComposerPrompt): void => {
      set((current: ComposerStore): ComposerStore | Partial<ComposerStore> =>
        current.composerPrompt === prompt ? { composerPrompt: undefined } : current
      );
    },

    attachToComposer: (thread: Thread | null, path: string): void => {
      if (thread?.workspace) {
        set({
          composerAttachment: { threadId: thread.id, workspaceId: thread.workspace.id, path },
        });
      }
    },

    consumeComposerAttachment: (request: ComposerAttachment): void => {
      set((current: ComposerStore): ComposerStore | Partial<ComposerStore> =>
        current.composerAttachment === request ? { composerAttachment: undefined } : current
      );
    },
  })
);
