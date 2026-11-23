import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CODING_TOOL_LIMITS } from "../src/constants/codingTools.ts";
import type { Artifact, WorkspaceSummary } from "../src/agent-core/types.ts";
import type { CodingPreflightIssue, CodingPreflightReport } from "../src/types/codingPreflight.ts";
import { ERROR_CODES } from "../src/agent-core/errors.ts";
import { codingDraftRepairMessage } from "./codingDraftRepair.ts";
import { assertCodingReadPath, canReadCodingPath, codingReadWindow } from "./codingRead.ts";
import { searchCodingText } from "./codingSearch.ts";
import { bindWorkspace } from "./workspace.ts";

test("line windows are one-based across LF and CRLF and don't add a phantom line", () => {
  assert.deepEqual(codingReadWindow("a\r\nb\nc\r", { startLine: 2, endLine: 3 }, 80), {
    body: "b\nc", startLine: 2, endLine: 3, totalLines: 3, truncated: false,
  });
  assert.deepEqual(codingReadWindow("", {}, 80), {
    body: "", startLine: 1, endLine: 0, totalLines: 0, truncated: false,
  });
});

test("windows cap line range and UTF-16 text and reject invalid numbers", () => {
  const sample = Array.from({ length: CODING_TOOL_LIMITS.readLines + 4 }, (_, i) => String(i + 1)).join("\n");
  const capped = codingReadWindow(sample, { startLine: 3, endLine: 20_000 }, 32_000);
  assert.equal(capped.endLine, CODING_TOOL_LIMITS.readLines + 2);
  assert.equal(capped.truncated, true);
  assert.equal(codingReadWindow("a😃b", {}, 2).body, "a");
  assert.equal(codingReadWindow("a😃b", {}, 2).truncated, true);
  for (const startLine of [-1, 0, 1.5, "1", null, Number.NaN, Infinity]) {
    assert.throws(() => codingReadWindow(sample, { startLine }, 40));
  }
  assert.throws(() => codingReadWindow(sample, { startLine: 3, endLine: 2 }, 40));
  assert.deepEqual(codingReadWindow("a\nb", { startLine: 7 }, 50), {
    body: "", startLine: 7, endLine: 6, totalLines: 2, truncated: false,
  });
});

test("background lookup does not access common credentials paths", () => {
  for (const name of [".git/config", "service/.env.test", ".npmrc", "certs/app.pfx", "secret\\id_ed25519", "credentials.yml", "vault.kdbx"]) {
    assert.equal(canReadCodingPath(name), false, name);
    assert.throws(() => assertCodingReadPath(name));
  }
  for (const name of ["src/env.ts", ".gitignore", "docs/credentials-guide.md", ""]) {
    assert.equal(canReadCodingPath(name), true, name);
    assert.doesNotThrow(() => assertCodingReadPath(name));
  }
});

test("scoped text search is deterministic and skips binary, private, generated and linked files", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "silver-context-"));
  const previous = process.env.SILVER_DATA_DIR;
  process.env.SILVER_DATA_DIR = join(base, "data");
  t.after(async () => {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(base, { recursive: true, force: true });
  });
  const root = join(base, "repo");
  await mkdir(join(root, "src", "node_modules"), { recursive: true });
  await writeFile(join(root, "src", "z.ts"), "needle in z\n");
  await writeFile(join(root, "src", "a.ts"), "other\rNEEDLE in A\n");
  await writeFile(join(root, "src", ".env"), "needle in env");
  await writeFile(join(root, "src", "hidden.key"), "needle in private key");
  await writeFile(join(root, "src", "node_modules", "ignored.js"), "needle in dependency");
  await writeFile(join(root, "src", "package-lock.json"), "needle in lock");
  await writeFile(join(root, "src", "binary.dat"), Buffer.from([0, 241, 12]));
  await writeFile(join(root, "outside-scope.ts"), "needle outside scope");
  await symlink(join(root, "outside-scope.ts"), join(root, "src", "linked.ts")).catch((error: NodeJS.ErrnoException) => {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
  });
  const workspace: WorkspaceSummary = await bindWorkspace(root);
  const result = await searchCodingText(workspace, " needle ", { directory: "src" });
  assert.deepEqual(result.matches, [
    { path: "src/a.ts", line: 2, text: "NEEDLE in A" },
    { path: "src/z.ts", line: 1, text: "needle in z" },
  ]);
  assert.equal(result.scannedFiles, 2);
  assert.equal(result.truncated, true);
  await assert.rejects(searchCodingText(workspace, "needle", { directory: "../" }));
  await assert.rejects(searchCodingText(workspace, "needle\nother"));
  await assert.rejects(searchCodingText(workspace, "needle", { signal: AbortSignal.abort() }), { name: "AbortError" });
  await writeFile(join(root, "src", "a.ts"), "needle\n".repeat(CODING_TOOL_LIMITS.searchMatches + 2));
  const capped = await searchCodingText(workspace, "needle", { directory: "src" });
  assert.equal(capped.matches.length, CODING_TOOL_LIMITS.searchMatches);
  assert.equal(capped.truncated, true);
});

function report(issues: CodingPreflightIssue[]): CodingPreflightReport {
  return {
    status: "invalid", files: [], issues,
    stats: {
      artifacts: 1, files: 1, verified: 0, created: 0, updated: 1, deleted: 0,
      additions: 1, deletions: 1, patchBytes: 60, patchLines: 6, snapshotBytes: 0,
    },
    writes: [{ artifactId: "1", path: "src/a.ts", before: "LOCAL_SECRET", after: "other" }],
  };
}

test("only repairable preflight issues are fed back, with no local write snapshots", () => {
  const drafts: Artifact[] = [{ kind: "diff", id: "1", title: "Fix", body: "draft-patch" }];
  const stale: CodingPreflightIssue = {
    severity: "error", reason: "stale_hunk", code: ERROR_CODES.DIFF_CONFLICT, path: "src/a.ts", expectedLine: 8, nearbyLine: 10,
  };
  const message = codingDraftRepairMessage(report([stale]), drafts);
  assert.equal(message?.role, "user");
  assert.match(message?.content ?? "", /"nearbyLine":10/u);
  assert.match(message?.content ?? "", /draft-patch/u);
  assert.doesNotMatch(message?.content ?? "", /LOCAL_SECRET/u);
  assert.equal(codingDraftRepairMessage(report([{ ...stale, reason: "scope" }]), drafts), undefined);
  assert.equal(codingDraftRepairMessage(report([stale, { ...stale, reason: "protected_path" }]), drafts), undefined);
  const large = codingDraftRepairMessage(report(Array(20).fill(stale)), [
    { ...drafts[0], body: "z".repeat(25_000) },
  ]);
  assert.match(large?.content ?? "", /"omittedIssues":8/u);
  assert.match(large?.content ?? "", /"truncated":true/u);
  assert.ok((large?.content.length ?? 0) < 17_000);
});
