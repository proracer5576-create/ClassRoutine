const CR = window.ClassRoutine;
const $ = selector => document.querySelector(selector);
const COLORS = { green: "#2f7666", orange: "#e76843", blue: "#4d7ea8", yellow: "#c99716" };
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let settings = CR.getSettings(), subjects = CR.getSubjects(), routines = CR.getRoutines(), records = CR.getRecords();
let alertTimer = null, drawTimer = null, activeAlert = null;
let studentTimerLastId = null, studentTimerDismissedId = null, studentTimerFinishedId = null;
let dailyInfo = null;

function todayRoutines() { const now = new Date(); return routines.filter(item => CR.activeOn(item, now)).sort((a, b) => a.startTime.localeCompare(b.startTime)); }
function completed(id) { return records.some(item => item.date === CR.dateKey() && item.routineId === id && item.status === "완료"); }
function stateAt(routine, minute) { const start = CR.toMinutes(routine.startTime), end = start + CR.durationFor(routine, settings); return completed(routine.id) || minute >= end ? "done" : minute >= start && minute < end ? "active" : "upcoming"; }
function subjectOf(routine) { return CR.subjectFor(routine, subjects); }
function titleOf(routine) { const subject = subjectOf(routine); if (routine.type === "class" && routine.period) return `${routine.period}교시${subject ? ` ${subject.name}` : ""}`; return subject && !routine.title.includes(subject.name) ? `${routine.title} ${subject.name}` : routine.title; }
function currentAndNext() { const now = new Date(), minute = now.getHours() * 60 + now.getMinutes(), list = todayRoutines(), current = CR.primaryCurrentRoutine(list.filter(item => !completed(item.id)), now, settings), next = list.find(item => CR.toMinutes(item.startTime) > minute && !completed(item.id)); return { current, next, featured: current || next || null, minute }; }

