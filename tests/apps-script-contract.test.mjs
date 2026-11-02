import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, "apps-script", file), "utf8");

test("Apps Script classroom hub has verified email sessions and role gates", () => {
  const server = read("Code.gs");
  assert.doesNotThrow(() => new vm.Script(server));
  assert.match(server, /Session\.getActiveUser\(\)\.getEmail\(\)/);
  assert.match(server, /requireUser_\(\['student'\], payload\)/);
  assert.match(server, /requireUser_\(\['master', 'teacher'\], payload\)/);
  assert.match(server, /LockService\.getScriptLock\(\)/);
  assert.match(server, /cleanHttpsUrl_/);
  assert.match(server, /function setupDatabase\(\)/);
  assert.match(server, /function setupDatabase_\(\)/);
  assert.match(server, /activeEmail !== effectiveEmail/);
  assert.match(server, /mealServiceDietInfo/);
  assert.match(server, /VilageFcstInfoService_2\.0/);
  assert.match(server, /normalizeAllergenCodes_/);
  assert.match(server, /function requestLoginCode\(payload\)/);
  assert.match(server, /function verifyLoginCode\(payload\)/);
  assert.match(server, /Session\.getTemporaryActiveUserKey\(\)/);
  assert.match(server, /MailApp\.sendEmail/);
  assert.match(server, /authTokenHash_/);
  for (const table of ["Users", "Classes", "State", "Responses", "HelpQueue", "AuditLog", "LoginChallenges", "AuthSessions"]) {
    assert.match(server, new RegExp(`${table}: \\[`));
  }
});

test("Apps Script UI supports master, teacher, and interactive student views", () => {
  const html = read("Index.html");
  const client = read("Client.html");
  const script = client.replace(/^<script>\s*/, "").replace(/\s*<\/script>\s*$/, "");
  assert.doesNotThrow(() => new vm.Script(script));
  for (const id of ["loginView", "loginForm", "loginEmail", "loginCode", "masterView", "teacherView", "studentView", "classForm", "sessionForm", "serviceForm", "rosterInput", "teacherMealMenu", "studentMealMenu", "studentAllergyWarning", "readyButton", "understandingChoices", "studentPollOptions", "helpButton", "exitButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(client, /google\.script\.run/);
  assert.match(client, /submitStudentResponse/);
  assert.match(client, /requestHelp/);
  assert.match(client, /5000/);
  assert.match(client, /12000/);
});

test("Apps Script manifest keeps scopes focused", () => {
  const manifest = JSON.parse(read("appsscript.json"));
  assert.equal(manifest.timeZone, "Asia/Seoul");
  assert.deepEqual(manifest.webapp, { access: "ANYONE", executeAs: "USER_DEPLOYING" });
  assert.deepEqual(manifest.oauthScopes.sort(), [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email"
  ].sort());
  assert.match(read(".claspignore"), /!Recovery\.gs/);
});

test("Apps Script adds schedule, subject defaults, announcements, timers, and selective desktop import", () => {
  const server = read("Code.gs");
  const html = read("Index.html");
  const client = read("Client.html");
  for (const table of ["SubjectSettings", "WeekPlans", "ClassAnnouncements", "RoutineSets", "DutyBoards", "ClassControls"]) {
    assert.match(server, new RegExp(`${table}: \\[`));
  }
  for (const method of ["saveSubjectSetting", "saveWeekPlan", "copyPreviousWeek", "saveClassAnnouncement", "startClassTimer", "stopClassTimer", "importDesktopBackup"]) {
    assert.match(server, new RegExp(`function ${method}\\(payload\\)`));
  }
  assert.match(server, /function saveWeekPlan\(payload\)[\s\S]*requireUser_\(\['master', 'teacher'\], payload\)[\s\S]*authorizeClass_/);
  const importBlock = server.match(/function importDesktopBackup\(payload\)[\s\S]*?(?=\nfunction publishSession\()/)[0];
  assert.doesNotMatch(importBlock, /backup\.memos|PROP_(NEIS|KMA)_API_KEY/, "private desktop memos and API keys must not be imported");
  assert.match(importBlock, /options\.records \? normalizeImportedRecords_/);
  assert.match(importBlock, /options\.handoffs \? normalizeImportedHandoffs_/);
  for (const id of ["subjectSettingForm", "weekPlanGrid", "announcementForm", "classTimerPresets", "desktopBackupFile", "studentTodaySchedule", "studentAnnouncement", "classTimerLayer"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(client, /pendingDesktopBackup = \{[\s\S]*subjects:[\s\S]*weeklyTimetables:[\s\S]*duties:/);
  assert.match(html, /data-import-option="students"/);
  assert.match(server, /options\.students[\s\S]*summary\.students/);
  const pendingBlock = client.match(/pendingDesktopBackup = \{([\s\S]*?)\n\s*\};/)[1];
  assert.doesNotMatch(pendingBlock, /memos|apiKey/i);
});

test("week plan helpers enforce Monday keys and materialize only assigned periods", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  assert.equal(vm.runInContext("normalizeWeekStart_('2026-09-14')", context), "2026-09-14");
  assert.throws(() => vm.runInContext("normalizeWeekStart_('2026-09-15')", context), /월요일/);
  const result = vm.runInContext(`materializePlanDay_(normalizeWeekPlan_({
    schedule:{activeDays:[1,2,3,4,5],firstStart:'09:00',classMinutes:40,breakMinutes:10,periodCount:5,middlePlay:{enabled:true,afterPeriod:2,duration:20},lunch:{enabled:false}},
    timetable:{1:{1:'subject-1',2:'subject-4',3:'subject-5'}}
  }), 1, defaultSubjectSettings_())`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(item => [item.startTime, item.title]))), [
    ["09:00", "국어"], ["09:40", "쉬는 시간"], ["09:50", "수학"], ["10:30", "중간놀이"], ["10:50", "과학"]
  ]);
});

test("middle play and lunch after the same period are both scheduled in order", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  const result = vm.runInContext(`materializePlanDay_(normalizeWeekPlan_({
    schedule:{activeDays:[1],firstStart:'09:00',classMinutes:40,breakMinutes:10,periodCount:2,
      middlePlay:{enabled:true,afterPeriod:1,duration:20},lunch:{enabled:true,afterPeriod:1,duration:30}},
    timetable:{1:{1:'subject-1',2:'subject-4'}}
  }), 1, defaultSubjectSettings_())`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(item => [item.startTime, item.title]))), [
    ["09:00", "국어"], ["09:40", "중간놀이"], ["10:00", "점심시간"], ["10:30", "수학"]
  ]);
  assert.equal(new Set(result.map(item => item.id)).size, result.length);
});

