import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ERROR_CODES } from "../src/agent-core/errors.ts";
import type { Artifact, WorkspaceSummary } from "../src/agent-core/types.ts";
import {
  CODING_PREFLIGHT_BULK_FILE_COUNT,
  CODING_PREFLIGHT_MAX_ARTIFACTS,
  CODING_PREFLIGHT_MAX_FILES,
  CODING_PREFLIGHT_MAX_PATCH_BYTES,
  CODING_PREFLIGHT_MAX_PATCH_LINES,
  CODING_PREFLIGHT_MAX_SNAPSHOT_BYTES,
} from "../src/constants/codingPreflight.ts";
import { FILE_EDIT_MAX_TEXT_BYTES } from "../src/constants/fileEdit.ts";
import type {
  CodingPreflightIssue,
  CodingPreflightReport,
  CodingPreflightSummary,
  CodingPreflightWrite,
  CodingSnapshotResult,
} from "../src/types/codingPreflight.ts";
import {
  preflightCodingChanges,
  summarizeCodingPreflight,
  verifyCodingWriteSnapshot,
} from "./codingPreflight.ts";
import { bindWorkspace, subscribeWorkspaceChanges, writeWorkspaceFile } from "./workspace.ts";

interface Fixture {
  root: string;
  dataDir: string;
  outer: string;
  workspace: WorkspaceSummary;
  set(path: string, content: string | Uint8Array): Promise<void>;
  read(path: string): Promise<string>;
  patch(body: string, options?: Partial<Omit<Artifact, "body">>): Artifact;
}

async function withWorkspace(action: (fixture: Fixture) => Promise<void>): Promise<void> {
  const outer: string = await mkdtemp(join(tmpdir(), "silver-preflight-"));
  const root: string = join(outer, "work");
  const dataDir: string = join(outer, "runtime");
  const previous: string | undefined = process.env.SILVER_DATA_DIR;
  process.env.SILVER_DATA_DIR = dataDir;
  let index: number = 0;
  try {
    await mkdir(root);
    const workspace: WorkspaceSummary = await bindWorkspace(root, dataDir);
    await action({
      root, dataDir, outer, workspace,
      set: async (path: string, content: string | Uint8Array): Promise<void> => {
        const parts: string[] = path.split("/");
        const parent: string = join(root, ...parts.slice(0, -1));
        await mkdir(parent, { recursive: true });
        await writeFile(join(parent, parts.at(-1) ?? ""), content);
      },
      read: (path: string): Promise<string> => readFile(join(root, path), "utf8"),
      patch: (body: string, options?: Partial<Omit<Artifact, "body">>): Artifact => ({
        id: `artifact-${++index}`, kind: "diff", title: "Proposed changes", body, workspaceId: workspace.id, ...options,
      }),
    });
  } finally {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(outer, { recursive: true, force: true });
  }
}

function createPatch(path: string, line: string = "new"): string {
  return `--- /dev/null\n+++ ${path}\n@@ -0,0 +1 @@\n+${line}\n`;
}

function updatePatch(path: string, previous: string = "old", next: string = "new"): string {
  return `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${previous}\n+${next}\n`;
}

function deletePatch(path: string, previous: string = "old"): string {
  return `--- ${path}\n+++ /dev/null\n@@ -1 +0,0 @@\n-${previous}\n`;
}

function issueCodes(report: CodingPreflightReport): (string | undefined)[][] {
  return report.issues.map(({ reason, code, path }: CodingPreflightIssue): (string | undefined)[] => [reason, code, path]);
}

