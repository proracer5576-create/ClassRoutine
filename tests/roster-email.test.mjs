import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const teacher = fs.readFileSync(path.join(project, "teacher.js"), "utf8");
const settings = fs.readFileSync(path.join(project, "settings.js"), "utf8");

test("desktop roster reads and exports student email", () => {
  const parseSource = teacher.match(/function parseRosterRows\(rows\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(parseSource, "parseRosterRows must exist");
  const context = vm.createContext({
    CR: { normalizeAllergenCodes: value => String(value || "").split("|").filter(Boolean) }
  });
  new vm.Script(parseSource).runInContext(context);
  const parsed = vm.runInContext(`parseRosterRows([
    ["번호", "이름", "성별", "이메일", "알레르기번호"],
    ["1", "김학생", "여", "Student01@Example.com", "1|2"]
  ])`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [{
    number: "1", name: "김학생", email: "student01@example.com", gender: "여", allergenCodes: ["1", "2"]
  }]);
  assert.match(teacher, /\["번호", "이름", "성별", "이메일", "알레르기번호"\]/);
  assert.match(settings, /\["번호","이름","성별","이메일","알레르기번호"\]/);
  assert.match(settings, /version: 4[\s\S]*roster: CR\.load/);
});
