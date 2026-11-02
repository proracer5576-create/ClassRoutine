import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("desktop shell keeps data local and opens routine notifications", () => {
  const main = read("electron-main.cjs");
  const preload = read("preload.cjs");
  const teacher = read("teacher.js");
  const student = read("student.js");

  assert.match(main, /path\.join\(app\.getPath\("documents"\), DATA_DIRECTORY_NAME\)/);
  assert.match(main, /new Tray\(/);
  assert.match(main, /launchAtLogin:\s*false/);
  assert.match(main, /windowsNotification:\s*false/);
  assert.match(main, /desktop:notify-routine/);
  assert.match(main, /desktop:set-windows-notification/);
  assert.match(main, /desktop:open-routine/);
  assert.match(main, /payload\?\.phase !== "start"/);
  assert.match(main, /60 \* 1000/);
  assert.match(main, /notification\.close\(\)/);
  assert.match(main, /desktop:open-data-folder/);
  assert.match(main, /desktop:save-backup/);
  assert.match(main, /desktop:open-backup/);
  assert.match(main, /desktop:open-external/);
  assert.match(main, /shell\.openExternal\(url\.href\)/);
  assert.match(main, /defaultPath: path\.join\(dataDirectory/);
  assert.match(main, /defaultPath: dataDirectory/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("classRoutineDesktop"/);
  assert.match(preload, /openDataFolder/);
  assert.match(preload, /saveBackup/);
  assert.match(preload, /openBackup/);
  assert.match(preload, /openExternal/);
  assert.match(teacher, /classRoutineDesktop\?\.notifyRoutine/);
  assert.match(student, /classRoutineDesktop\?\.notifyRoutine/);
  assert.match(teacher, /phase === "start"/);
  assert.match(student, /phase === "start"/);
});

test("installer includes only empty data templates", () => {
  const pkg = JSON.parse(read("package.json"));
  const files = pkg.build.files;
  for (const name of ["학생명렬표.csv", "주간시간표_이력.csv", "1인1역_배정.csv", "자리배치_이력.csv", "루틴기록.csv", "교실루틴_설정*.json", "데스크톱설정.json", "외부연동설정.json"]) {
    assert.ok(files.includes(`!${name}`), `${name} must be excluded`);
  }
  for (const template of ["명렬표_양식.csv", "주간시간표_빈파일.csv", "1인1역_배정_빈파일.csv", "자리배치_이력_빈파일.csv", "루틴기록_빈파일.csv"]) {
    assert.ok(files.includes(template), `${template} must be included`);
  }
  assert.match(pkg.build.nsis.artifactName, /설치본/);
  assert.match(pkg.build.portable.artifactName, /portable/);
});
