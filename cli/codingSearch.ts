import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import { CODING_TOOL_LIMITS } from "../src/constants/codingTools.ts";
import type { WorkspaceSummary, WorkspaceTextMatch } from "../src/agent-core/types.ts";
import type { CodingSearchOptions, CodingSearchResult } from "../src/types/codingTools.ts";
import { workspaceRoot } from "./workspace.ts";
import { canReadCodingPath } from "./codingRead.ts";
import { projectScope, readCodingWorkspaceText, scanProject } from "./codingProjectScan.ts";
import type { ProjectScan } from "./codingProjectScan.ts";

function searchable(path: string): boolean {
  return canReadCodingPath(path) && !/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/iu.test(path);
}

function collectTextMatches(
  path: string, text: string, options: { query: string; matches: WorkspaceTextMatch[]; signal?: AbortSignal; }
): void {
  const { query, matches, signal }: typeof options = options;
  for (const [index, line] of text.split(/\r\n|\r|\n/u).entries()) {
    signal?.throwIfAborted();
    const offset: number = line.toLowerCase().indexOf(query);
    if (offset === -1) continue;
    const start: number = Math.max(0, offset - CODING_TOOL_LIMITS.searchLeadingChars);
    matches.push({ path, line: index + 1, text: line.slice(start, start + CODING_TOOL_LIMITS.searchLineChars) });
    if (matches.length >= CODING_TOOL_LIMITS.searchMatches) return;
  }
}

export async function searchCodingText(
  workspace: WorkspaceSummary, rawQuery: string, options: CodingSearchOptions = {}
): Promise<CodingSearchResult> {
  const { signal }: CodingSearchOptions = options;
  signal?.throwIfAborted();
  const query: string = rawQuery.trim();
  if (!query || query.length > CODING_TOOL_LIMITS.targetChars || /[\r\n\0]/u.test(query)) {
    throw new AppError(ERROR_CODES.WORKSPACE_SEARCH_QUERY_EMPTY);
  }
  const directory: string = projectScope(options.directory ?? "");
  const root: string = await workspaceRoot(workspace);
  const project: ProjectScan = await scanProject(root, { directory, signal });
  const result: CodingSearchResult = { query, directory, matches: [], scannedFiles: 0, truncated: project.truncated };
  const lowerQuery: string = query.toLowerCase();
  let attempted: number = 0;
  let bytes: number = 0;
  for (const { path } of project.files) {
    signal?.throwIfAborted();
    if (!searchable(path)) continue;
    if (attempted >= CODING_TOOL_LIMITS.searchFiles || bytes >= CODING_TOOL_LIMITS.searchBytes) {
      result.truncated = true;
      break;
    }
    attempted++;
    try {
      const limit: number = Math.min(CODING_TOOL_LIMITS.searchFileBytes, CODING_TOOL_LIMITS.searchBytes - bytes);
      const source: Awaited<ReturnType<typeof readCodingWorkspaceText>> = await readCodingWorkspaceText(root, path, { limit, signal });
      bytes += source.bytes;
      result.scannedFiles++;
      collectTextMatches(path, source.text, { query: lowerQuery, matches: result.matches, signal });
      if (result.matches.length >= CODING_TOOL_LIMITS.searchMatches) {
        result.truncated = true;
        break;
      }
    } catch {
      signal?.throwIfAborted();
      // Binary, oversized or moving files are not searched; never report exhaustive coverage.
      result.truncated = true;
    }
  }
  return result;
}
