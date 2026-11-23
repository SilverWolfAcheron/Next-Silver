import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PROJECT_LIMITS } from "../src/constants/codingProject.ts";
import type { CodingProjectPackage } from "../src/types/codingProject.ts";
import { ERROR_CODES } from "../src/agent-core/errors.ts";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import { discoverCodingProject } from "./codingProject.ts";
import { parseProjectManifest, readPnpmWorkspacePatterns } from "./codingProjectMetadata.ts";
import { readCodingWorkspaceText } from "./codingProjectScan.ts";
import { bindWorkspace } from "./workspace.ts";

interface ProjectFixture {
  root: string;
  folder: string;
  dataDir: string;
  workspace: WorkspaceSummary;
  put: (path: string, content?: string | Buffer) => Promise<void>;
}

async function fixture(fn: (fixture: ProjectFixture) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "silver-project-"));
  const root = join(folder, "repo");
  const dataDir = join(root, "silver-private");
  const previous = process.env.SILVER_DATA_DIR;
  process.env.SILVER_DATA_DIR = dataDir;
  try {
    await mkdir(root);
    const workspace = await bindWorkspace(root);
    function put(path: string, content: string | Buffer = ""): Promise<void> {
      const target = join(root, ...path.split("/"));
      return mkdir(dirname(target), { recursive: true }).then(() => writeFile(target, content));
    }
    await fn({ root, folder, dataDir, workspace, put });
  } finally {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(folder, { recursive: true, force: true, maxRetries: 3 });
  }
}

test("inventory orients a mixed Vibe Coding repository without executing scripts or reading arbitrary documents", () => fixture(async ({ root, workspace, put }) => {
  await put("Agents.md", "instructions stay in the repository");
  await put("README.md", "only path inventory");
  await put("docs/architecture.md");
  await put("docs/notes.md");
  await put("package.json", JSON.stringify({
    name: "@next/silver",
    scripts: {
      build: "node --input-type=module -e \"throw new Error('unexpected execution')\"",
      dev: "node main.js",
      "lint:ci": "echo secret-not-in-result",
      test: "node --test",
      "type-check": "tsc --noEmit",
      "invalid name": "echo rejected",
      invalidValue: {},
    },
    main: "missing.js",
    module: "./src/bootstrap.ts",
    exports: { ".": { browser: "./src/web.ts", default: "./src/bootstrap.ts" }, "./sub": "./src/hidden.ts" },
    bin: { tool: "./bin/silver.js" },
    source: "../outside.ts",
  }));
  await put("pnpm-lock.yaml");
  await put("bin/silver.js");
  await put("tsconfig.json");
  await put("src/bootstrap.ts");
  await put("src/web.ts");
  await put("src/hidden.ts");
  await put("src/widget.test.ts");
  await put("src-tauri/Cargo.toml", '[package]\nname = "silver-desktop"\n');
  await put("src-tauri/src/main.rs");
  await put("src-tauri/src/lib.rs");
  await put("cli/main.ts");
  await put(".env", "access=private");
  await put(".npmrc", "secret-not-in-result");
  await put("vault.kdbx");
  await put("node_modules/dependency/package.json", "{}");
  const before = await readdir(root);
  const project = await discoverCodingProject(workspace);
  assert.deepEqual(await readdir(root), before);
  assert.equal(project.directory, "");
  assert.equal(project.truncated, false);
  assert.deepEqual(project.warnings, []);
  assert.deepEqual(project.languages, [{ language: "TypeScript", files: 5 }, { language: "Rust", files: 2 }, { language: "JavaScript", files: 1 }]);
  assert.deepEqual(project.packages, [{
    root: "",
    manifest: "package.json",
    ecosystem: "node",
    name: "@next/silver",
    packageManager: "pnpm",
    scripts: [
      { name: "build", kind: "build" }, { name: "lint:ci", kind: "lint" },
      { name: "test", kind: "test" }, { name: "type-check", kind: "typecheck" }, { name: "dev", kind: "other" },
    ],
    entrypoints: ["src/bootstrap.ts", "bin/silver.js", "src/web.ts"],
  }, {
    root: "src-tauri",
    manifest: "src-tauri/Cargo.toml",
    ecosystem: "cargo",
    name: "silver-desktop",
  }]);
  assert.deepEqual(project.files.slice(0, 6), [
    { path: "Agents.md", kind: "instructions" },
    { path: "package.json", kind: "manifest" },
    { path: "bin/silver.js", kind: "entrypoint" },
    { path: "README.md", kind: "documentation" },
    { path: "tsconfig.json", kind: "configuration" },
    { path: "src/widget.test.ts", kind: "test" },
  ]);
  const encoded = JSON.stringify(project);
  for (const hidden of [root, ".env", ".npmrc", "vault.kdbx", "secret-not-in-result", "node_modules", "silver-private", "outside.ts"]) {
    assert.ok(!encoded.includes(hidden), hidden);
  }
}));