test("preflight snapshots a mixed batch without creating parents, emitting events, or mutating disk", async (): Promise<void> => {
  await withWorkspace(async ({ root, workspace, set, patch, read }: Fixture): Promise<void> => {
    await set("src/main.ts", "old\r\nsecond\r\n");
    const change: Artifact = patch(updatePatch("src/main.ts") + createPatch("nested/new.txt"));
    const other: Artifact = patch("not a patch", { kind: "doc", workspaceId: undefined });
    let events: number = 0;
    const dispose: () => void = subscribeWorkspaceChanges(workspace, (): void => { events++; });
    try {
      const report: CodingPreflightReport = await preflightCodingChanges(workspace, [other, change]);
      assert.equal(report.status, "ready");
      assert.deepEqual(report.issues, []);
      assert.deepEqual(report.writes, [
        { artifactId: change.id, path: "src/main.ts", before: "old\r\nsecond\r\n", after: "new\r\nsecond\r\n" },
        { artifactId: change.id, path: "nested/new.txt", before: null, after: "new\n" },
      ]);
      assert.deepEqual(report.stats, {
        artifacts: 1, files: 2, verified: 2, created: 1, updated: 1, deleted: 0, additions: 2, deletions: 1,
        patchBytes: Buffer.byteLength(change.body), patchLines: 9, snapshotBytes: 30,
      });
      assert.deepEqual(report.files.map((file: CodingPreflightReport["files"][number]): (string | number | undefined)[] => [file.path, file.hunks, file.status, file.beforeBytes, file.afterBytes]), [
        ["src/main.ts", 1, "verified", 13, 13],
        ["nested/new.txt", 1, "verified", 0, 4],
      ]);
      assert.equal(await read("src/main.ts"), "old\r\nsecond\r\n");
      await assert.rejects(lstat(join(root, "nested")), { code: "ENOENT" });
      assert.equal(events, 0);
    } finally {
      dispose();
    }
  });
});

test("summary makes snapshots, raw patch, title and untouched source impossible to serialize accidentally", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, set }: Fixture): Promise<void> => {
    await set("program.txt", "development-only fixture\nprivate untouched value\n");
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(updatePatch("program.txt", "development-only fixture", "new private value"), { title: "secret title" }),
    ]);
    assert.equal(report.status, "ready");
    const summary: CodingPreflightSummary = summarizeCodingPreflight(report);
    const serialized: string = JSON.stringify(summary);
    assert.deepEqual(Object.keys(summary).sort(), ["files", "issues", "stats", "status"]);
    for (const secret of ["private untouched value", "new private value", "secret title", "development-only fixture"]) {
      assert.ok(!serialized.includes(secret));
    }
  });
});

test("does not reuse a foreign or unbound artifact; documents may be foreign and are ignored", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, root }: Fixture): Promise<void> => {
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch("foreign doc", { kind: "doc", workspaceId: "different-id" }),
      patch(createPatch("foreign.txt"), { workspaceId: "different-id" }),
      patch(createPatch("unbound.txt"), { workspaceId: undefined }),
    ]);
    assert.equal(report.status, "invalid");
    assert.equal(report.stats.artifacts, 2);
    assert.equal(report.stats.files, 0);
    assert.deepEqual(issueCodes(report), [
      ["artifact_workspace", ERROR_CODES.DIFF_WORKSPACE_UNBOUND, undefined],
      ["artifact_workspace", ERROR_CODES.DIFF_WORKSPACE_UNBOUND, undefined],
    ]);
    assert.deepEqual(report.writes, []);
    assert.deepEqual(await readdir(root), []);
  });
});

test("deletion, lockfile and execution config require confirmation but preserve write plans", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, set, patch, read }: Fixture): Promise<void> => {
    await set("packages/writer/package.json", "{}\n");
    await set("pnpm-lock.yaml", "old\n");
    await set("uv.lock", "old\n");
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(updatePatch("packages/writer/package.json", "{}", '{"scripts":{"test":"node --test"}}')),
      patch(deletePatch("pnpm-lock.yaml")),
      patch(updatePatch("uv.lock")),
      patch(createPatch(".github/workflows/ci.yml", "name: build")),
    ]);
    assert.equal(report.status, "needs_confirmation");
    assert.deepEqual(report.issues.map(({ reason, path }: CodingPreflightIssue): [string, string | undefined] => [reason, path]), [
      ["execution_config", "packages/writer/package.json"],
      ["delete", "pnpm-lock.yaml"],
      ["lockfile", "pnpm-lock.yaml"],
      ["lockfile", "uv.lock"],
      ["execution_config", ".github/workflows/ci.yml"],
    ]);
    assert.ok(report.issues.every(({ severity, code }: CodingPreflightIssue): boolean =>
      severity === "confirmation" && code === ERROR_CODES.DIFF_CONFIRMATION_REQUIRED));
    assert.equal(report.stats.deleted, 1);
    assert.equal(report.writes.length, 4);
    assert.equal(report.writes[1].after, null);
    assert.equal(await read("pnpm-lock.yaml"), "old\n");
  });
});

