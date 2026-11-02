(function () {
  const KEYS = {
    routines: "classRoutine.routines.v3",
    legacyRoutines: "classRoutine.routines.v2",
    records: "classRoutine.records.v2",
    settings: "classRoutine.settings.v3",
    legacySettings: "classRoutine.settings.v2",
    subjects: "classRoutine.subjects.v1",
    handoffs: "classRoutine.handoffs.v1",
    memos: "classRoutine.memos.v2",
    roster: "classRoutine.roster.v1",
    weeklyTimetables: "classRoutine.weeklyTimetables.v1",
    duties: "classRoutine.duties.v1",
    seating: "classRoutine.seating.v1",
    quickTimer: "classRoutine.quickTimer.v1"
  };
  const STATE_META_KEY = "classRoutine.stateBackupAt.v1";
  const ALLERGENS = Object.freeze({
    "1":"난류", "2":"우유", "3":"메밀", "4":"땅콩", "5":"대두", "6":"밀",
    "7":"고등어", "8":"게", "9":"새우", "10":"돼지고기", "11":"복숭아",
    "12":"토마토", "13":"아황산류", "14":"호두", "15":"닭고기",
    "16":"쇠고기", "17":"오징어", "18":"조개류", "19":"잣"
  });
  const PERSISTED_KEYS = new Set([
    KEYS.routines, KEYS.records, KEYS.settings, KEYS.subjects, KEYS.handoffs,
    KEYS.memos, KEYS.roster, KEYS.weeklyTimetables, KEYS.duties, KEYS.seating
  ]);
  let stateBackupTimer = null;
  let stateBackupRunning = false;
  let stateBackupQueued = false;
  let stateBackupRetryTimer = null;

  function showBackupWarning(message) {
    if (typeof document === "undefined") return;
    const show = () => {
      let banner = document.getElementById("storageWarning");
      if (!banner) {
        banner = document.createElement("aside");
        banner.id = "storageWarning";
        banner.className = "storage-warning";
        banner.setAttribute("role", "alert");
        document.body.prepend(banner);
      }
      banner.textContent = message;
      banner.hidden = !message;
    };
    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show, { once: true });
  }

  function applyStateSnapshot(snapshot, force = false) {
    if (!snapshot?.storage || typeof snapshot.storage !== "object") return { applied: false, keys: [], savedAt: "" };
    const localHasData = [...PERSISTED_KEYS].some(key => localStorage.getItem(key) !== null);
    const localSavedAt = localStorage.getItem(STATE_META_KEY) || "";
    if (!force && localHasData && (!snapshot.savedAt || (localSavedAt && String(snapshot.savedAt) <= localSavedAt))) return { applied: false, keys: [], savedAt: String(snapshot.savedAt || "") };
    const keys = [];
    for (const [key, value] of Object.entries(snapshot.storage)) {
      if (PERSISTED_KEYS.has(key)) { localStorage.setItem(key, JSON.stringify(value)); keys.push(key); }
    }
    localStorage.setItem(STATE_META_KEY, String(snapshot.savedAt || new Date().toISOString()));
    return { applied: true, keys, savedAt: String(snapshot.savedAt || "") };
  }

  function applyFolderState() { return applyStateSnapshot(window.__CLASS_ROUTINE_BOOTSTRAP__).applied; }

  async function restoreFolderState(force = false) {
    if (!window.location || !/^https?:$/.test(window.location.protocol)) return { ok: false, reason: "server-unavailable" };
    try {
      const response = await fetch("/api/state-json", { cache: "no-store" });
      if (!response.ok) return { ok: false, reason: "read-failed" };
      const result = applyStateSnapshot(await response.json(), force);
      if (result.applied) notify("folderState");
      return { ok: true, ...result };
    } catch {
      return { ok: false, reason: "read-failed" };
    }
  }

  async function flushStateBackup() {
    if (stateBackupRunning) { stateBackupQueued = true; return; }
    stateBackupRunning = true;
    let conflicts = 0;
    try {
      do {
        stateBackupQueued = false;
        const storage = {};
        for (const key of PERSISTED_KEYS) {
          try { const raw = localStorage.getItem(key); if (raw !== null) storage[key] = JSON.parse(raw); }
          catch {}
        }
        const savedAt = new Date().toISOString();
        try {
          const response = await fetch("/api/state-json", { method: "PUT", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ version: 1, savedAt, storage }) });
          if (response.status === 409 && ++conflicts <= 5) {
            stateBackupQueued = true;
            await new Promise(resolve => setTimeout(resolve, 20));
          } else if (!response.ok) {
            showBackupWarning("전체 작업본 자동 저장에 실패했습니다. 데이터 폴더와 저장 상태를 확인해 주세요.");
            clearTimeout(stateBackupRetryTimer);
            stateBackupRetryTimer = setTimeout(scheduleStateBackup, 5000);
            break;
          } else {
            const previous = localStorage.getItem(STATE_META_KEY) || "";
            if (savedAt > previous) localStorage.setItem(STATE_META_KEY, savedAt);
            showBackupWarning("");
          }
        } catch {
          showBackupWarning("전체 작업본 자동 저장에 실패했습니다. 앱 연결 상태를 확인해 주세요.");
          clearTimeout(stateBackupRetryTimer);
          stateBackupRetryTimer = setTimeout(scheduleStateBackup, 5000);
          break;
        }
      } while (stateBackupQueued);
    } finally {
      stateBackupRunning = false;
    }
  }

  function scheduleStateBackup() {
    if (!window.location || !/^https?:$/.test(window.location.protocol)) return;
    clearTimeout(stateBackupTimer);
    clearTimeout(stateBackupRetryTimer);
    stateBackupTimer = setTimeout(flushStateBackup, 300);
  }

  const SCHOOL_PRESETS = {
    elementary: { label: "초등학교", classMinutes: 40, breakMinutes: 10 },
    middle: { label: "중학교", classMinutes: 45, breakMinutes: 10 },
    high: { label: "고등학교", classMinutes: 50, breakMinutes: 10 },
    custom: { label: "직접 설정", classMinutes: 40, breakMinutes: 10 }
  };

  const SUBJECT_NAMES = ["국어", "사회", "도덕", "수학", "과학", "체육", "음악", "미술", "영어", "자율", "자치", "동아리"];
  const SUBJECT_COLORS = ["green", "orange", "blue", "yellow"];
  const DEFAULT_SETTINGS = {
    schoolLevel: "elementary",
    classMinutes: 40,
    breakMinutes: 10,
    defaultPreAlert: 2,
    className: "선생님",
    greeting: "오늘도 좋은 하루 보내세요.",
    sound: true,
    windowsNotification: false,
    globalSound: "chime",
    soundVolume: 100,
    alertDisplaySeconds: 15,
    reducedMotion: false,
    activeDays: [1, 2, 3, 4, 5],
    firstStart: "09:00",
    periodCount: 6,
    timetable: {},
    commonMessages: {
      break: "물을 마시거나 화장실을 다녀온 뒤 다음 수업을 준비해요.",
      middlePlay: "안전하게 놀이하고 종이 울리기 전에 교실로 돌아와요.",
      lunch: "손을 깨끗이 씻고 질서를 지켜 맛있게 먹어요."
    },
    middlePlay: { enabled: true, afterPeriod: 2, duration: 20 },
    lunch: { enabled: true, afterPeriod: 4, duration: 50 }
  };

  applyFolderState();
  const clone = value => JSON.parse(JSON.stringify(value));
  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? clone(fallback); }
    catch { return clone(fallback); }
  };
  const save = (key, value) => { localStorage.setItem(key, JSON.stringify(value)); if (PERSISTED_KEYS.has(key)) scheduleStateBackup(); };
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const toMinutes = time => { const [h, m] = String(time || "00:00").split(":").map(Number); return h * 60 + m; };
  const fromMinutes = minutes => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const quickTimerRemaining = (timer, now = Date.now()) => timer?.endsAt ? Math.max(0, Math.ceil((Number(timer.endsAt) - Number(now)) / 1000)) : 0;
  const formatCountdown = seconds => { const safe = Math.max(0, Math.floor(Number(seconds) || 0)); return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`; };
  const normalizeAllergenCodes = value => {
    const values = Array.isArray(value) ? value : String(value || "").split(/[|,./\s]+/);
    return [...new Set(values.map(item => String(item).replace(/\D/g, "")).filter(code => ALLERGENS[code]))].sort((a, b) => Number(a) - Number(b));
  };
  const allergenNames = value => normalizeAllergenCodes(value).map(code => ALLERGENS[code]);
  const mealWarnings = (meal, students = []) => students.map(student => {
    const codes = normalizeAllergenCodes(student.allergenCodes), dishes = (meal?.dishes || []).filter(dish => (dish.allergenCodes || []).some(code => codes.includes(code))).map(dish => ({ name:dish.name, matchedCodes:dish.allergenCodes.filter(code => codes.includes(code)), matchedNames:allergenNames(dish.allergenCodes.filter(code => codes.includes(code))) }));
    return { ...student, allergenCodes:codes, allergenNames:allergenNames(codes), dishes };
  }).filter(student => student.dishes.length);
  const addDays = (key, amount) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + amount); return dateKey(d); };
  const weekStartKey = (value = new Date()) => {
    const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : new Date(value);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return dateKey(date);
  };
  const weekInfo = (value = new Date()) => {
    const start = weekStartKey(value), startDate = new Date(`${start}T12:00:00`), end = addDays(start, 6);
    const first = new Date(startDate.getFullYear(), startDate.getMonth(), 1, 12);
    const monthWeek = Math.ceil((startDate.getDate() + ((first.getDay() + 6) % 7)) / 7);
    const thursday = new Date(startDate); thursday.setDate(thursday.getDate() + 3);
    const isoYear = thursday.getFullYear(), yearStart = new Date(isoYear, 0, 4, 12);
    yearStart.setDate(yearStart.getDate() - ((yearStart.getDay() + 6) % 7));
    const isoWeek = Math.floor((thursday - yearStart) / 604800000) + 1;
    return { key: start, start, end, year: startDate.getFullYear(), month: startDate.getMonth() + 1, monthWeek, isoYear, isoWeek };
  };
  const mergeSettings = value => ({
    ...clone(DEFAULT_SETTINGS),
    ...(value || {}),
    commonMessages: { ...DEFAULT_SETTINGS.commonMessages, ...(value?.commonMessages || {}) },
    middlePlay: { ...DEFAULT_SETTINGS.middlePlay, ...(value?.middlePlay || {}) },
    lunch: { ...DEFAULT_SETTINGS.lunch, ...(value?.lunch || {}) }
  });

  function defaultSubjects() {
    return SUBJECT_NAMES.map((name, index) => ({
      id: `subject-${index + 1}`,
      name,
      defaultMessage: "",
      resourceUrl: "",
      color: SUBJECT_COLORS[index % SUBJECT_COLORS.length],
      sound: "chime",
      enabled: true,
      builtin: true
    }));
  }

  function mapType(category) {
    if (category === "수업") return "class";
    if (category === "쉬는 시간" || category === "중간놀이") return "break";
    return "other";
  }

  function normalizeRoutine(routine, settings = getSettings()) {
    const type = routine.type || mapType(routine.category);
    return {
      id: routine.id || uid(),
      startTime: routine.startTime || routine.time || "09:00",
      type,
      category: routine.category || (type === "class" ? "수업" : type === "break" ? "쉬는 시간" : "기타"),
      subjectId: routine.subjectId || "",
      title: routine.title || "이름 없는 일정",
      durationMode: routine.durationMode || "default",
      duration: Number(routine.duration) || (type === "class" ? settings.classMinutes : type === "break" ? settings.breakMinutes : 10),
      preAlertMode: isDismissalRoutine(routine) ? "off" : routine.preAlertMode || "default",
      preAlertMinutes: Number.isFinite(Number(routine.preAlertMinutes)) ? Number(routine.preAlertMinutes) : settings.defaultPreAlert,
      eventMessage: routine.eventMessage ?? routine.message ?? "",
      resourceUrl: routine.resourceUrl || "",
      sound: routine.sound || "chime",
      color: routine.color || "green",
      activeDays: Array.isArray(routine.activeDays) && routine.activeDays.length ? routine.activeDays : [1, 2, 3, 4, 5],
      enabled: routine.enabled !== false,
      generated: Boolean(routine.generated),
      period: Number(routine.period) || null,
      weekStart: routine.weekStart || ""
    };
  }

  function migrate() {
    if (!localStorage.getItem(KEYS.settings)) {
      save(KEYS.settings, mergeSettings(load(KEYS.legacySettings, DEFAULT_SETTINGS)));
    }
    const settings = getSettings();
    if (!localStorage.getItem(KEYS.subjects)) save(KEYS.subjects, defaultSubjects());
    if (!localStorage.getItem(KEYS.routines)) {
      const legacy = load(KEYS.legacyRoutines, []);
      save(KEYS.routines, legacy.map(item => normalizeRoutine(item, settings)));
    }
    if (!localStorage.getItem(KEYS.handoffs)) save(KEYS.handoffs, []);
    if (!localStorage.getItem(KEYS.weeklyTimetables)) {
      const timetable = settings.timetable || {};
      const weeks = Object.keys(timetable).length ? { [weekStartKey()]: { ...weekInfo(), timetable, savedAt: new Date().toISOString() } } : {};
      save(KEYS.weeklyTimetables, weeks);
    }
    ensureWeekRoutines();
    ensureMorningRoutines();
    ensureCleaningRoutine();
    ensureDismissalRoutine();
  }

  function getSettings() { return mergeSettings(load(KEYS.settings, DEFAULT_SETTINGS)); }
  function setSettings(settings) { save(KEYS.settings, mergeSettings(settings)); ensureDismissalRoutine(); notify("settings"); }
  function getSubjects() { return load(KEYS.subjects, defaultSubjects()); }
  function setSubjects(subjects) { save(KEYS.subjects, subjects); notify("subjects"); }
  function getRoutines() { return load(KEYS.routines, []).map(item => normalizeRoutine(item)).sort((a, b) => a.startTime.localeCompare(b.startTime)); }
  function setRoutines(routines) {
    const next = routines.map(item => normalizeRoutine(item));
    const builtinIds = ["builtin-morning-0840", "builtin-morning-break-0855", "builtin-cleaning-1340"];
    const previousIds = new Set(load(KEYS.routines, []).map(item => item.id));
    const nextIds = new Set(next.map(item => item.id));
    const removed = builtinIds.filter(id => previousIds.has(id) && !nextIds.has(id));
    if (removed.length) {
      const settings = getSettings();
      settings.suppressedBuiltinRoutines = [...new Set([...(settings.suppressedBuiltinRoutines || []), ...removed])];
      save(KEYS.settings, settings);
    }
    save(KEYS.routines, next);
    ensureDismissalRoutine();
    notify("routines");
  }
  function getRecords() { return load(KEYS.records, []); }
  function setRecords(records) { save(KEYS.records, records); notify("records"); }
  function getHandoffs() { return load(KEYS.handoffs, []); }
  function setHandoffs(handoffs) { save(KEYS.handoffs, handoffs); notify("handoffs"); }
  function getWeeklyTimetables() { return load(KEYS.weeklyTimetables, {}); }
  function setWeeklyTimetables(weeks) { save(KEYS.weeklyTimetables, weeks); ensureDismissalRoutine(); notify("weeklyTimetables"); }
  function getDutyBoard() { return load(KEYS.duties, { savedAt: "", term: "", roles: [], assignments: {} }); }
  function setDutyBoard(board) { save(KEYS.duties, board); notify("duties"); }
  function getSeatBoard() { return load(KEYS.seating, { savedAt: "", layout: {}, options: {}, genders: {}, sameGenderRows: [], current: null, history: [] }); }
  function setSeatBoard(board) { save(KEYS.seating, board); notify("seating"); }
  function isCleaningRoutine(routine) { return `${routine?.category || ""} ${routine?.title || ""}`.includes("청소"); }
  function isDismissalRoutine(routine) { return `${routine?.category || ""} ${routine?.title || ""}`.includes("하교"); }
  function dutyAssignments(board = getDutyBoard()) {
    const order = ["board", "rocket", "environment", "milk", "health", "clean-mon", "clean-tue", "clean-wed", "clean-thu", "clean-fri", "notice", "materials", "engineer", "windows"], rank = new Map(order.map((id, index) => [id, index]));
    return (board.roles || []).map((role, index) => ({
      ...role, _index: index,
      students: Array.from({ length: Math.max(1, Number(role.capacity) || 1) }, (_, slot) => {
        const key = board.assignments?.[role.id]?.[slot]; if (!key) return null;
        const [number, name] = String(key).split("\u241f"); return name ? { number, name } : null;
      })
    })).sort((a, b) => (rank.get(a.id) ?? 1000 + a._index) - (rank.get(b.id) ?? 1000 + b._index)).map(({ _index, ...role }) => role);
  }
  function dutyAssignmentsForDate(value = new Date(), board = getDutyBoard()) {
    const date = value instanceof Date ? value : new Date(value), weekday = date.getDay();
    const idDays = { mon:1, tue:2, wed:3, thu:4, fri:5 }, nameDays = { 월:1, 화:2, 수:3, 목:4, 금:5 };
    return dutyAssignments(board).filter(role => {
      if (!String(role.name || "").includes("크린토피아")) return true;
      const idMatch = String(role.id || "").match(/^clean-(mon|tue|wed|thu|fri)$/i);
      const nameMatch = String(role.name || "").match(/(?:^|[·\s])(월|화|수|목|금)(?:요일)?\s*$/);
      const roleWeekday = idMatch ? idDays[idMatch[1].toLowerCase()] : nameMatch ? nameDays[nameMatch[1]] : null;
      return roleWeekday === null || roleWeekday === weekday;
    });
  }
  function cleaningDutyAssignmentsForDate(value = new Date(), board = getDutyBoard()) {
    const roles = dutyAssignmentsForDate(value, board);
    const crintopia = roles.filter(role => String(role.name || "").includes("크린토피아"));
    const milk = roles.filter(role => String(role.id || "").toLowerCase() === "milk" || String(role.name || "").includes("우유"));
    return [...crintopia, ...milk.filter(role => !crintopia.some(item => item.id === role.id))];
  }
  function durationFor(routine, settings = getSettings()) {
    if (routine.durationMode === "custom") return Number(routine.duration) || 1;
    return routine.type === "class" ? settings.classMinutes : routine.type === "break" ? settings.breakMinutes : Number(routine.duration) || 10;
  }
  function preAlertFor(routine, settings = getSettings()) {
    if (isDismissalRoutine(routine)) return null;
    if (routine.preAlertMode === "off") return null;
    return routine.preAlertMode === "custom" ? Number(routine.preAlertMinutes) : settings.defaultPreAlert;
  }
  function dueAlarmPhase(routine, date = new Date(), alerted = [], settings = getSettings()) {
    const minute = date.getHours() * 60 + date.getMinutes();
    const start = toMinutes(routine.startTime);
    const startGrace = Math.min(2, durationFor(routine, settings));
    if (minute >= start && minute < start + startGrace && !alerted.includes(`${routine.id}:start`)) return "start";
    const pre = preAlertFor(routine, settings);
    if (pre > 0 && minute >= start - pre && minute < start && !alerted.includes(`${routine.id}:pre`)) return "pre";
    return null;
  }
  function endTime(routine, settings = getSettings()) { return fromMinutes(toMinutes(routine.startTime) + durationFor(routine, settings)); }
  function hasEnded(routine, date = new Date(), settings = getSettings()) { return date.getHours() * 60 + date.getMinutes() >= toMinutes(routine.startTime) + durationFor(routine, settings); }
  function activeOn(routine, date = new Date()) { return routine.enabled && (!routine.weekStart || routine.weekStart === weekStartKey(date)) && routine.activeDays.includes(date.getDay()); }
  function dismissalConflicts(items, date = new Date(), settings = getSettings()) {
    const active = items.filter(item => activeOn(item, date));
    return active.filter(isDismissalRoutine).flatMap(dismissal => {
      const dismissalAt = toMinutes(dismissal.startTime);
      return active.filter(item => item.id !== dismissal.id && (item.type === "class" || /점심|급식/.test(`${item.category} ${item.title}`)) && toMinutes(item.startTime) < dismissalAt && toMinutes(item.startTime) + durationFor(item, settings) > dismissalAt).map(overlap => ({ dismissal, overlap }));
    });
  }
  function primaryCurrentRoutine(items, date = new Date(), settings = getSettings()) {
    const minute = date.getHours() * 60 + date.getMinutes();
    return [...items].filter(routine => activeOn(routine, date) && toMinutes(routine.startTime) <= minute && minute < toMinutes(routine.startTime) + durationFor(routine, settings)).sort((a, b) => Number(isCleaningRoutine(b)) - Number(isCleaningRoutine(a)) || b.startTime.localeCompare(a.startTime))[0] || null;
  }
  function subjectFor(routine, subjects = getSubjects()) { return subjects.find(subject => subject.id === routine.subjectId) || null; }
  function normalizeResourceUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : "";
    } catch { return ""; }
  }
  function resourceUrlFor(routine, subjects = getSubjects()) {
    return normalizeResourceUrl(routine.resourceUrl || subjectFor(routine, subjects)?.resourceUrl || "");
  }
  function handoffFor(routineId, date = dateKey()) { return getHandoffs().find(item => item.targetRoutineId === routineId && item.targetDate === date && !item.archived) || null; }
  function commonMessageFor(routine, settings = getSettings()) {
    const messages = settings.commonMessages || DEFAULT_SETTINGS.commonMessages;
    if (routine.category === "급식" || routine.title === "점심시간") return messages.lunch || "";
    if (routine.category === "중간놀이" || routine.title === "중간놀이") return messages.middlePlay || "";
    if (routine.type === "break" || routine.category === "쉬는 시간") return messages.break || "";
    return "";
  }
  function messagesFor(routine, date = dateKey()) {
    const subject = subjectFor(routine);
    const handoff = handoffFor(routine.id, date);
    return {
      subject: subject?.defaultMessage || "",
      event: routine.eventMessage || commonMessageFor(routine),
      handoff: handoff?.studentNote || "",
      teacher: handoff?.teacherNote || ""
    };
  }

  let soundContext = null;
  let activeSoundNodes = [];
  let activeSoundOutput = null;
  let activeSoundTimer = null;
  const SOUND_LENGTH_MULTIPLIER = 3;
  const SOUND_REPEAT_COUNT = 3;
  const SOUND_PATTERNS = {
    chime: { wave: "sine", notes: [[523, 0], [659, .16], [784, .34]], level: .22, release: .7 },
    wood: { wave: "triangle", notes: [[240, 0], [180, .18]], level: .3, release: .22 },
    sparkle: { wave: "sine", notes: [[659, 0], [880, .12], [1047, .25], [1319, .39]], level: .22, release: .7 }
  };
  function activateSound() {
    try {
      soundContext ??= new (window.AudioContext || window.webkitAudioContext)();
      soundContext.resume();
      const gain = soundContext.createGain(), oscillator = soundContext.createOscillator();
      gain.gain.value = 0; oscillator.connect(gain).connect(soundContext.destination);
      oscillator.start(); oscillator.stop(soundContext.currentTime + .02);
      return true;
    } catch { return false; }
  }
  function soundTiming(type = "chime") {
    const pattern = SOUND_PATTERNS[type] || SOUND_PATTERNS.chime;
    const release = pattern.release * SOUND_LENGTH_MULTIPLIER;
    const audibleSeconds = Math.max(...pattern.notes.map(([, delay]) => delay + release));
    return {
      audibleSeconds,
      silenceSeconds: audibleSeconds,
      repeatCount: SOUND_REPEAT_COUNT,
      totalSeconds: audibleSeconds * (SOUND_REPEAT_COUNT * 2 - 1)
    };
  }
  function stopSound() {
    if (activeSoundTimer) clearTimeout(activeSoundTimer);
    activeSoundTimer = null;
    activeSoundNodes.forEach(node => { try { node.stop(); } catch {} });
    activeSoundNodes = [];
    try { activeSoundOutput?.disconnect(); } catch {}
    activeSoundOutput = null;
  }
  function effectiveSound(type = "chime", options = {}) {
    const settings = getSettings();
    return options.force ? type : (settings.globalSound || type || "chime");
  }
  function playSound(type = "chime", options = {}) {
    const settings = getSettings(), resolvedType = effectiveSound(type, options), pattern = SOUND_PATTERNS[resolvedType] || SOUND_PATTERNS.chime;
    if (resolvedType === "none" || (!options.force && !settings.sound)) return false;
    try {
      soundContext ??= new (window.AudioContext || window.webkitAudioContext)(); soundContext.resume();
      stopSound();
      const now = soundContext.currentTime, volume = Math.max(.5, Math.min(1.5, Number(options.volume ?? settings.soundVolume ?? 100) / 100));
      const timing = soundTiming(resolvedType), release = pattern.release * SOUND_LENGTH_MULTIPLIER, cycleSeconds = timing.audibleSeconds + timing.silenceSeconds;
      const output = soundContext.createDynamicsCompressor();
      output.threshold.value = -10; output.knee.value = 12; output.ratio.value = 4; output.attack.value = .003; output.release.value = .2; output.connect(soundContext.destination);
      activeSoundOutput = output;
      for (let repeat = 0; repeat < timing.repeatCount; repeat++) {
        const repeatOffset = repeat * cycleSeconds;
        pattern.notes.forEach(([frequency, delay]) => {
          const oscillator = soundContext.createOscillator(), gain = soundContext.createGain();
          oscillator.type = pattern.wave; oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(pattern.level * volume, now + repeatOffset + delay);
          gain.gain.exponentialRampToValueAtTime(.001, now + repeatOffset + delay + release);
          oscillator.connect(gain).connect(output); oscillator.start(now + repeatOffset + delay); oscillator.stop(now + repeatOffset + delay + release + .04);
          activeSoundNodes.push(oscillator);
        });
      }
      activeSoundTimer = setTimeout(stopSound, (timing.totalSeconds + .2) * 1000);
      return true;
    } catch { return false; }
  }

  function nextClassAfter(routineId, currentDate = dateKey()) {
    const routines = getRoutines();
    const current = routines.find(item => item.id === routineId);
    if (current) {
      const currentDay = new Date(`${currentDate}T12:00:00`);
      const sameDay = routines.find(item => item.type === "class" && item.startTime > current.startTime && activeOn(item, currentDay));
      if (sameDay) return { routine: sameDay, date: currentDate };
    }
    for (let offset = 1; offset <= 14; offset++) {
      const nextDate = addDays(currentDate, offset);
      const nextDay = new Date(`${nextDate}T12:00:00`);
      const first = routines.find(item => item.type === "class" && activeOn(item, nextDay));
      if (first) return { routine: first, date: nextDate };
    }
    return null;
  }

  function generateSchedule(options, subjects = getSubjects()) {
    const settings = mergeSettings(options);
    const rows = [];
    let cursor = toMinutes(settings.firstStart);
    for (let period = 1; period <= Math.max(1, Math.min(8, settings.periodCount)); period++) {
      const subject = subjects.find(item => item.enabled) || null;
      rows.push(normalizeRoutine({
        id: uid(), startTime: fromMinutes(cursor), type: "class", category: "수업",
        subjectId: "", title: `${period}교시`, durationMode: "default", duration: settings.classMinutes,
        preAlertMode: "default", preAlertMinutes: settings.defaultPreAlert,
        sound: subject?.sound || "chime", color: subject?.color || "green", generated: true, period
      }, settings));
      cursor += settings.classMinutes;
      if (settings.lunch.enabled && period === Number(settings.lunch.afterPeriod)) {
        rows.push(normalizeRoutine({ id: uid(), startTime: fromMinutes(cursor), type: "other", category: "급식", title: "점심시간", durationMode: "custom", duration: Number(settings.lunch.duration), preAlertMode: "off", color: "yellow", sound: "chime", generated: true }, settings));
        cursor += Number(settings.lunch.duration);
      } else if (settings.middlePlay.enabled && period === Number(settings.middlePlay.afterPeriod)) {
        rows.push(normalizeRoutine({ id: uid(), startTime: fromMinutes(cursor), type: "break", category: "중간놀이", title: "중간놀이", durationMode: "custom", duration: Number(settings.middlePlay.duration), preAlertMode: "off", color: "orange", sound: "wood", generated: true }, settings));
        cursor += Number(settings.middlePlay.duration);
      } else if (period !== settings.periodCount) {
        rows.push(normalizeRoutine({ id: uid(), startTime: fromMinutes(cursor), type: "break", category: "쉬는 시간", title: "쉬는 시간", durationMode: "default", duration: settings.breakMinutes, preAlertMode: "off", color: "blue", sound: "none", generated: true }, settings));
        cursor += settings.breakMinutes;
      }
    }
    return rows;
  }

  function materializeWeek(weekStart, entry) {
    const settings = mergeSettings({ ...getSettings(), ...(entry.schedule || {}) });
    const subjects = getSubjects(), skeleton = generateSchedule(settings, subjects), merged = new Map();
    const table = entry.timetable || {};
    const add = (source, day, changes = {}) => {
      const routine = normalizeRoutine({ ...source, durationMode: "custom", duration: durationFor(source, settings), ...changes, id: uid(), activeDays: [Number(day)], generated: true, weekStart }, settings);
      const key = [routine.type, routine.startTime, routine.period || "", routine.subjectId, routine.category, routine.duration].join("|");
      if (merged.has(key)) merged.get(key).activeDays.push(Number(day));
      else merged.set(key, routine);
    };
    settings.activeDays.forEach(day => {
      const filled = Array.from({ length: settings.periodCount }, (_, index) => index + 1).filter(period => table[day]?.[period]);
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
        const hasThisClass = filled.includes(previousPeriod), hasLaterClass = filled.some(period => period > previousPeriod), isSpecial = row.category !== "쉬는 시간";
        if (hasThisClass && (hasLaterClass || isSpecial)) add(row, day);
      });
    });
    return [...merged.values()].map(routine => ({ ...routine, activeDays: [...new Set(routine.activeDays)].sort((a, b) => a - b) }));
  }

  function ensureWeekRoutines(weekStart = weekStartKey()) {
    const routines = getRoutines();
    const hasCurrent = routines.some(item => item.generated && item.type === "class" && (item.weekStart === weekStart || (!item.weekStart && weekStart === weekStartKey())));
    if (hasCurrent) return false;
    const entry = getWeeklyTimetables()[weekStart];
    if (!entry || !Object.values(entry.timetable || {}).some(day => Object.values(day || {}).some(Boolean))) return false;
    const generated = materializeWeek(weekStart, entry);
    const currentWeek = weekStartKey();
    const next = [...routines.filter(item => !item.generated || (item.weekStart && item.weekStart !== weekStart) || (!item.weekStart && weekStart !== currentWeek)), ...generated];
    save(KEYS.routines, next.map(item => normalizeRoutine(item)));
    return true;
  }

  function ensureMorningRoutines() {
    const routines = getRoutines(), settings = getSettings();
    const definitions = [
      {
        id: "builtin-morning-0840", startTime: "08:40", type: "other", category: "아침활동", title: "아침활동",
        durationMode: "custom", duration: 15, preAlertMode: "default", preAlertMinutes: settings.defaultPreAlert,
        eventMessage: "🥛 우유 마시기를 꼭 확인해요! 독서·레서·마타수학 중 오늘 활동을 하고, 오늘 시간표도 확인해요.",
        sound: "chime", color: "yellow", activeDays: [1, 2, 3, 4, 5], enabled: true, generated: false
      },
      {
        id: "builtin-morning-break-0855", startTime: "08:55", type: "break", category: "쉬는 시간", title: "아침 쉬는 시간",
        durationMode: "custom", duration: 5, preAlertMode: "default", preAlertMinutes: settings.defaultPreAlert,
        eventMessage: "1교시를 시작하기 전에 자리를 정돈하고 수업 준비를 마쳐요.",
        sound: "chime", color: "green", activeDays: [1, 2, 3, 4, 5], enabled: true, generated: false
      }
    ];
    let changed = false;
    definitions.forEach(definition => {
      if (settings.suppressedBuiltinRoutines?.includes(definition.id)) return;
      const index = routines.findIndex(item => item.id === definition.id);
      if (index >= 0) return;
      const duplicate = routines.some(item => item.startTime === definition.startTime && `${item.category} ${item.title}`.includes(definition.category));
      if (!duplicate) { routines.push(normalizeRoutine(definition, settings)); changed = true; }
    });
    if (changed) save(KEYS.routines, routines);
    return changed;
  }

  function ensureCleaningRoutine() {
    const routines = getRoutines(), settings = getSettings(), builtinId = "builtin-cleaning-1340";
    if (settings.suppressedBuiltinRoutines?.includes(builtinId)) return false;
    const builtinIndex = routines.findIndex(item => item.id === builtinId);
    if (builtinIndex >= 0) {
      const current = routines[builtinIndex], oldDefault = "1인 1역 배정표를 확인하고 맡은 일을 시작해요.", cleaningMessage = "오늘의 크린토피아와 우유 역할을 확인하고 맡은 일을 시작해요.", next = normalizeRoutine({ ...current, eventMessage: !current.eventMessage || current.eventMessage === oldDefault ? cleaningMessage : current.eventMessage }, settings);
      if (JSON.stringify(current) !== JSON.stringify(next)) { routines[builtinIndex] = next; save(KEYS.routines, routines); return true; }
      return false;
    }
    if (routines.some(item => item.startTime === "13:40" && isCleaningRoutine(item))) return false;
    routines.push(normalizeRoutine({
      id: builtinId, startTime: "13:40", type: "other", category: "청소", title: "청소 시간",
      durationMode: "custom", duration: 10, preAlertMode: "default", preAlertMinutes: settings.defaultPreAlert,
      eventMessage: "오늘의 크린토피아와 우유 역할을 확인하고 맡은 일을 시작해요.", sound: "wood", color: "blue",
      activeDays: [1, 2, 3, 4, 5], enabled: true, generated: false
    }, settings));
    save(KEYS.routines, routines);
    return true;
  }

  function ensureDismissalRoutine() {
    const routines = getRoutines(), settings = getSettings(), currentWeek = weekStartKey(), entry = getWeeklyTimetables()[currentWeek];
    const isSystemDismissal = routine => /^builtin-dismissal(?:-|$)/.test(routine.id || "");
    const preserved = routines.filter(routine => !isSystemDismissal(routine));
    const manualDismissals = preserved.filter(isDismissalRoutine);
    const timeByLastPeriod = { 5: "13:50", 6: "14:40" }, daysByLastPeriod = { 5: [], 6: [] };
    const table = entry?.timetable || {}, hasSavedTable = Object.values(table).some(day => Object.values(day || {}).some(Boolean));
    (settings.activeDays || []).forEach(day => {
      const assigned = Object.entries(table[day] || {}).filter(([, subjectId]) => Boolean(subjectId)).map(([period]) => Number(period));
      const lastPeriod = assigned.length ? Math.max(...assigned) : hasSavedTable ? 0 : Number(settings.periodCount);
      if (daysByLastPeriod[lastPeriod]) daysByLastPeriod[lastPeriod].push(Number(day));
    });
    const desired = Object.entries(daysByLastPeriod).flatMap(([period, activeDays]) => {
      const startTime = timeByLastPeriod[period];
      const uncoveredDays = activeDays.filter(day => !manualDismissals.some(item => item.startTime === startTime && item.activeDays.includes(day)));
      if (!uncoveredDays.length) return [];
      return [normalizeRoutine({
        id: `builtin-dismissal-${period}`, startTime, type: "other", category: "하교", title: "하교",
        durationMode: "custom", duration: 1, preAlertMode: "off", preAlertMinutes: settings.defaultPreAlert,
        eventMessage: "오늘 일정이 끝났어요. 준비물을 확인하고 안전하게 하교해요.", sound: "sparkle", color: "orange",
        activeDays: uncoveredDays, enabled: true, generated: false
      }, settings)];
    });
    const next = [...preserved, ...desired].sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (JSON.stringify(routines) === JSON.stringify(next)) return false;
    save(KEYS.routines, next);
    return true;
  }

  function parseTimetableCsv(text) {
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

  function weeklyTimetablesFromCsv(text) {
    const rows = parseTimetableCsv(text);
    if (rows.length < 2) return {};
    const headers = rows[0].map(value => value.replace(/^\uFEFF/, "")), at = name => headers.indexOf(name), subjects = getSubjects(), imported = {};
    rows.slice(1).forEach(row => {
      const start = row[at("주시작일")];
      if (!start) return;
      const info = weekInfo(start), activeDays = String(row[at("운영요일")] || "1|2|3|4|5").split("|").map(Number).filter(Number.isFinite);
      const entry = imported[start] ||= {
        ...info, timetable: {}, savedAt: row[at("저장시각")] || new Date().toISOString(),
        schedule: {
          activeDays, firstStart: row[at("1교시시작")] || "09:00", periodCount: Number(row[at("교시수")]) || 1,
          classMinutes: Number(row[at("수업분")]) || getSettings().classMinutes,
          breakMinutes: Number(row[at("쉬는분")]) || getSettings().breakMinutes,
          defaultPreAlert: Number(row[at("기본사전알림")]) || 0,
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

  function dutyBoardFromCsv(text) {
    const rows = parseTimetableCsv(text); if (rows.length < 2) return null;
    const headers = rows[0].map(value => value.replace(/^\uFEFF/, "")), at = name => headers.indexOf(name), roles = [], byId = new Map(), assignments = {};
    rows.slice(1).forEach(row => {
      const id = row[at("역할ID")]; if (!id) return;
      if (!byId.has(id)) {
        const role = { id, name: row[at("역할명")] || "역할", category: row[at("분류")] || "classroom", description: row[at("업무안내")] || "", color: row[at("색상")] || "coral", capacity: Math.max(1, Number(row[at("정원")]) || 1) };
        byId.set(id, role); roles.push(role); assignments[id] = Array(role.capacity).fill("");
      }
      const role = byId.get(id), slot = Math.max(0, Number(row[at("자리")]) - 1), number = row[at("학생번호")], name = row[at("학생이름")];
      if (name && slot < role.capacity) assignments[id][slot] = `${number}\u241f${name}`;
    });
    if (!roles.length) return null;
    return { savedAt: rows[1][at("저장시각")] || "", term: rows[1][at("배정기간")] || "", roles, assignments };
  }

  const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  function weeklyTimetablesCsv(weeks = getWeeklyTimetables()) {
    const header = ["구분","주시작일","주종료일","ISO연도","ISO주차","기준월","월주차","요일번호","요일","교시","과목ID","과목명","교시수","운영요일","1교시시작","수업분","쉬는분","기본사전알림","중간놀이사용","중간놀이분","점심사용","점심교시후","점심분","저장시각"];
    const dayLabels = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" }, subjects = getSubjects(), rows = [header];
    Object.values(weeks).sort((a, b) => a.start.localeCompare(b.start)).forEach(entry => {
      const info = weekInfo(entry.start), schedule = mergeSettings(entry.schedule || {}), common = [entry.start, entry.end || info.end, info.isoYear, info.isoWeek, info.month, info.monthWeek];
      const structure = [schedule.periodCount, schedule.activeDays.join("|"), schedule.firstStart, schedule.classMinutes, schedule.breakMinutes, schedule.defaultPreAlert, schedule.middlePlay.enabled ? 1 : 0, schedule.middlePlay.duration, schedule.lunch.enabled ? 1 : 0, schedule.lunch.afterPeriod, schedule.lunch.duration, entry.savedAt];
      rows.push(["주차", ...common, "", "", "", "", "", ...structure]);
      Object.entries(entry.timetable || {}).forEach(([day, periods]) => Object.entries(periods || {}).forEach(([period, subjectId]) => {
        if (!subjectId) return;
        const subject = subjects.find(item => item.id === subjectId);
        rows.push(["수업", ...common, day, dayLabels[day], period, subjectId, subject?.name || "", ...structure]);
      }));
    });
    return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  }

  async function syncFolderTimetables() {
    if (!window.location || !/^https?:$/.test(window.location.protocol)) return;
    try {
      const response = await fetch("/api/timetable-csv", { cache: "no-store" });
      if (!response.ok) return;
      const imported = weeklyTimetablesFromCsv(await response.text()), weeks = getWeeklyTimetables();
      let changed = false;
      Object.entries(imported).forEach(([key, entry]) => {
        if (!weeks[key] || String(entry.savedAt) >= String(weeks[key].savedAt || "")) { weeks[key] = entry; changed = true; }
      });
      if (changed) save(KEYS.weeklyTimetables, weeks);
      const restored = ensureWeekRoutines(), dismissalChanged = ensureDismissalRoutine();
      await fetch("/api/timetable-csv", { method: "PUT", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: weeklyTimetablesCsv(weeks) });
      if (changed || restored || dismissalChanged) notify("weeklyTimetables");
    } catch {}
  }

  async function syncFolderDuties() {
    if (!window.location || !/^https?:$/.test(window.location.protocol)) return;
    try {
      const response = await fetch("/api/roles-csv", { cache: "no-store" }); if (!response.ok) return;
      const imported = dutyBoardFromCsv(await response.text()); if (!imported) return;
      const current = getDutyBoard();
      if (!(current.roles || []).length || String(imported.savedAt) > String(current.savedAt || "")) setDutyBoard(imported);
    } catch {}
  }

  const channel = "BroadcastChannel" in window ? new BroadcastChannel("class-routine-live") : null;
  const listeners = new Set();
  function notify(scope) {
    const detail = { scope, at: Date.now() };
    channel?.postMessage(detail);
    window.dispatchEvent(new CustomEvent("classroutinechange", { detail }));
  }
  channel?.addEventListener("message", event => window.dispatchEvent(new CustomEvent("classroutinechange", { detail: event.data })));
  function onChange(callback) { const listener = event => callback(event.detail); window.addEventListener("classroutinechange", listener); listeners.add(listener); return () => window.removeEventListener("classroutinechange", listener); }

  migrate();
  if (typeof document !== "undefined") document.addEventListener("click", event => {
    const link = event.target.closest?.("a[data-resource-link]");
    if (!link || !window.classRoutineDesktop?.openExternal) return;
    event.preventDefault();
    window.classRoutineDesktop.openExternal(link.href);
  });
  window.ClassRoutine = {
    KEYS, SCHOOL_PRESETS, DEFAULT_SETTINGS, SUBJECT_COLORS, ALLERGENS, uid, dateKey, weekStartKey, weekInfo, toMinutes, fromMinutes, quickTimerRemaining, formatCountdown, normalizeAllergenCodes, allergenNames, mealWarnings,
    getSettings, setSettings, getSubjects, setSubjects, getRoutines, setRoutines, getRecords, setRecords,
    getHandoffs, setHandoffs, getWeeklyTimetables, setWeeklyTimetables, getDutyBoard, setDutyBoard, getSeatBoard, setSeatBoard, dutyAssignments, dutyAssignmentsForDate, cleaningDutyAssignmentsForDate, dutyBoardFromCsv,
    durationFor, preAlertFor, dueAlarmPhase, endTime, hasEnded, activeOn, dismissalConflicts, primaryCurrentRoutine, subjectFor, normalizeResourceUrl, resourceUrlFor, commonMessageFor, messagesFor, isCleaningRoutine, isDismissalRoutine, activateSound, soundTiming, stopSound, effectiveSound, playSound,
    nextClassAfter, generateSchedule, materializeWeek, ensureWeekRoutines, ensureMorningRoutines, ensureCleaningRoutine, ensureDismissalRoutine, weeklyTimetablesFromCsv, weeklyTimetablesCsv, normalizeRoutine, restoreFolderState, notify, onChange, load, save
  };
  syncFolderTimetables();
  syncFolderDuties();
  scheduleStateBackup();
})();
