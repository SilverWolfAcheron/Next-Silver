import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import type {
  FileEditResult,
  RenamePathResult,
  TextAppendResult,
  TextLineDeleteResult,
  TextLineReplaceResult,
} from "../src/types/fileEdit.ts";
import {
  appendTextToContent,
  deleteLinesInText,
  detectLineEnding,
  replaceLinesInText,
  restoreLineEndings,
} from "../src/utils/file-edit/textOps.ts";
import { bindWorkspace } from "./workspace.ts";
import {
  appendWorkspaceFile,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceDirectory,
  deleteWorkspaceFile,
  deleteWorkspaceFileLines,
  renameWorkspaceDirectory,
  renameWorkspaceFile,
  replaceWorkspaceFileContent,
  replaceWorkspaceFileLines,
} from "./workspaceFileOps.ts";

async function withWorkspace(
  run: (ctx: { root: string; dataDir: string; workspace: WorkspaceSummary; outer: string }) => Promise<void>
): Promise<void> {
  const outer: string = await mkdtemp(join(tmpdir(), "silver-file-edit-"));
  const root: string = join(outer, "work");
  const dataDir: string = join(outer, "data");
  await mkdir(root, { recursive: true });
  const workspace: WorkspaceSummary = await bindWorkspace(root, dataDir);
  try {
    await run({ root, dataDir, workspace, outer });
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
}

test("pure textOps preserve CRLF/LF endings and validate line ranges", (): void => {
  const crlf: string = "line1\r\nline2\r\nline3\r\n";
  assert.equal(detectLineEnding(crlf), "\r\n");

  const replaced: TextLineReplaceResult = replaceLinesInText({
    content: crlf,
    startLine: 2,
    endLine: 2,
    replacement: "updatedA\nupdatedB",
  });
  assert.equal(replaced.content, "line1\r\nupdatedA\r\nupdatedB\r\nline3\r\n");
  assert.equal(replaced.lineCount, 4);
  assert.equal(replaced.replacedCount, 1);

  const deleted: TextLineDeleteResult = deleteLinesInText({
    content: replaced.content,
    startLine: 2,
    endLine: 3,
  });
  assert.equal(deleted.content, "line1\r\nline3\r\n");
  assert.equal(deleted.deletedCount, 2);

  const appended: TextAppendResult = appendTextToContent({
    content: "first\r\nsecond",
    addition: "third\n",
    ensureNewline: true,
  });
  assert.equal(appended.content, "first\r\nsecond\r\nthird\r\n");
  assert.equal(restoreLineEndings("a\nb\n", "\r\n"), "a\r\nb\r\n");

  assert.throws(
    (): TextLineReplaceResult =>
      replaceLinesInText({ content: "one\ntwo\n", startLine: 0, endLine: 1, replacement: "x" }),
    /FILE_EDIT_LINE_RANGE_INVALID/u
  );
  assert.throws(
    (): TextLineDeleteResult =>
      deleteLinesInText({ content: "one\ntwo\n", startLine: 2, endLine: 5 }),
    /FILE_EDIT_LINE_RANGE_INVALID/u
  );
});

test("workspace file-edit operations support create, rename, line edit, append, replace, and delete", async (): Promise<void> => {
  await withWorkspace(async ({ root, dataDir, workspace, outer }): Promise<void> => {
    // 2: Create directory & file
    await createWorkspaceDirectory(workspace, { path: "src/sub", recursive: true }, dataDir);
    await assert.rejects(
      (): Promise<unknown> =>
        createWorkspaceDirectory(workspace, { path: "src/sub", recursive: false }, dataDir),
      /WORKSPACE_TARGET_EXISTS/u
    );

    const created: FileEditResult = await createWorkspaceFile(
      workspace,
      { path: "src/sub/demo.txt", content: "alpha\r\nbeta\r\ngamma\r\n" },
      dataDir
    );
    assert.equal(created.lineCount, 3);
    await assert.rejects(
      (): Promise<unknown> =>
        createWorkspaceFile(workspace, { path: "src/sub/demo.txt", content: "dup" }, dataDir),
      /WORKSPACE_TARGET_EXISTS/u
    );

    // 4: Replace lines by line range (preserving CRLF)
    const afterReplace: FileEditResult = await replaceWorkspaceFileLines(
      workspace,
      { path: "src/sub/demo.txt", startLine: 2, endLine: 2, replacement: "BETA_1\nBETA_2" },
      dataDir
    );
    assert.equal(afterReplace.content, "alpha\r\nBETA_1\r\nBETA_2\r\ngamma\r\n");

    // 5: Append content to file
    const afterAppend: FileEditResult = await appendWorkspaceFile(
      workspace,
      { path: "src/sub/demo.txt", content: "delta\n" },
      dataDir
    );
    assert.equal(afterAppend.content, "alpha\r\nBETA_1\r\nBETA_2\r\ngamma\r\ndelta\r\n");

    // 6: Delete lines by line range
    const afterDeleteLines: FileEditResult = await deleteWorkspaceFileLines(
      workspace,
      { path: "src/sub/demo.txt", startLine: 2, endLine: 3 },
      dataDir
    );
    assert.equal(afterDeleteLines.content, "alpha\r\ngamma\r\ndelta\r\n");

    // 7: Full content replacement (editor save path) with optimistic concurrency check
    await assert.rejects(
      (): Promise<unknown> =>
        replaceWorkspaceFileContent(
          workspace,
          { path: "src/sub/demo.txt", content: "stale", expectedBefore: "wrong" },
          dataDir
        ),
      /WORKSPACE_FILE_CHANGED/u
    );
    const saved: FileEditResult = await replaceWorkspaceFileContent(
      workspace,
      {
        path: "src/sub/demo.txt",
        content: "full replacement\r\nsecond line\r\n",
        expectedBefore: afterDeleteLines.content,
      },
      dataDir
    );
    assert.equal(saved.lineCount, 2);
    assert.equal(
      await readFile(join(root, "src", "sub", "demo.txt"), "utf8"),
      "full replacement\r\nsecond line\r\n"
    );

    // 3: Rename file (including case-only rename) & rename directory
    const renamedFile: RenamePathResult = await renameWorkspaceFile(
      workspace,
      { fromPath: "src/sub/demo.txt", toPath: "src/sub/Demo.txt" },
      dataDir
    );
    assert.equal(renamedFile.toPath, "src/sub/Demo.txt");

    await assert.rejects(
      (): Promise<unknown> =>
        renameWorkspaceDirectory(
          workspace,
          { fromPath: "src/sub", toPath: "src/sub/child" },
          dataDir
        ),
      /FILE_EDIT_RENAME_INTO_SELF/u
    );

    await renameWorkspaceDirectory(
      workspace,
      { fromPath: "src/sub", toPath: "src/renamed" },
      dataDir
    );
    assert.equal(
      await readFile(join(root, "src", "renamed", "Demo.txt"), "utf8"),
      "full replacement\r\nsecond line\r\n"
    );

    // 1: Delete file & delete directory (non-empty guard + recursive + symlink safety)
    await assert.rejects(
      (): Promise<unknown> =>
        deleteWorkspaceDirectory(workspace, { path: "src/renamed", recursive: false }, dataDir),
      /WORKSPACE_DIR_NOT_EMPTY/u
    );
    await deleteWorkspaceFile(workspace, { path: "src/renamed/Demo.txt" }, dataDir);
    await deleteWorkspaceDirectory(workspace, { path: "src/renamed", recursive: false }, dataDir);

    await createWorkspaceFile(workspace, { path: "trash/a/b.txt", content: "bye" }, dataDir);
    await deleteWorkspaceDirectory(workspace, { path: "trash", recursive: true }, dataDir);
    await assert.rejects((): Promise<unknown> => lstat(join(root, "trash")));

    // Security: reject symlink escape
    const outsideDir: string = join(outer, "outside");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.txt"), "safe", "utf8");
    await symlink(outsideDir, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      (): Promise<unknown> => deleteWorkspaceDirectory(workspace, { path: "link" }, dataDir),
      /WORKSPACE_SYMLINK_FORBIDDEN/u
    );
    assert.equal(await readFile(join(outsideDir, "secret.txt"), "utf8"), "safe");
  });
});
