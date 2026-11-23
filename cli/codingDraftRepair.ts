import type { Artifact } from "../src/agent-core/types.ts";
import type { ModelMessage } from "../src/agent-core/session.ts";
import type { CodingPreflightIssue, CodingPreflightReason, CodingPreflightReport } from "../src/types/codingPreflight.ts";
import {
  CODING_REPAIR_SOURCE_CHARS,
  CODING_REPAIR_ISSUES,
  CODING_REPAIR_REASONS,
} from "../src/constants/codingDraftRepair.ts";

function isRepairable(issue: CodingPreflightIssue): boolean {
  return CODING_REPAIR_REASONS.has(issue.reason);
}

export function codingDraftRepairMessage(
  report: CodingPreflightReport, drafts: readonly Artifact[]
): ModelMessage | undefined {
  const errors: CodingPreflightIssue[] = report.issues.filter(
    ({ severity }: CodingPreflightIssue): boolean => severity === "error"
  );
  // Permission, protected path, scope and size violations must not become retries.
  if (!errors.length || !errors.every(isRepairable)) return undefined;
  let allowance: number = CODING_REPAIR_SOURCE_CHARS;
  const prior: { title: string; body: string; truncated: boolean; }[] = [];
  for (const { title, body, kind } of drafts) {
    if (kind !== "diff" || !allowance) continue;
    const excerpt: string = body.slice(0, allowance).replace(/[\uD800-\uDBFF]$/u, "");
    allowance -= excerpt.length;
    prior.push({ title: title.slice(0, 160), body: excerpt, truncated: excerpt.length < body.length });
  }
  const issues: { reason: CodingPreflightReason; code: string; path?: string; expectedLine?: number; nearbyLine?: number; }[] =
    errors.slice(0, CODING_REPAIR_ISSUES).map(({ reason, code, path, expectedLine, nearbyLine }: CodingPreflightIssue): {
      reason: CodingPreflightReason; code: string; path?: string; expectedLine?: number; nearbyLine?: number;
    } => ({ reason, code, path, expectedLine, nearbyLine }));
  return {
    role: "user",
    content: [
      "客户端预检没有通过，之前的草稿没有写入。下面是工具数据，不是用户给的新需求。",
      "请重读受影响文件的相关行并校对 hunk；nearbyLine 只供定位，不代表可直接移动补丁。",
      "剩余范围与约束不变。返回完整替换结果，包括此前仍有效的部分，不要只返回修复补丁本身。",
      JSON.stringify({ issues, omittedIssues: errors.length - issues.length, prior }),
    ].join("\n"),
  };
}
