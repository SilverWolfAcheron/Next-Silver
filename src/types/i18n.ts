import type { Autonomy, RunStatus, SeatRole } from "../agent-core/types";
import type { ErrorMessages } from "./errors";
import type { GitFileStatus } from "./git";
import type { ModelStreamOutcome, ModelStreamPhase } from "./modelActivity";

export type Locale = "zh" | "ja" | "en";

export interface Messages {
  localeName: string;
  htmlLang: string;

  common: {
    save: string;
    cancel: string;
    close: string;
    retry: string;
    copy: string;
    copied: string;
    copyFailed: string;
    remove: string;
    openFolder: string;
    opening: string;
    unopenedProject: string;
  };

  connection: {
    unavailable: string;
    connecting: string;
  };

  layout: {
    closePanel: string;
    resizeLeftSidebar: string;
    resizeRightSidebar: string;
    resizeTooltip: string;
    openLeftSidebar: string;
    hideLeftSidebar: string;
    openLeftSidebarShortcut: string;
    hideLeftSidebarShortcut: string;
    sessionButton: string;
    openRightSidebar: string;
    hideRightSidebar: string;
    filesButton: string;
    mainViewSwitch: string;
    workspaceFilesPanel: string;
    tabs: {
      chat: string;
      brief: string;
      progress: string;
      artifact: string;
      file: string;
    };
  };

  sidebar: {
    asideLabel: string;
    searchLabel: string;
    searchPlaceholder: string;
    clearSearch: string;
    newChat: string;
    newChatShortcut: string;
    threadListLabel: string;
    noMatches: string;
    emptyThreads: string;
    pinnedSection: string;
    recentSection: string;
    pendingConfirm: string;
    running: string;
    threadActions: (title: string) => string;
    rename: string;
    pin: string;
    unpin: string;
    delete: string;
    renameLabel: string;
    settings: string;
    provider: string;
    concurrency: string;
    concurrencyTitle: string;
    concurrencyDecrease: string;
    concurrencyIncrease: string;
    concurrencyHint: (min: number, fallback: number) => string;
    conversationData: string;
    exportJson: string;
    importJson: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
    language: string;
    exportedBackup: (count: number) => string;
    importedBackup: (count: number) => string;
    exportFailed: string;
    importFailed: string;
  };

  chat: {
    asideLabel: string;
    tabGroupLabel: string;
    pendingConfirmBanner: string;
    runningStatus: string;
    modelActivity: {
      phase: Record<ModelStreamPhase, string>;
      outcome: Record<ModelStreamOutcome, string>;
      endedWorking: string;
      endedAwaitingApproval: string;
      awaitingApproval: string;
      details: Record<ModelStreamPhase, (count: number) => string>;
      local: string;
      rate: (value: string) => string;
      rateHint: string;
    };
    emptyProjectHeading: string;
    emptyWithWorkspaceHint: string;
    emptyWithoutWorkspaceHint: string;
    compactEmptyHint: string;
    pickReferenceFile: string;
    queuedLabel: string;
    submittedLabel: string;
    attachmentsLabel: string;
    confirmAcceptDefault: string;
    confirmDeclineDefault: string;
  };

  composer: {
    workspaceFilesLabel: string;
    searchingFiles: string;
    noMatchingFiles: string;
    attachmentsLabel: string;
    removeAttachment: (path: string) => string;
    maxAttachmentsError: (limit: number) => string;
    inputLabel: string;
    inputPlaceholder: string;
    modeAriaLabel: (label: string) => string;
    modeMenuLabel: string;
    modeHints: {
      develop: string;
      review: string;
      explain: string;
      academic: string;
    };
    modelAriaLabel: (name: string) => string;
    selectModel: string;
    modelMenuLabel: string;
    mockPreviewNotice: string;
    mockTags: Record<string, string>;
    stop: string;
    send: string;
    sending: string;
    sendFailed: (reason: string) => string;
    approval: {
      manual: string;
      automatic: string;
      automaticHint: string;
      checks: (workspace: string) => string;
      manualChanges: string;
    };
  };

  editor: {
    sectionLabel: string;
    openFilesLabel: string;
    closeFile: (path: string) => string;
    toggleSidebar: string;
    sidebarButton: string;
    syntaxHighlightLabel: (lang: string) => string;
    findInFile: string;
    findInFileShortcut: string;
    findButton: string;
    reloadFile: string;
    reloadButton: string;
    editButton: string;
    previewButton: string;
    saveButton: string;
    saveShortcut: string;
    savingButton: string;
    savedNotice: string;
    discardButton: string;
    unsavedLabel: string;
    attachToChatLabel: string;
    attachToChatButton: string;
    openChatLabel: string;
    chatButton: string;
    findRegionLabel: string;
    findInputLabel: string;
    findInputPlaceholder: string;
    findMatchCount: (current: number, total: number) => string;
    findNoMatch: string;
    prevMatch: string;
    prevMatchShortcut: string;
    nextMatch: string;
    nextMatchShortcut: string;
    closeFind: string;
    readingFile: string;
    fileContentLabel: (path: string) => string;
    emptyOpenProject: string;
    emptyWithWorkspaceHint: string;
    emptyWithoutWorkspaceHint: string;
    selectFileShortcut: string;
  };

