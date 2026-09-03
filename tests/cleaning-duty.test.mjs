import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};
const window = {
  location: { protocol: "file:" },
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {}
};
class CustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}
const context = vm.createContext({
  window, localStorage, CustomEvent, crypto: webcrypto, console,
  Date, JSON, String, Number, Array, Object, Set, Map,
  setTimeout, clearTimeout
});

const source = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "shared.js" });

const CR = window.ClassRoutine;
assert.equal(CR.getSettings().soundVolume, 100, "Existing settings must receive the default 100% sound volume.");
assert.equal(CR.getSettings().sound, true, "Sound alerts must be enabled by default.");
assert.equal(CR.getSettings().globalSound, "chime", "The default shared alert sound must be chime.");
assert.equal(CR.quickTimerRemaining({ endsAt: 5000 }, 0), 5, "Quick timer remaining time must be measured in seconds.");
assert.equal(CR.quickTimerRemaining({ endsAt: 5001 }, 0), 6, "Quick timer seconds must round up so the display does not finish early.");
assert.equal(CR.quickTimerRemaining(null, 0), 0);
assert.equal(CR.formatCountdown(65), "01:05");
assert.equal(CR.formatCountdown(600), "10:00");
const initialSettings = CR.getSettings();
CR.setSettings({ ...initialSettings, globalSound: "wood" });
assert.equal(CR.effectiveSound("sparkle"), "wood", "The selected shared sound must override per-routine sounds.");
assert.equal(CR.effectiveSound("sparkle", { force: true }), "sparkle", "Settings previews must play the requested test sound.");
CR.setSettings(initialSettings);
const chimeTiming = CR.soundTiming("chime");
assert.equal(chimeTiming.repeatCount, 3);
assert.equal(chimeTiming.silenceSeconds, chimeTiming.audibleSeconds);
assert.ok(chimeTiming.audibleSeconds >= 2.1, "Chime release should be three times longer.");
const timedRoutine = CR.normalizeRoutine({ id: "test-timed", startTime: "09:00", type: "break", durationMode: "custom", duration: 10 });
assert.equal(CR.hasEnded(timedRoutine, new Date("2026-08-28T09:09:00")), false);
assert.equal(CR.hasEnded(timedRoutine, new Date("2026-08-28T09:10:00")), true, "A routine must become complete at its scheduled end minute even without a record.");
const commonBreak = CR.normalizeRoutine({ id: "test-break", type: "break", category: "쉬는 시간", title: "쉬는 시간", eventMessage: "" });
const commonMiddle = CR.normalizeRoutine({ id: "test-middle", type: "break", category: "중간놀이", title: "중간놀이", eventMessage: "" });
const commonLunch = CR.normalizeRoutine({ id: "test-lunch", type: "other", category: "급식", title: "점심시간", eventMessage: "" });
assert.equal(CR.messagesFor(commonBreak).event, initialSettings.commonMessages.break);
assert.equal(CR.messagesFor(commonMiddle).event, initialSettings.commonMessages.middlePlay);
assert.equal(CR.messagesFor(commonLunch).event, initialSettings.commonMessages.lunch);
CR.setSettings({ ...initialSettings, commonMessages: { ...initialSettings.commonMessages, break: "공통 쉬는 시간 시험 안내" } });
assert.equal(CR.messagesFor(commonBreak).event, "공통 쉬는 시간 시험 안내", "Changing one shared message must update existing break routines.");
assert.equal(CR.messagesFor({ ...commonBreak, eventMessage: "개별 안내" }).event, "개별 안내", "A routine-specific message must override the shared message.");
CR.setSettings(initialSettings);
const morning = CR.getRoutines().find(item => item.id === "builtin-morning-0840");
const morningBreak = CR.getRoutines().find(item => item.id === "builtin-morning-break-0855");
assert.ok(morning, "The weekday morning activity must be created automatically.");
assert.equal(morning.startTime, "08:40");
assert.equal(CR.endTime(morning), "08:55");
assert.equal(morning.duration, 15);
assert.deepEqual(Array.from(morning.activeDays), [1, 2, 3, 4, 5]);
assert.match(morning.eventMessage, /우유 마시기/);
assert.match(morning.eventMessage, /독서·레서·마타수학/);
assert.ok(morningBreak, "The five-minute break before first period must be created automatically.");
assert.equal(morningBreak.startTime, "08:55");
assert.equal(CR.endTime(morningBreak), "09:00");
assert.equal(morningBreak.type, "break");
assert.equal(morningBreak.duration, 5);
CR.ensureMorningRoutines();
assert.equal(CR.getRoutines().filter(item => item.id === "builtin-morning-0840").length, 1);
assert.equal(CR.getRoutines().filter(item => item.id === "builtin-morning-break-0855").length, 1);
const cleaning = CR.getRoutines().filter(item => item.id === "builtin-cleaning-1340");
assert.equal(cleaning.length, 1, "The built-in cleaning routine must not be duplicated.");
assert.equal(cleaning[0].startTime, "13:40");
assert.equal(CR.endTime(cleaning[0]), "13:50");
assert.equal(cleaning[0].durationMode, "custom");
assert.equal(cleaning[0].duration, 10);
assert.deepEqual(Array.from(cleaning[0].activeDays), [1, 2, 3, 4, 5]);
assert.equal(CR.preAlertFor(cleaning[0]), 2);
assert.equal(CR.isCleaningRoutine(cleaning[0]), true);
const overlappingLunch = CR.normalizeRoutine({ id: "test-overlap-lunch", startTime: "13:10", type: "other", category: "급식", title: "점심시간", durationMode: "custom", duration: 50, activeDays: [5] });
assert.equal(CR.primaryCurrentRoutine([overlappingLunch, cleaning[0]], new Date("2026-08-28T13:20:00")).id, overlappingLunch.id);
assert.equal(CR.primaryCurrentRoutine([overlappingLunch, cleaning[0]], new Date("2026-08-28T13:45:00")).id, cleaning[0].id, "Cleaning must take top-card priority while it overlaps lunch.");