test("batch confirmation uses distinct verified files and preserves the existing twenty-file threshold", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch }: Fixture): Promise<void> => {
    const files: string[] = Array.from({ length: CODING_PREFLIGHT_BULK_FILE_COUNT + 1 },
      (_value: unknown, index: number): string => createPatch(`file-${index}.txt`));
    const ordinary: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(files.slice(0, -1).join(""))]);
    assert.equal(ordinary.status, "ready");
    const bulk: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(files.join(""))]);
    assert.equal(bulk.status, "needs_confirmation");
    assert.deepEqual(bulk.issues.map(({ reason, limit }: CodingPreflightIssue): [string, number | undefined] => [reason, limit]), [
      ["bulk_change", CODING_PREFLIGHT_BULK_FILE_COUNT],
    ]);
    assert.equal(bulk.writes.length, files.length);
  });
});

test("captures malformed hunk errors, prevents partial application and omits unsafe path text", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, root }: Fixture): Promise<void> => {
    const absolute: string = join(root, "should-not-leak");
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(createPatch("valid.txt")),
      patch(`--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n`),
      patch(createPatch("../sibling-secret")),
      patch(createPatch(absolute)),
      patch("GIT binary patch\n"),
    ]);
    assert.equal(report.status, "invalid");
    assert.deepEqual(issueCodes(report), [
      ["malformed", ERROR_CODES.DIFF_HUNK_LINE_COUNT_MISMATCH, "src/file.ts"],
      ["malformed", ERROR_CODES.DIFF_PATH_OUTSIDE_WORKSPACE, undefined],
      ["malformed", ERROR_CODES.DIFF_PATH_OUTSIDE_WORKSPACE, undefined],
      ["malformed", ERROR_CODES.DIFF_HEADER_MISSING, undefined],
    ]);
    assert.ok(!JSON.stringify(summarizeCodingPreflight(report)).includes(root));
    assert.equal(report.stats.verified, 1);
    assert.deepEqual(report.writes, []);
    assert.deepEqual(await readdir(root), []);
  });
});

test("rejects case-folded and Unicode-normalized aliases across separate artifacts", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch }: Fixture): Promise<void> => {
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(createPatch("src/Café.ts")),
      patch(createPatch("src/CAFE\u0301.ts")),
    ]);
    assert.equal(report.status, "invalid");
    assert.deepEqual(issueCodes(report), [
      ["duplicate_path", ERROR_CODES.ITERATION_CONFLICTING_DIFF, "src/Café.ts"],
      ["duplicate_path", ERROR_CODES.ITERATION_CONFLICTING_DIFF, "src/CAFE\u0301.ts"],
    ]);
    assert.equal(report.stats.verified, 0);
    assert.deepEqual(report.writes, []);
  });
});

test("rejects duplicate file sections within one patch and conflicts between proposed parent and child files", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch }: Fixture): Promise<void> => {
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(createPatch("same.txt") + createPatch("same.txt")),
      patch(createPatch("src/Blob")),
      patch(createPatch("src/blob/index.ts")),
      patch(createPatch("src/unrelated.ts")),
    ]);
    assert.equal(report.status, "invalid");
    assert.deepEqual(issueCodes(report), [
      ["duplicate_path", ERROR_CODES.DIFF_DUPLICATE_FILE, "same.txt"],
      ["duplicate_path", ERROR_CODES.DIFF_DUPLICATE_FILE, "same.txt"],
      ["path_collision", ERROR_CODES.ITERATION_CONFLICTING_DIFF, "src/Blob"],
      ["path_collision", ERROR_CODES.ITERATION_CONFLICTING_DIFF, "src/blob/index.ts"],
    ]);
    assert.equal(report.stats.verified, 1);
    assert.deepEqual(report.writes, []);
  });
});

