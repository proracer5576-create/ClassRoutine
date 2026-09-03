import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = await fsp.mkdtemp(path.join(os.tmpdir(), "class-routine-server-"));
const dataDirectory = path.join(base, "data"), port = 53000 + Math.floor(Math.random() * 1000);
assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())), "Test cleanup must stay inside the OS temp directory.");

const child = spawn(process.execPath, [path.join(project, "dev-server.mjs")], {
  cwd: project,
  env: { ...process.env, PORT: String(port), CLASS_ROUTINE_DATA_DIR: dataDirectory },
  stdio: ["ignore", "pipe", "pipe"]
});
let diagnostics = "";
child.stdout.on("data", chunk => diagnostics += chunk);
child.stderr.on("data", chunk => diagnostics += chunk);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/storage-info`); if (response.ok) return; }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Test server did not start.\n${diagnostics}`);
}

try {
  await waitForServer();
  const info = await (await fetch(`http://127.0.0.1:${port}/api/storage-info`)).json();
  assert.equal(path.resolve(info.dataDirectory), path.resolve(dataDirectory));
  assert.equal(info.status.records.exists, false);

  const stores = [
    ["timetable-csv", "주간시간표_이력.csv"], ["roster-csv", "학생명렬표.csv"],
    ["roles-csv", "1인1역_배정.csv"], ["records-csv", "루틴기록.csv"]
  ];
  for (const [route, fileName] of stores) {
    const sample = `구분,값\r\n${route},정상`;
    const put = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method: "PUT", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: sample });
    assert.equal(put.status, 200);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/api/${route}`)).text(), sample);
    assert.equal(await fsp.readFile(path.join(dataDirectory, fileName), "utf8"), sample);
  }

  const state = { version: 1, savedAt: "2026-09-03T00:00:00.000Z", storage: { "classRoutine.settings.v3": { className: "<우리 반>" } } };
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/state-json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) })).status, 200);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/state-json`)).json(), state);
  const status = await (await fetch(`http://127.0.0.1:${port}/api/storage-info`)).json();
  assert.equal(status.status.records.exists, true);
  assert.ok(status.status.records.bytes > 0);
  assert.equal(status.status.state.exists, true);
  assert.match(status.status.state.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /__CLASS_ROUTINE_BOOTSTRAP__/);
  assert.ok(!html.includes("<우리 반>"), "Bootstrap JSON must escape user-controlled HTML delimiters.");
  console.log("server-api: pages, four CSV stores, state backup, and safe bootstrap OK");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
  await fsp.rm(base, { recursive: true, force: true });
}
