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
  const schoolSearchWithoutKey = await (await fetch(`http://127.0.0.1:${port}/api/school-search?q=${encodeURIComponent("한빛초등학교")}`)).json();
  assert.equal(schoolSearchWithoutKey.status, "unconfigured");
  assert.deepEqual(schoolSearchWithoutKey.schools, []);

  const integrationPut = await fetch(`http://127.0.0.1:${port}/api/integration-settings`, { method:"PUT", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ neisOfficeCode:"B10", neisSchoolCode:"", weatherNx:"60", weatherNy:"127", neisApiKey:"private-key" }) });
  assert.equal(integrationPut.status, 200);
  const integration = await (await fetch(`http://127.0.0.1:${port}/api/integration-settings`)).json();
  assert.equal(integration.neisOfficeCode, "B10");
  assert.equal(integration.hasNeisApiKey, true);
  assert.equal("neisApiKey" in integration, false, "Saved API keys must not be returned to the browser.");
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/daily-info`)).json()).meal.status, "unconfigured");
  assert.equal(JSON.parse(await fsp.readFile(path.join(dataDirectory, "외부연동설정.json"), "utf8")).neisApiKey, "private-key");

  const stores = [
    ["timetable-csv", "주간시간표_이력.csv"], ["roster-csv", "학생명렬표.csv"],
    ["roles-csv", "1인1역_배정.csv"], ["seating-csv", "자리배치_이력.csv"], ["records-csv", "루틴기록.csv"]
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

  const newer = { ...state, savedAt: "2026-09-03T00:01:00.000Z", storage: { "classRoutine.settings.v3": { className: "새 작업본" } } };
  const putState = payload => fetch(`http://127.0.0.1:${port}/api/state-json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  await Promise.all([putState(newer), putState(state)]);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/state-json`)).json(), newer, "An older concurrent snapshot must not replace a newer one.");
  assert.equal((await putState(state)).status, 409, "An older completed request must be rejected.");
  const backupPath = path.join(dataDirectory, "교실루틴_설정.json.bak");
  assert.ok(JSON.parse(await fsp.readFile(backupPath, "utf8")).storage, "The previous valid snapshot must be retained.");

  const statePath = path.join(dataDirectory, "교실루틴_설정.json");
  await fsp.writeFile(statePath, "{", "utf8");
  const recovered = await fetch(`http://127.0.0.1:${port}/api/state-json`);
  assert.equal(recovered.status, 200, "A valid backup should recover a damaged primary file.");
  assert.ok((await recovered.json()).storage);
  assert.ok((await fsp.readdir(dataDirectory)).some(name => name.startsWith("교실루틴_설정.json.corrupt-")), "The damaged file must be preserved for inspection.");

  await fsp.writeFile(statePath, "{", "utf8");
  await fsp.writeFile(backupPath, "{", "utf8");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/state-json`)).status, 500);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 503, "Corrupt data must not be treated as an empty classroom.");
  assert.equal((await putState(newer)).status, 503, "Automatic save must stop instead of overwriting unreadable data.");
  console.log("server-api: pages, CSV stores, private integrations, state backup, and safe bootstrap OK");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
  await fsp.rm(base, { recursive: true, force: true });
}
