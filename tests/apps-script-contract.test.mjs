import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, "apps-script", file), "utf8");

test("Apps Script classroom hub has server-side SSO and role gates", () => {
  const server = read("Code.gs");
  assert.doesNotThrow(() => new vm.Script(server));
  assert.match(server, /Session\.getActiveUser\(\)\.getEmail\(\)/);
  assert.match(server, /requireUser_\(\['student'\]\)/);
  assert.match(server, /requireUser_\(\['master', 'teacher'\]\)/);
  assert.match(server, /LockService\.getScriptLock\(\)/);
  assert.match(server, /cleanHttpsUrl_/);
  assert.match(server, /function setupDatabase\(\)/);
  assert.match(server, /function setupDatabase_\(\)/);
  assert.match(server, /activeEmail !== effectiveEmail/);
  assert.match(server, /mealServiceDietInfo/);
  assert.match(server, /VilageFcstInfoService_2\.0/);
  assert.match(server, /normalizeAllergenCodes_/);
  for (const table of ["Users", "Classes", "State", "Responses", "HelpQueue", "AuditLog"]) {
    assert.match(server, new RegExp(`${table}: \\[`));
  }
});

test("Apps Script UI supports master, teacher, and interactive student views", () => {
  const html = read("Index.html");
  const client = read("Client.html");
  const script = client.replace(/^<script>\s*/, "").replace(/\s*<\/script>\s*$/, "");
  assert.doesNotThrow(() => new vm.Script(script));
  for (const id of ["masterView", "teacherView", "studentView", "classForm", "sessionForm", "serviceForm", "rosterInput", "teacherMealMenu", "studentMealMenu", "studentAllergyWarning", "readyButton", "understandingChoices", "studentPollOptions", "helpButton", "exitButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(client, /google\.script\.run/);
  assert.match(client, /submitStudentResponse/);
  assert.match(client, /requestHelp/);
  assert.match(client, /5000/);
  assert.match(client, /12000/);
});

test("Apps Script manifest keeps scopes focused", () => {
  const manifest = JSON.parse(read("appsscript.json"));
  assert.equal(manifest.timeZone, "Asia/Seoul");
  assert.deepEqual(manifest.oauthScopes.sort(), [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email"
  ].sort());
});
