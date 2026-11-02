import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screens = [
  ["index.html", "teacher.js"], ["settings.html", "settings.js"], ["student.html", "student.js"],
  ["roles.html", "roles.js"], ["roles-print.html", "roles-print.js"], ["guide.html", "guide.js"], ["seating.html", "seating.js"]
];

for (const [htmlName, scriptName] of screens) {
  const html = await fsp.readFile(path.join(project, htmlName), "utf8"), script = await fsp.readFile(path.join(project, scriptName), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${htmlName} must not contain duplicate IDs.`);
  const referencedIds = new Set([
    ...[...script.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g)].map(match => match[1]),
    ...[...script.matchAll(/getElementById\(["']([A-Za-z][\w-]*)["']\)/g)].map(match => match[1])
  ]);
  for (const id of referencedIds) assert.ok(ids.includes(id), `${scriptName} references missing #${id} in ${htmlName}.`);

  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(value => value && !value.startsWith("#") && !/^[a-z]+:/i.test(value));
  for (const asset of assets) assert.ok(await fsp.stat(path.join(project, asset)).then(stat => stat.isFile()).catch(() => false), `${htmlName} references missing ${asset}.`);
}

for (const cssName of ["styles.css", "teacher.css", "student.css", "settings.css", "timetable.css", "roles.css", "roles-print.css", "guide.css", "seating.css", "cute-theme.css"]) {
  const css = await fsp.readFile(path.join(project, cssName), "utf8");
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, `${cssName} has unbalanced braces.`);
  assert.doesNotMatch(css, /@import\s+url\(["']?https?:/i, `${cssName} must not load remote fonts or styles.`);
}

for (const htmlName of ["index.html", "settings.html", "student.html", "roles.html", "guide.html", "seating.html"]) {
  assert.match(await fsp.readFile(path.join(project, htmlName), "utf8"), /cute-theme\.css/, `${htmlName} must load the common visual theme.`);
}

const settingsHtml = await fsp.readFile(path.join(project, "settings.html"), "utf8");
for (const id of ["dataConnectionBadge", "dataDirectoryPath", "dataRoutineCount", "dataRecordCount", "dataWeekCount", "dataRosterCount", "dataDutyCount", "openDataFolder", "refreshDataStatus", "restoreFolderState", "importBackupButton"]) {
  assert.match(settingsHtml, new RegExp(`id="${id}"`), `settings data center must include #${id}.`);
}
for (const id of ["importSchoolTimetable", "schoolTimetableFile", "timetableImportDialog", "timetableImportForm", "timetableImportSummary", "timetableImportPreview", "timetableImportMappings", "applySchoolTimetable"]) {
  assert.match(settingsHtml, new RegExp(`id="${id}"`), `settings timetable import must include #${id}.`);
}
for (const id of ["subjectResourceUrl", "settingRoutineResourceUrl", "timetableConflict", "windowsNotificationSetting"]) assert.match(settingsHtml, new RegExp(`id="${id}"`));
assert.match(settingsHtml, /<script src="timetable-import\.js"><\/script>/, "settings must load the local XLSX timetable importer.");
for (const id of ["neisSchoolSearch", "searchSchoolButton", "schoolSearchStatus", "schoolSearchResults", "selectedSchoolName", "neisOfficeCode", "neisSchoolCode", "weatherNx", "weatherNy", "saveIntegrationSettings", "testDailyInfo", "allergyStudentSelect", "studentEmail", "studentEmailStatus", "allergenOptions", "saveStudentAllergens"]) {
  assert.match(settingsHtml, new RegExp(`id="${id}"`), `settings daily info must include #${id}.`);
}
const teacherHtml = await fsp.readFile(path.join(project, "index.html"), "utf8");
const studentHtml = await fsp.readFile(path.join(project, "student.html"), "utf8");
assert.match(teacherHtml, /id="todayMealDishes"/);
for (const id of ["todayMealCard", "mealDetailDialog", "mealDetailDishes", "mealDetailAllergy", "mealDetailWarnings", "alarmMealBoard", "alarmMealDishes", "alarmMealWarnings"]) assert.match(teacherHtml, new RegExp(`id="${id}"`));
for (const id of ["routineResourceUrl", "todayScheduleConflict"]) assert.match(teacherHtml, new RegExp(`id="${id}"`));
assert.match(teacherHtml, /class="meal-card-wrap"/, "The refresh button should sit outside the clickable meal card.");
assert.doesNotMatch(teacherHtml, /id="allergyPrivate"/, "compact teacher meal card must not expose allergy details.");
assert.match(studentHtml, /id="studentMealDishes"/);
for (const id of ["studentMealCard", "studentMealLayer", "studentMealLargeDishes", "closeStudentMeal", "confirmStudentMeal", "alertMealBoard", "alertMealDishes"]) assert.match(studentHtml, new RegExp(`id="${id}"`));
assert.doesNotMatch(await fsp.readFile(path.join(project, "student.js"), "utf8"), /mealWarnings\(/, "student screen must not calculate or display individual allergy warnings.");

const teacherStyles = await fsp.readFile(path.join(project, "styles.css"), "utf8");
const recordRule = teacherStyles.match(/\.record-card\{([^}]+)\}/)?.[1] || "";
assert.match(recordRule, /position:relative/, "today record card must stay in normal document flow.");
assert.doesNotMatch(recordRule, /position:(?:sticky|fixed)/, "today record card must not follow scrolling or cover other content.");
assert.match(teacherStyles, /\.alarm\.lunching\[open\]\{overflow:auto\}/, "teacher lunch alert must remain scrollable inside the viewport.");
assert.match(teacherStyles, /\.alarm\.lunching \.alarm-meal-dishes>span\{[^}]*border:0[^}]*white-space:nowrap/, "teacher lunch menu must use compact one-line items without a vertical bar.");
const studentStyles = await fsp.readFile(path.join(project, "student.css"), "utf8");
assert.match(studentStyles, /\.lunch-alert \.alert-card\{[^}]*overflow:auto/, "student lunch alert must remain scrollable inside the viewport.");
assert.match(studentStyles, /\.lunch-alert \.alert-meal-dishes article\{[^}]*border:0[^}]*white-space:nowrap/, "student lunch menu must use compact one-line items without a vertical bar.");

console.log("ui-contract: HTML IDs, local assets, CSS braces, shared theme, and offline styles OK");