test("blocks protected Git metadata and credentials before reading while permitting example env files", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, set, patch }: Fixture): Promise<void> => {
    const hidden: string[] = [
      ".git/config", "sub/.GIT/hooks/pre-commit", ".hg/hgrc", ".env.local", "foo/.ENV",
      "foo/key.PEM", ".npmrc", "foo/.netrc", "credentials/id_ed25519", ".ssh/config", ".aws/config",
    ];
    for (const path of hidden) await set(path, "never read or include this\n");
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      ...hidden.map((path: string): Artifact => patch(updatePatch(path))),
      patch(createPatch(".env.example", "EXAMPLE=public")),
    ]);
    assert.equal(report.status, "invalid");
    assert.deepEqual(report.issues.map(({ reason, path }: CodingPreflightIssue): [string, string | undefined] => [reason, path]),
      hidden.map((path: string): [string, string] => ["protected_path", path]));
    assert.equal(report.stats.verified, 1);
    assert.deepEqual(report.writes, []);
    assert.ok(!JSON.stringify(report).includes("never read or include this"));
  });
});

test("policy and exact seat scope are distinct errors and are evaluated before workspace reads", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch }: Fixture): Promise<void> => {
    const source: Artifact = patch(updatePatch("src/core.ts"));
    const docs: Artifact = patch(createPatch("docs/Guide.MD"));
    const deletion: Artifact = patch(deletePatch("docs/old.md"));
    const readOnly: CodingPreflightReport = await preflightCodingChanges(workspace, [source, docs], { policy: "none" });
    assert.deepEqual(issueCodes(readOnly), [
      ["policy", ERROR_CODES.DIFF_POLICY_READONLY, "src/core.ts"],
      ["policy", ERROR_CODES.DIFF_POLICY_READONLY, "docs/Guide.MD"],
    ]);
    const docsOnly: CodingPreflightReport = await preflightCodingChanges(workspace, [source, docs, deletion], { policy: "docs" });
    assert.deepEqual(issueCodes(docsOnly), [
      ["policy", ERROR_CODES.DIFF_POLICY_DOCS_ONLY, "src/core.ts"],
      ["policy", ERROR_CODES.DIFF_POLICY_DOCS_ONLY, "docs/old.md"],
    ]);
    assert.equal(docsOnly.stats.verified, 1);
    for (const scope of [[], ["docs"], ["docs/guide.md"]]) {
      const scoped: CodingPreflightReport = await preflightCodingChanges(workspace, [docs], { scope });
      assert.deepEqual(issueCodes(scoped), [["scope", ERROR_CODES.SEAT_SCOPE_EXCEEDED, "docs/Guide.MD"]]);
    }
    const exact: CodingPreflightReport = await preflightCodingChanges(workspace, [docs], {
      policy: "docs", scope: ["docs/Guide.MD"],
    });
    assert.equal(exact.status, "ready");
  });
});

test("retains a user's rejection and never mistakes a missing source or existing target for confirmation", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, set }: Fixture): Promise<void> => {
    await set("existing.txt", "new\n");
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(createPatch("existing.txt")),
      patch(deletePatch("missing/child.txt")),
      patch(createPatch("rejected.txt"), { fileDecisions: { "rejected.txt": "rejected" } }),
    ]);
    assert.equal(report.status, "invalid");
    assert.deepEqual(issueCodes(report), [
      ["target_exists", ERROR_CODES.DIFF_TARGET_EXISTS, "existing.txt"],
      ["source_missing", ERROR_CODES.DIFF_SOURCE_MISSING, "missing/child.txt"],
      ["rejected", ERROR_CODES.DIFF_FILE_REJECTED, "rejected.txt"],
    ]);
    assert.deepEqual(report.writes, []);
  });
});

test("stale model context receives bounded exact re-read coordinates, never automatic fuzzy application", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, set, read }: Fixture): Promise<void> => {
    await set("shifted.ts", "manual edit\nconst hidden = 'private';\nexport const next = 1;\n");
    const body: string = "--- shifted.ts\n+++ shifted.ts\n@@ -1,2 +1,2 @@\n const hidden = 'private';\n-export const next = 1;\n+export const next = 2;\n";
    const result: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(body)]);
    assert.equal(result.status, "invalid");
    const [first]: CodingPreflightIssue[] = result.issues;
    assert.equal(first.reason, "stale_hunk");
    assert.equal(first.code, ERROR_CODES.DIFF_CONFLICT);
    assert.deepEqual(first.params, { path: "shifted.ts", expectedLine: 1, nearbyLine: 2 });
    assert.equal(first.nearbyLine, 2);
    assert.deepEqual(result.writes, []);
    assert.ok(!JSON.stringify(summarizeCodingPreflight(result)).includes("private"));
    assert.equal(await read("shifted.ts"), "manual edit\nconst hidden = 'private';\nexport const next = 1;\n");

    await set("shifted.ts", "manual edit\nconst hidden = 'private';\nexport const next = 1;\nconst hidden = 'private';\nexport const next = 1;\n");
    const ambiguous: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(body)]);
    assert.equal(ambiguous.issues[0].expectedLine, 1);
    assert.equal(ambiguous.issues[0].nearbyLine, undefined);
  });
});