test("works with a named subdirectory, returning workspace-relative paths only", () => fixture(async ({ workspace, put }) => {
  await put("package.json", '{"workspaces":["apps/*"]}');
  await put("apps/editor/README.md");
  await put("apps/editor/package.json", '{"name":"editor","main":"src/main.js"}');
  await put("apps/editor/src/main.js");
  await put("apps/service/package.json", '{"name":"service"}');
  await put("secret.py");
  const project = await discoverCodingProject(workspace, { directory: "apps/editor" });
  assert.equal(project.directory, "apps/editor");
  assert.deepEqual(project.topLevel, [
    { path: "apps/editor/src", kind: "directory" },
    { path: "apps/editor/README.md", kind: "file" },
    { path: "apps/editor/package.json", kind: "file" },
  ]);
  assert.deepEqual(project.packages, [{
    root: "apps/editor",
    manifest: "apps/editor/package.json",
    ecosystem: "node",
    name: "editor",
    entrypoints: ["apps/editor/src/main.js"],
  }]);
  assert.deepEqual(project.languages, [{ language: "JavaScript", files: 1 }]);
  assert.deepEqual(await discoverCodingProject(workspace, { directory: "." }), await discoverCodingProject(workspace));
}));

test("identifies pnpm workspaces with nested rules and local overrides", () => fixture(async ({ workspace, put }) => {
  await put("package.json", '{"name":"root","packageManager":"pnpm@9.3.0","workspaces":["ignored/*"]}');
  await put("yarn.lock");
  await put("pnpm-workspace.yaml", "packages:\n  - 'apps/**'\n  - \"!apps/old/**\" # ignore\n  - '../escape'\nother:\n  - outside\n");
  await put("apps/editor/package.json", '{"name":"editor","workspaces":{"packages":["plugins/*"]}}');
  await put("apps/editor/pnpm-lock.yaml");
  await put("apps/editor/plugins/theme/package.json", '{"name":"theme"}');
  await put("apps/editor/plugins/typer/package.json", '{"name":"typer","packageManager":"yarn@4"}');
  await put("apps/old/legacy/package.json", '{"name":"legacy"}');
  await put("ignored/ignored/package.json", '{"name":"ignored"}');
  await put("outside/package.json", '{"name":"outside"}');
  const map = new Map((await discoverCodingProject(workspace)).packages.map((pkg) => [pkg.name, pkg]));
  assert.deepEqual(map.get("root")?.workspacePatterns, ["apps/**", "!apps/old/**"]);
  assert.deepEqual(map.get("editor")?.workspacePatterns, ["plugins/*"]);
  assert.equal(map.get("editor")?.workspaceRoot, "");
  assert.equal(map.get("theme")?.workspaceRoot, "apps/editor");
  assert.equal(map.get("theme")?.packageManager, "pnpm");
  assert.equal(map.get("typer")?.packageManager, "yarn");
  for (const name of ["legacy", "ignored", "outside"]) {
    assert.equal(map.get(name)?.workspaceRoot, undefined, name);
  }
}));

