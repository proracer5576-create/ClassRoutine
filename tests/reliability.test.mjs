import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};
const window = { location: { protocol: "file:" }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
vm.runInContext(source, vm.createContext({ window, localStorage, CustomEvent, crypto: webcrypto, URL, console, Date, JSON, String, Number, Array, Object, Set, Map, setTimeout, clearTimeout }), { filename: "shared.js" });
const CR = window.ClassRoutine;

const morning = CR.getRoutines().find(item => item.id === "builtin-morning-0840");
const cleaning = CR.getRoutines().find(item => item.id === "builtin-cleaning-1340");
assert.ok(morning && cleaning);
CR.setRoutines(CR.getRoutines().map(item => item.id === morning.id ? { ...item, startTime: "08:30", duration: 20, activeDays: [1, 3], enabled: false } : item.id === cleaning.id ? { ...item, startTime: "13:30", duration: 15, activeDays: [2, 4] } : item));
CR.ensureMorningRoutines();
CR.ensureCleaningRoutine();
assert.equal(CR.getRoutines().find(item => item.id === morning.id).startTime, "08:30");
assert.equal(CR.getRoutines().find(item => item.id === morning.id).enabled, false);
assert.equal(CR.getRoutines().find(item => item.id === cleaning.id).startTime, "13:30");
assert.equal(CR.getRoutines().find(item => item.id === cleaning.id).duration, 15);
CR.setRoutines(CR.getRoutines().filter(item => item.id !== morning.id));
CR.ensureMorningRoutines();
assert.equal(CR.getRoutines().some(item => item.id === morning.id), false, "A deleted built-in routine must stay deleted.");

const lesson = CR.normalizeRoutine({ id: "lesson", startTime: "09:00", type: "class", durationMode: "custom", duration: 40, preAlertMode: "custom", preAlertMinutes: 2 });
const at = clock => new Date(`2026-10-14T${clock}:00`);
assert.equal(CR.dueAlarmPhase(lesson, at("08:59"), []), "pre");
assert.equal(CR.dueAlarmPhase(lesson, at("09:01"), []), "start", "A one-minute wake-up delay should still show the in-page alert.");
assert.equal(CR.dueAlarmPhase(lesson, at("09:02"), []), null, "An old alert must not appear later in the day.");

const lunch = CR.normalizeRoutine({ id: "lunch", startTime: "13:10", type: "other", category: "급식", title: "점심시간", durationMode: "custom", duration: 50, activeDays: [3] });
const dismissal = CR.normalizeRoutine({ id: "dismissal", startTime: "13:50", type: "other", category: "하교", title: "하교", durationMode: "custom", duration: 1, activeDays: [3] });
assert.equal(CR.dismissalConflicts([lunch, dismissal], at("13:50")).length, 1);
assert.equal(CR.normalizeResourceUrl("javascript:alert(1)"), "");
assert.equal(CR.resourceUrlFor({ ...lesson, subjectId: "subject-1" }, [{ id: "subject-1", resourceUrl: "https://example.com/lesson" }]), "https://example.com/lesson");
console.log("reliability: built-in edits, bounded alarms, dismissal conflicts, and safe resource links OK");
