const CR = window.ClassRoutine;
const $ = selector => document.querySelector(selector);
const COLORS = { green: "#2f7666", orange: "#e76843", blue: "#4d7ea8", yellow: "#c99716" };
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
let settings = CR.getSettings(), subjects = CR.getSubjects(), routines = CR.getRoutines(), records = CR.getRecords();
let alertTimer = null, drawTimer = null;

function todayRoutines() { const now = new Date(); return routines.filter(item => CR.activeOn(item, now)).sort((a, b) => a.startTime.localeCompare(b.startTime)); }
function completed(id) { return records.some(item => item.date === CR.dateKey() && item.routineId === id && item.status === "완료"); }
function stateAt(routine, minute) { const start = CR.toMinutes(routine.startTime), end = start + CR.durationFor(routine, settings); return completed(routine.id) || minute >= end ? "done" : minute >= start && minute < end ? "active" : "upcoming"; }
function subjectOf(routine) { return CR.subjectFor(routine, subjects); }
function titleOf(routine) { const subject = subjectOf(routine); if (routine.type === "class" && routine.period) return `${routine.period}교시${subject ? ` ${subject.name}` : ""}`; return subject && !routine.title.includes(subject.name) ? `${routine.title} ${subject.name}` : routine.title; }
function currentAndNext() { const now = new Date(), minute = now.getHours() * 60 + now.getMinutes(), list = todayRoutines(), current = CR.primaryCurrentRoutine(list.filter(item => !completed(item.id)), now, settings), next = list.find(item => CR.toMinutes(item.startTime) > minute && !completed(item.id)); return { current, next, featured: current || next || null, minute }; }

function renderClock() { const now = new Date(); $("#dateText").textContent = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(now); $("#clock").textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; $("#seconds").textContent = String(now.getSeconds()).padStart(2, "0"); }
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
  $("#countdownLabel").textContent = isCurrent ? "남은 시간" : "시작까지";
  $("#countdown").textContent = isCurrent ? `${Math.max(0, end - minute)}분` : `${Math.max(0, start - minute)}분`;
  const progress = isCurrent ? (minute - start) / Math.max(1, duration) * 100 : next ? Math.max(0, Math.min(100, 100 - (start - minute) / 60 * 100)) : 0;
  $("#progressBar").style.width = `${Math.max(0, Math.min(100, progress))}%`;
}
function renderSchedule() { const list = todayRoutines(), minute = new Date().getHours() * 60 + new Date().getMinutes(); $("#daySummary").textContent = `${list.length}개의 일정`; $("#emptyDay").hidden = list.length > 0; $("#schedule").innerHTML = list.map(routine => { const subject = subjectOf(routine), state = stateAt(routine, minute), color = COLORS[routine.color] || subject?.color || COLORS.green; return `<article class="schedule-item ${state}" style="--row:${color}"><time>${routine.startTime}</time><i class="timeline-dot"></i><div class="schedule-copy"><small>${escapeHtml(routine.category)}</small><strong>${escapeHtml(titleOf(routine))}</strong></div><span>${CR.durationFor(routine, settings)}분</span></article>`; }).join(""); }
function renderAll() { settings = CR.getSettings(); subjects = CR.getSubjects(); routines = CR.getRoutines(); records = CR.getRecords(); renderHeader(); renderClock(); renderFeatured(); renderSchedule(); }