test("reads simple Cargo, Python, Go and Composer metadata and identifies other manifest ecosystems", () => fixture(async ({ workspace, put }) => {
  await put("Cargo.toml", `[workspace]
members = [
  "crates/*", # primary
  "tools/**",
]
exclude = ["tools/draft/**"]
[workspace.package]
name = "not-a-crate"
`);
  await put("crates/core/Cargo.toml", "[package]\nname = 'core' # ok\n");
  await put("crates/core/src/lib.rs");
  await put("tools/draft/alpha/Cargo.toml", '[package]\nname = "draft"\n');
  await put("python/pyproject.toml", '[project]\r\nname = "parser_core"\r\n');
  await put("python/app/__main__.py");
  await put("python/tests/test_run.py");
  await put("go/go.mod", 'module "example.com/tools/go" // local\n\ngo 1.23\n');
  await put("go/cmd/tool/main.go");
  await put("web/composer.json", '{"name":"acme/web","scripts":{"test":"not-returned"}}');
  await put("js/unrelated/pom.xml");
  await put("gradle/build.gradle.kts");
  await put("dotnet/Unit.csproj");
  await put("native/CMakeLists.txt");
  await put("swift/Package.swift");
  await put("ruby/Gemfile");
  const project = await discoverCodingProject(workspace);
  const pkg = (manifest: string): CodingProjectPackage | undefined => project.packages.find((item) => item.manifest === manifest);
  assert.deepEqual(pkg("Cargo.toml")?.workspacePatterns, ["crates/*", "tools/**", "!tools/draft/**"]);
  assert.equal(pkg("Cargo.toml")?.name, undefined);
  assert.equal(pkg("crates/core/Cargo.toml")?.workspaceRoot, "");
  assert.equal(pkg("crates/core/Cargo.toml")?.name, "core");
  assert.equal(pkg("tools/draft/alpha/Cargo.toml")?.workspaceRoot, undefined);
  assert.equal(pkg("python/pyproject.toml")?.name, "parser_core");
  assert.equal(pkg("go/go.mod")?.name, "example.com/tools/go");
  assert.equal(pkg("web/composer.json")?.name, "acme/web");
  assert.equal(pkg("web/composer.json")?.scripts, undefined);
  for (const [manifest, ecosystem] of [
    ["js/unrelated/pom.xml", "maven"], ["gradle/build.gradle.kts", "gradle"],
    ["dotnet/Unit.csproj", "dotnet"], ["native/CMakeLists.txt", "cmake"],
    ["swift/Package.swift", "swift"], ["ruby/Gemfile", "ruby"],
  ]) {
    assert.equal(pkg(manifest)?.ecosystem, ecosystem);
  }
  assert.ok(project.files.some((item) => item.path === "python/tests/test_run.py" && item.kind === "test"));
  assert.ok(project.files.some((item) => item.path === "go/cmd/tool/main.go" && item.kind === "entrypoint"));
}));

test("rejects illegal search roots and does not trust a caller's workspace path", () => fixture(async ({ workspace, folder, put }) => {
  await put("README.md");
  for (const directory of ["..", "../escape", "apps/../../outside", "/tmp", "C:/", "a\\b", ".git", "node_modules", ".env", "vault.kdbx"]) {
    await assert.rejects(discoverCodingProject(workspace, { directory }), { message: ERROR_CODES.WORKSPACE_INVALID_PATH });
  }
  await assert.rejects(discoverCodingProject(workspace, { directory: "README.md" }));
  await assert.rejects(discoverCodingProject(workspace, { directory: "missing" }));
  const project = await discoverCodingProject({ ...workspace, path: folder });
  assert.deepEqual(project.topLevel, [{ path: "README.md", kind: "file" }]);
  await assert.rejects(discoverCodingProject({ ...workspace, name: "forged" }), { message: ERROR_CODES.WORKSPACE_NOT_FOUND });
}));

