import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const executable = fileURLToPath(new URL("../dist-cli/silver.mjs", import.meta.url));
const fixtureKey = "loopback-fixture-key";

function events(value) {
  return "data: " + JSON.stringify({ choices: [{ delta: { content: value } }] }) + "\n\n";
}

async function until(read, explanation) {
  for (let index = 0; index < 400; index++) {
    const value = await read();
    if (value) return value;
    await delay(75);
  }
  throw new Error(explanation);
}

test("desktop CLI runs six rounds, reattaches, and resumes active seats without replaying completed model requests", { timeout: 120_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), "silver-desktop-runtime-"));
  const workspace = join(fixture, "workspace");
  const directory = join(fixture, "appdata");
  await mkdir(workspace);
  await writeFile(join(workspace, "source.txt"), "round-0\r\n");
  await writeFile(join(workspace, "review.txt"), "independent context\r\n");
  await writeFile(join(workspace, "package.json"), JSON.stringify({
    name: "silver-native-check-fixture", version: "1.0.0",
    scripts: { test: "node check.cjs test", typecheck: "node check.cjs types", build: "node check.cjs build" },
  }));
  await writeFile(join(workspace, "check.cjs"), [
    'const fs = require("node:fs");',
    'const source = fs.readFileSync("source.txt", "utf8").trim();',
    'const step = process.argv[2];',
    'fs.appendFileSync("checks.log", source + " " + step + "\\n");',
    'console.log("RAW-" + step + " " + source);',
    'if (step === "test" && source === "round-1") { console.error("REPAIR_FROM_TEST"); process.exitCode = 7; }',
  ].join("\n"));
  const children = [];
  const attempts = new Map();
  let firstHeld;
  let secondHeld;
  let secondConnection;
  let heldDisconnects = 0;
  let toolReads = 0;
  let checksReachedNextRound = false;
  let gameError;
  const plan = {
    intent: "运行本机检查并通过修复", outcome: "完成六轮独立缺口",
    constraints: "只修改 source.txt", autonomy: "decide", outOfScope: [],
    domainFields: {}, requirements: [{ id: "R1", text: "覆盖真实工作项测试流程" }],
  };
  const gateway = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${fixtureKey}`);
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const system = payload.messages[0].content;
      const userData = payload.messages.map(({ content }) => content).join("\n");
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (value) => response.end(events(JSON.stringify(value)) + "data: [DONE]\n\n");
      if (system.includes("从对话提取简报")) {
        response.end(events("简报。\n<<<SILVER_RESULT>>>\n" + JSON.stringify({ brief: plan })) + "data: [DONE]\n\n");
      } else if (system.includes("按已确认简报拆工作项")) {
        send({ runs: [{ title: "检验持续工作", dependsOn: ["R1"], seats: [
          { id: "writer", title: "更新源文件", scope: ["source.txt"] },
          { id: "reviewer", title: "等待附加独立资料", scope: ["review.txt"] },
        ] }] });
      } else if (system.includes("你负责判断同一工作项本轮结果")) {
        const evidence = JSON.parse(payload.messages.at(-1).content);
        const number = evidence.checks[0].output.match(/RAW-test round-(\d+)/u)?.[1];
        assert.ok(number);
        assert.equal(evidence.checks.length, 3);
        if (number === "1") {
          assert.equal(evidence.checks[0].exitCode, 7);
          assert.match(evidence.checks[0].output, /REPAIR_FROM_TEST/u);
        }
        send(Number(number) < 6 ? {
          verdict: "continue", gaps: [{ requirementId: "R1", missing: `缺口 ${number}` }],
          evidence: [`R1 本轮执行了三种检查。`], nextTitle: `处理下一项 ${number}`,
        } : { verdict: "done", gaps: [], evidence: ["R1 在真实工作区的三项检查均通过。"] });
      } else if (system.includes("角色：开发席位")) {
        const seat = system.match(/席位 ID：(\w+)/u)?.[1];
        const number = Number(system.match(/当前轮次：(\d+)/u)?.[1]);
        assert.ok(seat && number);
        const key = `${number}:${seat}`;
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
        if (seat === "reviewer") {
          if (number === 1 && !firstHeld) {
            firstHeld = () => send({ status: "completed", summary: "独立材料已核对", findings: [] });
            response.flushHeaders();
          } else if (number === 2 && !secondHeld) {
            secondHeld = true;
            response.on("close", () => { heldDisconnects++; });
            response.flushHeaders();
          } else if (number === 2) {
            secondConnection = () => send({ status: "completed", summary: "运行时重接工作", findings: [] });
            response.flushHeaders();
          } else send({ status: "completed", summary: "独立材料已核对", findings: [] });
          return;
        }
        if (number === 2) {
          assert.match(userData, /REPAIR_FROM_TEST/u);
          assert.match(userData, /RAW-types round-1/u);
          assert.match(userData, /RAW-build round-1/u);
          assert.match(userData, /"exitCode":7/u);
          checksReachedNextRound = true;
        }
        const requested = payload.messages.filter(({ content }) => content.includes("工具结果。以下是工作区数据")).length;
        if (number === 1 && requested < 6) {
          toolReads++;
          send({ tools: [{ name: requested % 2 ? "read" : "list", path: requested % 2 ? "source.txt" : "" }] });
          return;
        }
        send({
          status: "completed", summary: `本轮完成 ${number}`, findings: [],
          artifacts: [{
            kind: "diff", title: `更新源文件 ${number}`,
            body: ["--- a/source.txt", "+++ b/source.txt", "@@ -1 +1 @@", `-round-${number - 1}`, `+round-${number}`, ""].join("\n"),
          }],
        });
      } else throw new Error(`Unexpected role: ${system.slice(0, 300)}`);
    } catch (error) {
      gameError = error;
      response.end();
    }
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");

  let connection;
  async function call(path, body) {
    if (gameError) throw gameError;
    const response = await fetch(`http://127.0.0.1:${connection.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  }
  const action = (name, ...args) => call("/action", { name, args });
  async function start() {
    const child = spawn(process.execPath, [executable, "serve"], {
      env: { ...process.env, SILVER_DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    });
    children.push(child);
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    connection = await until(async () => {
      if (child.exitCode !== null) throw new Error(`CLI stopped early: ${stderr}`);
      const candidate = await readFile(join(directory, "endpoint.json"), "utf8").then(JSON.parse, () => undefined);
      return candidate?.pid === child.pid ? candidate : undefined;
    }, "CLI did not start");
    return child;
  }
  try {
    const initialHost = await start();
    const bound = await action("workspace.bind", workspace);
    const threadId = await action("newThread", "develop");
    const select = new AbortController();
    const feed = await fetch(`http://127.0.0.1:${connection.port}/events`, {
      headers: { authorization: `Bearer ${connection.token}` }, signal: select.signal,
    });
    assert.equal(feed.status, 200);
    await action("bindWorkspace", threadId, bound.id);
    await action("saveProvider", {
      id: "newapi", label: "New API", protocol: "openai", model: "fixture",
      baseUrl: `http://127.0.0.1:${gateway.address().port}`,
    }, fixtureKey);
    await action("selectModel", threadId, "newapi", "fixture");
    await action("sendMessage", threadId, "在当前工作区持续修复并跑过检查");
    const thread = async () => (await call("/state")).state.threads.find(({ id }) => id === threadId);
    const brief = await until(async () => (await thread()).pendingConfirmation, "No brief confirmation");
    await action("resolveConfirmation", threadId, brief.messageId, true);
    await until(() => firstHeld, "First round was not held");
    select.abort();
    await until(async () => (await thread()).runs[0]?.seats.find(({ id }) => id === "writer")?.status === "completed", "Writer failed after window disconnected");
    assert.equal(toolReads, 6);
    firstHeld();
    await until(async () => secondHeld && (await thread()).runs[0]?.seats.find(({ id }) => id === "writer")?.status === "completed", "Second round did not run");
    assert.equal(checksReachedNextRound, true);
    const beforeShutdown = await thread();
    assert.equal(beforeShutdown.runs[0].iterations.length, 2);
    assert.equal(beforeShutdown.runs[0].status, "in_progress");
    assert.equal(attempts.get("2:writer"), 1);
    const exited = once(initialHost, "exit");
    await call("/shutdown", {});
    await exited;
    assert.ok(heldDisconnects >= 1);
    const newHost = await start();
    assert.notEqual(newHost.pid, initialHost.pid);
    await until(() => secondConnection, "Unfinished seat did not resume");
    assert.equal(attempts.get("2:writer"), 1);
    assert.equal(attempts.get("2:reviewer"), 2);
    secondConnection();
    const completed = await until(async () => {
      const current = await thread();
      return current.runs[0]?.status === "completed" && current;
    }, "Six-round work item did not complete");
    assert.equal(completed.runs.length, 1);
    assert.equal(completed.runs[0].iterations.length, 6);
    assert.equal(completed.runs[0].iterations.at(-1).verdict, "done");
    assert.equal(completed.artifacts.filter(({ title }) => title === "npm test").length, 6);
    assert.equal(await readFile(join(workspace, "source.txt"), "utf8"), "round-6\r\n");
    assert.equal((await readFile(join(workspace, "checks.log"), "utf8")).trim().split("\n").length, 18);
    assert.ok(!JSON.stringify(await call("/state")).includes(fixtureKey));
    const finished = once(newHost, "exit");
    await call("/shutdown", {});
    await finished;
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    gateway.closeAllConnections();
    await new Promise((done) => gateway.close(done));
  }
});