function renderClock() { const now = new Date(); $("#dateText").textContent = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(now); $("#clock").textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; $("#seconds").textContent = String(now.getSeconds()).padStart(2, "0"); }
function renderStudentTimer() {
  const timer = CR.load(CR.KEYS.quickTimer, null), box = $("#studentTimer"), layer = $("#studentTimerLayer"), remaining = CR.quickTimerRemaining(timer);
  box.classList.remove("finished");
  if (!timer || (remaining <= 0 && Date.now() - Number(timer.endsAt) >= 10000)) { box.hidden = true; layer.hidden = true; if (!timer) { studentTimerLastId = null; studentTimerDismissedId = null; studentTimerFinishedId = null; } return; }
  if (studentTimerLastId !== timer.id) { studentTimerLastId = timer.id; studentTimerDismissedId = null; studentTimerFinishedId = null; }
  const totalSeconds = Math.max(1, Math.round((Number(timer.endsAt) - Number(timer.startedAt || timer.endsAt)) / 1000) || Number(timer.durationMinutes) * 60 || 60);
  const progress = Math.max(0, Math.min(100, (totalSeconds - remaining) / totalSeconds * 100));
  const endTime = new Date(Number(timer.endsAt)).toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit", hour12:false });
  box.hidden = false;
  $("#studentTimerDuration").textContent = `${timer.durationMinutes}분 타이머`;
  $("#studentTimerStatus").textContent = remaining > 0 ? "남은 시간" : "시간이 끝났어요!";
  $("#studentTimerLarge").textContent = CR.formatCountdown(remaining);
  $("#studentTimerProgress").style.width = `${progress}%`;
  $("#studentTimerEnd").textContent = `${endTime} 종료 예정`;
  layer.classList.toggle("finished", remaining <= 0);
  if (remaining > 0) { $("#studentTimerDisplay").textContent = CR.formatCountdown(remaining); layer.hidden = studentTimerDismissedId === timer.id; }
  else { box.classList.add("finished"); $("#studentTimerDisplay").textContent = "완료!"; if (studentTimerFinishedId !== timer.id) { studentTimerFinishedId = timer.id; studentTimerDismissedId = null; } layer.hidden = studentTimerDismissedId === timer.id; }
}
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
function updateAlertTimes() {
  if (!activeAlert) return;
  const currentMinute = new Date().getHours() * 60 + new Date().getMinutes();
  const startMinute = CR.toMinutes(activeAlert.routine.startTime);
  if (activeAlert.phase === "pre" ? currentMinute >= startMinute : currentMinute >= startMinute + CR.durationFor(activeAlert.routine, settings)) {
    closeAlert();
    return;
  }
  const now = new Date(), state = startCountdown(activeAlert.routine, now);
  $("#alertCurrentTime").textContent = liveTime(now);
  $("#alertTime").textContent = activeAlert.routine.startTime;
  $("#alertEndTime").textContent = `${CR.endTime(activeAlert.routine, settings)} 종료`;
  $("#alertCountdownLabel").textContent = state.label;
  $("#alertCountdown").textContent = state.value;
}
function renderHeader() { $("#className").textContent = settings.className || "우리 반"; $("#soundButton").textContent = settings.sound ? "소리 켜짐" : "소리 꺼짐"; $("#soundButton").setAttribute("aria-pressed", String(settings.sound)); document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion); }
function renderFeatured() {
  const { current, next, featured, minute } = currentAndNext(), panel = $("#nowPanel");
  if (!featured) { $("#statusPill").textContent = todayRoutines().length ? "오늘 일과 마침" : "오늘의 안내"; $("#timeRange").textContent = ""; $("#subjectName").textContent = settings.className || "우리 반"; $("#routineTitle").textContent = todayRoutines().length ? "오늘도 수고했어요" : "등록된 일정이 없어요"; $("#mainMessage").textContent = todayRoutines().length ? "사용한 자리를 정돈하고 기분 좋게 마무리해요." : "선생님이 곧 오늘의 일과를 알려 주실 거예요."; $("#messageGrid").innerHTML = ""; $("#countdownLabel").textContent = "오늘의 일과"; $("#countdown").textContent = "마침"; $("#progressBar").style.width = "100%"; panel.style.setProperty("--accent", "#49675f"); return; }
  const subject = subjectOf(featured), messages = CR.messagesFor(featured), start = CR.toMinutes(featured.startTime), duration = CR.durationFor(featured, settings), end = start + duration, isCurrent = current?.id === featured.id;
  panel.style.setProperty("--accent", COLORS[featured.color] || subject?.color || COLORS.green);
  $("#statusPill").textContent = isCurrent ? "지금 하고 있어요" : "다음 일정";
  $("#timeRange").textContent = `${featured.startTime} — ${CR.fromMinutes(end)}`;
  $("#subjectName").textContent = subject?.name || featured.category;
  $("#routineTitle").textContent = titleOf(featured);
  $("#mainMessage").textContent = messages.event || messages.subject || (isCurrent ? "집중해서 함께해요." : "미리 준비해 주세요.");
  const notes = [["이전 수업 메모", messages.handoff], ["추가 안내", messages.event && messages.subject ? messages.subject : ""]].filter(([, value]) => value);
  $("#messageGrid").innerHTML = notes.map(([label, value]) => `<div class="message-note"><b>${label}</b>${escapeHtml(value)}</div>`).join("");
  const resourceUrl = CR.resourceUrlFor(featured, subjects);
  if (resourceUrl) $("#messageGrid").insertAdjacentHTML("beforeend", `<a class="resource-link" data-resource-link href="${escapeHtml(resourceUrl)}" target="_blank" rel="noopener noreferrer">수업 도구 열기 ↗</a>`);
  $("#countdownLabel").textContent = isCurrent ? "남은 시간" : "시작까지";
  $("#countdown").textContent = isCurrent ? `${Math.max(0, end - minute)}분` : `${Math.max(0, start - minute)}분`;
  const progress = isCurrent ? (minute - start) / Math.max(1, duration) * 100 : next ? Math.max(0, Math.min(100, 100 - (start - minute) / 60 * 100)) : 0;
  $("#progressBar").style.width = `${Math.max(0, Math.min(100, progress))}%`;
}
function isLunchRoutine(routine) { return /점심|급식/.test(`${routine?.title || ""} ${routine?.category || ""}`); }
function mealMenuText() { const meal = dailyInfo?.meal; return meal?.status === "ready" && meal.dishes?.length ? meal.dishes.map(dish => dish.name).join(" · ") : ""; }
function renderSchedule() { const list = todayRoutines(), minute = new Date().getHours() * 60 + new Date().getMinutes(); $("#daySummary").textContent = `${list.length}개의 일정`; $("#emptyDay").hidden = list.length > 0; $("#schedule").innerHTML = list.map(routine => { const subject = subjectOf(routine), state = stateAt(routine, minute), color = COLORS[routine.color] || subject?.color || COLORS.green, lunchMenu = isLunchRoutine(routine) ? mealMenuText() : ""; return `<article class="schedule-item ${state}" style="--row:${color}"><time>${routine.startTime}</time><i class="timeline-dot"></i><div class="schedule-copy"><small>${escapeHtml(routine.category)}</small><strong>${escapeHtml(titleOf(routine))}</strong>${lunchMenu ? `<p class="schedule-meal-menu">${escapeHtml(lunchMenu)}</p>` : ""}</div><span>${CR.durationFor(routine, settings)}분</span></article>`; }).join(""); }
function renderStudentMealDetail() {
  const meal = dailyInfo?.meal || {}, dishes = Array.isArray(meal.dishes) ? meal.dishes : [];
  $("#studentMealLargeTitle").textContent = meal.status === "ready" ? (meal.mealName || "오늘의 급식") : "오늘 급식 안내";
  $("#studentMealLargeMeta").textContent = meal.status === "ready" ? [meal.calories, "맛있고 안전하게 먹어요"].filter(Boolean).join(" · ") : (meal.message || "선생님과 오늘 식단을 확인해요.");
  $("#studentMealLargeDishes").innerHTML = dishes.length ? dishes.map((dish, index) => {
    const allergy = (dish.allergenCodes || []).map(code => `${code} ${CR.ALLERGENS[code] || ""}`.trim()).join(" · ");
    return `<article class="student-meal-large-dish"><i>${index + 1}</i><div><h3>${escapeHtml(dish.name)}</h3>${allergy ? `<p>${escapeHtml(allergy)}</p>` : ""}</div></article>`;
  }).join("") : `<div class="student-meal-large-empty">${escapeHtml(meal.message || "표시할 급식 메뉴가 없어요.")}</div>`;
}
function openStudentMeal() { renderStudentMealDetail(); $("#studentMealLayer").hidden = false; }
function closeStudentMeal() { $("#studentMealLayer").hidden = true; $("#studentMealCard").focus(); }
function renderDailyInfo() {
  if (!dailyInfo) return;
  const meal = dailyInfo.meal || {}, weather = dailyInfo.weather || {};
  $("#studentMealTitle").textContent = meal.status === "ready" ? (meal.mealName || "오늘 급식") : "오늘 급식 안내";
  $("#studentMealDishes").innerHTML = meal.status === "ready" ? meal.dishes.map(dish => `<span class="student-meal-chip"><strong>${escapeHtml(dish.name)}</strong></span>`).join("") : `<span class="student-meal-message">${escapeHtml(meal.message || "선생님과 오늘 식단을 확인해요.")}</span>`;
  $("#studentMealNotice").textContent = "카드를 누르면 메뉴와 알레르기 정보를 크게 볼 수 있어요.";
  const card = $("#studentWeatherCard"), level = weather.guidance?.level || ""; card.dataset.level = level;
  $("#studentWeatherIcon").textContent = weather.status === "ready" ? ({ "맑음":"☀", "구름많음":"☁", "흐림":"흐", "비":"우", "눈":"설" }[weather.condition] || "날") : "날";
  $("#studentOutdoorLabel").textContent = weather.status === "ready" ? weather.guidance.label : "오늘의 실외활동";
  $("#studentWeatherValues").textContent = weather.status === "ready" ? `${weather.condition} ${weather.temperature ?? "-"}℃ · 강수 ${weather.precipitationProbability ?? "-"}% · 바람 ${weather.windSpeed ?? "-"}m/s` : (weather.message || "선생님과 오늘 날씨를 확인해요.");
  $("#studentOutdoorMessage").textContent = weather.status === "ready" ? weather.guidance.message : "운동장 상태는 선생님과 함께 확인해요.";
  renderStudentMealDetail();
  renderSchedule();
  if (activeAlert && isLunchRoutine(activeAlert.routine)) renderAlertMeal(activeAlert.routine);
}
async function loadDailyInfo() {
  try { const response = await fetch("/api/daily-info", { cache:"no-store" }); if (!response.ok) throw new Error(); dailyInfo = await response.json(); renderDailyInfo(); }
  catch { dailyInfo = { meal:{ status:"error", message:"급식 정보를 확인할 수 없어요." }, weather:{ status:"error", message:"날씨 정보를 확인할 수 없어요." } }; renderDailyInfo(); }
}
function renderAll() { settings = CR.getSettings(); subjects = CR.getSubjects(); routines = CR.getRoutines(); records = CR.getRecords(); renderHeader(); renderClock(); renderFeatured(); renderSchedule(); renderDailyInfo(); }

