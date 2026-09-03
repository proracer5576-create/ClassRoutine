import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
const settingsKey = "classRoutine.settings.v3", metaKey = "classRoutine.stateBackupAt.v1";

function run({ localSettings, localSavedAt = "", snapshot }) {
  const values = new Map();
  if (localSettings) values.set(settingsKey, JSON.stringify(localSettings));
  if (localSavedAt) values.set(metaKey, localSavedAt);
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = { location: { protocol: "file:" }, __CLASS_ROUTINE_BOOTSTRAP__: snapshot, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  vm.runInContext(source, vm.createContext({ window, localStorage, CustomEvent, crypto: webcrypto, console, Date, JSON, String, Number, Array, Object, Set, Map, setTimeout, clearTimeout }), { filename: "shared.js" });
  return window.ClassRoutine.getSettings();
}

const folderSnapshot = { version: 1, savedAt: "2026-09-03T01:00:00.000Z", storage: { [settingsKey]: { className: "공용 데이터 반" } } };
assert.equal(run({ localSettings: { className: "이전 브라우저 반" }, snapshot: folderSnapshot }).className, "공용 데이터 반", "A browser without backup metadata must adopt the existing shared snapshot.");
assert.equal(run({ localSettings: { className: "더 최신인 반" }, localSavedAt: "2026-09-03T02:00:00.000Z", snapshot: folderSnapshot }).className, "더 최신인 반", "Newer local data must not be overwritten by an older snapshot.");

console.log("state-bootstrap: new browser restore and newer-local conflict protection OK");