CR.ensureCleaningRoutine();
assert.equal(CR.getRoutines().filter(item => item.id === "builtin-cleaning-1340").length, 1);

let dismissal = CR.getRoutines().filter(item => item.id.startsWith("builtin-dismissal"));
assert.equal(dismissal.length, 1, "The built-in dismissal routine must not be duplicated.");
assert.equal(dismissal[0].id, "builtin-dismissal-6");
assert.equal(dismissal[0].startTime, "14:40", "Six periods should dismiss at 14:40.");
assert.equal(dismissal[0].duration, 1);
assert.equal(CR.preAlertFor(dismissal[0]), 2);
assert.equal(CR.isDismissalRoutine(dismissal[0]), true);

CR.setSettings({ ...CR.getSettings(), periodCount: 5 });
dismissal = CR.getRoutines().filter(item => item.id.startsWith("builtin-dismissal"));
assert.equal(dismissal.length, 1);
assert.equal(dismissal[0].id, "builtin-dismissal-5");
assert.equal(dismissal[0].startTime, "13:50", "Five periods should dismiss at 13:50.");

CR.setSettings({ ...CR.getSettings(), periodCount: 6 });
dismissal = CR.getRoutines().filter(item => item.id.startsWith("builtin-dismissal"));
assert.equal(dismissal.length, 1);
assert.equal(dismissal[0].startTime, "14:40", "Changing the period count should move the same routine.");

const currentWeek = CR.weekStartKey();
const currentWeekTable = {
  1: { 1: "subject-1", 2: "subject-1", 3: "subject-1", 4: "subject-1", 5: "subject-1" },
  2: { 1: "subject-1", 2: "subject-1", 3: "subject-1", 4: "subject-1", 5: "subject-1", 6: "subject-1" },
  3: { 1: "subject-1", 2: "subject-1", 3: "subject-1", 4: "subject-1", 5: "subject-1" },
  4: { 1: "subject-1", 2: "subject-1", 3: "subject-1", 4: "subject-1", 5: "subject-1" },
  5: { 1: "subject-1", 2: "subject-1", 3: "subject-1", 4: "subject-1", 5: "subject-1" }
};
CR.setWeeklyTimetables({ [currentWeek]: { ...CR.weekInfo(currentWeek), timetable: currentWeekTable, savedAt: new Date().toISOString() } });
dismissal = CR.getRoutines().filter(item => item.id.startsWith("builtin-dismissal"));
assert.equal(dismissal.length, 2, "Five- and six-period weekdays need separate dismissal routines.");
const dismissal5 = dismissal.find(item => item.id === "builtin-dismissal-5"), dismissal6 = dismissal.find(item => item.id === "builtin-dismissal-6");
assert.deepEqual(Array.from(dismissal5.activeDays), [1, 3, 4, 5]);
assert.deepEqual(Array.from(dismissal6.activeDays), [2]);
assert.equal(CR.activeOn(dismissal5, new Date("2026-08-28T13:48:00")), true, "Friday with five assigned periods must use the 13:50 dismissal.");
assert.equal(CR.activeOn(dismissal6, new Date("2026-08-28T14:38:00")), false, "Friday must not receive the six-period dismissal alert.");

