import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

export const APP_NAME = "오늘도 차근차근";
export const DATA_DIRECTORY_NAME = "오늘도 차근차근";
export const DATA_FILES = Object.freeze({
  timetable: "주간시간표_이력.csv",
  roster: "학생명렬표.csv",
  roles: "1인1역_배정.csv",
  seating: "자리배치_이력.csv",
  records: "루틴기록.csv",
  state: "교실루틴_설정.json",
  desktop: "데스크톱설정.json",
  integrations: "외부연동설정.json"
});

export function resolveDataDirectory() {
  const override = String(process.env.CLASS_ROUTINE_DATA_DIR || "").trim();
  return path.resolve(override || path.join(os.homedir(), "Documents", DATA_DIRECTORY_NAME));
}

export async function prepareDataDirectory(sourceDirectory, requestedDataDirectory) {
  const dataDirectory = requestedDataDirectory ? path.resolve(requestedDataDirectory) : resolveDataDirectory();
  await fsp.mkdir(dataDirectory, { recursive: true });
  const migrated = [];
  for (const fileName of Object.values(DATA_FILES)) {
    const source = path.join(sourceDirectory, fileName), target = path.join(dataDirectory, fileName);
    try {
      await fsp.access(target);
    } catch {
      try {
        await fsp.copyFile(source, target);
        migrated.push(fileName);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return { dataDirectory, migrated };
}
