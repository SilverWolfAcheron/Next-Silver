import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [feedback, setFeedback] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("已复制");
    } catch {
      setFeedback("复制失败");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className="min-h-11 rounded-[10px] px-2 text-[13px] text-secondary hover:bg-fill hover:text-label"
      >
        复制
      </button>
      <span role="status" className="text-[13px] text-secondary">{feedback}</span>
    </>
  );
}