const dutyRoles = [
  ["board", "칠판", "classroom", 1], ["rocket", "로켓배송", "delivery", 1],
  ["environment", "환경부", "cleaning", 2], ["milk", "우유배송", "delivery", 2],
  ["health", "보건도우미", "support", 1],
  ["clean-mon", "크린토피아 · 월", "cleaning", 2], ["clean-tue", "크린토피아 · 화", "cleaning", 1],
  ["clean-wed", "크린토피아 · 수", "cleaning", 2], ["clean-thu", "크린토피아 · 목", "cleaning", 2],
  ["clean-fri", "크린토피아 · 금", "cleaning", 2],
  ["notice", "안내장 확인", "support", 1], ["materials", "자료정리", "support", 1],
  ["engineer", "엔지니어", "tech", 4], ["windows", "창문 · 문틀", "tech", 1]
];
const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const dutyHeader = ["저장시각", "배정기간", "역할ID", "역할명", "분류", "업무안내", "색상", "정원", "자리", "학생번호", "학생이름"];
const csv = [dutyHeader, ...dutyRoles.map(([id, name, category, capacity], index) => [
  "2026-08-27T12:00:00.000Z", "테스트 학기", id, name, category, "테스트 업무", "coral", capacity, 1,
  index === 0 ? 1 : "", index === 0 ? "테스트학생" : ""
])].map(row => row.map(csvCell).join(",")).join("\r\n");
const board = CR.dutyBoardFromCsv(csv);
assert.ok(board, "The saved duty CSV should be readable.");
const roles = CR.dutyAssignments(board);
assert.equal(roles.length, 14);
assert.deepEqual(Array.from(roles.slice(0, 5), role => role.id), ["board", "rocket", "environment", "milk", "health"]);
assert.deepEqual(Array.from(roles.slice(5, 10), role => role.id), ["clean-mon", "clean-tue", "clean-wed", "clean-thu", "clean-fri"]);
assert.ok(roles.some(role => role.students.some(Boolean)), "Saved student assignments should appear in the cleaning alert.");
const mondayAlertRoles = CR.dutyAssignmentsForDate(new Date("2026-08-24T13:40:00"), board);
const wednesdayAlertRoles = CR.dutyAssignmentsForDate(new Date("2026-08-26T13:40:00"), board);
assert.equal(mondayAlertRoles.length, 10, "The alert should keep all regular roles and only Monday's Crintopia role.");
assert.deepEqual(Array.from(mondayAlertRoles.filter(role => role.name.includes("크린토피아")), role => role.id), ["clean-mon"]);
assert.deepEqual(Array.from(wednesdayAlertRoles.filter(role => role.name.includes("크린토피아")), role => role.id), ["clean-wed"]);
assert.ok(mondayAlertRoles.some(role => role.id === "health"), "Non-weekday roles must remain visible in the alert.");

const nextWeekDate = new Date(`${currentWeek}T12:00:00`);
nextWeekDate.setDate(nextWeekDate.getDate() + 7);
const nextWeek = CR.weekStartKey(nextWeekDate);
const subject = CR.getSubjects()[0];
const nextWeekEntry = {
  ...CR.weekInfo(nextWeek),
  timetable: { 1: { 1: subject.id } },
  schedule: {
    ...CR.getSettings(), activeDays: [1], firstStart: "09:00", periodCount: 1,
    middlePlay: { enabled: false, afterPeriod: 2, duration: 20 },
    lunch: { enabled: false, afterPeriod: 4, duration: 50 }
  },
  savedAt: new Date().toISOString()
};
const futureRoutines = CR.materializeWeek(nextWeek, nextWeekEntry);
assert.ok(futureRoutines.some(item => item.type === "class" && item.weekStart === nextWeek), "A next-week archive must create next-week routines.");
const currentRoutineCount = CR.getRoutines().filter(item => item.generated && (!item.weekStart || item.weekStart === currentWeek)).length;
CR.setWeeklyTimetables({ ...CR.getWeeklyTimetables(), [nextWeek]: nextWeekEntry });
CR.ensureWeekRoutines(nextWeek);
assert.ok(CR.getRoutines().some(item => item.generated && item.type === "class" && item.weekStart === nextWeek), "Saved next-week routines must be restored independently.");
assert.equal(CR.getRoutines().filter(item => item.generated && (!item.weekStart || item.weekStart === currentWeek)).length, currentRoutineCount, "Saving next week must preserve current-week routines.");

console.log("cleaning-duty: cleaning, dismissal, duty board, and independent next-week timetable OK");
