const CR = window.ClassRoutine;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const COLORS = { green: "#2f7666", orange: "#ee6539", blue: "#4d7ea8", yellow: "#d3a61d" };
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let settings = CR.getSettings(), subjects = CR.getSubjects(), routines = CR.getRoutines(), records = CR.getRecords(), handoffs = CR.getHandoffs();
let roster = CR.load(CR.KEYS.roster, []), memos = CR.load(CR.KEYS.memos, {}), activeAlarm = null, snoozes = [], recordHandle = null, rosterHandle = null;
let alarmTimer = null;
let timerDialogLastId = null, timerDialogDismissedId = null, timerDialogFinishedId = null;
let dailyInfo = null;

function todayRoutines() { const now = new Date(); return routines.filter(item => CR.activeOn(item, now)).sort((a, b) => a.startTime.localeCompare(b.startTime)); }
function isComplete(id, date = CR.dateKey()) { return records.some(item => item.routineId === id && item.date === date && item.status === "완료"); }
function routineEnded(routine, now = new Date()) { return CR.hasEnded(routine, now, settings); }
function isRoutineDone(routine, now = new Date()) { return isComplete(routine.id) || routineEnded(routine, now); }
function currentOrNext() { const now = new Date(), stamp = now.getHours() * 60 + now.getMinutes(), list = todayRoutines().filter(item => !isComplete(item.id)); return CR.primaryCurrentRoutine(list, now, settings) || list.find(item => CR.toMinutes(item.startTime) >= stamp) || null; }
function toast(message) { const element = $("#toast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 2500); }
function closeTimerMenu() { $("#timerMenu").hidden = true; $("#timerTrigger").setAttribute("aria-expanded", "false"); }
function openTimerMenu() { $("#timerMenu").hidden = false; $("#timerTrigger").setAttribute("aria-expanded", "true"); }
function startQuickTimer(minutes) {
  const durationMinutes = Math.max(1, Math.min(10, Number(minutes) || 1)), startedAt = Date.now();
  timerDialogDismissedId = null; timerDialogFinishedId = null;
  CR.activateSound(); CR.save(CR.KEYS.quickTimer, { id: CR.uid(), durationMinutes, startedAt, endsAt: startedAt + durationMinutes * 60000 }); CR.notify("quickTimer");
  closeTimerMenu(); renderQuickTimer(); toast(`${durationMinutes}분 타이머를 시작했어요.`);
}
function stopQuickTimer(showToast = true) { const dialog = $("#quickTimerDialog"); if (dialog.open) dialog.close(); timerDialogLastId = null; timerDialogDismissedId = null; timerDialogFinishedId = null; CR.save(CR.KEYS.quickTimer, null); CR.notify("quickTimer"); renderQuickTimer(); if (showToast) toast("타이머를 중지했어요."); }
function renderQuickTimer() {
  const timer = CR.load(CR.KEYS.quickTimer, null), box = $("#quickTimer"), display = $("#quickTimerDisplay"), stop = $("#timerStop"), dialog = $("#quickTimerDialog");
  const remaining = CR.quickTimerRemaining(timer); box.classList.remove("running", "finished"); stop.disabled = !timer;
  if (!timer) { display.textContent = "타이머"; $("#timerTrigger").setAttribute("aria-label", "빠른 타이머 열기"); if (dialog.open) dialog.close(); return; }
  if (timerDialogLastId !== timer.id) { timerDialogLastId = timer.id; timerDialogDismissedId = null; timerDialogFinishedId = null; }
  const totalSeconds = Math.max(1, Math.round((Number(timer.endsAt) - Number(timer.startedAt || timer.endsAt)) / 1000) || Number(timer.durationMinutes) * 60 || 60);
  const progress = Math.max(0, Math.min(100, (totalSeconds - remaining) / totalSeconds * 100));
  const endTime = new Date(Number(timer.endsAt)).toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit", hour12:false });
  $("#timerDialogDuration").textContent = `${timer.durationMinutes}분 타이머`;
  $("#timerDialogStatus").textContent = remaining > 0 ? "남은 시간" : "시간이 끝났어요!";
  $("#timerDialogDisplay").textContent = CR.formatCountdown(remaining);
  $("#timerDialogProgress").style.width = `${progress}%`;
  $("#timerDialogEnd").textContent = `${endTime} 종료 예정`;
  dialog.classList.toggle("finished", remaining <= 0);
  if (remaining > 0) {
    box.classList.add("running"); display.textContent = CR.formatCountdown(remaining); $("#timerTrigger").setAttribute("aria-label", `타이머 ${display.textContent} 남음`);
    if (timerDialogDismissedId !== timer.id && !dialog.open) dialog.showModal();
    return;
  }
  box.classList.add("finished"); display.textContent = "완료!"; $("#timerTrigger").setAttribute("aria-label", "타이머 종료");
  if (timerDialogFinishedId !== timer.id) { timerDialogFinishedId = timer.id; timerDialogDismissedId = null; if (!dialog.open) dialog.showModal(); }
  if (!timer.notifiedAt) { timer.notifiedAt = Date.now(); CR.save(CR.KEYS.quickTimer, timer); CR.notify("quickTimer"); playSound("chime"); toast("타이머가 끝났어요!"); }
  if (Date.now() - Number(timer.notifiedAt || timer.endsAt) >= 8000) stopQuickTimer(false);
}
function dateTime() { const now = new Date(); $("#monthDay").textContent = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(now); $("#weekday").textContent = new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(now); $("#currentClock").textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; $("#currentSeconds").textContent = String(now.getSeconds()).padStart(2, "0"); }
function liveTime(now = new Date()) { return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`; }
function startCountdown(routine, now = new Date()) {
  const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const startSeconds = CR.toMinutes(routine.startTime) * 60, endSeconds = startSeconds + CR.durationFor(routine, settings) * 60, difference = startSeconds - currentSeconds;
  if (difference > 0) {
    const hours = Math.floor(difference / 3600), minutes = Math.floor(difference % 3600 / 60), seconds = difference % 60;
    return { label: "시작까지", value: hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` };
  }
  if (difference > -60) return { label: "현재 상태", value: "지금 시작" };
  return currentSeconds < endSeconds ? { label: "현재 상태", value: "진행 중" } : { label: "현재 상태", value: "종료됨" };
}
function updateAlarmTimes() {
  if (!activeAlarm) return;
  if (activeAlarm.phase !== "preview") {
    const minute = new Date().getHours() * 60 + new Date().getMinutes();
    const start = CR.toMinutes(activeAlarm.routine.startTime);
    if (activeAlarm.phase === "pre" ? minute >= start : minute >= start + CR.durationFor(activeAlarm.routine, settings)) {
      closeAlarm();
      return;
    }
  }
  const now = new Date(), state = startCountdown(activeAlarm.routine, now);
  $("#alarmCurrentTime").textContent = liveTime(now);
  $("#alarmTime").textContent = activeAlarm.routine.startTime;
  $("#alarmEndTime").textContent = `${CR.endTime(activeAlarm.routine, settings)} 종료`;
  $("#alarmCountdownLabel").textContent = state.label;
  $("#alarmCountdown").textContent = state.value;
}
function renderGreeting() { $("#welcomeMessage").textContent = `${settings.className}, ${settings.greeting}`; $("#soundLabel").textContent = settings.sound ? "소리 켜짐" : "소리 꺼짐"; $("#soundToggle").setAttribute("aria-pressed", String(settings.sound)); document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion); }
function displayTitle(routine) { const subject = CR.subjectFor(routine, subjects); if (routine.type === "class" && routine.period) return `${routine.period}교시${subject ? ` ${subject.name}` : ""}`; return subject && !routine.title.includes(subject.name) ? `${routine.title} ${subject.name}` : routine.title; }
function isLunchRoutine(routine) { return /점심|급식/.test(`${routine?.title || ""} ${routine?.category || ""}`); }
function mealMenuText() { const meal = dailyInfo?.meal; return meal?.status === "ready" && meal.dishes?.length ? meal.dishes.map(dish => dish.name).join(" · ") : ""; }
function renderNext() { const routine = currentOrNext(), now = new Date(); if (!routine) { delete $("#nextCard").dataset.id; $("#nextStatus").textContent = "오늘의 일정 종료"; $("#countdown").textContent = "참 잘했어요"; $("#nextTime").textContent = "✓"; $("#nextCategory").textContent = "오늘의 마무리"; $("#nextTitle").textContent = todayRoutines().length ? "모든 일정이 종료됐어요" : "오늘 표시할 일정이 없어요"; $("#nextMessage").textContent = todayRoutines().length ? "오늘의 진행 현황을 확인해 보세요." : "설정 페이지에서 일과표를 만들어 주세요."; $("#nextNotes").innerHTML = ""; $("#quickComplete").hidden = true; return; } const start = CR.toMinutes(routine.startTime), current = now.getHours() * 60 + now.getMinutes(), diff = start - current, end = CR.toMinutes(routine.startTime) + CR.durationFor(routine, settings); $("#nextStatus").textContent = current >= start && current < end ? "현재 일정" : "다음 일정"; $("#countdown").textContent = diff <= 0 ? `${Math.max(0, end - current)}분 남음` : diff < 60 ? `${diff}분 뒤` : `${Math.floor(diff / 60)}시간 ${diff % 60 ? diff % 60 + "분" : ""} 뒤`; $("#nextTime").textContent = routine.startTime; $("#nextCategory").textContent = routine.category; $("#nextTitle").textContent = displayTitle(routine); const messages = CR.messagesFor(routine), lunchMenu = isLunchRoutine(routine) ? mealMenuText() : ""; $("#nextMessage").textContent = lunchMenu || messages.event || messages.subject || "준비할 시간이에요."; $("#nextNotes").innerHTML = [messages.subject && messages.event ? `<span class="note-chip">과목 기본 · ${escapeHtml(messages.subject)}</span>` : "", messages.handoff ? `<span class="note-chip">전달 메모 · ${escapeHtml(messages.handoff)}</span>` : "", messages.teacher ? `<span class="note-chip">교사 메모 · ${escapeHtml(messages.teacher)}</span>` : ""].join(""); $("#quickComplete").hidden = false; $("#nextCard").dataset.id = routine.id; const day = todayRoutines(); if (day.length > 1) { const first = CR.toMinutes(day[0].startTime), last = CR.toMinutes(day.at(-1).startTime) + CR.durationFor(day.at(-1), settings); $("#dayProgress").style.width = `${Math.max(0, Math.min(100, (current - first) / Math.max(1, last - first) * 100))}%`; } }
function renderRoutines() { const list = $("#routineList"), now = new Date(), current = now.getHours() * 60 + now.getMinutes(), next = currentOrNext(), day = todayRoutines(); list.innerHTML = ""; $("#routineEmpty").hidden = day.length > 0; day.forEach(routine => { const item = $("#routineTemplate").content.firstElementChild.cloneNode(true), subject = CR.subjectFor(routine, subjects), duration = CR.durationFor(routine, settings), messages = CR.messagesFor(routine), lunchMenu = isLunchRoutine(routine) ? mealMenuText() : "", recorded = isComplete(routine.id), ended = routineEnded(routine, now), completeButton = $('[data-action="complete"]', item); item.dataset.id = routine.id; item.setAttribute("aria-label", `${displayTitle(routine)} 크게 보기`); item.style.setProperty("--color", COLORS[routine.color] || COLORS.green); $("time", item).innerHTML = `${routine.startTime}<small>${CR.endTime(routine, settings)}까지</small>`; $(".routine-copy>span", item).innerHTML = `${escapeHtml(routine.category)} <b class="meta">${duration}분 · ${routine.durationMode === "custom" ? "개별" : "기본"}</b>`; $("h3", item).textContent = displayTitle(routine); $(".routine-copy p", item).textContent = lunchMenu || messages.handoff || messages.event || messages.subject || "안내 메시지가 없습니다."; item.classList.toggle("done", recorded || ended); item.classList.toggle("auto-done", ended && !recorded); item.classList.toggle("active", next?.id === routine.id); completeButton.textContent = recorded ? "↶" : ended ? "◷" : "✓"; completeButton.setAttribute("aria-label", recorded ? "일정 종료 기록 취소" : ended ? "자동 종료됨 · 종료 기록 남기기" : "일정 종료"); list.append(item); }); }
function renderSummary() { const now = new Date(), day = todayRoutines(), doneRecords = records.filter(item => item.date === CR.dateKey() && item.status === "완료"), recordByRoutine = new Map(doneRecords.map(item => [item.routineId, item])), finished = day.filter(routine => recordByRoutine.has(routine.id) || routineEnded(routine, now)), total = day.length, completed = finished.length, percent = total ? Math.round(completed / total * 100) : 0, autoCount = finished.filter(routine => !recordByRoutine.has(routine.id)).length; $("#todayScore").textContent = `${completed} / ${total}`; $("#percent").textContent = percent; $("#ring").style.setProperty("--progress", `${percent * 3.6}deg`); $("#summaryCopy").innerHTML = percent === 100 ? "오늘 일정이 모두 종료됐어요!<br>우리 반에게 큰 박수를 보내요." : autoCount ? `시간 기준으로 ${autoCount}개 일정이 자동 종료됐어요.<br>현재 일과를 이어가요.` : completed ? "차근차근 잘하고 있어요.<br>다음 일정도 함께해요." : "아직 시작 전이에요.<br>천천히 시작해 볼까요?"; const recent = finished.map(routine => { const record = recordByRoutine.get(routine.id); return { title: displayTitle(routine), completedAt: record?.completedAt || CR.endTime(routine, settings), automatic: !record }; }).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 3); $("#recentLog").innerHTML = recent.length ? recent.map(item => `<div class="log-line ${item.automatic ? "automatic" : "recorded"}"><span>${item.automatic ? "◷" : "✓"} ${escapeHtml(item.title)} <small>${item.automatic ? "자동" : "기록"}</small></span><time>${item.completedAt}</time></div>`).join("") : `<div class="log-empty">종료된 일정이 여기에 표시됩니다.</div>`; }
function renderRoster() { $("#rosterCount").textContent = roster.length; $("#drawStudentButton").disabled = !roster.length; $("#rosterList").innerHTML = roster.map(item => `<div class="roster-person"><b>${escapeHtml(item.number)}</b><span>${escapeHtml(item.name)}</span></div>`).join(""); }
function renderMealDetail() {
  const meal = dailyInfo?.meal || {}, dishes = Array.isArray(meal.dishes) ? meal.dishes : [], warnings = CR.mealWarnings(meal, roster);
  $("#mealDetailTitle").textContent = meal.status === "ready" ? (meal.mealName || "오늘의 급식") : "급식 연결 확인";
  $("#mealDetailMeta").textContent = meal.status === "ready" ? [meal.calories, "메뉴의 번호는 알레르기 유발 식재료입니다"].filter(Boolean).join(" · ") : (meal.message || "설정에서 학교와 나이스 인증키를 확인해 주세요.");
  $("#mealDetailDishes").innerHTML = dishes.length ? dishes.map((dish, index) => {
    const allergy = (dish.allergenCodes || []).map(code => `${code} ${CR.ALLERGENS[code] || ""}`.trim()).join(" · ");
    return `<article class="meal-detail-dish"><i>${index + 1}</i><div><h3>${escapeHtml(dish.name)}</h3>${allergy ? `<p>${escapeHtml(allergy)}</p>` : ""}</div></article>`;
  }).join("") : `<div class="meal-detail-empty">${escapeHtml(meal.message || "표시할 급식 메뉴가 없습니다.")}</div>`;
  $("#mealDetailAllergy").hidden = !warnings.length;
  $("#mealDetailAllergyTitle").textContent = warnings.length ? `학생별 알레르기 주의 · ${warnings.length}명` : "학생별 알레르기 주의";
  $("#mealDetailWarnings").innerHTML = warnings.map(student => `<article class="meal-warning-large"><strong>${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</strong><p>${student.dishes.map(dish => `${escapeHtml(dish.name)} — ${escapeHtml(dish.matchedNames.join("·"))}`).join("<br>")}</p></article>`).join("");
}
function openMealDetail() { renderMealDetail(); const dialog = $("#mealDetailDialog"); if (!dialog.open) dialog.showModal(); }
function renderDailyInfo() {
  if (!dailyInfo) return;
  const meal = dailyInfo.meal || {}, weather = dailyInfo.weather || {};
  $("#todayMealTitle").textContent = meal.status === "ready" ? (meal.mealName || "오늘 급식") : "급식 연결 확인";
  $("#todayMealDishes").innerHTML = meal.status === "ready" ? meal.dishes.map(dish => `<span class="meal-dish"><b>${escapeHtml(dish.name)}</b></span>`).join("") : `<span class="meal-card-message">${escapeHtml(meal.message || "설정에서 학교 코드를 입력해 주세요.")}</span>`;
  const weatherCard = $(".daily-brief-card.weather"), level = weather.guidance?.level || "";
  weatherCard.dataset.level = level;
  $("#weatherIcon").textContent = weather.status === "ready" ? ({ "맑음":"☀", "구름많음":"☁", "흐림":"흐", "비":"우", "눈":"설" }[weather.condition] || "날") : "날";
  $("#outdoorLabel").textContent = weather.status === "ready" ? weather.guidance.label : "날씨 연결 확인";
  $("#weatherValues").innerHTML = weather.status === "ready" ? `<b>${escapeHtml(weather.condition)} ${weather.temperature ?? "-"}℃</b> 강수 ${weather.precipitationProbability ?? "-"}% · 바람 ${weather.windSpeed ?? "-"}m/s` : escapeHtml(weather.message || "설정에서 기상청 정보를 입력해 주세요.");
  $("#outdoorMessage").textContent = weather.status === "ready" ? weather.guidance.message : "현장 상태와 학생 건강 상태를 함께 확인해 주세요.";
  renderMealDetail();
  renderRoutines(); renderNext();
  if (activeAlarm && isLunchRoutine(activeAlarm.routine)) renderAlarmMeal(activeAlarm.routine);
}
async function loadDailyInfo(force = false) {
  const button = $("#refreshDailyInfo"); if (button) { button.disabled = true; button.textContent = "…"; }
  try { const response = await fetch(`/api/daily-info${force ? "?refresh=1" : ""}`, { cache:"no-store" }); if (!response.ok) throw new Error(); dailyInfo = await response.json(); renderDailyInfo(); }
  catch { dailyInfo = { meal:{ status:"error", message:"급식 정보를 불러오지 못했어요." }, weather:{ status:"error", message:"날씨 정보를 불러오지 못했어요." } }; renderDailyInfo(); }
  finally { if (button) { button.disabled = false; button.textContent = "↻"; } }
}
function renderAll() { settings = CR.getSettings(); subjects = CR.getSubjects(); routines = CR.getRoutines(); records = CR.getRecords(); handoffs = CR.getHandoffs(); roster = CR.load(CR.KEYS.roster, []); dateTime(); renderGreeting(); renderRoutines(); renderScheduleConflict(); renderNext(); renderSummary(); renderRoster(); renderDailyInfo(); }
function renderScheduleConflict() {
  const conflicts = CR.dismissalConflicts(todayRoutines(), new Date(), settings);
  const notice = $("#todayScheduleConflict");
  notice.hidden = !conflicts.length;
  if (conflicts.length) {
    const { dismissal, overlap } = conflicts[0];
    notice.textContent = `시간 확인: ${dismissal.startTime} 하교가 ${overlap.startTime}–${CR.endTime(overlap, settings)} ${overlap.title} 중에 있습니다. 점심 길이 또는 시간표를 확인해 주세요.`;
  }
}