test("never inventories a symlink or a nested Silver data directory", { skip: process.platform === "win32" }, () => fixture(async ({ workspace, folder, root, put }) => {
  const outside = join(folder, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "package.json"), '{"name":"outside"}');
  await symlink(outside, join(root, "linked-directory"), "dir");
  await symlink(join(outside, "package.json"), join(root, "package.json"), "file");
  await put("regular/README.md");
  await symlink(join(root, "regular"), join(root, "linked-local"), "dir");
  await put("silver-private/README.md");
  await put("dist/package.json");
  const project = await discoverCodingProject(workspace);
  assert.deepEqual(project.topLevel, [{ path: "regular", kind: "directory" }]);
  assert.deepEqual(project.files, [{ path: "regular/README.md", kind: "documentation" }]);
  assert.deepEqual(project.packages, []);
  await assert.rejects(discoverCodingProject(workspace, { directory: "linked-directory" }), { message: ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN });
  await assert.rejects(discoverCodingProject(workspace, { directory: "silver-private" }), { message: ERROR_CODES.WORKSPACE_INVALID_PATH });
}));

test("warns about malformed or unreadable manifests without disclosing their contents", () => fixture(async ({ workspace, put }) => {
  await put("package.json", "{secret-invalid-content");
  await put("apps/large/package.json", "z".repeat(PROJECT_LIMITS.manifestBytes + 1));
  await put("crates/utf8/Cargo.toml", Buffer.from([0x00, 0x80]));
  await put("apps/good/package.json", '{"name":"good"}');
  const project = await discoverCodingProject(workspace);
  assert.deepEqual(project.warnings, [
    { path: "package.json", reason: "manifest-invalid" },
    { path: "apps/large/package.json", reason: "manifest-unreadable" },
    { path: "crates/utf8/Cargo.toml", reason: "manifest-unreadable" },
  ]);
  assert.equal(project.packages.find((pkg) => pkg.root === "apps/good")?.name, "good");
  assert.equal(project.truncated, true);
  assert.doesNotMatch(JSON.stringify(project), /secret-invalid-content/u);
}));

test("preserves essential result types when many files compete for output", () => fixture(async ({ workspace, put }) => {
  for (let i = 0; i < PROJECT_LIMITS.rankedFiles + 10; i += 1) await put(`docs/${String(i).padStart(3, "0")}-architecture.md`);
  await put("src/core.test.ts");
  await put("src/custom.ts");
  await put("src/main.ts");
  await put("package.json", '{"source":"src/custom.ts"}');
  await put("README.md");
  await put("tsconfig.json");
  await put("AGENTS.md");
  const project = await discoverCodingProject(workspace);
  assert.equal(project.files.length, PROJECT_LIMITS.rankedFiles);
  assert.equal(project.truncated, true);
  assert.equal(project.files.find(({ kind }) => kind === "entrypoint")?.path, "src/custom.ts");
  for (const path of ["src/core.test.ts", "AGENTS.md", "package.json", "README.md", "tsconfig.json"]) {
    assert.ok(project.files.some((row) => row.path === path), path);
  }
  assert.deepEqual(await discoverCodingProject(workspace), project);
}));

test("caps expensive project probes and explicitly discloses incomplete scans", () => fixture(async ({ workspace, put }) => {
  for (let i = 0; i < PROJECT_LIMITS.entriesPerDirectory + 1; i += 1) await put(`wide/${i}.ts`);
  await put("n/1/2/3/4/5/6/7/8/deep.ts");
  for (let i = 0; i < PROJECT_LIMITS.packages + 2; i += 1) {
    await put(`apps/pkg-${String(i).padStart(2, "0")}/package.json`, "{}");
  }
  const project = await discoverCodingProject(workspace);
  assert.equal(project.packages.length, PROJECT_LIMITS.packages);
  assert.equal(project.truncated, true);
  assert.deepEqual(project.languages, []);
  assert.ok(project.warnings.some(({ path, reason }) => path === "wide" && reason === "directory-limit"));
  assert.ok(project.warnings.some(({ path, reason }) => path === "" && reason === "manifest-limit"));
  assert.ok(project.warnings.some(({ path, reason }) => path.startsWith("n/") && reason === "directory-limit"));
}));

