import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fsp.readFile(path.join(project, "timetable-import.js"), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context);
const importer = context.SchoolTimetableImport;

const rows = [
  ["학급시간표 조회"],
  ["2026학년도 2학기 4 학년 4 반"],
  ["교시", "월요일(2026.09.28.)", "화요일(2026.09.29.)", "수요일(2026.09.30.)", "목요일(2026.10.01.)", "금요일(2026.10.02.)", "토요일(2026.10.03.)", "일요일(2026.10.04.)"],
  [1, "국어(박오종)", "국어(박오종)", "국어(박오종)", "국어(박오종)", "국어(박오종)", "개천절", ""],
  [2, "국어(박오종)", "수학(박오종)", "체육(변용우)", "체육(박오종)", "수학(박오종)", "개천절", ""],
  [3, "수학(박오종)", "사회(박오종)", "수학(박오종)", "사회(박오종)", "사회(박오종)", "개천절", ""],
  [4, "사회(박오종)", "영어(정현주)", "미술(박오종)", "과학(박오종)", "도덕(박오종)", "개천절", ""],
  [5, "자율·자치활동(박오종)", "과학(유지혜)", "미술(박오종)", "음악(박오종)", "음악(박오종)", "개천절", ""],
  [6, "", "동아리활동(박오종)", "", "영어(정현주)", "", "개천절", ""],
  [7, "", "", "", "", "", "개천절", ""],
  [8, "", "", "", "", "", "개천절", ""]
];

const parsed = importer.parseRows(rows);
assert.equal(parsed.weekStart, "2026-09-28");
assert.equal(parsed.weekEnd, "2026-10-04");
assert.equal(parsed.lessonCount, 27);
assert.equal(parsed.maxPeriod, 6);
assert.deepEqual([...parsed.days], [1, 2, 3, 4, 5]);
assert.equal(parsed.table[1][1], "국어");
assert.equal(parsed.table[2][6], "동아리활동");
assert.equal(parsed.table[4][6], "영어");
assert.equal(parsed.table[6], undefined);
assert.equal(parsed.ignored.length, 8);
assert.match(parsed.classLabel, /4\s*학년\s*4\s*반/);

const subjects = [{ id:"club", name:"동아리" }, { id:"korean", name:"국어" }, { id:"self", name:"자율" }];
assert.equal(importer.findSubject("국어", subjects).id, "korean");
assert.equal(importer.findSubject("동아리활동", subjects).id, "club");
assert.equal(importer.findSubject("자율·자치활동", subjects), null);
assert.equal(importer.subjectName(" 체육 (변용우) "), "체육");
assert.equal(importer.isNonClassLabel("대체공휴일"), true);

assert.throws(() => importer.parseRows([["과목", "월요일"]]), /시간표 머리글/);

console.log("school-timetable-import: dated XLSX rows, teacher suffixes, holidays, and subject matching OK");
