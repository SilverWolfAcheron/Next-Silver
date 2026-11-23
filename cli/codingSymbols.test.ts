import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { CODING_SYMBOL_LIMITS } from "../src/constants/codingSymbols.ts";
import { ERROR_CODES } from "../src/agent-core/errors.ts";
import type { CodingSymbolLanguage, CodingSymbolMatch, CodingSymbolMode } from "../src/types/codingSymbols";
import { findCodingSymbols } from "./codingSymbols.ts";
import { matchCodingSource } from "./codingSymbolsMatch.ts";
import { bindWorkspace } from "./workspace.ts";
import type { WorkspaceSummary } from "./workspace.ts";

interface Fixture {
  workspace: WorkspaceSummary;
  project: string;
  temporary: string;
  write: (path: string, content: string | Buffer) => Promise<void>;
}

async function fixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const temporary: string = await mkdtemp(join(tmpdir(), "silver-symbols-"));
  const dataDir: string = join(temporary, "data");
  const project: string = join(temporary, "project");
  const previous: string | undefined = process.env.SILVER_DATA_DIR;
  process.env.SILVER_DATA_DIR = dataDir;
  try {
    await mkdir(project);
    const workspace: WorkspaceSummary = await bindWorkspace(project);
    async function write(path: string, content: string | Buffer): Promise<void> {
      const target: string = join(project, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await run({ workspace, project, temporary, write });
  } finally {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function matches(
  text: string, language: CodingSymbolLanguage, options: { name?: string; mode?: CodingSymbolMode } = {}
): ReturnType<typeof matchCodingSource> {
  return matchCodingSource({ path: "source", language, text }, { name: options.name ?? "track", mode: options.mode ?? "all" });
}

function points(items: CodingSymbolMatch[]): [number, number][] {
  return items.map(({ line, column }: CodingSymbolMatch): [number, number] => [line, column]);
}

test("TypeScript navigation finds exact positions, ignoring comments, strings and prefix/suffix matches", () => {
  const result = matches([
    "/* track*/ export function track(input: string): void {",
    "  track(input);",
    "  tracker(input);",
    "  untrack(input);",
    "  return void 'track'; // track",
    "}",
    "const testRegex = /track[/]/g;",
    "const sample = `track \n track`;",
    "track('test');",
    "TRACK('test');",
  ].join("\r\n"), "typescript");
  assert.deepEqual(points(result.definitions), [[1, 28]]);
  assert.deepEqual(points(result.references), [[2, 3], [10, 1]]);
  assert.equal(result.definitions[0].language, "typescript");
  assert.equal(result.references[1].text, "track('test');");
});

test("supports JS and TS declarations, inline methods, return annotations, and ignores member calls", () => {
  const result = matches([
    "import type track from './types';",
    "const object = { track(input) { return input; } };",
    "export interface Tracker { track(input): void; }",
    "class Service { public async track<X>(x: X): Promise<X> { return x; } }",
    "class Private { #track() {} }",
    "object.track(arg);",
    "const x = object?.track(arg);",
    "function *track() {}",
    "type track = string;",
  ].join("\n"), "typescript");
  assert.deepEqual(result.definitions.map((match) => match.line), [2, 3, 4, 5, 8, 9]);
  assert.deepEqual(result.references.map((match) => match.line), [1, 6, 7]);
});

test("numeric division operands are references, strings and regex character classes are opaque", () => {
  const result = matches([
    "const ratio = 8 / track / 4;",
    "const reg = /[x/]+track/;",
    "if (ratio > 0) return /track/.test(input);",
    "const track = ratio / 2;",
  ].join("\n"), "javascript");
  assert.deepEqual(points(result.definitions), [[4, 7]]);
  assert.deepEqual(points(result.references), [[1, 19]]);
});

test("Python navigation handles annotated assignments, async defs, triple-quoted strings and comments", () => {
  const result = matches([
    '"""track in a multiline',
    'docstring"""',
    "@decorator",
    "async def track(value):",
    "  string = 'track'",
    "  return track(value)",
    "track: int = 4; track = 8",
    "instance.track = value",
    "process(track=0) # track",
    "long_track = track",
  ].join("\n"), "python");
  assert.deepEqual(points(result.definitions), [[4, 11], [7, 1], [7, 17]]);
  assert.deepEqual(points(result.references), [[6, 10], [8, 10], [9, 9], [10, 14]]);
});

test("Go navigation recognizes functions, receiver methods, groups and short declarations", () => {
  const result = matches([
    "package metrics",
    "var (",
    "  track = 1",
    ")",
    "func track() {}",
    "func (s service) track() {}",
    "func run() {",
    "  track, ok := value()",
    "  data, track := value()",
    "  _ = obj.track",
    "  _ = `track",
    "  track remains opaque`",
    "  x(track)",
    "}",
  ].join("\n"), "go");
  assert.deepEqual(points(result.definitions), [[3, 3], [5, 6], [6, 18], [8, 3], [9, 9]]);
  assert.deepEqual(points(result.references), [[10, 11], [13, 5]]);
});

test("Rust navigation supports raw identifiers, nested comments and lifetimes", () => {
  const result = matches([
    "/* outer track /* inner comment */ track */",
    "pub fn track<'a>(value: &'a str) -> &'a str { value }",
    "fn r#track() {}",
    "const RAW: &str = r###\"track \" track\"###;",
    "static mut track: i32 = 1;",
    "let ref mut track = value;",
    "let a = 'x';",
    "self::track('a');",
  ].join("\n"), "rust");
  assert.deepEqual(result.definitions.map((match) => match.line), [2, 3, 5, 6]);
  assert.deepEqual(points(result.references), [[8, 7]]);
});

test("Unicode identifier boundaries and UTF-16 columns match editor locations", () => {
  const result = matches("const 地区=''; /*🌐*/ 地区(); 地区性(); _地区();", "typescript", { name: "地区" });
  assert.deepEqual(points(result.definitions), [[1, 7]]);
  assert.deepEqual(points(result.references), [[1, 21]]);
});

test("long lines are clipped around the matched symbol and terminal controls are not returned", () => {
  const source: string = "track; " + "x".repeat(2_000) + "; \u001btrack(); " + "x".repeat(2_000);
  const result = matches(source, "typescript");
  assert.equal(result.references.length, 2);
  assert.match(result.references[0].text, /^track;/u);
  assert.match(result.references[1].text, /^….*track\(\).*…$/u);
  assert.ok(result.references.every((hit) => hit.text.length <= CODING_SYMBOL_LIMITS.snippetLength));
  assert.ok(result.references.every((hit) => !hit.text.includes("\u001b")));
});

test("definitions and references are separately filtered and intra-file caps are reported", () => {
  const text: string = ["function track() {}", ...Array<string>(28).fill("track();")].join("\n");
  const definitions = matches(text, "typescript", { mode: "definitions" });
  assert.equal(definitions.definitions.length, 1);
  assert.equal(definitions.references.length, 0);
  assert.equal(definitions.truncated, false);
  const references = matches(text, "typescript", { mode: "references" });
  assert.equal(references.definitions.length, 0);
  assert.equal(references.references.length, CODING_SYMBOL_LIMITS.perFileMatches);
  assert.equal(references.truncated, true);
});

test("symbol lookup is deterministic, ranks definitions first, and supports subdirectory scope", () => fixture(async ({ workspace, write }) => {
  await write("z.ts", "function track() {}\ntrack();\n");
  await write("a.ts", "track();\n");
  await write("apps/web/main.py", "def track(): pass\ntrack()\n");
  await write("apps/worker/main.go", "func track() {}\n");
  for (const hidden of [".git/x.ts", "node_modules/x.ts", "dist/x.ts", ".env.ts", "assets/vendor/x.ts", "lib.min.js", "src/x.generated.ts"]) {
    await write(hidden, "function track() {}\n");
  }
  await write("README.md", "const track = 1;");
  const result = await findCodingSymbols(workspace, " track ");
  assert.deepEqual(result, await findCodingSymbols(workspace, "track", { directory: "." }));
  assert.equal(result.scannedFiles, 4);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.matches.map(({ path, kind }) => [path, kind]), [
    ["z.ts", "definition"], ["apps/web/main.py", "definition"], ["apps/worker/main.go", "definition"],
    ["a.ts", "reference"], ["z.ts", "reference"], ["apps/web/main.py", "reference"],
  ]);
  const scoped = await findCodingSymbols(workspace, "track", { directory: "apps/web", mode: "definitions" });
  assert.equal(scoped.directory, "apps/web");
  assert.equal(scoped.scannedFiles, 1);
  assert.deepEqual(scoped.matches.map(({ path, line }) => [path, line]), [["apps/web/main.py", 1]]);
}));

test("unsafe and invalid paths are rejected, rather than silently substituting the root", () => fixture(async ({ workspace, write }) => {
  await write("source.ts", "function track() {}\n");
  for (const directory of ["../x", "/tmp", "C:/workspace", "src/..", ".git", "node_modules", "src\\nested"]) {
    await assert.rejects(findCodingSymbols(workspace, "track", { directory }), { code: ERROR_CODES.WORKSPACE_INVALID_PATH });
  }
  await assert.rejects(findCodingSymbols(workspace, "", {}), { code: ERROR_CODES.WORKSPACE_SEARCH_QUERY_EMPTY });
  for (const bad of ["track()", "a.b", "a|b", "1a", "x".repeat(CODING_SYMBOL_LIMITS.queryLength + 1)]) {
    await assert.rejects(findCodingSymbols(workspace, bad), { code: ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE });
  }
  await assert.rejects(findCodingSymbols(workspace, "track", { directory: "missing" }), { code: ERROR_CODES.WORKSPACE_FILE_NOT_FOUND });
}));

test("directory or source symlinks cannot escape workspace scope", (context) => fixture(async ({ project, temporary, workspace, write }) => {
  await write("real.ts", "function track() {}");
  const outside: string = join(temporary, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "leaked.ts"), "function track() {}");
  try {
    await symlink(outside, join(project, "linked"), "junction");
    await symlink(join(outside, "leaked.ts"), join(project, "linked.ts"), "file");
  } catch (error) {
    if (process.platform !== "win32") throw error;
    context.skip("Windows host does not allow creation of test symlinks");
    return;
  }
  assert.deepEqual((await findCodingSymbols(workspace, "track")).matches.map((hit) => hit.path), ["real.ts"]);
  await assert.rejects(findCodingSymbols(workspace, "track", { directory: "linked" }), { code: ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN });
}));

test("large, binary and non-UTF-8 candidate files are omitted explicitly", () => fixture(async ({ workspace, write }) => {
  await write("src/large.ts", "x".repeat(CODING_SYMBOL_LIMITS.fileBytes + 1));
  await write("src/binary.ts", "function track() {}\0");
  await write("src/invalid.ts", Buffer.from([0xc0, 0xaf]));
  await write("src/ok.ts", "\ufeff\nconst track = 1;");
  const result = await findCodingSymbols(workspace, "track", { directory: "src" });
  assert.equal(result.scannedFiles, 1);
  assert.equal(result.truncated, true);
  assert.deepEqual(points(result.matches), [[2, 7]]);
}));

test("result cap preserves late definitions before early references", () => fixture(async ({ workspace, write }) => {
  for (let i: number = 0; i < 4; i++) {
    await write(`a${i}.ts`, "track();\n".repeat(15));
  }
  await write("zzz/last.ts", "export function track() {}");
  const result = await findCodingSymbols(workspace, "track");
  assert.equal(result.matches.length, CODING_SYMBOL_LIMITS.matches);
  assert.equal(result.truncated, true);
  assert.equal(result.matches[0].kind, "definition");
  assert.equal(result.matches[0].path, "zzz/last.ts");
  assert.equal(result.matches[1].path, "a0.ts");
}));

test("cancellation is propagated both before lookup and while filesystem discovery is pending", () => fixture(async ({ workspace, write }) => {
  await write("src/file.ts", "function track() {}");
  const pre = new AbortController();
  const reason = new Error("stop symbol lookup");
  pre.abort(reason);
  await assert.rejects(findCodingSymbols(workspace, "track", { signal: pre.signal }), (error) => error === reason);
  const controller = new AbortController();
  const pending = findCodingSymbols(workspace, "track", { signal: controller.signal });
  const outcome = assert.rejects(pending, (error) => error === reason);
  await setImmediate();
  controller.abort(reason);
  await outcome;
}));

test("JavaScript template interpolation scans code without matching text or escaped interpolation", () => {
  const input: string = [
    "const out = `track \\${track} ${{ key: track }}",
    "${`track ${track()}`}`;",
    "const fraction = out / track / 10;",
  ].join("\n");
  const result = matches(input, "javascript");
  assert.deepEqual(points(result.references), [[1, 39], [2, 12], [3, 24]]);
});

test("symbol lookup reports directory-depth limits without blocking narrower follow-up queries", () => fixture(async ({ workspace, write }) => {
  const deep: string = Array<string>(CODING_SYMBOL_LIMITS.depth + 1).fill("level").join("/");
  await write("src/root.ts", "function track() {}");
  await write(`${deep}/nested.ts`, "function track() {}");
  const broad = await findCodingSymbols(workspace, "track");
  assert.equal(broad.truncated, true);
  assert.deepEqual(broad.matches.map(({ path }) => path), ["src/root.ts"]);
  const narrow = await findCodingSymbols(workspace, "track", { directory: deep });
  assert.equal(narrow.truncated, false);
  assert.deepEqual(narrow.matches.map(({ path }) => path), [`${deep}/nested.ts`]);
}));

test("workspace replacement is rejected by the bound identity", () => fixture(async ({ workspace, project, write }) => {
  await write("src/ok.ts", "const track = 1;");
  await rm(project, { recursive: true });
  await assert.rejects(findCodingSymbols(workspace, "track"), { code: ERROR_CODES.WORKSPACE_UNAVAILABLE });
}));
