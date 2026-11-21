import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));
const runtime = join(project, "src-tauri", "desktop-runtime");

if (process.platform !== "win32" || process.arch !== "x64" || Number(process.versions.node.split(".")[0]) < 24) {
  throw new Error("Silver Windows packaging requires Node.js 24 or later for Windows x64.");
}

async function npmDirectory() {
  const candidates = [
    join(dirname(process.execPath), "node_modules", "npm"),
    process.env.npm_execpath && resolve(dirname(process.env.npm_execpath), ".."),
  ].filter(Boolean);
  for (const path of candidates) {
    if (await stat(join(path, "bin", "npm-cli.js")).then((entry) => entry.isFile(), () => false)) return path;
  }
  throw new Error("The build environment requires a Windows Node.js distribution containing npm.");
}

const npmPath = await npmDirectory();
const result = spawnSync(process.execPath, [join(npmPath, "bin", "npm-cli.js"), "run", "build:cli"], {
  cwd: project,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir(join(runtime, "node_modules"), { recursive: true });
await Promise.all([
  cp(process.execPath, join(runtime, "node.exe")),
  cp(join(project, "dist-cli", "silver.mjs"), join(runtime, "silver.mjs")),
  cp(npmPath, join(runtime, "node_modules", "npm"), { recursive: true }),
  writeFile(join(runtime, "silver.cmd"), [
    "@echo off",
    '"%~dp0node.exe" "%~dp0silver.mjs" %*',
    "",
  ].join("\r\n")),
  writeFile(join(runtime, "npm.cmd"), [
    "@echo off",
    '"%~dp0node.exe" "%~dp0node_modules/npm/bin/npm-cli.js" %*',
    "",
  ].join("\r\n")),
]);

const source = dirname(process.execPath);
const license = (await readdir(source)).find((name) => /^license(?:\.txt)?$/i.test(name));
if (license) {
  await cp(join(source, license), join(runtime, "NODE-LICENSE.txt"));
} else {
  const file = join(runtime, "NODE-LICENSE.txt");
  const address = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;
  const download = spawnSync("curl.exe", ["--fail", "--silent", "--show-error", "--location", "--max-time", "30", address, "-o", file], {
    stdio: "inherit",
  });
  if (download.status !== 0) throw new Error("Could not obtain the license for the bundled Node.js release.", { cause: download.error });
}

const npm = JSON.parse(await readFile(join(npmPath, "package.json"), "utf8"));
console.log(`Staged Node.js ${process.versions.node} and npm ${npm.version} for Silver.`);
