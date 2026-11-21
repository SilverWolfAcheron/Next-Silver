import { useSilver } from "../state/SilverContext";

interface EditorProps {
  onOpenSidebar: () => void;
  onOpenAgent: () => void;
  showSidebarButton: boolean;
  showAgentButton: boolean;
}

export function Editor({ onOpenSidebar, onOpenAgent, showSidebarButton, showAgentButton }: EditorProps) {
  const { currentThread, filePreview, closeFilePreview, openFolder } = useSilver();
  const preview = filePreview && currentThread && filePreview.threadId === currentThread.id ? filePreview : null;
  const lines = preview?.body?.split("\n") ?? [];

  return (
    <section aria-label="编辑器" className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-separator px-2">
        <button
          type="button"
          aria-label="切换侧栏"
          onClick={onOpenSidebar}
          className={`min-h-11 rounded-[10px] px-2 text-[13px] text-secondary hover:bg-fill ${showSidebarButton ? "" : "min-[960px]:hidden"}`}
        >
          文件
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-secondary">
          {preview?.path ?? currentThread?.workspace?.name ?? "未打开项目"}
        </span>
        {preview && (
          <button type="button" aria-label="关闭文件" onClick={closeFilePreview} className="min-h-11 rounded-[10px] px-2 text-[13px] text-secondary hover:bg-fill">
            关闭
          </button>
        )}
        {showAgentButton && (
          <button type="button" aria-label="打开对话" onClick={onOpenAgent} className="min-h-11 rounded-[10px] px-2 text-[13px] text-secondary hover:bg-fill min-[960px]:hidden">
            对话
          </button>
        )}
      </header>
      {preview?.error ? (
        <p role="alert" className="px-4 py-3 text-[13px] text-danger">{preview.error}</p>
      ) : preview && preview.body === undefined ? (
        <p role="status" className="px-4 py-3 text-[13px] text-secondary">正在读取文件…</p>
      ) : preview ? (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <pre className="flex min-w-full font-mono text-[13px] leading-5 text-label">
            <span aria-hidden="true" className="select-none pr-4 text-right text-tertiary">
              {lines.map((_, index) => <span key={index} className="block">{index + 1}</span>)}
            </span>
            <code className="whitespace-pre">{preview.body}</code>
          </pre>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1 className="text-[28px] font-semibold text-label">
            {currentThread?.workspace?.name ?? "打开项目"}
          </h1>
          <p className="mt-3 max-w-md text-[17px] text-secondary">
            {currentThread?.workspace
              ? "从左侧点开文件。右侧对话会直接改这个文件夹里的代码。"
              : "选择一个本地文件夹。对话、差异和检查都发生在这个项目里。"}
          </p>
          {!currentThread?.workspace && (
            <button
              type="button"
              onClick={() => void openFolder()}
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-[17px] font-medium text-on-accent"
            >
              打开文件夹
            </button>
          )}
        </div>
      )}
    </section>
  );
}