function playSound(type = "chime") { CR.playSound(type); }

function requestComplete(id) { if (isComplete(id)) return removeCompletion(id); const routine = routines.find(item => item.id === id); if (!routine) return; if (routine.type !== "class") return finalizeComplete(id); const next = CR.nextClassAfter(id); $("#completeRoutineId").value = id; $("#studentHandoff").value = ""; $("#teacherHandoff").value = ""; $("#handoffTarget").innerHTML = next ? `<b>전달 대상</b> · ${escapeHtml(next.date === CR.dateKey() ? "오늘" : next.date)} ${next.routine.startTime} ${escapeHtml(displayTitle(next.routine))}` : `<b>다음 수업 없음</b> · 메모 없이 종료할 수 있어요.`; $("#handoffDialog").showModal(); }
async function finalizeComplete(id, studentNote = "", teacherNote = "") { const routine = routines.find(item => item.id === id); if (!routine || isComplete(id)) return; const now = new Date(); records.push({ id: CR.uid(), date: CR.dateKey(), routineId: id, title: displayTitle(routine), scheduledTime: routine.startTime, completedAt: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, status: "완료" }); handoffs = handoffs.map(item => item.targetRoutineId === id && item.targetDate === CR.dateKey() ? { ...item, archived: true, archivedAt: new Date().toISOString() } : item); const next = CR.nextClassAfter(id); if (next && (studentNote || teacherNote)) handoffs.push({ id: CR.uid(), sourceRoutineId: id, targetRoutineId: next.routine.id, targetDate: next.date, studentNote, teacherNote, createdAt: new Date().toISOString(), archived: false }); CR.setHandoffs(handoffs); await persistRecords(); playSound("sparkle"); renderAll(); toast(`“${routine.title}” 일정을 종료했어요.`); }
async function removeCompletion(id) { const index = records.findIndex(item => item.routineId === id && item.date === CR.dateKey() && item.status === "완료"); if (index < 0) return; records.splice(index, 1); await persistRecords(); renderAll(); toast("일정 종료 기록을 취소했어요."); }