function playSound(type = "chime") { CR.playSound(type); }
function activateSound() { CR.activateSound(); $("#soundHint").classList.add("ready"); }
function dutyBoardHtml() { const roles = CR.cleaningDutyAssignmentsForDate(new Date()); return roles.length ? roles.map(role => { const names = role.students.map(student => student ? `<span><b>${escapeHtml(student.number)}번</b>${escapeHtml(student.name)}</span>` : `<span class="empty-duty">미배정</span>`).join(""), primary = String(role.name || "").includes("크린토피아"); return `<article class="duty-alert-card ${primary ? "primary-duty" : "support-duty"}" data-color="${escapeHtml(role.color)}"><strong>${escapeHtml(role.name)}</strong><div>${names}</div></article>`; }).join("") : `<div class="duty-board-empty">오늘의 크린토피아와 우유 역할이 아직 배정되지 않았어요.</div>`; }
function renderAlertMeal(routine) {
  const board = $("#alertMealBoard"), meal = dailyInfo?.meal || {}, dishes = Array.isArray(meal.dishes) ? meal.dishes : [], lunch = isLunchRoutine(routine);
  board.hidden = !lunch;
  if (!lunch) return;
  $("#alertMealMeta").textContent = meal.status === "ready" ? [meal.mealName, meal.calories].filter(Boolean).join(" · ") : "급식 연결 확인";
  $("#alertMealDishes").innerHTML = dishes.length ? dishes.map(dish => { const allergy = (dish.allergenCodes || []).map(code => `${code} ${CR.ALLERGENS[code] || ""}`.trim()).join(" · "); return `<article><b>${escapeHtml(dish.name)}</b>${allergy ? `<span>${escapeHtml(allergy)}</span>` : ""}</article>`; }).join("") : `<p>${escapeHtml(meal.message || "표시할 급식 메뉴가 없어요.")}</p>`;
}
function showAlert(routine, phase) {
  const messages = CR.messagesFor(routine), subject = subjectOf(routine), cleaning = CR.isCleaningRoutine(routine), lunch = isLunchRoutine(routine);
  clearTimeout(alertTimer);
  activeAlert = { routine, phase };
  $("#alertLayer").classList.toggle("cleaning-alert", cleaning);
  $("#alertLayer").classList.toggle("lunch-alert", lunch);
  $("#alertBadge").textContent = phase === "pre" ? `${CR.preAlertFor(routine, settings)}분 전 알림` : "지금 시작해요";
  updateAlertTimes();
  $("#alertSubject").textContent = cleaning ? "오늘의 청소 역할" : subject?.name || routine.category;
  $("#alertTitle").textContent = routine.title;
  const rows = [["과목 안내", messages.subject], ["일정 안내", messages.event], ["이전 수업 메모", messages.handoff]].filter(([, value]) => value);
  $("#alertMessages").innerHTML = rows.length ? rows.map(([label, value]) => `<div class="alert-message"><b>${label}</b>${escapeHtml(value)}</div>`).join("") : `<div class="alert-message">${phase === "pre" ? "다음 일정을 준비해 주세요." : "자, 함께 시작해 볼까요?"}</div>`;
  const resourceUrl = CR.resourceUrlFor(routine, subjects);
  if (resourceUrl) $("#alertMessages").insertAdjacentHTML("beforeend", `<a class="resource-link" data-resource-link href="${escapeHtml(resourceUrl)}" target="_blank" rel="noopener noreferrer">수업 도구 열기 ↗</a>`);
  renderAlertMeal(routine);
  $("#dutyAlertBoard").hidden = !cleaning;
  $("#dutyAlertBoard").innerHTML = cleaning ? dutyBoardHtml() : "";
  $("#alertLayer").hidden = false;
  playSound(routine.sound);
  const now = new Date();
  if (phase === "start" && settings.windowsNotification && now.getHours() * 60 + now.getMinutes() === CR.toMinutes(routine.startTime)) window.classRoutineDesktop?.notifyRoutine({ id: routine.id, title: titleOf(routine), time: routine.startTime, phase, body: `${routine.startTime} · ${messages.event || messages.handoff || messages.subject || "시작할 시간이에요."}` });
  const seconds = cleaning ? Math.max(30, Number(settings.alertDisplaySeconds) || 0) : Number(settings.alertDisplaySeconds);
  if (seconds > 0) alertTimer = setTimeout(closeAlert, seconds * 1000);
}
function closeAlert() { clearTimeout(alertTimer); CR.stopSound(); $("#alertLayer").hidden = true; activeAlert = null; }
function checkAlarms() { const now = new Date(), key = `classRoutine.alerted.v3.${CR.dateKey()}`, alerted = CR.load(key, []); for (const routine of todayRoutines()) { const phase = CR.dueAlarmPhase(routine, now, alerted, settings); if (phase) { alerted.push(`${routine.id}:${phase}`); CR.save(key, alerted); showAlert(routine, phase); return; } } }
function checkDraw() { const result = CR.load("classRoutine.drawResult", null); if (!result || Date.now() - Number(result.at) > 15000 || checkDraw.last === result.at) return; checkDraw.last = result.at; clearTimeout(drawTimer); $("#drawName").textContent = result.name; $("#drawNumber").textContent = `${result.number}번`; $("#drawLayer").hidden = false; playSound("sparkle"); drawTimer = setTimeout(() => $("#drawLayer").hidden = true, 6500); }