test("Apps Script client references existing unique element IDs", () => {
  const html = read("Index.html");
  const client = read("Client.html");
  assert.doesNotThrow(() => new vm.Script(client.replace(/^<script>\s*/, "").replace(/\s*<\/script>\s*$/, "")));
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");
  const referenced = [...client.matchAll(/\$\(['"]#([A-Za-z][\w:-]*)['"]\)/g)].map(match => match[1]);
  const missing = [...new Set(referenced.filter(id => !ids.includes(id)))];
  assert.deepEqual(missing, [], `missing client elements: ${missing.join(", ")}`);
});

test("desktop routine alerts and roster gender survive Apps Script normalization", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  const result = vm.runInContext(`(() => {
    const routines = normalizeRoutineSet_([
      { id:'dismiss', title:'하교', category:'하교', startTime:'13:50', duration:1, preAlertMode:'custom', preAlertMinutes:5, generated:true, weekStart:'2026-09-28', activeDays:[5] },
      { id:'clean', title:'청소 시간', startTime:'13:40', duration:10, preAlertMode:'custom', preAlertMinutes:3, activeDays:[5], eventMessage:'우유와 크린토피아' }
    ]);
    return { routineCount:routines.length, weekStart:routines[0].weekStart,
      dismissal:publicRoutineScheduleItem_(routines[0], [], 2).preAlertMinutes,
      cleaning:publicRoutineScheduleItem_(routines[1], [], 2),
      gender:[normalizeGender_('남'), normalizeGender_('여')] };
  })()`, context);
  assert.equal(result.routineCount, 2);
  assert.equal(result.weekStart, "2026-09-28");
  assert.equal(result.dismissal, null, "dismissal must alert only at its start time");
  assert.equal(result.cleaning.preAlertMinutes, 3);
  assert.equal(result.cleaning.message, "우유와 크린토피아");
  assert.deepEqual(Array.from(result.gender), ["남", "여"]);
  assert.throws(() => vm.runInContext("normalizeGender_('기타')", context), /남 또는 여/);
});

test("teacher Gmail and student school domains are checked independently of the deployer domain", () => {
  const context = vm.createContext({ console, PropertiesService: {
    getScriptProperties: () => ({ getProperty: key => key === "CLASSROOM_HUB_STUDENT_DOMAINS" ? "wj.es.kr, ai.jne.kr" : "" })
  } });
  new vm.Script(read("Code.gs")).runInContext(context);
  assert.doesNotThrow(() => vm.runInContext("assertSchoolDomain_('teacher@gmail.com','teacher')", context));
  assert.doesNotThrow(() => vm.runInContext("assertSchoolDomain_('student@wj.es.kr','student')", context));
  assert.throws(() => vm.runInContext("assertSchoolDomain_('student@elsewhere.com','student')", context), /학생 계정/);
});

test("large desktop import preserves weekly routines and email-free roster without duplicates", () => {
  const weeks = ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];
  const routines = Array.from({ length: 6 }, (_, index) => ({
    id: `manual-${index}`, startTime: "08:40", title: `일정 ${index}`, activeDays: [1], generated: false
  }));
  weeks.forEach((weekStart, weekIndex) => {
    const count = weekIndex < 2 ? 24 : 23;
    for (let index = 0; index < count; index += 1) routines.push({
      id: `generated-${weekIndex}-${index}`, weekStart, generated: true,
      startTime: `${String(9 + Math.floor(index / 6)).padStart(2, "0")}:${String(index % 6 * 10).padStart(2, "0")}`,
      title: `수업 ${index}`, type: "class", activeDays: [1], eventMessage: `개별 안내 ${index}`,
      durationMode: "custom", duration: 40, sound: "chime", color: "blue"
    });
  });
  assert.equal(routines.length, 192);
  const roster = Array.from({ length: 24 }, (_, index) => ({
    number: String(index + 1), name: `학생${index + 1}`, email: "", gender: index % 2 ? "남" : "여",
    allergenCodes: index < 3 ? [String(index + 1)] : []
  }));
  const backup = { version: 4, settings: { schoolLevel: "elementary" }, routines, roster,
    weeklyTimetables: Object.fromEntries(weeks.map(week => [week, {
      schedule: { activeDays: [1], periodCount: 1 }, timetable: { 1: { 1: "subject-1" } }
    }])),
    seating: { layout: { sections: 1, rows: 4, seats: [6] }, current: {
      savedAt: "2026-10-15T00:00:00.000Z", layout: { sections: 1, rows: 4, seats: [6] },
      seats: Object.fromEntries(roster.map((student, index) => [`0-${Math.floor(index / 6)}-${index % 6}`, `${student.number}␟${student.name}`]))
    }, history: [] }
  };
  const memory = {};
  const context = vm.createContext({ console, backup, memory });
  new vm.Script(read("Code.gs")).runInContext(context);
  vm.runInContext(`
    requireUser_ = () => ({email:'teacher@example.edu',role:'teacher'});
    authorizeClass_ = () => 'c1';
    withScriptLock_ = callback => callback();
    readRows_ = name => memory[name] || [];
    upsertRow_ = (name, key, keyValue, value) => {
      const rows = memory[name] || (memory[name] = []);
      const index = rows.findIndex(row => String(row[key]) === String(keyValue));
      if (index < 0) rows.push({...value}); else rows[index] = {...value};
    };
    deleteRowsWhere_ = (name, predicate) => { memory[name] = (memory[name] || []).filter(row => !predicate(row)); };
    createClassRecoveryCopy_ = () => ({operationId:'recovery-test'});
    updateRecoveryStatus_ = () => {};
    audit_ = () => {};
    teacherSnapshot_ = () => ({});
  `, context);
  const importOnce = () => vm.runInContext(`importDesktopBackup({classId:'c1',weekStart:'2026-10-12',backup,
    overwriteSeating:true,options:{routines:true,timetables:true,students:true,allergies:true,seating:true}})`, context);
  const first = importOnce();
  assert.equal(first.importSummary.routines, 192);
  assert.equal(first.importSummary.students, 24);
  assert.equal(first.importSummary.linkedAccounts, 0);
  assert.equal(memory.Users?.length || 0, 0);
  assert.equal(memory.RosterMembers.length, 24);
  assert.equal(memory.WeekPlans.length, 8);
  assert.equal(JSON.parse(memory.RoutineSets[0].routinesJson).length, 6);
  assert.equal(memory.WeekPlans.reduce((sum, row) => sum + JSON.parse(row.generatedJson).length, 0), 186);
  assert.equal(memory.SeatingBoards.length, 1);
  assert.equal(Object.keys(JSON.parse(memory.SeatingBoards[0].boardJson).current.seats).length, 24);
  importOnce();
  assert.equal(memory.RosterMembers.length, 24);
  assert.equal(memory.WeekPlans.length, 8);
  assert.equal(memory.RoutineSets.length, 1);
  const firstSeatKey = JSON.parse(memory.SeatingBoards[0].boardJson).current.seats["0-0-0"];
  vm.runInContext(`
    assertSchoolDomain_ = () => {};
    upsertUser_ = (email, patch) => {
      const rows = memory.Users || (memory.Users = []);
      const index = rows.findIndex(row => row.email === email);
      const row = {...(rows[index] || {}), ...patch, email};
      if (index < 0) rows.push(row); else rows[index] = row;
    };
    saveRoster({classId:'c1', entries:backup.roster.map((student,index) => ({
      ...student, email:'student' + (index + 1) + '@school.kr'
    }))});
  `, context);
  assert.equal(memory.RosterMembers.length, 24, "linking emails must reuse imported member rows");
  assert.equal(memory.Users.length, 24);
  assert.equal(JSON.parse(memory.SeatingBoards[0].boardJson).current.seats["0-0-0"], firstSeatKey);
  importOnce();
  assert.equal(memory.RosterMembers.length, 24, "reimporting an email-free backup must not duplicate linked students");
  assert.equal(memory.Users.length, 24, "reimporting an email-free backup must retain later email links");
  const beforeInvalidImport = JSON.stringify(memory);
  backup.roster[0].gender = "invalid";
  assert.throws(importOnce, /성별은 남 또는 여/);
  assert.equal(JSON.stringify(memory), beforeInvalidImport, "invalid roster data must not partially overwrite earlier sections");
  backup.roster[0].gender = "여";
  const edited = vm.runInContext(`(() => {
    const row = memory.WeekPlans.find(item => item.weekStart === '2026-09-14');
    const plan = JSON.parse(row.planJson);
    plan.schedule.firstStart = '10:00';
    saveWeekPlan({classId:'c1',weekStart:'2026-09-14',revision:row.revision,plan});
    return memory.WeekPlans.find(item => item.weekStart === '2026-09-14').generatedJson;
  })()`, context);
  assert.equal(edited, "[]", "editing a week must invalidate its imported generated schedule");
});

test("selective import avoids sending unselected backup sections", () => {
  const client = read("Client.html");
  const server = read("Code.gs");
  assert.match(client, /const selectedBackup = \{ version: pendingDesktopBackup\.version \}/);
  assert.match(client, /if \(options\.students\) selectedBackup\.roster/);
  assert.match(client, /else if \(options\.allergies\) selectedBackup\.roster = pendingDesktopBackup\.roster\.map/);
  assert.match(server, /existing\.classId !== classId\) \{/);
  assert.match(server, /StudentProfiles: \[/);
  assert.match(server, /entry\.gender == null \? String\(previous && previous\.gender \|\| ''\)/);
  assert.match(client, /function updateScheduleAlert\(\)/);
  assert.match(read("Index.html"), /id="scheduleAlertLayer"/);
});

test("seating import maps legacy roster keys to registered emails and rejects unknown pupils", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  const board = vm.runInContext(`normalizeSeatingBoard_({
    layout:{sections:1,rows:1,seats:[2]}, options:{mixGender:true,avoidPairs:true,avoidSeats:true},
    current:{savedAt:'2026-10-02T00:00:00.000Z',layout:{sections:1,rows:1,seats:[2]},seats:{'0-0-0':'1␟가학생','0-0-1':'2␟나학생'}}, history:[]
  }, [{email:'a@school.kr',number:'1',name:'가학생'},{email:'b@school.kr',number:'2',name:'나학생'}])`, context);
  assert.equal(board.current.seats["0-0-0"], "a@school.kr");
  assert.equal(board.current.seats["0-0-1"], "b@school.kr");
  assert.throws(() => vm.runInContext(`normalizeSeatingBoard_({layout:{sections:1,rows:1,seats:[1]},current:{savedAt:'2026-10-02',seats:{'0-0-0':'9␟없는학생'}}}, [{email:'a@school.kr',number:'1',name:'가학생'}])`, context), /명렬/);
});

test("completion history and student handoffs are separately persisted with role checks", () => {
  const server = read("Code.gs");
  const html = read("Index.html");
  const client = read("Client.html");
  for (const table of ["RoutineRecords", "RoutineHandoffs", "SeatingBoards", "SeatingHistory", "StudentProfiles"]) assert.match(server, new RegExp(`${table}: \\[`));
  for (const endpoint of ["completeRoutine", "undoRoutineCompletion", "saveSeatingBoard", "saveRoutine", "deleteRoutine"]) {
    assert.match(server, new RegExp(`function ${endpoint}\\(payload\\)[\\s\\S]*?requireUser_\\(\\['master', 'teacher'\\], payload\\)`));
  }
  assert.match(server, /audience === 'teacher' \? \{ teacherNote:/);
  for (const id of ["routineRecordList", "routineRecordDialog", "seatingBoard", "routineForm", "scheduleAlertHandoff"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(client, /function seatingPenalty\(/);
});

test("school-level defaults remain individually editable and dismissal has no early alert", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  const result = vm.runInContext(`(() => {
    const plan = normalizeWeekPlan_({schedule:{schoolLevel:'middle',classMinutes:47,breakMinutes:10,periodCount:6,
      firstStart:'09:00',middlePlay:{enabled:false},lunch:{enabled:false},dismissal:{enabled:true,afterFive:'13:50',afterSix:'14:40'}},
      timetable:{1:{1:'subject-1',2:'subject-1',3:'subject-1',4:'subject-1',5:'subject-1'}}});
    const items = materializePlanDay_(plan, 1, defaultSubjectSettings_());
    return {level:plan.schedule.schoolLevel,classMinutes:plan.schedule.classMinutes,
      dismissal:items.find(item => item.id === 'dismissal-1-5')};
  })()`, context);
  assert.equal(result.level, "middle");
  assert.equal(result.classMinutes, 47);
  assert.equal(result.dismissal.startTime, "13:50");
  assert.equal(result.dismissal.preAlertMinutes, null);
});

test("teacher can edit all duty roles and print a single-page roster without exposing it to student state", () => {
  const server = read("Code.gs"), html = read("Index.html"), client = read("Client.html"), css = read("Styles.html");
  assert.match(server, /function saveDutyBoard\(payload\)[\s\S]*?requireUser_\(\['master', 'teacher'\], payload\)/);
  assert.match(server, /dutyBoard: dutyBoardFor_\(classId\)/);
  const studentBlock = server.match(/function studentSnapshot_\(actor\)[\s\S]*?(?=\nfunction defaultSubjectSettings_\()/)[0];
  assert.doesNotMatch(studentBlock, /dutyBoard:/);
  for (const id of ["dutyEditorList", "addDutyRole", "saveDutyBoard", "printDutyBoard", "dutyPrintSheet"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(client, /window\.print\(\)/);
  assert.match(css, /@page\{size:A4 landscape/);
});

test("teacher-only full backup is downloadable and excludes integration API keys", () => {
  const server = read("Code.gs"), html = read("Index.html"), client = read("Client.html");
  const block = server.match(/function exportClassBackup\(payload\)[\s\S]*?(?=\nfunction saveSeatingBoard\()/)[0];
  assert.match(block, /requireUser_\(\['master', 'teacher'\], payload\)/);
  assert.match(block, /authorizeClass_/);
  assert.match(block, /version: 4/);
  assert.match(block, /weeklyTimetables/);
  assert.match(block, /records, handoffs, memos: \{\}, roster/);
  assert.doesNotMatch(block, /PROP_(NEIS|KMA)_API_KEY|neisApiKey|kmaApiKey/);
  assert.match(html, /id="exportClassBackup"/);
  assert.match(client, /callServer\('exportClassBackup'/);
});

test("Apps Script reuses the tested local XLSX parser without uploading the source file", () => {
  const embedded = read("TimetableImport.html").replace(/^<script>\s*/, "").replace(/\s*<\/script>\s*$/, "").trim();
  const desktop = fs.readFileSync(path.join(root, "timetable-import.js"), "utf8").trim();
  assert.equal(embedded, desktop, "the Apps Script parser must stay aligned with the desktop parser");
  assert.doesNotThrow(() => new vm.Script(embedded));
  assert.match(read("Index.html"), /include_\('TimetableImport'\)/);
  assert.match(read("Index.html"), /id="schoolTimetableFile"/);
  assert.match(read("Client.html"), /SchoolTimetableImport\.parseFile\(file\)/);
  assert.match(read("Client.html"), /plan\.timetable = mapped\.timetable/);
  assert.match(read("Client.html"), /callServer\('saveWeekPlan'/);
});

test("teacher can find NEIS schools by name without returning the API key", () => {
  const server = read("Code.gs"), html = read("Index.html"), client = read("Client.html");
  const context = vm.createContext({ console, PropertiesService: { getScriptProperties: () => ({ getProperty: () => "SECRET" }) } });
  new vm.Script(server).runInContext(context);
  vm.runInContext(`requireUser_ = () => ({role:'teacher',classId:'class-1'}); authorizeClass_ = () => 'class-1';
    fetchJson_ = url => ({schoolInfo:[{row:[{ATPT_OFCDC_SC_CODE:'B10',ATPT_OFCDC_SC_NM:'서울특별시교육청',SD_SCHUL_CODE:'1234567',SCHUL_NM:'가람초등학교',SCHUL_KND_SC_NM:'초등학교',ORG_RDNMA:'서울 주소'}]}]});`, context);
  const result = vm.runInContext(`searchSchools({classId:'class-1',query:'가람',neisApiKey:'SECRET'})`, context);
  assert.equal(result.schools[0].officeCode, "B10");
  assert.equal(result.schools[0].schoolCode, "1234567");
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  assert.match(html, /id="neisSchoolSearch"/);
  assert.match(html, /id="schoolSearchResults"/);
  assert.match(client, /callServer\('searchSchools'/);
});

test("normal app reads do not migrate or delete sheets", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  vm.runInContext(`
    globalThis.__calls = [];
    PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'db-id' }) };
    SpreadsheetApp = { openById: () => ({ getSheetByName: () => null }) };
    assertSchema_ = () => __calls.push('assert');
    ensureSchema_ = () => { throw new Error('ordinary read must not migrate'); };
    getDb_();
  `, context);
  assert.deepEqual(Array.from(context.__calls), ["assert"]);
  const schemaBlock = read("Code.gs").match(/function ensureSchema_\(spreadsheet\)[\s\S]*?(?=\nfunction assertSchema_)/)[0];
  assert.doesNotMatch(schemaBlock, /deleteSheet\(/);
});

test("changing the sole homeroom teacher preserves settings and revokes old access", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  vm.runInContext(`
    globalThis.__events = [];
    requireUser_ = () => ({ role:'master', email:'owner@gmail.com' });
    assertSchoolDomain_ = () => {};
    masterEmails_ = () => ['owner@gmail.com'];
    withScriptLock_ = fn => fn();
    findRow_ = name => name === 'Classes' ? {classId:'c1',teacherEmail:'old@school.kr',createdAt:'before',neisOfficeCode:'B10',weatherNx:42} : null;
    readRows_ = name => name === 'Classes' ? [] : [];
    upsertRow_ = (name,key,id,row) => __events.push({name,row});
    upsertUser_ = (email,patch) => __events.push({email,patch});
    revokeSessionsForEmail_ = email => __events.push({revoked:email});
    audit_ = () => {};
    adminSnapshot_ = () => ({});
    saveClass({classId:'c1',teacherEmail:'new@school.kr',teacherName:'새 담임',className:'4반',schoolName:'가상학교'});
  `, context);
  const events = context.__events;
  assert.equal(events[0].row.neisOfficeCode, "B10");
  assert.equal(events[0].row.weatherNx, 42);
  assert.deepEqual(JSON.parse(JSON.stringify(events[1])), {email:"old@school.kr",patch:{active:false}});
  assert.deepEqual(JSON.parse(JSON.stringify(events[2])), {revoked:"old@school.kr"});
  assert.equal(events[3].email, "new@school.kr");
});

test("roster full sync disables omitted logins but retains records", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  vm.runInContext(`
    globalThis.__events = [];
    requireUser_ = () => ({ role:'teacher', classId:'c1', email:'teacher@school.kr' });
    authorizeClass_ = () => 'c1';
    assertSchoolDomain_ = () => {};
    withScriptLock_ = fn => fn();
    readRows_ = name => name === 'Users' ? [
      {email:'keep@school.kr',role:'student',classId:'c1',active:true},
      {email:'omit@school.kr',role:'student',classId:'c1',active:true}
    ] : [];
    findRow_ = () => null;
    upsertUser_ = (email,patch) => __events.push({email,patch});
    upsertRow_ = (name,key,id,row) => __events.push({name,row});
    revokeSessionsForEmail_ = email => __events.push({revoked:email});
    createClassRecoveryCopy_ = () => { __events.push({copied:true}); return {operationId:'recovery_sync'}; };
    updateRecoveryStatus_ = (id,status) => __events.push({status});
    audit_ = () => {};
    teacherSnapshot_ = () => ({});
    saveRoster({classId:'c1',mode:'sync',confirmDeactivation:true,deactivateEmails:['omit@school.kr'],
      entries:[{email:'keep@school.kr',number:'1',name:'가학생'}]});
  `, context);
  assert.ok(context.__events.some(event => event.email === "omit@school.kr" && event.patch.active === false));
  assert.ok(context.__events.some(event => event.copied));
  assert.ok(context.__events.some(event => event.status === "COMMITTED"));
  assert.ok(context.__events.some(event => event.revoked === "omit@school.kr"));
  assert.ok(!context.__events.some(event => ["Responses", "RoutineRecords", "RoutineHandoffs"].includes(event.name)));
});

test("Apps Script exposes full roster sync with a deactivation preview", () => {
  const index = read("Index.html");
  const client = read("Client.html");
  assert.match(index, /id="syncRosterButton"/);
  assert.match(client, /\$\('#syncRosterButton'\)\.addEventListener/);
  assert.match(client, /deactivateEmails: removed\.map\(student => student\.email\)/);
  assert.match(client, /\$\('#neisApiKey'\)\.closest\('details'\)\.hidden = data\.actor\.role !== 'master'/);
});

test("roster full sync makes no changes when its recovery copy fails", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  vm.runInContext(`
    globalThis.__writes = 0;
    requireUser_ = () => ({role:'teacher',classId:'c1',email:'teacher@school.kr'});
    authorizeClass_ = () => 'c1';
    assertSchoolDomain_ = () => {};
    withScriptLock_ = fn => fn();
    readRows_ = name => name === 'Users' ? [
      {email:'keep@school.kr',role:'student',classId:'c1',active:true},
      {email:'omit@school.kr',role:'student',classId:'c1',active:true}
    ] : [];
    createClassRecoveryCopy_ = () => { throw new Error('Drive unavailable'); };
    upsertUser_ = () => { __writes++; };
    upsertRow_ = () => { __writes++; };
  `, context);
  assert.throws(() => vm.runInContext(`saveRoster({classId:'c1',mode:'sync',confirmDeactivation:true,
    deactivateEmails:['omit@school.kr'],entries:[{email:'keep@school.kr',name:'Student'}]})`, context), /Drive unavailable/);
  assert.equal(context.__writes, 0);
});

test("recovery snapshot scopes class rows and excludes auth sessions", () => {
  const context = vm.createContext({ console });
  new vm.Script(`${read("Code.gs")}\n${read("Recovery.gs")}`).runInContext(context);
  vm.runInContext(`
    readRows_ = name => {
      if (name === 'Users') return [
        {email:'a@school.kr',classId:'c1',role:'student',active:true},
        {email:'b@school.kr',classId:'c2',role:'student',active:true}
      ];
      if (name === 'StudentProfiles') return [{email:'a@school.kr',classId:'c1'},{email:'b@school.kr',classId:'c2'}];
      if (name === 'Classes') return [{classId:'c1',className:'1반'},{classId:'c2',className:'2반'}];
      if (name === 'AuthSessions') throw new Error('must not read auth sessions');
      return [];
    };
    globalThis.__snapshot = classRecoveryData_('c1','desktop.import',[],'2026-10-14T00:00:00.000Z','2026-11-13T00:00:00.000Z');
  `, context);
  const snapshot = context.__snapshot;
  assert.equal(snapshot.tables.Users.rows.length, 1);
  assert.equal(snapshot.tables.StudentProfiles.rows.length, 1);
  assert.equal(snapshot.tables.Classes.rows.length, 1);
  assert.equal(snapshot.tables.AuthSessions, undefined);
  assert.equal(snapshot.tables.LoginChallenges, undefined);
  assert.equal(snapshot.tables.RecoveryCopies, undefined);
});

test("a master cannot silently transfer a student from another class", () => {
  const context = vm.createContext({ console });
  new vm.Script(read("Code.gs")).runInContext(context);
  vm.runInContext(`
    globalThis.__writes = 0;
    requireUser_ = () => ({ role:'master', email:'owner@gmail.com' });
    authorizeClass_ = () => 'c1';
    assertSchoolDomain_ = () => {};
    withScriptLock_ = fn => fn();
    readRows_ = name => name === 'Users' ? [{email:'student@school.kr',role:'student',classId:'c2',active:true}] : [];
    upsertUser_ = () => { __writes += 1; };
    upsertRow_ = () => { __writes += 1; };
  `, context);
  assert.throws(() => vm.runInContext(`saveRoster({classId:'c1',entries:[{email:'student@school.kr',name:'Student'}]})`, context));
  assert.equal(context.__writes, 0);
  assert.throws(() => vm.runInContext(`importDesktopBackup({classId:'c1',backup:{roster:[{email:'student@school.kr',name:'Student'}]},options:{students:true}})`, context));
  assert.equal(context.__writes, 0);
  assert.match(read("Code.gs"), /existing\.classId !== classId\) \{/);
  assert.doesNotMatch(read("Code.gs"), /existing\.classId !== classId && actor\.role !== 'master'/);
});

test("recovery storage setup probes private create, read-back and deletion", () => {
  const context = vm.createContext({ console });
  new vm.Script(`${read("Code.gs")}\n${read("Recovery.gs")}`).runInContext(context);
  vm.runInContext(`
    globalThis.__methods = [];
    const content = JSON.stringify({format:'class_recovery_probe_v1',createdAt:'2026-10-15T00:00:00.000Z'});
    id_ = () => 'recovery_probe123';
    now_ = () => '2026-10-15T00:00:00.000Z';
    hashText_ = value => String(value.length);
    Session = {getEffectiveUser:() => ({getEmail:() => 'owner@gmail.com'})};
    recoveryFileMetadata_ = () => ({mimeType:'application/json',shared:false,
      owners:[{emailAddress:'owner@gmail.com'}],permissions:[{role:'owner'}],
      appProperties:{installationId:'install-1',kind:'class_recovery_v1',operationId:'recovery_probe123',checksum:String(content.length)}});
    driveRecoveryFetch_ = (url,options) => {
      __methods.push(options.method);
      return {getContentText:() => options.method === 'post' ? '{"id":"probeFile1"}' : content};
    };
    verifyRecoveryStorage_('install-1');
  `, context);
  assert.deepEqual(Array.from(context.__methods), ["post", "get", "delete"]);
});

test("recovery import is fail-closed when daily cleanup is not installed", () => {
  const context = vm.createContext({ console });
  new vm.Script(`${read("Code.gs")}\n${read("Recovery.gs")}`).runInContext(context);
  vm.runInContext(`PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'installation-1' }) };
    recoveryTriggerInstalled_ = () => false;`, context);
  assert.throws(() => vm.runInContext("createClassRecoveryCopy_('c1','desktop.import',[])", context), /30일 정리/);
  assert.match(read("Recovery.gs"), /RECOVERY_RETENTION_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(read("Recovery.gs"), /files\/\$\{encodeURIComponent\(file\.id\)\}/);
});

test("recovery copy becomes ready only after private read-back succeeds", () => {
  const context = vm.createContext({ console });
  new vm.Script(`${read("Code.gs")}\n${read("Recovery.gs")}`).runInContext(context);
  vm.runInContext(`
    globalThis.__ledger = [];
    const sample = {format:'class_recovery_v1',tables:{Users:{headers:['email'],rows:[['a@school.kr']]}}};
    PropertiesService = {getScriptProperties:() => ({getProperty:() => 'install-1'})};
    Session = {getEffectiveUser:() => ({getEmail:() => 'owner@gmail.com'})};
    Utilities = {newBlob:text => ({getBytes:() => new Array(text.length)})};
    recoveryTriggerInstalled_ = () => true;
    classRecoveryData_ = () => sample;
    hashText_ = text => String(text.length);
    now_ = () => '2026-10-14T00:00:00.000Z';
    id_ = () => 'recovery_abc123';
    upsertRow_ = (name,key,id,row) => __ledger.push({status:row.status,copyId:row.copyId});
    driveRecoveryFetch_ = url => ({getContentText:() => url.includes('upload') ? '{"id":"copy123"}' : JSON.stringify(sample)});
    recoveryFileMetadata_ = () => ({mimeType:'application/json',shared:false,
      owners:[{emailAddress:'owner@gmail.com'}],permissions:[{role:'owner'}],
      appProperties:{installationId:'install-1',kind:'class_recovery_v1',operationId:'recovery_abc123',checksum:String(JSON.stringify(sample).length)}});
    globalThis.__copy = createClassRecoveryCopy_('c1','desktop.import',[]);
  `, context);
  assert.deepEqual(Array.from(context.__ledger, item => item.status), ["PREPARING", "READY"]);
  assert.equal(context.__copy.copyId, "copy123");
  assert.equal(context.__copy.expiresAt, "2026-11-13T00:00:00.000Z");
});

test("30-day cleanup deletes only expired verified app-owned copies", () => {
  const context = vm.createContext({ console });
  new vm.Script(`${read("Code.gs")}\n${read("Recovery.gs")}`).runInContext(context);
  vm.runInContext(`
    globalThis.__deleted = [];
    const props = id => ({installationId:'install-1',kind:'class_recovery_v1',operationId:id,checksum:'sum',expiresAt:'2020-01-01T00:00:00.000Z'});
    PropertiesService = {getScriptProperties:() => ({getProperty:key => key.includes('SPREADSHEET') ? 'liveDb' : 'install-1'})};
    Session = {getEffectiveUser:() => ({getEmail:() => 'owner@gmail.com'})};
    driveRecoveryFetch_ = (url,options) => {
      if (options.method === 'delete') { __deleted.push(url); return {getContentText:() => ''}; }
      return {getContentText:() => JSON.stringify({files:[
        {id:'old1',mimeType:'application/json',appProperties:props('recovery_old')},
        {id:'future1',mimeType:'application/json',appProperties:Object.assign(props('recovery_future'),{expiresAt:'2999-01-01T00:00:00.000Z'})},
        {id:'liveDb',mimeType:'application/json',appProperties:props('recovery_live')}
      ]})};
    };
    recoveryFileMetadata_ = id => ({mimeType:'application/json',owners:[{emailAddress:'owner@gmail.com'}],
      appProperties:props(id === 'old1' ? 'recovery_old' : 'recovery_live')});
    updateRecoveryStatus_ = () => {};
    globalThis.__cleanup = cleanupRecoveryCopies_();
  `, context);
  assert.equal(context.__cleanup.deleted, 1);
  assert.equal(context.__deleted.length, 1);
  assert.match(context.__deleted[0], /old1$/);
});