function openRoutine(routine = null) {
  $("#routineForm").reset();
  const value = routine || CR.normalizeRoutine({ startTime: "09:00", type: "other", category: "기타", title: "", durationMode: "custom", duration: 10, preAlertMode: "default", activeDays: settings.activeDays, enabled: true });
  $("#routineId").value = routine?.id || "";
  $("#routineFormTitle").textContent = routine ? "일정 수정" : "새 일정 추가";
  $("#routineType").value = value.type;
  $("#routineTime").value = value.startTime;
  $("#routineSubject").innerHTML = `<option value="">과목 미지정</option>` + subjects.filter(item => item.enabled).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  $("#routineSubject").value = value.subjectId || "";
  $("#routineTitle").value = value.title;
  $("#routineCategory").value = value.category;
  $("#durationMode").value = value.durationMode;
  $("#routineDuration").value = CR.durationFor(value, settings);
  $("#preAlertMode").value = value.preAlertMode;
  $("#preAlertMinutes").value = CR.preAlertFor(value, settings) ?? settings.defaultPreAlert;
  $("#routineMessage").value = value.eventMessage;
  $("#routineResourceUrl").value = value.resourceUrl || "";
  $(`input[name=color][value=${value.color}]`).checked = true;
  $$("#routineDays input").forEach(input => input.checked = value.activeDays.includes(Number(input.value)));
  $("#routineEnabled").checked = value.enabled;
  $("#deleteButton").hidden = !routine;
  updateRoutineFields();
  $("#routineDialog").showModal();
}
function updateRoutineFields() { const type = $("#routineType").value; $("#routineSubjectWrap").hidden = type !== "class"; $("#routineDuration").disabled = $("#durationMode").value === "default"; if ($("#routineDuration").disabled) $("#routineDuration").value = type === "class" ? settings.classMinutes : type === "break" ? settings.breakMinutes : 10; $("#preAlertMinutes").disabled = $("#preAlertMode").value !== "custom"; $("#routineEndTime").textContent = `${CR.fromMinutes(CR.toMinutes($("#routineTime").value || "00:00") + (Number($("#routineDuration").value) || 0))} 종료`; }
function saveRoutine(event) {
  event.preventDefault();
  const id = $("#routineId").value, old = routines.find(item => item.id === id), type = $("#routineType").value;
  const rawUrl = $("#routineResourceUrl").value.trim();
  if (rawUrl && !CR.normalizeResourceUrl(rawUrl)) return toast("일정 링크는 http 또는 https 주소로 입력해 주세요.");
  const routine = CR.normalizeRoutine({ ...old, id: id || CR.uid(), startTime: $("#routineTime").value, type, subjectId: type === "class" ? $("#routineSubject").value : "", title: $("#routineTitle").value.trim(), category: $("#routineCategory").value.trim() || (type === "class" ? "수업" : type === "break" ? "쉬는 시간" : "기타"), durationMode: $("#durationMode").value, duration: Number($("#routineDuration").value), preAlertMode: $("#preAlertMode").value, preAlertMinutes: Number($("#preAlertMinutes").value), eventMessage: $("#routineMessage").value.trim(), resourceUrl: CR.normalizeResourceUrl(rawUrl), color: $("input[name=color]:checked").value, activeDays: $$("#routineDays input:checked").map(input => Number(input.value)), enabled: $("#routineEnabled").checked, generated: old?.generated || false });
  if (!routine.title || !routine.activeDays.length) return toast("일정 이름과 반복 요일을 확인해 주세요.");
  routines = id ? routines.map(item => item.id === id ? routine : item) : [...routines, routine];
  CR.setRoutines(routines);
  $("#routineDialog").close();
  renderAll();
  toast("일정을 저장했어요.");
}