$("#closeAlert").onclick = closeAlert;
$("#studentMealCard").onclick = openStudentMeal;
$("#studentMealCard").onkeydown = event => { if (!["Enter", " "].includes(event.key)) return; event.preventDefault(); openStudentMeal(); };
$("#closeStudentMeal").onclick = closeStudentMeal;
$("#confirmStudentMeal").onclick = closeStudentMeal;
$("#studentMealLayer").onclick = event => { if (event.target === event.currentTarget) closeStudentMeal(); };
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#studentMealLayer").hidden) closeStudentMeal(); });
$("#drawLayer").onclick = () => $("#drawLayer").hidden = true;
$("#studentTimerMinimize").onclick = () => { const timer = CR.load(CR.KEYS.quickTimer, null); studentTimerDismissedId = timer?.id || null; $("#studentTimerLayer").hidden = true; };
$("#soundButton").onclick = () => { settings.sound = !settings.sound; CR.setSettings(settings); activateSound(); if (settings.sound) playSound(); };
$("#fullButton").onclick = async () => { activateSound(); if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); };
document.addEventListener("pointerdown", activateSound, { once:true });
CR.onChange(() => { renderAll(); renderStudentTimer(); checkDraw(); });
renderAll(); renderStudentTimer(); checkDraw(); loadDailyInfo(); localStorage.setItem("classRoutine.studentHeartbeat", Date.now());
setInterval(() => { localStorage.setItem("classRoutine.studentHeartbeat", Date.now()); renderClock(); renderStudentTimer(); updateAlertTimes(); checkAlarms(); checkDraw(); if (new Date().getSeconds() === 0) { renderFeatured(); renderSchedule(); } }, 1000);
setInterval(loadDailyInfo, 10 * 60 * 1000);
