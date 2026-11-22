import { isConfiguredProvider } from "../agent-core/provider/presets";
import type { ProviderConfig } from "../agent-core/provider/presets";
import type { ChatDraft, Thread } from "../agent-core/types";
import { MOCK_MODELS } from "../mocks/models";
import type { MentionQuery, ModelMenuState, ModelOption } from "../types/composer";

export function createEmptyDraft(workspaceId?: string): ChatDraft {
  return { text: "", attachments: [], workspaceId };
}

export function makeComposerScope(threadId?: string, workspaceId?: string): string {
  return JSON.stringify([threadId, workspaceId]);
}

export function resolveModelMenuState(
  allProviders: ProviderConfig[],
  thread: Thread | null
): ModelMenuState {
  const configured: ProviderConfig[] = allProviders.filter(isConfiguredProvider);
  const usingMockModels: boolean = configured.length === 0;
  const options: ModelOption[] = usingMockModels
    ? [...MOCK_MODELS]
    : configured.map((provider: ProviderConfig): ModelOption => ({
      providerId: provider.id,
      providerLabel: provider.label,
      model: provider.model,
      displayName: provider.model,
    }));

  const groupedMap: Map<string, ModelOption[]> = new Map();
  for (const option of options) {
    const list: ModelOption[] = groupedMap.get(option.providerLabel) ?? [];
    list.push(option);
    groupedMap.set(option.providerLabel, list);
  }
  const grouped: [string, ModelOption[]][] = Array.from(groupedMap);

  const storedProvider: ProviderConfig | undefined = allProviders.find(
    ({ id }: ProviderConfig): boolean => id === thread?.modelId
  );
  const selectedModel: ProviderConfig | undefined = storedProvider
    ? {
      ...storedProvider,
      model: thread?.modelName || storedProvider.model,
    }
    : undefined;
  const selectedReal: ProviderConfig | undefined =
    selectedModel && isConfiguredProvider(selectedModel) ? selectedModel : undefined;

  const activeOption: ModelOption | undefined = selectedReal
    ? options.find(
      (option: ModelOption): boolean =>
        option.providerId === selectedReal.id && option.model === selectedReal.model
    ) ?? {
      providerId: selectedReal.id,
      providerLabel: selectedReal.label,
      model: selectedReal.model,
      displayName: selectedReal.model,
    }
    : options.find(
      (option: ModelOption): boolean =>
        option.providerId === thread?.modelId && option.model === thread?.modelName
    );

  return { usingMockModels, options, grouped, activeOption };
}

export function extractMentionQuery(
  value: string,
  cursor: number,
  hasWorkspace: boolean
): MentionQuery | null {
  if (!hasWorkspace) return null;
  const mention: RegExpExecArray | null = /(?:^|\s)@([^\s@]*)$/u.exec(value.slice(0, cursor));
  if (!mention) return null;
  return {
    text: mention[1],
    from: cursor - mention[1].length - 1,
    to: cursor,
  };
}

export function appendPromptToDraft(current: ChatDraft, promptText: string): ChatDraft {
  const prefix: string = `${promptText}\n`;
  if (current.text.startsWith(prefix)) return current;
  return {
    ...current,
    text: current.text.trim() ? `${current.text.trimEnd()}\n${prefix}` : prefix,
  };
}