function alarmDutyHtml() { const roles = CR.cleaningDutyAssignmentsForDate(new Date()); return roles.length ? roles.map(role => { const primary = String(role.name || "").includes("크린토피아"); return `<article class="${primary ? "primary-duty" : "support-duty"}" data-color="${escapeHtml(role.color)}"><strong>${escapeHtml(role.name)}</strong><div>${role.students.map(student => student ? `<span>${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</span>` : `<span class="empty">미배정</span>`).join("")}</div></article>`; }).join("") : `<p>오늘의 크린토피아와 우유 역할이 아직 배정되지 않았습니다.</p>`; }
function renderAlarmMeal(routine) {
  const board = $("#alarmMealBoard"), meal = dailyInfo?.meal || {}, dishes = Array.isArray(meal.dishes) ? meal.dishes : [], warnings = CR.mealWarnings(meal, roster), lunch = isLunchRoutine(routine);
  board.hidden = !lunch;
  if (!lunch) return;
  $("#alarmMealMeta").textContent = meal.status === "ready" ? [meal.mealName, meal.calories].filter(Boolean).join(" · ") : "급식 연결 확인";
  $("#alarmMealDishes").innerHTML = dishes.length ? dishes.map(dish => `<span>${escapeHtml(dish.name)}</span>`).join("") : `<p>${escapeHtml(meal.message || "표시할 급식 메뉴가 없습니다.")}</p>`;
  $("#alarmMealWarnings").hidden = !warnings.length;
  $("#alarmMealWarnings").innerHTML = warnings.length ? `<strong>알레르기 주의 학생 ${warnings.length}명</strong>${warnings.map(student => `<article><b>${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</b><span>${student.dishes.map(dish => `${escapeHtml(dish.name)} — ${escapeHtml(dish.matchedNames.join("·"))}`).join("<br>")}</span></article>`).join("")}` : "";
}
function notifyDesktopRoutine(routine, phase) { if (!settings.windowsNotification) return; const messages = CR.messagesFor(routine); window.classRoutineDesktop?.notifyRoutine({ id: routine.id, title: displayTitle(routine), time: routine.startTime, phase, body: `${routine.startTime} · ${messages.event || messages.handoff || messages.subject || (phase === "pre" ? "곧 시작해요." : "시작할 시간이에요.")}` }); }
function closeAlarm() { clearTimeout(alarmTimer); CR.stopSound(); const dialog = $("#alarmDialog"); if (dialog.open) dialog.close(); activeAlarm = null; }
function renderAlarm(routine, phase) {
  clearTimeout(alarmTimer);
  activeAlarm = { routine, phase };
  const preview = phase === "preview", cleaning = CR.isCleaningRoutine(routine), lunch = isLunchRoutine(routine), dialog = $("#alarmDialog");
  dialog.classList.toggle("cleaning", cleaning); dialog.classList.toggle("lunching", lunch); dialog.classList.toggle("manual-preview", preview);
  $("#alarmPhase").textContent = preview ? `${routine.category} · 일정 크게 보기` : phase === "pre" ? `${CR.preAlertFor(routine, settings)}분 뒤 시작해요` : "일정을 시작할 시간이에요";
  updateAlarmTimes();
  $("#alarmTitle").textContent = displayTitle(routine);
  const messages = CR.messagesFor(routine), items = [["과목 기본 안내", messages.subject], ["오늘 일정 안내", messages.event], ["이전 수업 메모", messages.handoff], ["교사 메모", preview ? messages.teacher : ""]].filter(([, value]) => value);
  $("#alarmMessages").innerHTML = items.length ? items.map(([label, value]) => `<div class="alarm-message"><b>${label}</b>${escapeHtml(value)}</div>`).join("") : `<div class="alarm-message">${preview ? "이 일정에 등록된 안내가 없습니다." : phase === "pre" ? "다음 일정을 준비해요." : "일정을 시작해요."}</div>`;
  const resourceUrl = CR.resourceUrlFor(routine, subjects);
  if (resourceUrl) $("#alarmMessages").insertAdjacentHTML("beforeend", `<a class="resource-link" data-resource-link href="${escapeHtml(resourceUrl)}" target="_blank" rel="noopener noreferrer">수업 도구 열기 ↗</a>`);
  renderAlarmMeal(routine);
  $("#alarmDutyBoard").hidden = !cleaning; $("#alarmDutyBoard").innerHTML = cleaning ? alarmDutyHtml() : "";
  $("#alarmIcon").textContent = preview ? "↗" : phase === "pre" ? "◷" : "♪"; $("#laterButton").hidden = preview;
  $("#alarmComplete span").textContent = preview ? "큰 화면 닫기" : "일정 확인"; $("#alarmComplete b").textContent = preview ? "×" : "✓";
  if (!preview) {
    playSound(routine.sound);
    const now = new Date();
    if (phase === "start" && now.getHours() * 60 + now.getMinutes() === CR.toMinutes(routine.startTime)) notifyDesktopRoutine(routine, phase);
  }
  if (!dialog.open) dialog.showModal();
  const seconds = Number(settings.alertDisplaySeconds);
  if (!preview && seconds > 0) alarmTimer = setTimeout(closeAlarm, (cleaning ? Math.max(30, seconds) : seconds) * 1000);
}
function openRoutinePreview(id) { const routine = routines.find(item => item.id === id); if (routine) renderAlarm(routine, "preview"); }
function checkAlarms() { const heartbeat = Number(localStorage.getItem("classRoutine.studentHeartbeat") || 0); if (Date.now() - heartbeat < 5000) return; const now = new Date(), alerted = CR.load(`classRoutine.alerted.v3.${CR.dateKey()}`, []); for (const routine of todayRoutines()) { const phase = CR.dueAlarmPhase(routine, now, alerted, settings); if (phase) { alerted.push(`${routine.id}:${phase}`); CR.save(`classRoutine.alerted.v3.${CR.dateKey()}`, alerted); renderAlarm(routine, phase); return; } } const snooze = snoozes.find(item => item.at <= Date.now()); if (snooze) { snoozes = snoozes.filter(item => item !== snooze); const routine = routines.find(item => item.id === snooze.id); if (routine && !CR.hasEnded(routine, now, settings)) renderAlarm(routine, "start"); } }

function showHistory(date = CR.dateKey()) { const rows = records.filter(item => item.date === date).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)); $("#historyDate").value = date; $("#historyContent").innerHTML = rows.length ? rows.map(item => `<div class="history-row"><time>${item.completedAt}</time><div><strong>${escapeHtml(item.title)}</strong><br><span>예정 ${item.scheduledTime}</span></div><b>${item.status}</b></div>`).join("") : `<div class="empty"><span>⌁</span><h3>이 날짜의 종료 기록이 없어요</h3><p>‘일정 종료’를 직접 누른 일정만 CSV 기록으로 보관됩니다.</p></div>`; }
const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
function recordCsv() { return "\uFEFF" + [["날짜", "루틴ID", "루틴", "예정시간", "완료시간", "상태"], ...records.map(item => [item.date, item.routineId, item.title, item.scheduledTime, item.completedAt, item.status])].map(row => row.map(csvCell).join(",")).join("\r\n"); }
function downloadRecords() { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([recordCsv()], { type: "text/csv;charset=utf-8" })); link.download = `교실루틴_기록_${CR.dateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href); }
function openHandleDb() { return new Promise((resolve, reject) => { const request = indexedDB.open("ClassRoutineFiles", 1); request.onupgradeneeded = () => request.result.createObjectStore("handles"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function getHandle(key) { try { const db = await openHandleDb(); return await new Promise((resolve, reject) => { const request = db.transaction("handles", "readonly").objectStore("handles").get(key); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); }); } catch { return null; } }
async function saveHandle(key, handle) { const db = await openHandleDb(); await new Promise((resolve, reject) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(handle, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
async function permitted(handle, ask = false, mode = "readwrite") { if (!handle) return false; if (await handle.queryPermission({ mode }) === "granted") return true; return ask && await handle.requestPermission({ mode }) === "granted"; }
async function writeCsv() { if (!recordHandle || !await permitted(recordHandle)) return; try { const writable = await recordHandle.createWritable(); await writable.write(recordCsv()); await writable.close(); $("#csvStatus").textContent = `${recordHandle.name} · 자동 저장 중`; $("#csvStatus").className = "connected"; } catch { $("#csvStatus").textContent = "저장 권한 확인 필요"; } }
async function pushFolderRecords() { if (!/^https?:$/.test(location.protocol)) return false; try { const response = await fetch("/api/records-csv", { method: "PUT", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: recordCsv() }); if (response.ok) { $("#csvStatus").textContent = "공용 데이터 폴더\\루틴기록.csv · 자동 저장 중"; $("#csvStatus").className = "connected"; return true; } } catch {} return false; }
async function persistRecords() { CR.setRecords(records); await writeCsv(); await pushFolderRecords(); }
async function connectRecord() { if (!window.showSaveFilePicker) return downloadRecords(); try { let handle = await getHandle("record"); if (!handle || !await permitted(handle, true)) handle = await showSaveFilePicker({ suggestedName: "교실루틴_기록.csv", types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] }); recordHandle = handle; await saveHandle("record", handle); await importRecordHandle(handle); await writeCsv(); toast("기록 CSV를 연결했어요."); } catch (error) { if (error.name !== "AbortError") toast("CSV 연결을 확인해 주세요."); } }
function parseCsv(text) { const rows = [], row = []; let field = "", quoted = false; for (let i = 0; i < text.length; i++) { const char = text[i]; if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; } else if (char === '"') quoted = true; else if (char === ",") { row.push(field); field = ""; } else if (char === "\n") { row.push(field.replace(/\r$/, "").trim()); rows.push([...row]); row.length = 0; field = ""; } else field += char; } if (field || row.length) { row.push(field.trim()); rows.push(row); } return rows.filter(item => item.some(value => value)); }
function importRecordText(text) { const rows = parseCsv(text); if (rows.length < 2) return 0; const imported = rows.slice(1).map(row => ({ id: CR.uid(), date: row[0], routineId: row[1], title: row[2], scheduledTime: row[3], completedAt: row[4], status: row[5] || "완료" })).filter(item => item.date && item.routineId && item.title); const key = item => `${item.date}|${item.routineId}|${item.completedAt}|${item.status}`; const known = new Set(records.map(key)); let added = 0; imported.forEach(item => { if (!known.has(key(item))) { known.add(key(item)); records.push(item); added++; } }); if (added) CR.setRecords(records); return added; }
async function importRecordHandle(handle) { const file = await handle.getFile(); if (!file.size) return; importRecordText(await file.text()); renderAll(); }
async function restoreFolderRecords() { if (!/^https?:$/.test(location.protocol)) return false; try { const response = await fetch("/api/records-csv", { cache: "no-store" }); if (!response.ok) return false; const text = await response.text(); if (text.trim()) importRecordText(text); await pushFolderRecords(); renderAll(); return true; } catch { return false; } }
function parseRosterRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(value => String(value ?? "").replace(/^\uFEFF/, "").replace(/\s/g, "").toLowerCase());
  const nameIndex = headers.findIndex(value => value.includes("이름") || value.includes("성명") || value === "name");
  const numberIndex = headers.findIndex(value => value.includes("번호") || value === "no" || value === "number");
  const emailIndex = headers.findIndex(value => value.includes("이메일") || value.includes("전자우편") || value === "email" || value === "e-mail");
  const genderIndex = headers.findIndex(value => value.includes("성별") || value === "gender" || value === "sex");
  const allergenIndex = headers.findIndex(value => value.includes("알레르기") || value.includes("알러지") || value === "allergens");
  const body = nameIndex >= 0 ? rows.slice(1) : rows;
  return body.map((row, index) => ({
    number: String(row[numberIndex >= 0 ? numberIndex : row.length > 1 ? 0 : -1] || index + 1).trim(),
    name: String(row[nameIndex >= 0 ? nameIndex : row.length > 1 ? 1 : 0] || "").trim(),
    email: String(emailIndex >= 0 ? row[emailIndex] || "" : "").trim().toLowerCase(),
    gender: ["남", "남자", "m", "male"].includes(String(genderIndex >= 0 ? row[genderIndex] || "" : "").trim().toLowerCase()) ? "남" : ["여", "여자", "f", "female"].includes(String(genderIndex >= 0 ? row[genderIndex] || "" : "").trim().toLowerCase()) ? "여" : "",
    allergenCodes: CR.normalizeAllergenCodes(allergenIndex >= 0 ? row[allergenIndex] : "")
  })).filter(item => item.name);
}
async function unzipXlsx(buffer) { const bytes = new Uint8Array(buffer), view = new DataView(buffer); let end = -1; for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (view.getUint32(index, true) === 0x06054b50) { end = index; break; } if (end < 0) throw new Error("올바른 XLSX가 아닙니다."); const count = view.getUint16(end + 10, true), entries = new Map(); let position = view.getUint32(end + 16, true); for (let index = 0; index < count; index++) { const method = view.getUint16(position + 10, true), size = view.getUint32(position + 20, true), nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true), localOffset = view.getUint32(position + 42, true), name = new TextDecoder().decode(bytes.slice(position + 46, position + 46 + nameLength)); entries.set(name, { method, size, localOffset }); position += 46 + nameLength + extraLength + commentLength; } async function extract(name) { const entry = entries.get(name); if (!entry) return null; const p = entry.localOffset, nameLength = view.getUint16(p + 26, true), extraLength = view.getUint16(p + 28, true), start = p + 30 + nameLength + extraLength, data = bytes.slice(start, start + entry.size); if (entry.method === 0) return data; const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return new Uint8Array(await new Response(stream).arrayBuffer()); } return { extract }; }
async function parseXlsx(file) { const zip = await unzipXlsx(await file.arrayBuffer()), decode = data => new TextDecoder().decode(data), xml = text => new DOMParser().parseFromString(text, "application/xml"), all = (doc, name) => [...doc.getElementsByTagNameNS("*", name)]; const sharedBytes = await zip.extract("xl/sharedStrings.xml"), shared = sharedBytes ? all(xml(decode(sharedBytes)), "si").map(item => all(item, "t").map(t => t.textContent || "").join("")) : []; const workbook = xml(decode(await zip.extract("xl/workbook.xml"))), relations = xml(decode(await zip.extract("xl/_rels/workbook.xml.rels"))), sheet = all(workbook, "sheet")[0], relationId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"), relation = all(relations, "Relationship").find(item => item.getAttribute("Id") === relationId); let target = relation.getAttribute("Target").replace(/^\//, ""); if (!target.startsWith("xl/")) target = `xl/${target.replace(/^\.\//, "")}`; const doc = xml(decode(await zip.extract(target))), rows = []; all(doc, "row").forEach(row => { const values = []; all(row, "c").forEach(cell => { const ref = cell.getAttribute("r"), letters = (ref.match(/[A-Z]+/) || ["A"])[0]; let column = 0; for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64; column--; const type = cell.getAttribute("t"), valueNode = all(cell, "v")[0]; values[column] = type === "s" && valueNode ? shared[Number(valueNode.textContent)] : type === "inlineStr" ? all(cell, "t").map(item => item.textContent || "").join("") : valueNode?.textContent || ""; }); rows.push(values); }); return parseRosterRows(rows); }
async function rosterFromFile(file) { return file.name.toLowerCase().endsWith(".xlsx") ? parseXlsx(file) : parseRosterRows(parseCsv(await file.text())); }
function rosterCsv() { return "\uFEFF" + [["번호", "이름", "성별", "이메일", "알레르기번호"], ...roster.map(student => [student.number, student.name, student.gender || "", student.email || "", CR.normalizeAllergenCodes(student.allergenCodes).join("|")])].map(row => row.map(csvCell).join(",")).join("\r\n"); }
async function pushFolderRoster() { if (!/^https?:$/.test(location.protocol) || !roster.length) return false; try { const response = await fetch("/api/roster-csv", { method: "PUT", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: rosterCsv() }); return response.ok; } catch { return false; } }
async function restoreFolderRoster() { if (!/^https?:$/.test(location.protocol)) return false; try { const response = await fetch("/api/roster-csv", { cache: "no-store" }); if (!response.ok) return false; const imported = parseRosterRows(parseCsv(await response.text())); if (!imported.length) { if (roster.length) await pushFolderRoster(); return false; } roster = imported; CR.save(CR.KEYS.roster, roster); CR.notify("roster"); renderRoster(); $("#rosterStatus").textContent = `학생명렬표.csv · ${roster.length}명`; $("#rosterStatus").className = "connected"; return true; } catch { return false; } }
async function readRoster(handle) { const file = await handle.getFile(); roster = await rosterFromFile(file); CR.save(CR.KEYS.roster, roster); CR.notify("roster"); await pushFolderRoster(); $("#rosterStatus").textContent = `${handle.name} · ${roster.length}명`; $("#rosterStatus").className = "connected"; renderRoster(); }
async function connectRoster() { try { if (!window.showOpenFilePicker) { const input = document.createElement("input"); input.type = "file"; input.accept = ".xlsx,.csv"; input.onchange = async () => { roster = await rosterFromFile(input.files[0]); CR.save(CR.KEYS.roster, roster); CR.notify("roster"); await pushFolderRoster(); renderRoster(); toast(`${roster.length}명의 명렬표를 연결했어요.`); }; return input.click(); } let handle = await getHandle("roster"); if (!handle || !await permitted(handle, true, "read")) [handle] = await showOpenFilePicker({ multiple: false, types: [{ description: "명렬표", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "text/csv": [".csv"] } }] }); rosterHandle = handle; await saveHandle("roster", handle); await readRoster(handle); toast(`${roster.length}명의 명렬표를 연결했어요.`); } catch (error) { if (error.name !== "AbortError") toast("명렬표 파일을 읽지 못했어요."); } }
async function restoreFiles() { const folderRecords = await restoreFolderRecords(); recordHandle = await getHandle("record"); if (recordHandle && await permitted(recordHandle, false, "read")) { await importRecordHandle(recordHandle); if (await permitted(recordHandle, false, "readwrite")) await writeCsv(); await pushFolderRecords(); } else if (!folderRecords) $("#csvStatus").textContent = recordHandle ? "연결 권한 확인 필요" : "직접 실행 시 사본 파일 연결 필요"; rosterHandle = await getHandle("roster"); if (rosterHandle && await permitted(rosterHandle, false, "read")) await readRoster(rosterHandle); else if (!await restoreFolderRoster()) $("#rosterStatus").textContent = roster.length ? `저장된 명렬 ${roster.length}명` : "아직 연결되지 않음"; }

$("#addButton").onclick = () => openRoutine(); $("#emptyAdd").onclick = () => openRoutine(); $("#routineForm").onsubmit = saveRoutine; $("#routineList").onclick = event => { const button = event.target.closest("button"), item = event.target.closest(".routine-item"); if (!item) return; if (!button) return openRoutinePreview(item.dataset.id); button.dataset.action === "complete" ? requestComplete(item.dataset.id) : openRoutine(routines.find(routine => routine.id === item.dataset.id)); }; $("#routineList").onkeydown = event => { if (!event.target.matches(".routine-item") || !["Enter", " "].includes(event.key)) return; event.preventDefault(); openRoutinePreview(event.target.dataset.id); }; $("#quickComplete").onclick = event => { event.stopPropagation(); requestComplete($("#nextCard").dataset.id); }; $("#nextCard").onclick = event => { if (!event.target.closest("button") && $("#nextCard").dataset.id) openRoutinePreview($("#nextCard").dataset.id); }; $("#nextCard").onkeydown = event => { if (!["Enter", " "].includes(event.key) || event.target.closest("button")) return; event.preventDefault(); if ($("#nextCard").dataset.id) openRoutinePreview($("#nextCard").dataset.id); };
$("#timerTrigger").onclick = () => $("#timerMenu").hidden ? openTimerMenu() : closeTimerMenu(); $("#closeTimerMenu").onclick = closeTimerMenu; $("#timerStop").onclick = () => { stopQuickTimer(); closeTimerMenu(); }; $("#timerMenu").onclick = event => { const preset = event.target.closest("[data-minutes]"); if (preset) startQuickTimer(preset.dataset.minutes); }; $("#timerDialogMinimize").onclick = () => { const timer = CR.load(CR.KEYS.quickTimer, null); timerDialogDismissedId = timer?.id || null; $("#quickTimerDialog").close(); }; $("#timerDialogStop").onclick = () => stopQuickTimer(); $("#quickTimerDialog").addEventListener("cancel", event => { event.preventDefault(); const timer = CR.load(CR.KEYS.quickTimer, null); timerDialogDismissedId = timer?.id || null; $("#quickTimerDialog").close(); }); document.addEventListener("click", event => { if (!event.target.closest("#quickTimer")) closeTimerMenu(); }); document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#timerMenu").hidden) closeTimerMenu(); });
$("#routineType").onchange = updateRoutineFields; $("#durationMode").onchange = updateRoutineFields; $("#preAlertMode").onchange = updateRoutineFields; $("#routineTime").oninput = updateRoutineFields; $("#routineDuration").oninput = updateRoutineFields; $("#deleteButton").onclick = () => { const id = $("#routineId").value, routine = routines.find(item => item.id === id); if (!routine || !confirm(`“${routine.title}” 일정을 삭제할까요?`)) return; routines = routines.filter(item => item.id !== id); CR.setRoutines(routines); $("#routineDialog").close(); renderAll(); toast("일정을 삭제했어요."); };
$("#handoffForm").onsubmit = async event => { event.preventDefault(); $("#handoffDialog").close(); await finalizeComplete($("#completeRoutineId").value, $("#studentHandoff").value.trim(), $("#teacherHandoff").value.trim()); }; $("#completeOnly").onclick = async () => { $("#handoffDialog").close(); await finalizeComplete($("#completeRoutineId").value); };
$("#soundToggle").onclick = () => { settings.sound = !settings.sound; CR.setSettings(settings); renderGreeting(); if (settings.sound) playSound(); }; $("#historyButton").onclick = () => { showHistory(); $("#historyDialog").showModal(); }; $("#historyDate").onchange = event => showHistory(event.target.value); $("#exportButton").onclick = downloadRecords; $("#connectCsvButton").onclick = connectRecord; $("#connectRosterButton").onclick = connectRoster;
$("#refreshDailyInfo").onclick = event => { event.stopPropagation(); loadDailyInfo(true); };
$("#todayMealCard").onclick = event => { if (!event.target.closest("button,details,summary")) openMealDetail(); };
$("#todayMealCard").onkeydown = event => { if (!["Enter", " "].includes(event.key) || event.target.closest("button,summary")) return; event.preventDefault(); openMealDetail(); };
$("#mealDetailDialog").addEventListener("click", event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$("#alarmComplete").onclick = closeAlarm; $("#laterButton").onclick = () => { if (activeAlarm) snoozes.push({ id: activeAlarm.routine.id, at: Date.now() + 300000 }); closeAlarm(); toast("5분 뒤에 다시 알려드릴게요."); };
$("#alarmDialog").addEventListener("close", () => { clearTimeout(alarmTimer); CR.stopSound(); activeAlarm = null; });
$("#drawStudentButton").onclick = () => { $("#pickedStudent").innerHTML = "<small>준비됐나요?</small><strong>?</strong>"; $("#rosterList").hidden = true; $("#drawDialog").showModal(); }; $("#pickButton").onclick = () => { if (!roster.length) return; let tick = 0; const timer = setInterval(() => { const student = roster[Math.floor(Math.random() * roster.length)]; $("#pickedStudent").innerHTML = `<small>${escapeHtml(student.number)}번</small><strong>${escapeHtml(student.name)}</strong>`; if (++tick === 8) { clearInterval(timer); localStorage.setItem("classRoutine.drawResult", JSON.stringify({ ...student, at: Date.now() })); CR.notify("draw"); playSound("sparkle"); } }, 90); }; $("#showRosterButton").onclick = () => { $("#rosterList").hidden = !$("#rosterList").hidden; };
$$('[data-close]').forEach(button => button.onclick = () => $("#" + button.dataset.close).close());
$("#routineMessage").closest("label").after($("#routineResourceTemplate").content.firstElementChild.cloneNode(true));
const memoKey = CR.dateKey(); let memoTimer = null; $("#memo").value = memos[memoKey] || ""; $("#memo").oninput = event => { $("#memoState").textContent = "저장 중…"; clearTimeout(memoTimer); memoTimer = setTimeout(() => { memos[CR.dateKey()] = event.target.value; CR.save(CR.KEYS.memos, memos); $("#memoState").textContent = "저장됨"; }, 450); };
CR.onChange(() => { renderAll(); renderQuickTimer(); }); renderAll(); renderQuickTimer(); restoreFiles(); loadDailyInfo();
window.classRoutineDesktop?.onOpenRoutine(routineId => openRoutinePreview(routineId));
window.classRoutineDesktop?.onWindowsNotificationChanged?.(enabled => { settings = { ...CR.getSettings(), windowsNotification: Boolean(enabled) }; CR.setSettings(settings); });
const desktopRoutineId = new URLSearchParams(location.search).get("openRoutine");
if (desktopRoutineId) queueMicrotask(() => openRoutinePreview(desktopRoutineId));
setInterval(() => { dateTime(); renderQuickTimer(); updateAlarmTimes(); checkAlarms(); if (new Date().getSeconds() === 0) { renderRoutines(); renderNext(); renderSummary(); } }, 1000);
setInterval(() => loadDailyInfo(), 10 * 60 * 1000);