test("honors cancellation before workspace lookup and during an in-flight scan", () => fixture(async ({ workspace, put }) => {
  const stopped = new Error("cancelled by caller");
  await assert.rejects(discoverCodingProject({ ...workspace, id: "unknown" }, { signal: AbortSignal.abort(stopped) }),
    (error) => error === stopped);
  for (let i = 0; i < 50; i += 1) await put(`src/module-${i}.ts`);
  const abort = new AbortController();
  const pending = discoverCodingProject(workspace, { signal: abort.signal });
  setImmediate(() => abort.abort(stopped));
  await assert.rejects(pending, (error) => error === stopped);
}));

test("parsers do not interpret unsupported manifest structures or raw script strings as paths", () => {
  assert.equal(parseProjectManifest("package.json", "[]"), undefined);
  assert.equal(parseProjectManifest("composer.json", "false"), undefined);
  assert.equal(parseProjectManifest("package.json", "{ malformed"), undefined);
  assert.deepEqual(readPnpmWorkspacePatterns("packages: [apps]"), []);
  assert.deepEqual(readPnpmWorkspacePatterns("packages:\n - '*foo'\n - apps/*\n - 'apps/a/../b'\n"), ["apps/*"]);
  const toml = parseProjectManifest("Cargo.toml", `[package]
description = """
[workspace]
members = ["fake"]
name = "fake"
"""
name = "real"
`);
  assert.deepEqual(toml, { name: "real" });
  const js = parseProjectManifest("package.json", JSON.stringify({
    exports: { ".": [{ development: "./dev.ts" }, { default: "./prod.ts" }] },
    main: "https://example.test/demo.js",
    module: "/etc/outside.js",
    types: "bad\\windows.ts",
    workspaces: ["!../escape", "a/*", "a/*"],
    scripts: { good: "echo test", "bad;ls": "invalid", empty: "     " },
  }));
  assert.deepEqual(js?.entrypoints, ["dev.ts", "prod.ts"]);
  assert.deepEqual(js?.workspacePatterns, ["a/*"]);
  assert.deepEqual(js?.scripts, [{ name: "good", kind: "other" }]);
});

test("ambiguous lockfiles are not silently resolved to an arbitrary package manager", () => fixture(async ({ workspace, put }) => {
  await put("package.json", "{}");
  await put("pnpm-lock.yaml");
  await put("package-lock.json");
  const project = await discoverCodingProject(workspace);
  assert.equal(project.packages[0].packageManager, undefined);
}));

test("bounded workspace reads measure UTF-8 bytes and reject unsafe files", () => fixture(async ({ root, put }) => {
  await put("empty.ts");
  await put("vault.kdbx");
  await put("text.ts", "中文");
  await put("binary.ts", Buffer.from([0x10, 0xc3, 0xff]));
  await put("null-byte.ts", "\0text");
  assert.deepEqual(await readCodingWorkspaceText(root, "empty.ts", { limit: 0 }), { text: "", bytes: 0 });
  assert.deepEqual(await readCodingWorkspaceText(root, "text.ts", { limit: 6 }), { text: "中文", bytes: 6 });
  await assert.rejects(readCodingWorkspaceText(root, "text.ts", { limit: 5 }), { message: ERROR_CODES.WORKSPACE_FILE_TOO_LARGE });
  await assert.rejects(readCodingWorkspaceText(root, "text.ts", { limit: NaN }), { message: ERROR_CODES.WORKSPACE_FILE_TOO_LARGE });
  await assert.rejects(readCodingWorkspaceText(root, "binary.ts", { limit: 5 }), { message: ERROR_CODES.WORKSPACE_NOT_UTF8 });
  await assert.rejects(readCodingWorkspaceText(root, "null-byte.ts", { limit: 5 }), { message: ERROR_CODES.WORKSPACE_NOT_UTF8 });
  await assert.rejects(readCodingWorkspaceText(root, "vault.kdbx", { limit: 5 }), { message: ERROR_CODES.WORKSPACE_INVALID_PATH });
  await assert.rejects(readCodingWorkspaceText(root, "../outside.ts", { limit: 5 }), { message: ERROR_CODES.WORKSPACE_INVALID_PATH });
}));
