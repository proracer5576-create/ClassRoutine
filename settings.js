const CR = window.ClassRoutine;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const COLORS = { green: "#2f7666", orange: "#ee6539", blue: "#4d7ea8", yellow: "#d3a61d" };
const DAY_LABELS = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };
let settings = CR.getSettings();
let subjects = CR.getSubjects();
let routines = CR.getRoutines();
let preview = [];
let timetable = {};
let weeklyTimetables = CR.getWeeklyTimetables();
let selectedWeek = CR.weekStartKey();
let timetableCsvHandle = null;
let timetableFolderStorage = false;
let soundTestTimer = null;
let pendingTimetableImport = null;

function toast(message) {
  const element = $("#settingsToast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2500);
}

function fillBaseSettings() {
  $(`input[name=schoolLevel][value=${settings.schoolLevel}]`).checked = true;
  $("#classNameSetting").value = settings.className;
  $("#greetingSetting").value = settings.greeting;
  $("#classMinutes").value = settings.classMinutes;
  $("#breakMinutes").value = settings.breakMinutes;
  $("#defaultPreAlert").value = settings.defaultPreAlert;
  $("#breakCommonMessage").value = settings.commonMessages.break;
  $("#middlePlayCommonMessage").value = settings.commonMessages.middlePlay;
  $("#lunchCommonMessage").value = settings.commonMessages.lunch;
  $$("#activeDayOptions input").forEach(input => input.checked = settings.activeDays.includes(Number(input.value)));
  $("#firstStart").value = settings.firstStart;
  $("#periodCount").innerHTML = Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">${index + 1}교시</option>`).join("");
  $("#periodCount").value = settings.periodCount;
  $("#middleEnabled").checked = settings.middlePlay.enabled;
  $("#middleDuration").value = [20, 30].includes(Number(settings.middlePlay.duration)) ? String(settings.middlePlay.duration) : "custom";
  $("#middleCustom").value = settings.middlePlay.duration;
  $("#middleCustomWrap").hidden = $("#middleDuration").value !== "custom";
  $("#lunchEnabled").checked = settings.lunch.enabled;
  $("#lunchAfter").value = settings.lunch.afterPeriod;
  $("#lunchDuration").value = settings.lunch.duration;
  $("#soundSetting").checked = settings.sound;
  $("#windowsNotificationSetting").checked = Boolean(settings.windowsNotification);
  selectGlobalSound(settings.globalSound || "chime", { saved: true });
  $("#soundVolume").value = settings.soundVolume ?? 100;
  $("#soundVolumeValue").value = `${$("#soundVolume").value}%`;
  $("#motionSetting").checked = settings.reducedMotion;
  $("#alertSeconds").value = settings.alertDisplaySeconds;
}

function collectBaseSettings() {
  const level = $("input[name=schoolLevel]:checked").value;
  return {
    ...settings,
    schoolLevel: level,
    className: $("#classNameSetting").value.trim() || "선생님",
    greeting: $("#greetingSetting").value.trim() || "오늘도 좋은 하루 보내세요.",
    classMinutes: Math.max(10, Number($("#classMinutes").value) || 40),
    breakMinutes: Math.max(1, Number($("#breakMinutes").value) || 10),
    defaultPreAlert: Math.max(0, Number($("#defaultPreAlert").value) || 0),
    commonMessages: {
      break: $("#breakCommonMessage").value.trim(),
      middlePlay: $("#middlePlayCommonMessage").value.trim(),
      lunch: $("#lunchCommonMessage").value.trim()
    },
    activeDays: $$("#activeDayOptions input:checked").map(input => Number(input.value)),
    firstStart: $("#firstStart").value || "09:00",
    periodCount: Number($("#periodCount").value),
    middlePlay: {
      enabled: $("#middleEnabled").checked,
      afterPeriod: 2,
      duration: $("#middleDuration").value === "custom" ? Math.max(1, Number($("#middleCustom").value) || 20) : Number($("#middleDuration").value)
    },
    lunch: {
      enabled: $("#lunchEnabled").checked,
      afterPeriod: Number($("#lunchAfter").value),
      duration: Math.max(10, Number($("#lunchDuration").value) || 50)
    }
  };
}

function renderSubjects() {
  $("#subjectGrid").innerHTML = subjects.map(subject => `
    <article class="subject-card ${subject.enabled ? "" : "disabled"}" style="--subject-color:${COLORS[subject.color] || COLORS.green}" data-id="${subject.id}">
      <header><h3>${escapeHtml(subject.name)}</h3><button type="button" aria-label="${escapeHtml(subject.name)} 수정">•••</button></header>
      <p>${escapeHtml(subject.defaultMessage || "기본 안내 메시지가 없습니다.")}</p>
      <small>${subject.enabled ? "사용 중" : "사용 안 함"} · ${CR.normalizeResourceUrl(subject.resourceUrl) ? "기본 수업 링크 있음" : "수업 링크 없음"} · 공통 알림음 적용</small>
    </article>`).join("");
}

function renderRoutines() {
  routines = CR.getRoutines();
  const typeName = { class: "수업", break: "쉬는 시간", other: "기타" };
  const visible = routines.filter(routine => !routine.generated || routine.weekStart === selectedWeek || (!routine.weekStart && selectedWeek === CR.weekStartKey()));
  $("#settingsRoutineList").innerHTML = visible.length ? visible.map(routine => {
    const subject = CR.subjectFor(routine, subjects);
    const effectiveMessage = CR.messagesFor(routine).event || routine.category;
    return `<article class="settings-routine" data-id="${routine.id}">
      <time>${routine.startTime}</time><span class="type-pill">${typeName[routine.type]}</span>
      <div><h3>${escapeHtml(subject?.name ? `${subject.name} · ${routine.title}` : routine.title)}</h3><p>${escapeHtml(effectiveMessage)}</p></div>
      <span class="duration">${CR.durationFor(routine, settings)}분<br>${routine.durationMode === "custom" ? "개별 설정" : "기본값"}</span>
      <button type="button" aria-label="일정 수정">•••</button>
    </article>`;
  }).join("") : `<div class="preview-empty"><span>✎</span><p>선택한 주에 등록된 일정이 없습니다.</p></div>`;
}

function soundLabel(value) { return ({ chime: "맑은 종", wood: "나무 블록", sparkle: "반짝임", none: "소리 없음" })[value] || value; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function formatDataBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDataTime(value) {
  if (!value) return "저장 시각 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "저장 시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function renderDataCounts() {
  const currentRecords = CR.getRecords(), today = CR.dateKey(), dutyBoard = CR.getDutyBoard();
  $("#dataRoutineCount").textContent = CR.getRoutines().length;
  $("#dataRecordCount").textContent = currentRecords.length;
  $("#dataTodayRecords").textContent = currentRecords.filter(item => item.date === today && item.status === "완료").length;
  $("#dataWeekCount").textContent = Object.keys(CR.getWeeklyTimetables()).length;
  $("#dataRosterCount").textContent = CR.load(CR.KEYS.roster, []).length;
  $("#dataDutyCount").textContent = (dutyBoard.roles || []).length;
}

async function refreshDataCenter({ announce = false } = {}) {
  renderDataCounts();
  const badge = $("#dataConnectionBadge");
  badge.className = "data-connection-badge checking";
  badge.innerHTML = "<i></i> 확인 중";
  try {
    const response = await fetch("/api/storage-info", { cache: "no-store" });
    if (!response.ok) throw new Error("storage unavailable");
    const info = await response.json();
    $("#dataDirectoryPath").textContent = info.dataDirectory;
    $("#dataConnectionMode").textContent = window.classRoutineDesktop?.isDesktop ? "Windows 설치 앱 · 자동 연결" : "웹 개발 서버 · 자동 연결";
    $("#openDataFolder").textContent = window.classRoutineDesktop?.isDesktop ? "데이터 폴더 열기" : "폴더 경로 복사";
    $("#openDataFolder").disabled = false;
    badge.className = "data-connection-badge connected";
    badge.innerHTML = "<i></i> 자동 연결됨";
    const modified = [];
    $$("[data-storage-file]").forEach(card => {
      const state = info.status?.[card.dataset.storageFile];
      card.classList.toggle("available", Boolean(state?.exists));
      card.classList.toggle("missing", !state?.exists);
      card.querySelector(":scope > span").textContent = state?.exists ? `저장됨 · ${formatDataBytes(state.bytes)}` : "아직 생성되지 않음";
      if (state?.modifiedAt) modified.push(state.modifiedAt);
    });
    const latest = modified.sort().at(-1);
    $("#dataLastSaved").textContent = latest ? `최근 저장 · ${formatDataTime(latest)}` : "저장된 파일이 아직 없습니다.";
    if (announce) toast("문서 데이터 폴더 상태를 다시 확인했어요.");
    return info;
  } catch {
    badge.className = "data-connection-badge disconnected";
    badge.innerHTML = "<i></i> 연결 확인 필요";
    $("#dataConnectionMode").textContent = "직접 HTML 실행 또는 서버 연결 안 됨";
    $("#dataDirectoryPath").textContent = "설치 앱이나 개발 서버로 열면 자동 연결됩니다.";
    $("#openDataFolder").textContent = "데이터 폴더 열기";
    $("#openDataFolder").disabled = true;
    $$("[data-storage-file]").forEach(card => { card.classList.add("missing"); card.querySelector(":scope > span").textContent = "연결 후 확인"; });
    $("#dataLastSaved").textContent = "저장 서버에 연결되지 않았습니다.";
    if (announce) toast("데이터 폴더 연결을 확인해 주세요.");
    return null;
  }
}

function timetableFromRoutines() {
  const table = {};
  settings.activeDays.forEach(day => { table[day] = {}; });
  const currentWeek = CR.weekStartKey();
  routines.filter(routine => routine.type === "class" && routine.period && (routine.weekStart === selectedWeek || (!routine.weekStart && selectedWeek === currentWeek))).forEach(routine => {
    routine.activeDays.forEach(day => {
      table[day] ||= {};
      if (!table[day][routine.period] && routine.subjectId) table[day][routine.period] = routine.subjectId;
    });
  });
  return table;
}

function initialTimetable() {
  const archived = weeklyTimetables[selectedWeek]?.timetable;
  if (archived) return JSON.parse(JSON.stringify(archived));
  if (selectedWeek !== CR.weekStartKey()) return {};
  const saved = settings.timetable && Object.keys(settings.timetable).length ? settings.timetable : timetableFromRoutines();
  return JSON.parse(JSON.stringify(saved || {}));
}

function scheduleSnapshot(source = collectBaseSettings()) {
  return {
    activeDays: [...source.activeDays], firstStart: source.firstStart, periodCount: source.periodCount,
    classMinutes: source.classMinutes, breakMinutes: source.breakMinutes, defaultPreAlert: source.defaultPreAlert,
    middlePlay: { ...source.middlePlay }, lunch: { ...source.lunch }
  };
}

function applyScheduleSnapshot(snapshot = settings) {
  $("#classMinutes").value = snapshot.classMinutes ?? settings.classMinutes;
  $("#breakMinutes").value = snapshot.breakMinutes ?? settings.breakMinutes;
  $("#defaultPreAlert").value = snapshot.defaultPreAlert ?? settings.defaultPreAlert;
  $$("#activeDayOptions input").forEach(input => input.checked = (snapshot.activeDays || settings.activeDays).includes(Number(input.value)));
  $("#firstStart").value = snapshot.firstStart || settings.firstStart;
  $("#periodCount").value = snapshot.periodCount || settings.periodCount;
  const middle = snapshot.middlePlay || settings.middlePlay;
  $("#middleEnabled").checked = middle.enabled;
  $("#middleDuration").value = [20, 30].includes(Number(middle.duration)) ? String(middle.duration) : "custom";
  $("#middleCustom").value = middle.duration;
  $("#middleCustomWrap").hidden = $("#middleDuration").value !== "custom";
  const lunch = snapshot.lunch || settings.lunch;
  $("#lunchEnabled").checked = lunch.enabled;
  $("#lunchAfter").value = lunch.afterPeriod;
  $("#lunchDuration").value = lunch.duration;
}

function renderWeekIdentity() {
  const info = CR.weekInfo(selectedWeek), current = selectedWeek === CR.weekStartKey(), saved = weeklyTimetables[selectedWeek];
  $("#weekDate").value = selectedWeek;
  $("#weekLabel").textContent = `${info.year}년 ${info.month}월 ${info.monthWeek}주차`;
  $("#weekRange").textContent = `${info.start.replaceAll("-", ".")} — ${info.end.replaceAll("-", ".")} · 연간 ${info.isoWeek}주`;
  $("#weekCurrentBadge").textContent = current ? "이번 주" : selectedWeek < CR.weekStartKey() ? "지난 주간" : "다가오는 주간";
  $("#weekCurrentBadge").classList.toggle("not-current", !current);
  $("#weekSavedState").textContent = saved ? "저장된 주간 시간표" : "아직 저장되지 않은 주";
  $("#weekSavedDetail").textContent = saved ? `${new Date(saved.savedAt).toLocaleString("ko-KR")} 저장 · ${Object.values(saved.timetable || {}).reduce((sum, day) => sum + Object.values(day || {}).filter(Boolean).length, 0)}개 수업` : "적용하면 이 주의 시간표가 별도로 보관됩니다.";
  renderTimetableSaveTarget();
}

function weekOffset(weekStart, days) {
  const date = new Date(`${weekStart}T12:00:00`);
  date.setDate(date.getDate() + days);
  return CR.weekStartKey(date);
}

function weekShortLabel(weekStart) {
  const info = CR.weekInfo(weekStart);
  return `${info.start.slice(5).replace("-", ".")} — ${info.end.slice(5).replace("-", ".")}`;
}

function timetableSaveWeek() {
  return $("input[name=timetableSaveTarget]:checked")?.value === "next" ? weekOffset(selectedWeek, 7) : selectedWeek;
}

function renderTimetableSaveTarget() {
  const nextWeek = weekOffset(selectedWeek, 7), targetWeek = timetableSaveWeek();
  $("#selectedWeekSaveLabel").textContent = `${weekShortLabel(selectedWeek)} · ${selectedWeek === CR.weekStartKey() ? "이번 주" : "선택 주"}`;
  $("#nextWeekSaveLabel").textContent = `${weekShortLabel(nextWeek)} · 다음 주`;
  $("#applyTimetable").textContent = targetWeek === selectedWeek ? "선택한 주에 저장" : "다음 주로 저장";
}

function selectWeek(value) {
  selectedWeek = CR.weekStartKey(value);
  const selectedTarget = $("input[name=timetableSaveTarget][value=selected]");
  if (selectedTarget) selectedTarget.checked = true;
  const archived = weeklyTimetables[selectedWeek];
  applyScheduleSnapshot(archived?.schedule || settings);
  timetable = initialTimetable();
  renderWeekIdentity();
  renderTimetable();
  renderRoutines();
}

async function saveWeekArchive(draft, weekStart = selectedWeek, table = timetable) {
  const info = CR.weekInfo(weekStart);
  weeklyTimetables[weekStart] = { ...info, timetable: JSON.parse(JSON.stringify(table)), schedule: scheduleSnapshot(draft), savedAt: new Date().toISOString() };
  CR.setWeeklyTimetables(weeklyTimetables);
  if (weekStart === CR.weekStartKey()) settings.timetable = JSON.parse(JSON.stringify(table));
  renderWeekIdentity();
  await writeTimetableCsv();
}

function replaceGeneratedForWeek(generated, weekStart = selectedWeek) {
  const currentWeek = CR.weekStartKey();
  routines = [...routines.filter(item => !item.generated || (item.weekStart && item.weekStart !== weekStart) || (!item.weekStart && weekStart !== currentWeek)), ...generated];
  CR.setRoutines(routines);
}

function renderTimetable() {
  const draft = collectBaseSettings(), days = draft.activeDays, periodCount = draft.periodCount;
  if (!days.length) {
    $("#timetableGrid").innerHTML = `<div class="timetable-empty">운영 요일을 한 개 이상 선택해 주세요.</div>`;
    $("#timetableSummary").textContent = "운영 요일 없음";
    $("#applyTimetable").disabled = true;
    $("#timetableConflict").hidden = true;
    return;
  }
  const options = subjects.filter(subject => subject.enabled).map(subject => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`).join("");
  let html = `<div class="tt-corner"><span>교시</span><small>요일</small></div>` + days.map(day => `<div class="tt-day"><b>${DAY_LABELS[day]}요일</b><button type="button" data-clear-day="${day}" aria-label="${DAY_LABELS[day]}요일 비우기">비우기</button></div>`).join("");
  for (let period = 1; period <= periodCount; period++) {
    html += `<div class="tt-period"><strong>${period}</strong><small>${period}교시</small></div>`;
    days.forEach(day => {
      html += `<label class="tt-cell" data-day="${day}" data-period="${period}"><span>${period}교시 ${DAY_LABELS[day]}</span><select aria-label="${DAY_LABELS[day]}요일 ${period}교시 과목"><option value="">— 없음 —</option>${options}</select><i></i></label>`;
    });
  }
  $("#timetableGrid").style.setProperty("--day-count", days.length);
  $("#timetableGrid").innerHTML = html;
  $$(".tt-cell", $("#timetableGrid")).forEach(cell => {
    $("select", cell).value = timetable[cell.dataset.day]?.[cell.dataset.period] || "";
    styleTimetableCell(cell);
  });
  const assigned = $$(".tt-cell select", $("#timetableGrid")).filter(select => select.value).length;
  $("#timetableSummary").textContent = assigned ? `${days.length}일 · ${assigned}개 수업 배정` : "과목 배정 전";
  $("#applyTimetable").disabled = !assigned;
  renderTimetableConflict(draft, timetable, selectedWeek);
}

function styleTimetableCell(cell) {
  const subject = subjects.find(item => item.id === $("select", cell).value);
  cell.classList.toggle("filled", Boolean(subject));
  cell.style.setProperty("--cell-color", COLORS[subject?.color] || COLORS.green);
}

function collectTimetableGrid() {
  const next = {};
  $$(".tt-cell", $("#timetableGrid")).forEach(cell => {
    next[cell.dataset.day] ||= {};
    next[cell.dataset.day][cell.dataset.period] = $("select", cell).value;
  });
  return next;
}

function importedTimetableLessonCount(table) {
  return Object.values(table || {}).reduce((sum, day) => sum + Object.values(day || {}).filter(Boolean).length, 0);
}

function importedWeekLabel(weekStart, weekEnd) {
  return `${String(weekStart).replaceAll("-", ".")} — ${String(weekEnd).replaceAll("-", ".")}`;
}

function renderTimetableImport(file, imported) {
  const existingLessons = importedTimetableLessonCount(weeklyTimetables[imported.weekStart]?.timetable);
  const weekInfo = CR.weekInfo(imported.weekStart);
  const ignoredText = imported.ignored.length ? `휴일 표시 ${imported.ignored.length}칸 제외` : "휴일 표시 없음";
  $("#timetableImportSummary").innerHTML = `
    <article><span>저장 주차</span><b>${escapeHtml(`${weekInfo.year}년 ${weekInfo.month}월 ${weekInfo.monthWeek}주차`)}</b><small>${escapeHtml(importedWeekLabel(imported.weekStart, imported.weekEnd))}</small></article>
    <article><span>인식 결과</span><b>${imported.lessonCount}개 수업 · 최대 ${imported.maxPeriod}교시</b><small>${escapeHtml(imported.classLabel || file.name)} · ${escapeHtml(ignoredText)}</small></article>
    <article class="${existingLessons ? "warning" : ""}"><span>저장 상태</span><b>${existingLessons ? `${existingLessons}개 기존 수업 있음` : "새 주간 시간표"}</b><small>${existingLessons ? "저장하면 이 주의 기존 자동 생성 시간표를 바꿉니다." : "확인 후 이 주의 시간표로 바로 저장합니다."}</small></article>`;

  const previewDays = imported.columns.filter((item, index, list) => item.day >= 1 && item.day <= 5 && list.findIndex(other => other.day === item.day) === index);
  const head = previewDays.map(item => `<th>${DAY_LABELS[item.day]}요일<br><small>${escapeHtml(item.date.slice(5).replace("-", "."))}</small></th>`).join("");
  let rows = "";
  for (let period = 1; period <= imported.maxPeriod; period++) {
    rows += `<tr><th>${period}교시</th>${previewDays.map(({ day }) => {
      const name = imported.table[day]?.[period] || "";
      return `<td class="${name ? "" : "empty"}">${escapeHtml(name || "—")}</td>`;
    }).join("")}</tr>`;
  }
  $("#timetableImportPreview").innerHTML = `<table><thead><tr><th>교시</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;

  const subjectOptions = subjects.map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}${subject.enabled ? "" : " · 사용 안 함"}</option>`).join("");
  $("#timetableImportMappings").innerHTML = imported.subjects.map((name, index) => {
    const matched = SchoolTimetableImport.findSubject(name, subjects);
    return `<label class="timetable-import-map-row"><b title="${escapeHtml(name)}">${escapeHtml(name)}</b><i>→</i><select data-import-subject="${index}" aria-label="${escapeHtml(name)} 과목 연결"><option value="__new__">‘${escapeHtml(name)}’ 새 과목으로 추가</option>${subjectOptions}<option value="__skip__">가져오지 않음</option></select></label>`;
  }).join("");
  imported.subjects.forEach((name, index) => {
    const matched = SchoolTimetableImport.findSubject(name, subjects), select = $(`[data-import-subject="${index}"]`);
    select.value = matched?.id || "__new__";
  });
  $("#applySchoolTimetable").textContent = existingLessons ? "이 주 시간표 덮어쓰기" : "이 주 시간표로 저장";
}

async function previewSchoolTimetable(file) {
  const button = $("#importSchoolTimetable");
  button.disabled = true;
  button.textContent = "XLSX 읽는 중…";
  try {
    const imported = await SchoolTimetableImport.parseFile(file);
    pendingTimetableImport = { file, imported };
    renderTimetableImport(file, imported);
    $("#timetableImportDialog").showModal();
  } catch (error) {
    pendingTimetableImport = null;
    toast(error.message || "학사 시간표 파일을 읽지 못했어요.");
  } finally {
    button.disabled = false;
    button.textContent = "학사 시간표 XLSX 가져오기";
  }
}

async function applySchoolTimetable(event) {
  event.preventDefault();
  if (!pendingTimetableImport) return;
  const { imported } = pendingTimetableImport, targetWeek = imported.weekStart;
  const existingLessons = importedTimetableLessonCount(weeklyTimetables[targetWeek]?.timetable);
  if (existingLessons && !confirm(`${importedWeekLabel(targetWeek, imported.weekEnd)}에 이미 ${existingLessons}개 수업이 저장되어 있습니다.\n학사 시간표 내용으로 덮어쓸까요?\n직접 추가한 일정은 유지됩니다.`)) return;

  const subjectIds = new Map(), newSubjects = [];
  imported.subjects.forEach((name, index) => {
    const value = $(`[data-import-subject="${index}"]`).value;
    if (value === "__skip__") return;
    if (value !== "__new__") { subjectIds.set(name, value); return; }
    const existing = SchoolTimetableImport.findSubject(name, [...subjects, ...newSubjects]);
    if (existing) { subjectIds.set(name, existing.id); return; }
    const created = { id: CR.uid(), name: name.slice(0, 20), defaultMessage: `${name} 수업을 준비해요.`.slice(0, 160), color: ["green", "orange", "blue", "yellow"][(subjects.length + newSubjects.length) % 4], enabled: true, builtin: false };
    newSubjects.push(created);
    subjectIds.set(name, created.id);
  });
  if (newSubjects.length) {
    subjects = [...subjects, ...newSubjects];
    CR.setSubjects(subjects);
  }

  const table = {};
  Object.entries(imported.table).forEach(([day, periods]) => {
    Object.entries(periods || {}).forEach(([period, name]) => {
      const subjectId = subjectIds.get(name);
      if (!subjectId) return;
      table[day] ||= {};
      table[day][period] = subjectId;
    });
  });
  const lessonCount = importedTimetableLessonCount(table);
  if (!lessonCount) return toast("가져올 과목을 한 개 이상 연결해 주세요.");
  const activeDays = Object.keys(table).map(Number).filter(day => Object.values(table[day] || {}).some(Boolean)).sort((a, b) => a - b);
  const periodCount = Math.max(...Object.values(table).flatMap(day => Object.keys(day || {}).map(Number)), 1);
  const draft = { ...collectBaseSettings(), activeDays, periodCount, timetable: table };
  const generated = buildTimetableRoutines(draft, table, targetWeek);
  if (!generated.some(item => item.type === "class")) return toast("시간표에서 수업 일정을 만들지 못했어요.");
  if (targetWeek === CR.weekStartKey()) { settings = draft; CR.setSettings(settings); }
  replaceGeneratedForWeek(generated, targetWeek);
  await saveWeekArchive(draft, targetWeek, table);
  $("#timetableImportDialog").close();
  pendingTimetableImport = null;
  $("#schoolTimetableFile").value = "";
  renderSubjects();
  selectWeek(targetWeek);
  toast(`${importedWeekLabel(targetWeek, imported.weekEnd)} 시간표 ${lessonCount}개 수업을 저장했어요.`);
}

function buildTimetableRoutines(draft, table, weekStart = selectedWeek) {
  const skeleton = CR.generateSchedule(draft, subjects), merged = new Map();
  const add = (source, day, changes = {}) => {
    const routine = CR.normalizeRoutine({ ...source, durationMode: "custom", duration: CR.durationFor(source, draft), ...changes, id: CR.uid(), activeDays: [Number(day)], generated: true, weekStart }, draft);
    const key = [routine.type, routine.startTime, routine.period || "", routine.subjectId, routine.category, routine.durationMode, routine.duration].join("|");
    if (merged.has(key)) merged.get(key).activeDays.push(Number(day));
    else merged.set(key, routine);
  };
  draft.activeDays.forEach(day => {
    const filled = Array.from({ length: draft.periodCount }, (_, index) => index + 1).filter(period => table[day]?.[period]);
    let previousPeriod = 0;
    skeleton.forEach(row => {
      if (row.type === "class") {
        previousPeriod = row.period;
        const subjectId = table[day]?.[row.period];
        if (!subjectId) return;
        const subject = subjects.find(item => item.id === subjectId);
        add(row, day, { subjectId, title: `${row.period}교시`, color: subject?.color || row.color, sound: subject?.sound || row.sound });
        return;
      }
      const hasThisClass = filled.includes(previousPeriod);
      const hasLaterClass = filled.some(period => period > previousPeriod);
      const isSpecial = row.category !== "쉬는 시간";
      if (hasThisClass && (hasLaterClass || isSpecial)) add(row, day);
    });
  });
  return [...merged.values()].map(routine => ({ ...routine, activeDays: [...new Set(routine.activeDays)].sort((a, b) => a - b) }));
}

function timetableConflicts(draft, table, weekStart = selectedWeek) {
  const generated = buildTimetableRoutines(draft, table, weekStart);
  return draft.activeDays.flatMap(day => {
    const filled = Object.entries(table[day] || {}).filter(([, subjectId]) => subjectId).map(([period]) => Number(period));
    const lastPeriod = filled.length ? Math.max(...filled) : 0;
    const dismissalTime = { 5: "13:50", 6: "14:40" }[lastPeriod];
    if (!dismissalTime) return [];
    const dismissal = CR.normalizeRoutine({ id: `preview-dismissal-${day}`, startTime: dismissalTime, type: "other", category: "하교", title: "하교", durationMode: "custom", duration: 1, activeDays: [day], enabled: true, weekStart }, draft);
    const date = new Date(`${weekStart}T12:00:00`);
    date.setDate(date.getDate() + (Number(day) + 6) % 7);
    return CR.dismissalConflicts([...generated, dismissal], date, draft).map(conflict => ({ ...conflict, day }));
  });
}

function renderTimetableConflict(draft, table, weekStart) {
  const conflicts = timetableConflicts(draft, table, weekStart), notice = $("#timetableConflict");
  notice.hidden = !conflicts.length;
  if (conflicts.length) {
    const first = conflicts[0];
    notice.textContent = `시간 확인: ${DAY_LABELS[first.day]}요일 ${first.dismissal.startTime} 하교가 ${first.overlap.startTime}–${CR.endTime(first.overlap, draft)} ${first.overlap.title} 중에 있습니다. ${conflicts.length > 1 ? `외 ${conflicts.length - 1}건. ` : ""}점심 길이나 일과 시간을 조정해 주세요.`;
  }
  return conflicts;
}

function renderPreview() {
  $("#applySchedule").disabled = !preview.length;
  renderTimetableConflict(collectBaseSettings(), timetable, selectedWeek);
  if (!preview.length) return;
  $("#schedulePreview").innerHTML = preview.map((routine, index) => {
    const isClass = routine.type === "class";
    return `<div class="preview-row" data-index="${index}"><time>${routine.startTime}</time><span class="kind">${isClass ? `${routine.period}교시` : escapeHtml(routine.category)}</span><strong>${isClass ? "과목은 주간 시간표에서 배정" : escapeHtml(routine.title)}</strong><span>${CR.durationFor(routine, collectBaseSettings())}분 · ${CR.endTime(routine, collectBaseSettings())}까지</span></div>`;
  }).join("");
}

function openSubject(subject = null) {
  $("#subjectForm").reset();
  $("#subjectId").value = subject?.id || "";
  $("#subjectDialogTitle").textContent = subject ? "과목 설정" : "새 과목 추가";
  $("#subjectName").value = subject?.name || "";
  $("#subjectMessage").value = subject?.defaultMessage || "";
  $("#subjectResourceUrl").value = subject?.resourceUrl || "";
  $(`input[name=subjectColor][value=${subject?.color || "green"}]`).checked = true;
  $("#subjectEnabled").checked = subject?.enabled !== false;
  $("#deleteSubject").hidden = !subject;
  $("#subjectDialog").showModal();
}

function saveSubject(event) {
  event.preventDefault();
  const id = $("#subjectId").value;
  const rawUrl = $("#subjectResourceUrl").value.trim();
  if (rawUrl && !CR.normalizeResourceUrl(rawUrl)) return toast("수업 링크는 http 또는 https 주소로 입력해 주세요.");
  const subject = { id: id || CR.uid(), name: $("#subjectName").value.trim(), defaultMessage: $("#subjectMessage").value.trim(), resourceUrl: CR.normalizeResourceUrl(rawUrl), color: $("input[name=subjectColor]:checked").value, enabled: $("#subjectEnabled").checked, builtin: false };
  if (!subject.name) return;
  subjects = id ? subjects.map(item => item.id === id ? { ...item, ...subject } : item) : [...subjects, subject];
  CR.setSubjects(subjects); $("#subjectDialog").close(); renderSubjects(); renderTimetable(); toast("과목 설정을 저장했어요.");
}

function openRoutine(routine = null) {
  $("#routineSettingForm").reset();
  const value = routine || CR.normalizeRoutine({ id: "", startTime: "09:00", type: "other", title: "", category: "기타", durationMode: "custom", duration: 10, preAlertMode: "default", activeDays: settings.activeDays, enabled: true });
  $("#settingRoutineId").value = routine?.id || "";
  $("#routineSettingTitle").textContent = routine ? "일정 수정" : "개별 일정 추가";
  $("#settingRoutineType").value = value.type;
  $("#settingRoutineStart").value = value.startTime;
  $("#settingRoutineSubject").innerHTML = `<option value="">과목 미지정</option>` + subjects.filter(subject => subject.enabled).map(subject => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`).join("");
  $("#settingRoutineSubject").value = value.subjectId || "";
  $("#settingRoutineName").value = value.title;
  $("#settingRoutineCategory").value = value.category;
  $("#settingDurationMode").value = value.durationMode;
  $("#settingDuration").value = CR.durationFor(value, settings);
  $("#settingPreAlertMode").value = value.preAlertMode;
  $("#settingPreAlertMinutes").value = CR.preAlertFor(value, settings) ?? settings.defaultPreAlert;
  $("#settingRoutineMessage").value = value.eventMessage;
  $("#settingRoutineResourceUrl").value = value.resourceUrl || "";
  $(`input[name=settingRoutineColor][value=${value.color}]`).checked = true;
  $$("#settingRoutineDays input").forEach(input => input.checked = value.activeDays.includes(Number(input.value)));
  $("#settingRoutineEnabled").checked = value.enabled;
  $("#deleteSettingRoutine").hidden = !routine;
  updateRoutineFields(); $("#routineSettingDialog").showModal();
}

function updateRoutineFields() {
  const type = $("#settingRoutineType").value;
  $("#settingSubjectWrap").hidden = type !== "class";
  $("#settingDuration").disabled = $("#settingDurationMode").value === "default";
  if ($("#settingDuration").disabled) $("#settingDuration").value = type === "class" ? settings.classMinutes : type === "break" ? settings.breakMinutes : 10;
  $("#settingPreAlertMinutes").disabled = $("#settingPreAlertMode").value !== "custom";
  const start = CR.toMinutes($("#settingRoutineStart").value || "00:00"), duration = Number($("#settingDuration").value) || 0;
  $("#settingEndTime").textContent = `${CR.fromMinutes(start + duration)} 종료`;
}

function saveRoutine(event) {
  event.preventDefault();
  const id = $("#settingRoutineId").value, old = routines.find(item => item.id === id);
  const type = $("#settingRoutineType").value;
  const rawUrl = $("#settingRoutineResourceUrl").value.trim();
  if (rawUrl && !CR.normalizeResourceUrl(rawUrl)) return toast("일정 링크는 http 또는 https 주소로 입력해 주세요.");
  const routine = CR.normalizeRoutine({ ...old, id: id || CR.uid(), startTime: $("#settingRoutineStart").value, type, subjectId: type === "class" ? $("#settingRoutineSubject").value : "", title: $("#settingRoutineName").value.trim(), category: $("#settingRoutineCategory").value.trim() || (type === "class" ? "수업" : type === "break" ? "쉬는 시간" : "기타"), durationMode: $("#settingDurationMode").value, duration: Number($("#settingDuration").value), preAlertMode: $("#settingPreAlertMode").value, preAlertMinutes: Number($("#settingPreAlertMinutes").value), eventMessage: $("#settingRoutineMessage").value.trim(), resourceUrl: CR.normalizeResourceUrl(rawUrl), color: $("input[name=settingRoutineColor]:checked").value, activeDays: $$("#settingRoutineDays input:checked").map(input => Number(input.value)), enabled: $("#settingRoutineEnabled").checked, generated: old?.generated || false });
  if (!routine.title || !routine.activeDays.length) return toast("일정 이름과 반복 요일을 확인해 주세요.");
  routines = id ? routines.map(item => item.id === id ? routine : item) : [...routines, routine];
  CR.setRoutines(routines); $("#routineSettingDialog").close(); renderRoutines(); toast("일정을 저장했어요.");
}

const weekCsvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
function timetableCsvText() {
  const header = ["구분","주시작일","주종료일","ISO연도","ISO주차","기준월","월주차","요일번호","요일","교시","과목ID","과목명","교시수","운영요일","1교시시작","수업분","쉬는분","기본사전알림","중간놀이사용","중간놀이분","점심사용","점심교시후","점심분","저장시각"];
  const rows = [header];
  Object.values(weeklyTimetables).sort((a, b) => a.start.localeCompare(b.start)).forEach(entry => {
    const info = CR.weekInfo(entry.start), schedule = entry.schedule || settings;
    const common = [entry.start, entry.end || info.end, info.isoYear, info.isoWeek, info.month, info.monthWeek];
    const structure = [schedule.periodCount, (schedule.activeDays || []).join("|"), schedule.firstStart, schedule.classMinutes, schedule.breakMinutes, schedule.defaultPreAlert, schedule.middlePlay?.enabled ? 1 : 0, schedule.middlePlay?.duration, schedule.lunch?.enabled ? 1 : 0, schedule.lunch?.afterPeriod, schedule.lunch?.duration, entry.savedAt];
    rows.push(["주차", ...common, "", "", "", "", "", ...structure]);
    Object.entries(entry.timetable || {}).forEach(([day, periods]) => Object.entries(periods || {}).forEach(([period, subjectId]) => {
      if (!subjectId) return;
      const subject = subjects.find(item => item.id === subjectId);
      rows.push(["수업", ...common, day, DAY_LABELS[day], period, subjectId, subject?.name || "", ...structure]);
    }));
  });
  return "\uFEFF" + rows.map(row => row.map(weekCsvCell).join(",")).join("\r\n");
}

function downloadTimetableCsv() {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([timetableCsvText()], { type: "text/csv;charset=utf-8" }));
  link.download = `주간시간표_이력_${CR.dateKey()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseWeekCsv(text) {
  const rows = [], row = []; let field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push([...row]); row.length = 0; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(values => values.some(Boolean));
}

function weeksFromCsv(text) {
  const rows = parseWeekCsv(text);
  if (rows.length < 2) return {};
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, "")), at = name => headers.indexOf(name), imported = {};
  rows.slice(1).forEach(row => {
    const start = row[at("주시작일")];
    if (!start) return;
    const info = CR.weekInfo(start), activeDays = String(row[at("운영요일")] || "1|2|3|4|5").split("|").map(Number).filter(Number.isFinite);
    const entry = imported[start] ||= {
      ...info, timetable: {}, savedAt: row[at("저장시각")] || new Date().toISOString(),
      schedule: {
        activeDays, firstStart: row[at("1교시시작")] || "09:00",
        classMinutes: Number(row[at("수업분")]) || settings.classMinutes,
        breakMinutes: Number(row[at("쉬는분")]) || settings.breakMinutes,
        defaultPreAlert: Number(row[at("기본사전알림")]) || 0,
        periodCount: Number(row[at("교시수")]) || 1,
        middlePlay: { enabled: row[at("중간놀이사용")] === "1", afterPeriod: 2, duration: Number(row[at("중간놀이분")]) || 20 },
        lunch: { enabled: row[at("점심사용")] === "1", afterPeriod: Number(row[at("점심교시후")]) || 4, duration: Number(row[at("점심분")]) || 50 }
      }
    };
    if (row[at("구분")] !== "수업") return;
    const day = Number(row[at("요일번호")]), period = Number(row[at("교시")]);
    let subjectId = row[at("과목ID")], subject = subjects.find(item => item.id === subjectId);
    if (!subject) { subject = subjects.find(item => item.name === row[at("과목명")]); subjectId = subject?.id || ""; }
    if (!subjectId || !Number.isFinite(day) || !period) return;
    entry.timetable[day] ||= {};
    entry.timetable[day][period] = subjectId;
    entry.schedule.periodCount = Math.max(entry.schedule.periodCount, period);
  });
  return imported;
}

function openTimetableHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ClassRoutineFiles", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("handles")) request.result.createObjectStore("handles"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function getTimetableHandle() {
  try { const db = await openTimetableHandleDb(); return await new Promise((resolve, reject) => { const request = db.transaction("handles", "readonly").objectStore("handles").get("timetable"); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); }); }
  catch { return null; }
}
async function saveTimetableHandle(handle) {
  const db = await openTimetableHandleDb();
  await new Promise((resolve, reject) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(handle, "timetable"); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
async function timetablePermitted(handle, ask = false, mode = "readwrite") {
  if (!handle) return false;
  if (await handle.queryPermission({ mode }) === "granted") return true;
  return ask && await handle.requestPermission({ mode }) === "granted";
}
function mergeTimetableCsvText(text) {
  const imported = weeksFromCsv(text);
  const accepted = [];
  Object.entries(imported).forEach(([key, entry]) => {
    const current = weeklyTimetables[key];
    if (!current || String(entry.savedAt) >= String(current.savedAt || "")) { weeklyTimetables[key] = entry; accepted.push(key); }
  });
  CR.setWeeklyTimetables(weeklyTimetables);
  const originalWeek = selectedWeek, currentWeek = CR.weekStartKey();
  accepted.forEach(key => {
    const entry = weeklyTimetables[key];
    if (!Object.values(entry.timetable || {}).some(day => Object.values(day || {}).some(Boolean))) return;
    selectedWeek = key;
    const draft = { ...settings, ...entry.schedule, timetable: entry.timetable, middlePlay: { ...settings.middlePlay, ...entry.schedule?.middlePlay }, lunch: { ...settings.lunch, ...entry.schedule?.lunch } };
    const generated = buildTimetableRoutines(draft, entry.timetable);
    routines = [...routines.filter(item => !item.generated || (item.weekStart && item.weekStart !== key) || (!item.weekStart && key !== currentWeek)), ...generated];
  });
  selectedWeek = originalWeek;
  CR.setRoutines(routines);
  selectWeek(selectedWeek);
}
async function importTimetableCsvHandle(handle) {
  const file = await handle.getFile();
  if (file.size) mergeTimetableCsvText(await file.text());
}
async function writeTimetableCsv() {
  try {
    const response = await fetch("/api/timetable-csv", { method: "PUT", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: timetableCsvText() });
    if (response.ok) {
      timetableFolderStorage = true;
      $("#timetableCsvStatus").textContent = "문서\\오늘도 차근차근\\주간시간표_이력.csv · 자동 보관 중";
      $("#timetableCsvStatus").className = "timetable-csv-status connected";
      return true;
    }
  } catch {}
  if (!timetableCsvHandle || !await timetablePermitted(timetableCsvHandle)) return false;
  try {
    const writable = await timetableCsvHandle.createWritable();
    await writable.write(timetableCsvText());
    await writable.close();
    $("#timetableCsvStatus").textContent = `${timetableCsvHandle.name} · 주간 저장 시 자동 기록 중`;
    $("#timetableCsvStatus").className = "timetable-csv-status connected";
    return true;
  } catch { $("#timetableCsvStatus").textContent = "시간표 CSV 저장 권한을 다시 확인해 주세요."; return false; }
}
async function restoreFolderTimetableCsv() {
  try {
    const response = await fetch("/api/timetable-csv", { cache: "no-store" });
    if (!response.ok) return false;
    timetableFolderStorage = true;
    const text = await response.text();
    if (text.trim()) mergeTimetableCsvText(text);
    await writeTimetableCsv();
    return true;
  } catch { return false; }
}
async function connectTimetableCsv() {
  if (await restoreFolderTimetableCsv()) { toast("공용 데이터 폴더의 시간표 CSV와 동기화했어요."); return; }
  if (!window.showSaveFilePicker) return downloadTimetableCsv();
  try {
    let handle = await getTimetableHandle();
    if (!handle || !await timetablePermitted(handle, true)) handle = await showSaveFilePicker({ suggestedName: "주간시간표_이력.csv", types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] });
    timetableCsvHandle = handle;
    await saveTimetableHandle(handle);
    await importTimetableCsvHandle(handle);
    await writeTimetableCsv();
    toast("시간표 CSV를 연결했어요.");
  } catch (error) { if (error.name !== "AbortError") toast("시간표 CSV 연결을 확인해 주세요."); }
}
async function restoreTimetableCsv() {
  if (await restoreFolderTimetableCsv()) return;
  timetableCsvHandle = await getTimetableHandle();
  if (!timetableCsvHandle || !await timetablePermitted(timetableCsvHandle, false, "read")) return;
  await importTimetableCsvHandle(timetableCsvHandle);
  $("#timetableCsvStatus").textContent = `${timetableCsvHandle.name} · 연결됨`;
  $("#timetableCsvStatus").className = "timetable-csv-status connected";
  if (await timetablePermitted(timetableCsvHandle, false, "readwrite")) await writeTimetableCsv();
}

$("#baseSettingsForm").addEventListener("submit", event => { event.preventDefault(); settings = { ...collectBaseSettings(), timetable }; CR.setSettings(settings); $("#baseSaveState").textContent = "저장됨"; setTimeout(() => $("#baseSaveState").textContent = "", 2000); renderRoutines(); renderTimetable(); toast("기본 설정을 저장했어요."); });
$$('input[name=schoolLevel]').forEach(input => input.addEventListener("change", () => { const preset = CR.SCHOOL_PRESETS[input.value]; $("#classMinutes").value = preset.classMinutes; $("#breakMinutes").value = preset.breakMinutes; $("#baseSaveState").textContent = `${preset.label} 기본값을 불러왔어요.`; }));
$("#middleDuration").addEventListener("change", () => $("#middleCustomWrap").hidden = $("#middleDuration").value !== "custom");
$("#generatePreview").addEventListener("click", () => { const draft = collectBaseSettings(); if (draft.middlePlay.enabled && draft.lunch.enabled && draft.middlePlay.afterPeriod === draft.lunch.afterPeriod) return toast("중간놀이와 점심시간 위치가 겹칩니다."); preview = CR.generateSchedule(draft, subjects); renderPreview(); toast("시간 구조 미리보기를 만들었어요."); });
$("#applySchedule").addEventListener("click", async () => {
  if (!preview.length) return;
  const draft = { ...collectBaseSettings(), timetable };
  if (selectedWeek === CR.weekStartKey()) { settings = draft; CR.setSettings(settings); }
  const hasAssignments = Object.values(timetable).some(day => Object.values(day || {}).some(Boolean));
  const generated = hasAssignments ? buildTimetableRoutines(draft, timetable) : preview.map(item => CR.normalizeRoutine({ ...item, durationMode: "custom", duration: CR.durationFor(item, draft), weekStart: selectedWeek }, draft));
  replaceGeneratedForWeek(generated);
  await saveWeekArchive(draft);
  preview = [];
  $("#applySchedule").disabled = true;
  $("#schedulePreview").innerHTML = `<div class="preview-empty"><span>✓</span><p>시간 구조를 저장했어요. 아래에서 요일별 과목을 배정해 주세요.</p></div>`;
  renderRoutines();
  renderTimetable();
  toast("시간 구조를 저장했어요.");
});
$("#timetableGrid").addEventListener("change", event => {
  const cell = event.target.closest(".tt-cell");
  if (!cell || event.target.tagName !== "SELECT") return;
  timetable[cell.dataset.day] ||= {};
  timetable[cell.dataset.day][cell.dataset.period] = event.target.value;
  renderTimetable();
});
$("#timetableGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-clear-day]");
  if (!button) return;
  timetable[button.dataset.clearDay] = {};
  renderTimetable();
});
$("#loadTimetable").addEventListener("click", () => { timetable = timetableFromRoutines(); renderTimetable(); toast("현재 수업 일정에서 과목을 불러왔어요."); });
$("#clearTimetable").addEventListener("click", () => { timetable = {}; renderTimetable(); toast("표를 비웠어요. 적용하기 전까지 기존 일정은 유지됩니다."); });
$("#importSchoolTimetable").addEventListener("click", () => { $("#schoolTimetableFile").value = ""; $("#schoolTimetableFile").click(); });
$("#schoolTimetableFile").addEventListener("change", event => { const file = event.target.files?.[0]; if (file) previewSchoolTimetable(file); });
$("#timetableImportForm").addEventListener("submit", applySchoolTimetable);
$$('input[name=timetableSaveTarget]').forEach(input => input.addEventListener("change", renderTimetableSaveTarget));
$("#applyTimetable").addEventListener("click", async () => {
  timetable = collectTimetableGrid();
  const draft = { ...collectBaseSettings(), timetable };
  const targetWeek = timetableSaveWeek(), targetInfo = CR.weekInfo(targetWeek), savingAhead = targetWeek !== selectedWeek;
  const generated = buildTimetableRoutines(draft, timetable, targetWeek);
  if (!generated.some(item => item.type === "class")) return toast("한 교시 이상 과목을 선택해 주세요.");
  const currentWeek = CR.weekStartKey();
  const count = routines.filter(item => item.generated && (item.weekStart === targetWeek || (!item.weekStart && targetWeek === currentWeek))).length;
  const existingLessons = Object.values(weeklyTimetables[targetWeek]?.timetable || {}).reduce((sum, day) => sum + Object.values(day || {}).filter(Boolean).length, 0);
  const targetLabel = `${targetInfo.start.slice(5).replace("-", ".")}~${targetInfo.end.slice(5).replace("-", ".")}`;
  const overwriteLine = existingLessons ? `\n이미 저장된 ${existingLessons}개 수업을 새 편집본으로 덮어씁니다.` : "";
  const conflictCount = timetableConflicts(draft, timetable, targetWeek).length;
  const conflictLine = conflictCount ? `\n주의: 하교와 수업·점심시간이 ${conflictCount}건 겹칩니다. 시간을 확인해 주세요.` : "";
  if (!confirm(`${savingAhead ? "수정한 시간표를 다음 주로 저장할까요?" : "선택한 주의 시간표를 저장할까요?"}\n저장 주간: ${targetLabel}${overwriteLine}${conflictLine}\n자동 생성 일정 ${count}개를 교체하고 직접 추가한 일정은 유지합니다.`)) return;
  if (targetWeek === currentWeek) { settings = draft; CR.setSettings(settings); }
  replaceGeneratedForWeek(generated, targetWeek);
  await saveWeekArchive(draft, targetWeek, timetable);
  if (savingAhead) selectWeek(targetWeek);
  else { renderRoutines(); renderTimetable(); }
  toast(savingAhead ? "수정한 시간표를 다음 주에 저장했어요." : "선택한 주의 시간표를 저장했어요.");
});
$("#periodCount").addEventListener("change", renderTimetable);
for (const id of ["firstStart", "classMinutes", "breakMinutes", "middleEnabled", "middleDuration", "middleCustom", "lunchEnabled", "lunchAfter", "lunchDuration"]) $("#" + id).addEventListener("change", renderTimetable);
$$("#activeDayOptions input").forEach(input => input.addEventListener("change", renderTimetable));
function moveSelectedWeek(days) { const date = new Date(`${selectedWeek}T12:00:00`); date.setDate(date.getDate() + days); selectWeek(date); }
$("#previousWeek").addEventListener("click", () => moveSelectedWeek(-7));
$("#nextWeek").addEventListener("click", () => moveSelectedWeek(7));
$("#goCurrentWeek").addEventListener("click", () => selectWeek(new Date()));
$("#weekDate").addEventListener("change", event => { if (event.target.value) selectWeek(event.target.value); });
$("#copyPreviousWeek").addEventListener("click", () => { const date = new Date(`${selectedWeek}T12:00:00`); date.setDate(date.getDate() - 7); const previousKey = CR.weekStartKey(date), previous = weeklyTimetables[previousKey]; if (!previous) return toast("바로 지난주에 저장된 시간표가 없어요."); timetable = JSON.parse(JSON.stringify(previous.timetable || {})); applyScheduleSnapshot(previous.schedule || settings); renderTimetable(); toast("지난주 시간표를 가져왔어요. 적용을 누르면 이번 주에 저장됩니다."); });
$("#connectTimetableCsv").addEventListener("click", connectTimetableCsv);
$("#downloadTimetableCsv").addEventListener("click", downloadTimetableCsv);
$("#addSubject").addEventListener("click", () => openSubject()); $("#subjectGrid").addEventListener("click", event => { const card = event.target.closest(".subject-card"); if (card) openSubject(subjects.find(item => item.id === card.dataset.id)); }); $("#subjectForm").addEventListener("submit", saveSubject);
$("#deleteSubject").addEventListener("click", () => { const id = $("#subjectId").value, subject = subjects.find(item => item.id === id); if (!subject || !confirm(`“${subject.name}” 과목을 삭제할까요?\n연결된 일정은 과목 미지정 상태가 됩니다.`)) return; subjects = subjects.filter(item => item.id !== id); CR.setSubjects(subjects); $("#subjectDialog").close(); renderSubjects(); renderTimetable(); toast("과목을 삭제했어요."); });
$("#addRoutineSetting").addEventListener("click", () => openRoutine()); $("#settingsRoutineList").addEventListener("click", event => { const row = event.target.closest(".settings-routine"); if (row) openRoutine(routines.find(item => item.id === row.dataset.id)); }); $("#routineSettingForm").addEventListener("submit", saveRoutine); $("#settingRoutineType").addEventListener("change", updateRoutineFields); $("#settingDurationMode").addEventListener("change", updateRoutineFields); $("#settingPreAlertMode").addEventListener("change", updateRoutineFields); $("#settingRoutineStart").addEventListener("input", updateRoutineFields); $("#settingDuration").addEventListener("input", updateRoutineFields);
$("#deleteSettingRoutine").addEventListener("click", () => { const id = $("#settingRoutineId").value, routine = routines.find(item => item.id === id); if (!routine || !confirm(`“${routine.title}” 일정을 삭제할까요?`)) return; routines = routines.filter(item => item.id !== id); CR.setRoutines(routines); $("#routineSettingDialog").close(); renderRoutines(); toast("일정을 삭제했어요."); });
$("#soundVolume").addEventListener("input", event => { $("#soundVolumeValue").value = `${event.target.value}%`; });
function selectGlobalSound(type, { saved = false } = {}) {
  const selected = ["chime", "wood", "sparkle"].includes(type) ? type : "chime";
  $("#globalSound").value = selected;
  $$('[data-test-sound]').forEach(button => {
    const active = button.dataset.testSound === selected;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#soundTestStatus").textContent = saved
    ? `${soundLabel(selected)} 사용 중 · 모든 일정에 적용됩니다.`
    : `${soundLabel(selected)} 선택 · ‘알림 설정 저장’을 누르면 모든 일정에 적용됩니다.`;
}
$$('[data-test-sound]').forEach(button => button.addEventListener("click", () => {
  selectGlobalSound(button.dataset.testSound);
  CR.activateSound();
  const played = CR.playSound(button.dataset.testSound, { force: true, volume: Number($("#soundVolume").value) });
  const timing = CR.soundTiming(button.dataset.testSound);
  $$('[data-test-sound]').forEach(item => item.classList.remove("playing"));
  button.classList.add("playing");
  clearTimeout(soundTestTimer);
  soundTestTimer = setTimeout(() => button.classList.remove("playing"), timing.totalSeconds * 1000);
  $("#soundTestStatus").textContent = played
    ? `${button.querySelector("b").textContent} 선택 · 저장 대기 · ${$("#soundVolume").value}% · 3회 반복 중 (약 ${Math.ceil(timing.totalSeconds)}초)`
    : "브라우저의 소리 권한과 스피커 연결을 확인해 주세요.";
}));
$("#saveAlertSettings").addEventListener("click", () => { settings = { ...collectBaseSettings(), sound: $("#soundSetting").checked, windowsNotification: $("#windowsNotificationSetting").checked, globalSound: $("#globalSound").value, soundVolume: Number($("#soundVolume").value), reducedMotion: $("#motionSetting").checked, alertDisplaySeconds: Number($("#alertSeconds").value) }; CR.setSettings(settings); window.classRoutineDesktop?.setWindowsNotification?.(settings.windowsNotification); selectGlobalSound(settings.globalSound, { saved: true }); document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion); toast(`${soundLabel(settings.globalSound)}을 모든 일정의 알림음으로 저장했어요.`); });
window.classRoutineDesktop?.onWindowsNotificationChanged?.(enabled => { settings = { ...CR.getSettings(), windowsNotification: Boolean(enabled) }; CR.setSettings(settings); $("#windowsNotificationSetting").checked = Boolean(enabled); });
function createFullBackup() {
  return { version: 4, exportedAt: new Date().toISOString(), settings: CR.getSettings(), subjects: CR.getSubjects(), routines: CR.getRoutines(), records: CR.getRecords(), handoffs: CR.getHandoffs(), memos: CR.load(CR.KEYS.memos, {}), roster: CR.load(CR.KEYS.roster, []), weeklyTimetables: CR.getWeeklyTimetables(), duties: CR.getDutyBoard(), seating: CR.getSeatBoard() };
}

function downloadBackupInBrowser(content, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function restoreFullBackupText(text) {
  try {
    const data = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    if (!data.settings || !Array.isArray(data.routines)) throw new Error("invalid backup");
    if (!confirm("현재 설정·일정·시간표와 저장 데이터를 백업 파일 내용으로 바꿀까요?")) return false;
    CR.setSettings(data.settings); CR.setSubjects(data.subjects || subjects); CR.setRoutines(data.routines);
    if (Array.isArray(data.records)) CR.setRecords(data.records);
    if (Array.isArray(data.handoffs)) CR.setHandoffs(data.handoffs);
    if (data.memos && typeof data.memos === "object") CR.save(CR.KEYS.memos, data.memos);
    if (Array.isArray(data.roster)) CR.save(CR.KEYS.roster, data.roster);
    if (data.weeklyTimetables && typeof data.weeklyTimetables === "object") CR.setWeeklyTimetables(data.weeklyTimetables);
    if (data.duties && typeof data.duties === "object") CR.setDutyBoard(data.duties);
    if (data.seating && typeof data.seating === "object") CR.setSeatBoard(data.seating);
    settings = CR.getSettings(); subjects = CR.getSubjects(); routines = CR.getRoutines(); timetable = initialTimetable();
    fillBaseSettings(); renderSubjects(); renderRoutines(); renderTimetable(); renderDataCounts();
    toast("전체 백업을 복원했어요.");
    return true;
  } catch {
    toast("올바른 교실 루틴 백업 파일이 아닙니다.");
    return false;
  }
}

$("#exportBackup").addEventListener("click", async () => {
  const fileName = `교실루틴_전체백업_${CR.dateKey()}.json`;
  const content = JSON.stringify(createFullBackup(), null, 2);
  if (window.classRoutineDesktop?.saveBackup) {
    try {
      const result = await window.classRoutineDesktop.saveBackup({ content, fileName });
      if (result?.canceled) return;
      toast(result?.ok ? "데이터 폴더에 전체 백업을 저장했어요." : "전체 백업을 저장하지 못했어요.");
    } catch { toast("전체 백업을 저장하지 못했어요."); }
    return;
  }
  downloadBackupInBrowser(content, fileName);
  toast("시간표·명렬표·1인 1역을 포함한 전체 백업을 저장했어요.");
});

$("#importBackupButton").addEventListener("click", async () => {
  if (window.classRoutineDesktop?.openBackup) {
    try {
      const result = await window.classRoutineDesktop.openBackup();
      if (result?.canceled) return;
      if (!result?.ok) return toast("백업 파일을 읽지 못했어요.");
      await restoreFullBackupText(result.content);
    } catch { toast("백업 파일을 읽지 못했어요."); }
    return;
  }
  $("#importBackup").click();
});

$("#importBackup").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (file) await restoreFullBackupText(await file.text());
  event.target.value = "";
});
$("#refreshDataStatus").addEventListener("click", () => refreshDataCenter({ announce: true }));
$("#openDataFolder").addEventListener("click", async () => {
  const directory = $("#dataDirectoryPath").textContent;
  if (window.classRoutineDesktop?.openDataFolder) {
    const result = await window.classRoutineDesktop.openDataFolder();
    toast(result?.ok ? "데이터 폴더를 열었어요." : "데이터 폴더를 열지 못했어요.");
    return;
  }
  try { await navigator.clipboard.writeText(directory); toast("데이터 폴더 경로를 복사했어요."); }
  catch { toast(`데이터 폴더: ${directory}`); }
});
$("#restoreFolderState").addEventListener("click", async event => {
  if (!confirm("문서 폴더의 전체 작업본으로 현재 화면 데이터를 다시 불러올까요?\n문서 폴더 파일 자체는 변경하지 않습니다.")) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.querySelector("span:last-of-type").textContent = "불러오는 중…";
  const result = await CR.restoreFolderState(true);
  if (!result.ok || !result.applied) {
    button.disabled = false;
    button.querySelector("span:last-of-type").textContent = "전체 작업본으로 복원";
    toast(result.ok ? "불러올 전체 작업본이 없습니다." : "문서 폴더 작업본을 읽지 못했어요.");
    return;
  }
  toast(`문서 폴더에서 ${result.keys.length}개 데이터 영역을 복원했어요.`);
  setTimeout(() => location.reload(), 700);
});

let integrationSettings = {};
function integrationPayload() {
  return {
    schoolName: $("#selectedSchoolName").dataset.value || "",
    neisOfficeCode: $("#neisOfficeCode").value,
    neisSchoolCode: $("#neisSchoolCode").value,
    neisApiKey: $("#neisApiKey").value,
    weatherNx: $("#weatherNx").value,
    weatherNy: $("#weatherNy").value,
    kmaApiKey: $("#kmaApiKey").value
  };
}
function renderSelectedSchool(value = {}) {
  const name = value.schoolName || "", officeCode = value.officeCode || value.neisOfficeCode || "", schoolCode = value.schoolCode || value.neisSchoolCode || "";
  $("#selectedSchoolName").dataset.value = name;
  $("#selectedSchoolName").textContent = name || "선택한 학교 없음";
  $("#selectedSchoolMeta").textContent = name ? [value.officeName, value.schoolType, value.address].filter(Boolean).join(" · ") || `${officeCode} · ${schoolCode}` : "검색 결과에서 학교를 선택해 주세요.";
  $("#selectedSchool").classList.toggle("ready", Boolean(name && officeCode && schoolCode));
}
function renderIntegrationSettings(value = {}) {
  integrationSettings = value;
  $("#neisSchoolSearch").value = value.schoolName || "";
  $("#neisOfficeCode").value = value.neisOfficeCode || "";
  $("#neisSchoolCode").value = value.neisSchoolCode || "";
  $("#weatherNx").value = value.weatherNx || "";
  $("#weatherNy").value = value.weatherNy || "";
  $("#neisApiKey").value = ""; $("#kmaApiKey").value = "";
  renderSelectedSchool(value);
  $("#neisKeyState").textContent = value.hasNeisApiKey ? "저장됨" : "미등록";
  $("#kmaKeyState").textContent = value.hasKmaApiKey ? "저장됨" : "미등록";
}
async function loadIntegrationSettings() {
  try {
    const response = await fetch("/api/integration-settings", { cache:"no-store" });
    if (!response.ok) throw new Error();
    renderIntegrationSettings(await response.json());
    $("#integrationStatus").textContent = "문서 폴더의 연동 설정을 불러왔어요.";
  } catch { $("#integrationStatus").textContent = "설치형 프로그램에서 연동 설정을 사용할 수 있어요."; }
}
function renderDailyPreview(data) {
  const meal = data?.meal || {}, weather = data?.weather || {}, roster = CR.load(CR.KEYS.roster, []), warnings = CR.mealWarnings(meal, roster);
  const mealHtml = meal.status === "ready" ? `<b>${escapeHtml(meal.mealName || "오늘 급식")}</b><br>${meal.dishes.map(dish => `${escapeHtml(dish.name)}${dish.allergenCodes.length ? ` <small>(${dish.allergenCodes.join("·")})</small>` : ""}`).join(" · ")}<br><strong>맞춤 주의 ${warnings.length}명</strong>${warnings.length ? `<details><summary>교사용 상세 보기</summary>${warnings.map(student => `<p>${escapeHtml(student.number)}번 ${escapeHtml(student.name)} — ${student.dishes.map(dish => `${escapeHtml(dish.name)}(${dish.matchedNames.join("·")})`).join(", ")}</p>`).join("")}</details>` : ""}` : escapeHtml(meal.message || "급식 설정을 확인해 주세요.");
  const weatherHtml = weather.status === "ready" ? `<b>${escapeHtml(weather.condition)} · ${weather.temperature ?? "-"}℃</b><br>강수 ${weather.precipitationProbability ?? "-"}% · 바람 ${weather.windSpeed ?? "-"}m/s<br><strong>${escapeHtml(weather.guidance?.label || "현장 확인")}</strong> ${escapeHtml(weather.guidance?.message || "")}` : escapeHtml(weather.message || "날씨 설정을 확인해 주세요.");
  $("#dailyPreview").innerHTML = `<div><span>급식</span><p>${mealHtml}</p></div><div><span>날씨</span><p>${weatherHtml}</p></div>`;
}
async function fetchDailyPreview(force = false) {
  const button = $("#testDailyInfo"); button.disabled = true; button.textContent = "불러오는 중…";
  try {
    const response = await fetch(`/api/daily-info${force ? "?refresh=1" : ""}`, { cache:"no-store" });
    if (!response.ok) throw new Error();
    renderDailyPreview(await response.json());
    $("#integrationStatus").textContent = "오늘 정보를 확인했어요.";
  } catch { $("#integrationStatus").textContent = "급식·날씨 정보를 불러오지 못했어요."; }
  finally { button.disabled = false; button.textContent = "오늘 정보 불러오기"; }
}
function renderAllergyEditor() {
  const roster = CR.load(CR.KEYS.roster, []), select = $("#allergyStudentSelect"), previous = select.value;
  select.innerHTML = roster.length ? `<option value="">학생 선택</option>${roster.map((student, index) => `<option value="${index}">${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</option>`).join("")}` : `<option value="">명렬표를 먼저 연결해 주세요</option>`;
  if (previous && roster[Number(previous)]) select.value = previous;
  $("#allergenOptions").innerHTML = Object.entries(CR.ALLERGENS).map(([code, name]) => `<label><input type="checkbox" value="${code}" disabled><span><i>${code}</i><b>${escapeHtml(name)}</b></span></label>`).join("");
  syncAllergySelection();
}
function syncAllergySelection() {
  const roster = CR.load(CR.KEYS.roster, []), index = $("#allergyStudentSelect").value, student = index === "" ? null : roster[Number(index)], codes = CR.normalizeAllergenCodes(student?.allergenCodes);
  $$("#allergenOptions input").forEach(input => { input.disabled = !student; input.checked = codes.includes(input.value); });
  $("#studentEmail").disabled = !student;
  $("#studentGender").disabled = !student;
  $("#studentGender").value = student?.gender || "";
  $("#studentEmail").value = student?.email || "";
  $("#studentEmail").classList.remove("invalid");
  $("#studentEmailStatus").textContent = !student ? "학생을 선택하세요" : student.email ? "백업에 포함됨" : "미등록";
  $("#saveStudentAllergens").disabled = !student;
}
async function persistRosterFromSettings(roster) {
  const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\uFEFF" + [["번호","이름","성별","이메일","알레르기번호"], ...roster.map(student => [student.number, student.name, student.gender || "", student.email || "", CR.normalizeAllergenCodes(student.allergenCodes).join("|")])].map(row => row.map(csvCell).join(",")).join("\r\n");
  try { await fetch("/api/roster-csv", { method:"PUT", headers:{ "Content-Type":"text/csv; charset=utf-8" }, body:csv }); } catch {}
}
async function saveIntegrationSettings({ quiet = false } = {}) {
  const button = $("#saveIntegrationSettings"); button.disabled = true; button.textContent = "저장 중…";
  try {
    const response = await fetch("/api/integration-settings", { method:"PUT", headers:{ "Content-Type":"application/json; charset=utf-8" }, body:JSON.stringify(integrationPayload()) });
    if (!response.ok) throw new Error();
    const result = await response.json(); renderIntegrationSettings(result.settings); await refreshDataCenter();
    if (!quiet) { $("#integrationStatus").textContent = "연동 설정을 별도 파일에 저장했어요."; toast("급식·날씨 연동 설정을 저장했어요."); }
    return result.settings;
  } catch { $("#integrationStatus").textContent = "설치형 프로그램에서 저장해 주세요."; if (!quiet) toast("연동 설정을 저장하지 못했어요."); return null; }
  finally { button.disabled = false; button.textContent = "연동 설정 저장"; }
}
function chooseSchool(school) {
  $("#neisOfficeCode").value = school.officeCode;
  $("#neisSchoolCode").value = school.schoolCode;
  $("#neisSchoolSearch").value = school.schoolName;
  renderSelectedSchool(school);
  $("#schoolSearchResults").hidden = true;
  $("#schoolSearchStatus").textContent = `${school.schoolName}을(를) 선택했습니다. 연동 설정을 저장해 주세요.`;
}
function renderSchoolResults(schools) {
  const container = $("#schoolSearchResults");
  container.innerHTML = schools.map((school, index) => `<button class="school-result" type="button" data-school-index="${index}"><b>${escapeHtml(school.schoolName)}</b><em>${escapeHtml(school.schoolType || "학교")}</em><span>${escapeHtml([school.officeName, school.address].filter(Boolean).join(" · "))}</span></button>`).join("");
  $$('[data-school-index]', container).forEach(button => button.addEventListener("click", () => chooseSchool(schools[Number(button.dataset.schoolIndex)])));
  container.hidden = !schools.length;
}
async function findSchool() {
  const query = $("#neisSchoolSearch").value.trim(), button = $("#searchSchoolButton");
  if (query.length < 2) return $("#schoolSearchStatus").textContent = "학교 이름을 두 글자 이상 입력해 주세요.";
  button.disabled = true; button.textContent = "찾는 중…"; $("#schoolSearchStatus").textContent = "나이스 학교기본정보에서 찾고 있어요."; $("#schoolSearchResults").hidden = true;
  try {
    const saved = await saveIntegrationSettings({ quiet:true });
    $("#neisSchoolSearch").value = query;
    if (!saved?.hasNeisApiKey) throw new Error("나이스 API 인증키를 먼저 입력해 주세요.");
    const response = await fetch(`/api/school-search?q=${encodeURIComponent(query)}`, { cache:"no-store" });
    if (!response.ok) throw new Error("학교 검색 서비스에 연결하지 못했습니다.");
    const result = await response.json(), schools = Array.isArray(result.schools) ? result.schools : [];
    if (result.status !== "ready") throw new Error(result.message || "일치하는 학교가 없습니다.");
    if (schools.length === 1) chooseSchool(schools[0]);
    else { renderSchoolResults(schools); $("#schoolSearchStatus").textContent = `${schools.length}개 학교를 찾았습니다. 지역과 주소를 확인해 선택하세요.`; }
  } catch (error) { $("#schoolSearchStatus").textContent = error.message || "학교를 검색하지 못했습니다."; }
  finally { button.disabled = false; button.textContent = "학교 찾기"; }
}
$("#saveIntegrationSettings").addEventListener("click", () => saveIntegrationSettings());
$("#searchSchoolButton").addEventListener("click", findSchool);
$("#neisSchoolSearch").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); findSchool(); } });
$("#testDailyInfo").addEventListener("click", () => fetchDailyPreview(true));
$("#allergyStudentSelect").addEventListener("change", syncAllergySelection);
$("#saveStudentAllergens").addEventListener("click", async () => {
  const roster = CR.load(CR.KEYS.roster, []), index = $("#allergyStudentSelect").value;
  if (index === "" || !roster[Number(index)]) return toast("학생을 먼저 선택해 주세요.");
  const email = $("#studentEmail").value.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $("#studentEmail").classList.add("invalid");
    $("#studentEmailStatus").textContent = "형식 확인 필요";
    return toast("학생 이메일 형식을 확인해 주세요.");
  }
  roster[Number(index)] = { ...roster[Number(index)], gender:$("#studentGender").value, email, allergenCodes:$$("#allergenOptions input:checked").map(input => input.value) };
  CR.save(CR.KEYS.roster, roster); CR.notify("roster"); await persistRosterFromSettings(roster); renderDataCounts();
  syncAllergySelection();
  toast(`${roster[Number(index)].name} 학생의 성별·이메일·알레르기 정보를 저장했어요.`); fetchDailyPreview();
});
window.addEventListener("classroutinechange", event => { renderDataCounts(); if (event.detail?.scope === "roster") renderAllergyEditor(); });
$$('[data-close]').forEach(button => button.addEventListener("click", () => $("#" + button.dataset.close).close()));

$("#subjectMessage").closest("label").after($("#subjectResourceTemplate").content.firstElementChild.cloneNode(true));
$("#settingRoutineMessage").closest("label").after($("#settingRoutineResourceTemplate").content.firstElementChild.cloneNode(true));
$("#settingRoutineResourceUrl").closest("label").insertAdjacentHTML("afterend", '<fieldset><legend>표시 색상</legend><div class="colors"><input type="radio" name="settingRoutineColor" value="green" checked aria-label="초록"><input type="radio" name="settingRoutineColor" value="orange" aria-label="주황"><input type="radio" name="settingRoutineColor" value="blue" aria-label="파랑"><input type="radio" name="settingRoutineColor" value="yellow" aria-label="노랑"></div></fieldset>');

timetable = initialTimetable(); fillBaseSettings(); renderSubjects(); renderRoutines(); renderWeekIdentity(); renderTimetable(); renderAllergyEditor(); loadIntegrationSettings().then(() => fetchDailyPreview()); restoreTimetableCsv(); refreshDataCenter(); document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion);
