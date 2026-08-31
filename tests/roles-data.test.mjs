import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const file = new URL("../roles.js", import.meta.url);
const fullSource = fs.readFileSync(file, "utf8");
const marker = '$("#roleBoard").onchange';
const source = fullSource.slice(0, fullSource.indexOf(marker)) + `
globalThis.__rolesTest = {
  normalizeState, studentKey, slotCount, boardCsv, boardFromCsv, reconcileAssignments, allAssignedKeys,
  setRoster(value) { roster = value; }, setState(value) { state = value; }, getState() { return state; }
};`;

const context = vm.createContext({
  window: { ClassRoutine: { KEYS: { roster: "roster" }, load: (_key, fallback) => fallback, uid: () => "test-id", save() {}, notify() {}, dateKey: () => "2026-08-27" } },
  document: { querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return {}; } },
  location: { protocol: "http:" }, crypto: webcrypto, console, Date, JSON, String, Number, Array, Object, Set, Map,
  TextDecoder, TextEncoder, Blob, Response, DecompressionStream, URL, setTimeout, clearTimeout, fetch: async () => ({ ok: false, text: async () => "" })
});
vm.runInContext(source, context, { filename: "roles.js" });

const api = context.__rolesTest;
let state = api.normalizeState(null);
assert.equal(state.roles.length, 14, "PPT 기본 역할 묶음은 14개여야 합니다.");
api.setState(state);
assert.equal(api.slotCount(), 23, "PPT 기본 배정 자리는 23개여야 합니다.");

const roster = Array.from({ length: 23 }, (_, index) => ({ number: String(index + 1), name: `학생${index + 1}` }));
api.setRoster(roster);
let cursor = 0;
state.roles.forEach(role => { state.assignments[role.id] = Array.from({ length: role.capacity }, () => api.studentKey(roster[cursor++])); });
state.savedAt = "2026-08-27T12:00:00.000Z";
api.setState(state);

const csv = api.boardCsv();
const restored = api.boardFromCsv(csv);
assert.equal(restored.roles.length, 14, "CSV 복원 뒤 역할 수가 유지되어야 합니다.");
assert.equal(restored.roles.reduce((sum, role) => sum + role.capacity, 0), 23, "CSV 복원 뒤 자리 수가 유지되어야 합니다.");
assert.equal(Object.values(restored.assignments).flat().filter(Boolean).length, 23, "CSV 복원 뒤 학생 배정이 유지되어야 합니다.");

restored.assignments[restored.roles[1].id][0] = restored.assignments[restored.roles[0].id][0];
api.setState(restored);
assert.equal(api.reconcileAssignments(), true, "중복 배정은 정리되어야 합니다.");
assert.equal(new Set(api.allAssignedKeys()).size, api.allAssignedKeys().length, "학생은 한 역할에만 남아야 합니다.");

const printSourceFull = fs.readFileSync(new URL("../roles-print.js", import.meta.url), "utf8");
const printSource = printSourceFull.slice(0, printSourceFull.indexOf('$("#printNow")')) + `
globalThis.__printTest = { fromCsv, chunks, printOrderedRoles };`;
const printContext = vm.createContext({
  window: { ClassRoutine: { getSettings: () => ({ className: "우리 반" }) } }, document: { querySelector() { return null; } },
  localStorage: { getItem() { return null; } }, location: { protocol: "http:" }, console, Date, JSON, String, Number, Array, Object, Set, Map
});
vm.runInContext(printSource, printContext, { filename: "roles-print.js" });
const printData = printContext.__printTest.fromCsv(csv);
assert.equal(printData.roles.length, 14, "출력 화면에서도 역할 14개를 읽어야 합니다.");
assert.equal(printData.roles.flatMap(role => role.students).filter(Boolean).length, 23, "출력 화면에서 학생 23명을 유지해야 합니다.");
const orderedIds = Array.from(printContext.__printTest.printOrderedRoles(printData.roles), role => role.id);
assert.deepEqual(orderedIds.slice(0, 5), ["board", "rocket", "environment", "milk", "health"], "보건도우미가 첫째 줄 마지막으로 올라와야 합니다.");
assert.deepEqual(orderedIds.slice(5, 10), ["clean-mon", "clean-tue", "clean-wed", "clean-thu", "clean-fri"], "크린토피아 월~금은 둘째 줄에 모여야 합니다.");

console.log("roles-data: 14 roles, 23 slots, row grouping, larger-name print data OK");