test("refuses binary bytes, directories, and symlinks rather than checking outside workspace", async (context): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, set, root, outer }: Fixture): Promise<void> => {
    await set("binary.bin", new Uint8Array([0, 1, 2]));
    await mkdir(join(root, "directory"));
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(updatePatch("binary.bin")), patch(updatePatch("directory")),
    ]);
    assert.deepEqual(issueCodes(report), [
      ["read", ERROR_CODES.WORKSPACE_NOT_UTF8, "binary.bin"],
      ["read", ERROR_CODES.WORKSPACE_NOT_REGULAR_FILE, "directory"],
    ]);
    const external: string = join(outer, "external");
    await mkdir(external);
    await writeFile(join(external, "sample.txt"), "outside fixture\n");
    try {
      await symlink(external, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (process.platform !== "win32") throw error;
      context.diagnostic("Skipping the symlink-specific assertion: this Windows host does not permit creating junctions.");
      return;
    }
    const scoped: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(updatePatch("link/sample.txt"))]);
    assert.deepEqual(issueCodes(scoped), [["read", ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN, "link/sample.txt"]]);
    assert.ok(!JSON.stringify(scoped).includes("outside fixture"));
  });
});

test("distinguishes byte limits from hunk conflicts and bounds artifact count and section count", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, set }: Fixture): Promise<void> => {
    const hugePatch: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(createPatch("large.txt", "é".repeat(CODING_PREFLIGHT_MAX_PATCH_BYTES / 2))),
    ]);
    assert.equal(hugePatch.issues[0].reason, "patch_limit");
    assert.equal(hugePatch.stats.verified, 0);
    assert.equal(hugePatch.issues[0].params?.limit, CODING_PREFLIGHT_MAX_PATCH_BYTES);

    const tooManyLines: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch("--- /dev/null\n+++ lines.txt\n@@ -0,0 +1," + CODING_PREFLIGHT_MAX_PATCH_LINES + " @@\n" +
        "+\n".repeat(CODING_PREFLIGHT_MAX_PATCH_LINES)),
    ]);
    assert.equal(tooManyLines.issues[0].reason, "patch_line_limit");
    assert.equal(tooManyLines.stats.files, 0);
    assert.equal(tooManyLines.stats.verified, 0);

    const oversizedResult: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(createPatch("large.txt", "é".repeat(FILE_EDIT_MAX_TEXT_BYTES / 2))),
    ]);
    assert.equal(oversizedResult.issues[0].reason, "result_limit");
    assert.deepEqual(oversizedResult.writes, []);

    const artifactBatch: Artifact[] = Array.from({ length: CODING_PREFLIGHT_MAX_ARTIFACTS + 1 },
      (_value: unknown, index: number): Artifact => patch(createPatch(`artifact-${index}.txt`)));
    const tooManyArtifacts: CodingPreflightReport = await preflightCodingChanges(workspace, artifactBatch);
    assert.equal(tooManyArtifacts.issues[0].reason, "artifact_limit");
    assert.equal(tooManyArtifacts.stats.verified, 0);

    const sections: string[] = Array.from({ length: CODING_PREFLIGHT_MAX_FILES + 1 },
      (_value: unknown, index: number): string => createPatch(`nested/file-${index}.txt`));
    const tooManyFiles: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(sections.join(""))]);
    assert.equal(tooManyFiles.issues[0].reason, "file_limit");
    assert.equal(tooManyFiles.stats.verified, 0);

    await set("source-too-large.txt", "a".repeat(FILE_EDIT_MAX_TEXT_BYTES + 1));
    const source: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(updatePatch("source-too-large.txt"))]);
    assert.deepEqual(issueCodes(source), [["read", ERROR_CODES.WORKSPACE_FILE_TOO_LARGE, "source-too-large.txt"]]);
  });
});