function playSound(type = "chime") { CR.playSound(type); }
function activateSound() { CR.activateSound(); $("#soundHint").classList.add("ready"); }
function dutyBoardHtml() { const roles = CR.dutyAssignments(); return roles.length ? roles.map(role => { const names = role.students.map(student => student ? `<span><b>${escapeHtml(student.number)}번</b>${escapeHtml(student.name)}</span>` : `<span class="empty-duty">미배정</span>`).join(""); return `<article class="duty-alert-card" data-color="${escapeHtml(role.color)}"><strong>${escapeHtml(role.name)}</strong><div>${names}</div></article>`; }).join("") : `<div class="duty-board-empty">1인 1역 배정표가 아직 없어요. 선생님과 역할을 확인해요.</div>`; }
function showAlert(routine, phase) { const messages = CR.messagesFor(routine), subject = subjectOf(routine), cleaning = CR.isCleaningRoutine(routine); clearTimeout(alertTimer); $("#alertLayer").classList.toggle("cleaning-alert", cleaning); $("#alertBadge").textContent = phase === "pre" ? `${CR.preAlertFor(routine, settings)}분 전 알림` : "지금 시작해요"; $("#alertTime").textContent = routine.startTime; $("#alertSubject").textContent = cleaning ? "우리 반 1인 1역" : subject?.name || routine.category; $("#alertTitle").textContent = routine.title; const rows = [["과목 안내", messages.subject], ["일정 안내", messages.event], ["이전 수업 메모", messages.handoff]].filter(([, value]) => value); $("#alertMessages").innerHTML = rows.length ? rows.map(([label, value]) => `<div class="alert-message"><b>${label}</b>${escapeHtml(value)}</div>`).join("") : `<div class="alert-message">${phase === "pre" ? "다음 일정을 준비해 주세요." : "자, 함께 시작해 볼까요?"}</div>`; $("#dutyAlertBoard").hidden = !cleaning; $("#dutyAlertBoard").innerHTML = cleaning ? dutyBoardHtml() : ""; $("#alertLayer").hidden = false; playSound(routine.sound); const seconds = cleaning ? Math.max(30, Number(settings.alertDisplaySeconds) || 0) : Number(settings.alertDisplaySeconds); if (seconds > 0) alertTimer = setTimeout(closeAlert, seconds * 1000); }
function closeAlert() { clearTimeout(alertTimer); $("#alertLayer").hidden = true; }
function checkAlarms() { const now = new Date(), minute = now.getHours() * 60 + now.getMinutes(), key = `classRoutine.alerted.v3.${CR.dateKey()}`, alerted = CR.load(key, []); for (const routine of todayRoutines()) { const pre = CR.preAlertFor(routine, settings), phases = []; if (pre !== null && minute === CR.toMinutes(routine.startTime) - pre) phases.push("pre"); if (minute === CR.toMinutes(routine.startTime)) phases.push("start"); const phase = phases.find(value => !alerted.includes(`${routine.id}:${value}`)); if (phase) { alerted.push(`${routine.id}:${phase}`); CR.save(key, alerted); showAlert(routine, phase); return; } } }
function checkDraw() { const result = CR.load("classRoutine.drawResult", null); if (!result || Date.now() - Number(result.at) > 15000 || checkDraw.last === result.at) return; checkDraw.last = result.at; clearTimeout(drawTimer); $("#drawName").textContent = result.name; $("#drawNumber").textContent = `${result.number}번`; $("#drawLayer").hidden = false; playSound("sparkle"); drawTimer = setTimeout(() => $("#drawLayer").hidden = true, 6500); }

$("#closeAlert").onclick = closeAlert;
$("#drawLayer").onclick = () => $("#drawLayer").hidden = true;
$("#soundButton").onclick = () => { settings.sound = !settings.sound; CR.setSettings(settings); activateSound(); if (settings.sound) playSound(); };
$("#fullButton").onclick = async () => { activateSound(); if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); };
document.addEventListener("pointerdown", activateSound, { once:true });
CR.onChange(() => { renderAll(); checkDraw(); });
renderAll(); checkDraw(); localStorage.setItem("classRoutine.studentHeartbeat", Date.now());
setInterval(() => { localStorage.setItem("classRoutine.studentHeartbeat", Date.now()); renderClock(); checkAlarms(); checkDraw(); if (new Date().getSeconds() === 0) { renderFeatured(); renderSchedule(); } }, 1000);
