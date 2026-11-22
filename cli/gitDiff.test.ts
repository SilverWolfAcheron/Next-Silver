import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import type { GitDiffFile, GitTreeNode, WorkspaceGitDiff } from "../src/types/git.ts";
import { buildGitChangesTree } from "../src/utils/diff.ts";
import { parseGitDiffOutput, readWorkspaceGitDiff } from "./gitDiff.ts";
import { bindWorkspace } from "./workspace.ts";

const execFileAsync: (
  file: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean }
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir: string = await mkdtemp(join(tmpdir(), "silver-git-diff-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readWorkspaceGitDiff reports isRepo=false for non-git workspaces", async (): Promise<void> => {
  await withTempDir(async (dir: string): Promise<void> => {
    const dataDir: string = join(dir, "data");
    const workDir: string = join(dir, "plain");
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, "readme.txt"), "hello\n", "utf8");

    const workspace: WorkspaceSummary = await bindWorkspace(workDir, dataDir);
    const diff: WorkspaceGitDiff = await readWorkspaceGitDiff(workspace, dataDir);
    assert.equal(diff.isRepo, false);
    assert.deepEqual(diff.files, []);
    assert.equal(diff.totalAdditions, 0);
    assert.equal(diff.totalDeletions, 0);
  });
});

test("readWorkspaceGitDiff reads tracked, staged, deleted, renamed, binary, and untracked changes", async (): Promise<void> => {
  await withTempDir(async (dir: string): Promise<void> => {
    const dataDir: string = join(dir, "data");
    const repoDir: string = join(dir, "repo");
    await mkdir(join(repoDir, "src", "nested"), { recursive: true });

    await git(repoDir, ["init", "-b", "main"]);
    await git(repoDir, ["config", "user.name", "Silver Test"]);
    await git(repoDir, ["config", "user.email", "test@silver.local"]);

    const workspace: WorkspaceSummary = await bindWorkspace(repoDir, dataDir);

    // Unborn HEAD with an untracked file
    await writeFile(join(repoDir, "src", "app.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
    const unbornDiff: WorkspaceGitDiff = await readWorkspaceGitDiff(workspace, dataDir);
    assert.equal(unbornDiff.isRepo, true);
    assert.equal(unbornDiff.branch, "main");
    assert.equal(unbornDiff.files.length, 1);
    assert.equal(unbornDiff.files[0].status, "untracked");
    assert.equal(unbornDiff.files[0].additions, 2);
    assert.equal(unbornDiff.files[0].deletions, 0);

    // Create initial commit
    await writeFile(join(repoDir, "src", "nested", "old.ts"), "export const x = 1;\n", "utf8");
    await writeFile(join(repoDir, "remove-me.txt"), "line1\nline2\n", "utf8");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["commit", "-m", "initial"]);

    // Clean working tree
    const cleanDiff: WorkspaceGitDiff = await readWorkspaceGitDiff(workspace, dataDir);
    assert.equal(cleanDiff.isRepo, true);
    assert.equal(cleanDiff.files.length, 0);

    // Produce modified, staged added, deleted, renamed, untracked Unicode, and binary files
    await writeFile(join(repoDir, "src", "app.ts"), "const a = 10;\nconst b = 2;\nconst c = 3;\n", "utf8");
    await unlink(join(repoDir, "remove-me.txt"));
    await writeFile(join(repoDir, "src", "staged.ts"), "export const ok = true;\n", "utf8");
    await git(repoDir, ["add", "src/staged.ts"]);
    await git(repoDir, ["mv", "src/nested/old.ts", "src/nested/renamed.ts"]);
    await writeFile(join(repoDir, "src", "中文.ts"), "export const label = 'hi';\n", "utf8");
    await writeFile(join(repoDir, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff]));

    const result: WorkspaceGitDiff = await readWorkspaceGitDiff(workspace, dataDir);
    assert.equal(result.isRepo, true);
    assert.equal(result.branch, "main");

    const byPath: Map<string, GitDiffFile> = new Map<string, GitDiffFile>(
      result.files.map((file: GitDiffFile): [string, GitDiffFile] => [file.path, file])
    );

    const modified: GitDiffFile | undefined = byPath.get("src/app.ts");
    assert.ok(modified);
    assert.equal(modified.status, "modified");
    assert.equal(modified.additions, 2);
    assert.equal(modified.deletions, 1);
    assert.ok(modified.lines.some((line): boolean => line.kind === "added" && line.newLine === 1));
    assert.ok(modified.lines.some((line): boolean => line.kind === "removed" && line.oldLine === 1));

    const deleted: GitDiffFile | undefined = byPath.get("remove-me.txt");
    assert.ok(deleted);
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.deletions, 2);

    const staged: GitDiffFile | undefined = byPath.get("src/staged.ts");
    assert.ok(staged);
    assert.equal(staged.status, "added");
    assert.equal(staged.additions, 1);

    const renamed: GitDiffFile | undefined = byPath.get("src/nested/renamed.ts");
    assert.ok(renamed);
    assert.equal(renamed.status, "renamed");
    assert.equal(renamed.oldPath, "src/nested/old.ts");

    const unicodeUntracked: GitDiffFile | undefined = byPath.get("src/中文.ts");
    assert.ok(unicodeUntracked);
    assert.equal(unicodeUntracked.status, "untracked");
    assert.equal(unicodeUntracked.additions, 1);

    const binaryFile: GitDiffFile | undefined = byPath.get("bin.dat");
    assert.ok(binaryFile);
    assert.equal(binaryFile.binary, true);

    assert.equal(result.totalAdditions, 4);
    assert.equal(result.totalDeletions, 3);

    // Verify changed-files directory tree aggregation
    const tree: GitTreeNode[] = buildGitChangesTree(result.files);
    const srcDir: GitTreeNode | undefined = tree.find(
      (node: GitTreeNode): boolean => node.kind === "directory" && node.name === "src"
    );
    assert.ok(srcDir);
    assert.equal(srcDir.additions, 4);
    assert.equal(srcDir.deletions, 1);
    assert.ok(srcDir.children?.some((child: GitTreeNode): boolean => child.name === "nested"));
    assert.ok(srcDir.children?.some((child: GitTreeNode): boolean => child.name === "app.ts"));
  });
});

test("parseGitDiffOutput tracks dual-column line numbers accurately", (): void => {
  const sample: string = [
    "diff --git a/foo.ts b/foo.ts",
    "index 1111111..2222222 100644",
    "--- a/foo.ts",
    "+++ b/foo.ts",
    "@@ -10,3 +10,4 @@",
    " const keep = 1;",
    "-const oldVal = 2;",
    "+const newVal = 2;",
    "+const extra = 3;",
    " const end = 4;",
  ].join("\n");

  const parsed: GitDiffFile[] = parseGitDiffOutput(sample);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].additions, 2);
  assert.equal(parsed[0].deletions, 1);
  assert.deepEqual(
    parsed[0].lines.map((line): [string, number | null, number | null] => [
      line.kind,
      line.oldLine,
      line.newLine,
    ]),
    [
      ["meta", null, null],
      ["context", 10, 10],
      ["removed", 11, null],
      ["added", null, 11],
      ["added", null, 12],
      ["context", 12, 13],
    ]
  );
});