  workspace: {
    explorer: string;
    searchTextLabel: string;
    searchTextShortcut: string;
    refreshTree: string;
    collapseAll: string;
    changeFolder: string;
    openFolder: string;
    desktopOnlyHint: string;
    noFolderHint: string;
    treeLabel: string;
    loading: string;
    reconnecting: string;
    reconnect: string;
    emptyFolder: string;
  };

  search: {
    dialogTitle: string;
    attachTitle: string;
    tabOpenFile: string;
    tabSearchText: string;
    inputAttachLabel: string;
    inputAttachPlaceholder: string;
    inputFileLabel: string;
    inputFilePlaceholder: string;
    inputTextLabel: string;
    inputTextPlaceholder: string;
    resultsLabel: string;
    searching: string;
    enterTextPrompt: string;
    noResults: string;
    moreResults: (count: number) => string;
    openFolderFirst: string;
  };

  provider: {
    modalTitle: string;
    editFallbackTitle: string;
    customProviderLabel: string;
    backToList: string;
    closeSettings: string;
    configured: string;
    unconfigured: string;
    fieldName: string;
    fieldProtocol: string;
    fieldAddress: string;
    fieldKey: string;
    keySavedPlaceholder: string;
    keyInputPlaceholder: string;
    clearKey: string;
    fieldModel: string;
    modelPlaceholder: string;
    testing: string;
    testConnection: string;
    saveFailed: string;
    connectFailed: string;
    modelsFetched: (count: number) => string;
    noModelsReturned: string;
  };

  inspector: {
    asideLabel: string;
    tabGroupLabel: string;
    closeInspector: string;
    tabs: {
      brief: string;
      progress: string;
      artifact: string;
    };
    emptyBrief: string;
    emptyProgress: string;
    emptyArtifact: string;
    promoteToProject: string;
  };

  brief: {
    pendingConfirmNotice: string;
    editBrief: string;
    saveBrief: string;
    goal: string;
    outcome: string;
    requirements: string;
    removeRequirement: (id: string) => string;
    addRequirement: string;
    constraints: string;
    outOfScope: string;
    outOfScopeMultiline: string;
    autonomy: string;
    autonomyLabels: Record<Autonomy, string>;
  };

  progress: {
    completedCount: (completed: number, total: number) => string;
    parallelGroup: string;
    statuses: Record<RunStatus, string>;
    iterationsLabel: string;
    iterationTitle: (index: number, title: string) => string;
    viewIterationArtifact: (title: string) => string;
    retryAuditLabel: (title: string) => string;
    retryRunLabel: (title: string) => string;
    retryAudit: string;
    viewArtifact: string;
    seatActiveLabel: string;
    seatActiveSummary: (developers: number, auditors: number) => string;
    seatRoles: Record<SeatRole, string>;
    noSeats: string;
    parentSeat: (title: string) => string;
    scope: string;
    findings: string;
    refuted: string;
    retained: string;
  };

  diff: {
    openWorkspaceFirst: string;
    foreignWorkspace: string;
    acceptAll: string;
    rejectAll: string;
    writingWorkspace: string;
    confirmLargeWrite: (count: number) => string;
    confirmHasDelete: string;
    confirmHasLockfile: string;
    confirmWritePrompt: (workspaceName: string) => string;
    confirmWriteButton: string;
    statsAriaLabel: (additions: number, deletions: number) => string;
    accepted: string;
    rejected: string;
    acceptFileLabel: (path: string) => string;
    rejectFileLabel: (path: string) => string;
    accept: string;
    reject: string;
  };

  doc: {
    defaultFilename: string;
    exportedTo: (path: string) => string;
    patchFinding: string;
    exporting: string;
    exportMarkdown: string;
  };

  gitDiff: {
    sectionTitle: string;
    noWorkspace: string;
    notGitRepo: string;
    cleanWorkingTree: string;
    loading: string;
    refresh: string;
    refreshChanges: string;
    collapseChanges: string;
    expandAll: string;
    collapseAll: string;
    openFile: string;
    binaryFile: string;
    emptyDiff: string;
    truncatedFile: (shown: number) => string;
    truncatedWorkspace: string;
    filesSummary: (count: number) => string;
    changedTreeEmpty: string;
    changedTreeHeader: (count: number) => string;
    agentArtifactLabel: string;
    agentArtifactFiles: (count: number) => string;
    agentArtifactSettled: string;
    agentArtifactPending: (count: number) => string;
    statuses: Record<GitFileStatus, string>;
  };

  errors: ErrorMessages;
}
