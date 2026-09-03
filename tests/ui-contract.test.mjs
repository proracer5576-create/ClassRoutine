import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screens = [
  ["index.html", "teacher.js"], ["settings.html", "settings.js"], ["student.html", "student.js"],
  ["roles.html", "roles.js"], ["roles-print.html", "roles-print.js"], ["guide.html", "guide.js"]
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

for (const cssName of ["styles.css", "teacher.css", "student.css", "settings.css", "timetable.css", "roles.css", "roles-print.css", "guide.css", "cute-theme.css"]) {
  const css = await fsp.readFile(path.join(project, cssName), "utf8");
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, `${cssName} has unbalanced braces.`);
  assert.doesNotMatch(css, /@import\s+url\(["']?https?:/i, `${cssName} must not load remote fonts or styles.`);
}

for (const htmlName of ["index.html", "settings.html", "student.html", "roles.html", "guide.html"]) {
  assert.match(await fsp.readFile(path.join(project, htmlName), "utf8"), /cute-theme\.css/, `${htmlName} must load the common visual theme.`);
}

const settingsHtml = await fsp.readFile(path.join(project, "settings.html"), "utf8");
for (const id of ["dataConnectionBadge", "dataDirectoryPath", "dataRoutineCount", "dataRecordCount", "dataWeekCount", "dataRosterCount", "dataDutyCount", "openDataFolder", "refreshDataStatus", "restoreFolderState"]) {
  assert.match(settingsHtml, new RegExp(`id="${id}"`), `settings data center must include #${id}.`);
}

console.log("ui-contract: HTML IDs, local assets, CSS braces, shared theme, and offline styles OK");