test("caps total retained before and after snapshots for batches with tiny patches against large files", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, set, patch }: Fixture): Promise<void> => {
    const content: string = "old\n" + "a".repeat(FILE_EDIT_MAX_TEXT_BYTES - 4);
    const files: string[] = ["one", "two", "three", "four", "five"];
    for (const name of files) await set(`${name}.txt`, content);
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [
      patch(files.map((name: string): string => updatePatch(`${name}.txt`)).join("")),
    ]);
    assert.equal(report.status, "invalid");
    assert.equal(report.stats.verified, 3);
    assert.equal(report.stats.snapshotBytes, CODING_PREFLIGHT_MAX_SNAPSHOT_BYTES);
    assert.deepEqual(issueCodes(report), [["snapshot_limit", ERROR_CODES.WORKSPACE_WRITE_INVALID, "four.txt"]]);
    assert.deepEqual(report.writes, []);
  });
});

test("requires the exact original snapshot unless explicitly recovering an already applied file", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch, set, read }: Fixture): Promise<void> => {
    await set("edit.txt", "old\n");
    await set("remove.txt", "old\n");
    const puts: Artifact[] = [patch(updatePatch("edit.txt") + createPatch("new/sub.txt") + deletePatch("remove.txt"))];
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, puts);
    assert.equal(report.status, "needs_confirmation");
    const initial: CodingSnapshotResult = await verifyCodingWriteSnapshot(workspace, report.writes);
    assert.deepEqual(initial, { issues: [], alreadyApplied: [] });

    for (const write of report.writes) {
      const { path, before, after }: CodingPreflightWrite = write;
      await writeWorkspaceFile(workspace, { path, expectedBefore: before, after });
    }

    const strict: CodingSnapshotResult = await verifyCodingWriteSnapshot(workspace, report.writes);
    assert.deepEqual(strict.issues.map(({ code }: CodingPreflightIssue): string => code), [
      ERROR_CODES.ITERATION_FILE_MODIFIED, ERROR_CODES.ITERATION_FILE_MODIFIED, ERROR_CODES.ITERATION_FILE_MODIFIED,
    ]);
    assert.deepEqual(strict.alreadyApplied, []);
    const recovery: CodingSnapshotResult = await verifyCodingWriteSnapshot(workspace, report.writes, { allowAlreadyApplied: true });
    assert.deepEqual(recovery, { issues: [], alreadyApplied: ["edit.txt", "new/sub.txt", "remove.txt"] });

    await set("new/sub.txt", "external manual edit\n");
    const changed: CodingSnapshotResult = await verifyCodingWriteSnapshot(workspace, report.writes, { allowAlreadyApplied: true });
    assert.deepEqual(changed.alreadyApplied, ["edit.txt", "remove.txt"]);
    assert.equal(changed.issues[0].reason, "snapshot_changed");
    assert.equal(changed.issues[0].path, "new/sub.txt");
    assert.equal(await read("new/sub.txt"), "external manual edit\n");
  });
});

test("rechecks workspace binding and does not expose the absolute runtime path after replacement", async (): Promise<void> => {
  await withWorkspace(async ({ outer, root, workspace, patch }: Fixture): Promise<void> => {
    await rename(root, join(outer, "moved"));
    await mkdir(root);
    const report: CodingPreflightReport = await preflightCodingChanges(workspace, [patch(createPatch("fresh.txt"))]);
    assert.deepEqual(issueCodes(report), [["read", ERROR_CODES.WORKSPACE_UNAVAILABLE, "fresh.txt"]]);
    assert.ok(!JSON.stringify(report).includes(outer));
  });
});

test("honors the caller's abort reason without interpreting cancellation as an invalid patch", async (): Promise<void> => {
  await withWorkspace(async ({ workspace, patch }: Fixture): Promise<void> => {
    const controller: AbortController = new AbortController();
    const reason: Error = new Error("stopped while reviewing");
    controller.abort(reason);
    await assert.rejects(preflightCodingChanges(workspace, [patch("malformed")], { signal: controller.signal }), (error: unknown): boolean => error === reason);
    await assert.rejects(verifyCodingWriteSnapshot(workspace, [], { signal: controller.signal }), (error: unknown): boolean => error === reason);
  });
});
