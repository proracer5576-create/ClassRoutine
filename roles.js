const CR = window.ClassRoutine;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const STORAGE_KEY = "classRoutine.duties.v1";
const API_BOARD = "/api/roles-csv";
const API_ROSTER = "/api/roster-csv";
const CATEGORY_LABELS = { classroom: "교실 관리", delivery: "배부·전달", cleaning: "청소·환경", support: "생활 지원", tech: "기기·시설" };

const DEFAULT_ROLES = [
  { id: "board", name: "칠판", category: "classroom", description: "수업 전후 칠판과 지우개를 정리해요.", capacity: 1, color: "coral" },
  { id: "rocket", name: "로켓배송", category: "delivery", description: "공책과 학습 자료를 빠르고 정확하게 전달해요.", capacity: 1, color: "coral" },
  { id: "environment", name: "환경부", category: "cleaning", description: "분리배출과 교실 환경을 살펴요.", capacity: 2, color: "coral" },
  { id: "milk", name: "우유배송", category: "delivery", description: "우유를 받아 배부하고 빈 상자를 정리해요.", capacity: 2, color: "coral" },
  { id: "clean-mon", name: "크린토피아 · 월", category: "cleaning", description: "월요일 청소 마무리를 확인해요.", capacity: 2, color: "blue" },
  { id: "clean-tue", name: "크린토피아 · 화", category: "cleaning", description: "화요일 청소 마무리를 확인해요.", capacity: 1, color: "blue" },
  { id: "clean-wed", name: "크린토피아 · 수", category: "cleaning", description: "수요일 청소 마무리를 확인해요.", capacity: 2, color: "blue" },
  { id: "clean-thu", name: "크린토피아 · 목", category: "cleaning", description: "목요일 청소 마무리를 확인해요.", capacity: 2, color: "blue" },
  { id: "clean-fri", name: "크린토피아 · 금", category: "cleaning", description: "금요일 청소 마무리를 확인해요.", capacity: 2, color: "blue" },
  { id: "health", name: "보건도우미", category: "support", description: "보건 용품과 아픈 친구의 이동을 도와요.", capacity: 1, color: "yellow" },
  { id: "notice", name: "안내장 확인", category: "support", description: "안내장 배부와 제출 여부를 확인해요.", capacity: 1, color: "yellow" },
  { id: "materials", name: "자료정리", category: "support", description: "함께 쓰는 자료를 제자리에 정리해요.", capacity: 1, color: "yellow" },
  { id: "engineer", name: "엔지니어", category: "tech", description: "전자기기, 충전 상태와 전원을 점검해요.", capacity: 4, color: "green" },
  { id: "windows", name: "창문 · 문틀", category: "tech", description: "환기하고 창문 주변을 안전하게 정리해요.", capacity: 1, color: "green" }
];

const clone = value => JSON.parse(JSON.stringify(value));
const defaultTerm = () => `${new Date().getFullYear()}학년도 ${new Date().getMonth() < 7 ? "1" : "2"}학기`;
const normalizeRole = role => ({
  id: role.id || CR.uid(), name: String(role.name || "새 역할"), category: CATEGORY_LABELS[role.category] ? role.category : "classroom",
  description: String(role.description || ""), capacity: Math.max(1, Math.min(10, Number(role.capacity) || 1)),
  color: ["coral", "blue", "yellow", "green"].includes(role.color) ? role.color : "coral"
});
const normalizeState = value => ({
  savedAt: value?.savedAt || "", term: value?.term || defaultTerm(),
  roles: Array.isArray(value?.roles) ? value.roles.map(normalizeRole) : clone(DEFAULT_ROLES),
  assignments: value?.assignments && typeof value.assignments === "object" ? value.assignments : {}
});

let roster = CR.load(CR.KEYS.roster, []);
let state = normalizeState(CR.load(STORAGE_KEY, null));
let saveTimer = null;

function studentKey(student) { return `${String(student.number).trim()}\u241f${String(student.name).trim()}`; }
function studentFor(key) { return roster.find(student => studentKey(student) === key) || null; }
function allAssignedKeys() { return state.roles.flatMap(role => (state.assignments[role.id] || []).filter(Boolean)); }
function slotCount() { return state.roles.reduce((sum, role) => sum + role.capacity, 0); }
function toast(message) { const box = $("#toast"); box.textContent = message; box.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove("show"), 2600); }

function parseCsv(text) {
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
  return rows.filter(values => values.some(value => String(value).trim()));
}

function parseRosterRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(value => String(value ?? "").replace(/^\uFEFF/, "").replace(/\s/g, "").toLowerCase());
  const nameIndex = headers.findIndex(value => value.includes("이름") || value.includes("성명") || value === "name");
  const numberIndex = headers.findIndex(value => value.includes("번호") || value === "no" || value === "number");
  const body = nameIndex >= 0 ? rows.slice(1) : rows;
  return body.map((row, index) => ({
    number: String(row[numberIndex >= 0 ? numberIndex : row.length > 1 ? 0 : -1] || index + 1).trim(),
    name: String(row[nameIndex >= 0 ? nameIndex : row.length > 1 ? 1 : 0] || "").trim()
  })).filter(item => item.name);
}

async function unzipXlsx(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer); let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  if (end < 0) throw new Error("올바른 XLSX 파일이 아닙니다.");
  const count = view.getUint16(end + 10, true), entries = new Map(); let position = view.getUint32(end + 16, true);
  for (let index = 0; index < count; index++) {
    const method = view.getUint16(position + 10, true), size = view.getUint32(position + 20, true), nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true), localOffset = view.getUint32(position + 42, true), name = new TextDecoder().decode(bytes.slice(position + 46, position + 46 + nameLength));
    entries.set(name, { method, size, localOffset }); position += 46 + nameLength + extraLength + commentLength;
  }
  async function extract(name) {
    const entry = entries.get(name); if (!entry) return null;
    const point = entry.localOffset, nameLength = view.getUint16(point + 26, true), extraLength = view.getUint16(point + 28, true), start = point + 30 + nameLength + extraLength, data = bytes.slice(start, start + entry.size);
    if (entry.method === 0) return data;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return { extract };
}

async function parseXlsx(file) {
  const zip = await unzipXlsx(await file.arrayBuffer()), decode = data => new TextDecoder().decode(data), xml = text => new DOMParser().parseFromString(text, "application/xml"), all = (doc, name) => [...doc.getElementsByTagNameNS("*", name)];
  const sharedBytes = await zip.extract("xl/sharedStrings.xml"), shared = sharedBytes ? all(xml(decode(sharedBytes)), "si").map(item => all(item, "t").map(text => text.textContent || "").join("")) : [];
  const workbook = xml(decode(await zip.extract("xl/workbook.xml"))), relations = xml(decode(await zip.extract("xl/_rels/workbook.xml.rels"))), sheet = all(workbook, "sheet")[0];
  const relationId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"), relation = all(relations, "Relationship").find(item => item.getAttribute("Id") === relationId);
  let target = relation.getAttribute("Target").replace(/^\//, ""); if (!target.startsWith("xl/")) target = `xl/${target.replace(/^\.\//, "")}`;
  const doc = xml(decode(await zip.extract(target))), rows = [];
  all(doc, "row").forEach(row => { const values = []; all(row, "c").forEach(cell => { const ref = cell.getAttribute("r"), letters = (ref.match(/[A-Z]+/) || ["A"])[0]; let column = 0; for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64; column--; const type = cell.getAttribute("t"), valueNode = all(cell, "v")[0]; values[column] = type === "s" && valueNode ? shared[Number(valueNode.textContent)] : type === "inlineStr" ? all(cell, "t").map(item => item.textContent || "").join("") : valueNode?.textContent || ""; }); rows.push(values); });
  return parseRosterRows(rows);
}

async function rosterFromFile(file) { return file.name.toLowerCase().endsWith(".xlsx") ? parseXlsx(file) : parseRosterRows(parseCsv(await file.text())); }
const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
function rosterCsv() { return "\uFEFF" + [["번호", "이름"], ...roster.map(student => [student.number, student.name])].map(row => row.map(csvCell).join(",")).join("\r\n"); }

function boardCsv() {
  const rows = [["저장시각", "배정기간", "역할ID", "역할명", "분류", "업무안내", "색상", "정원", "자리", "학생번호", "학생이름"]];
  state.roles.forEach(role => {
    for (let slot = 0; slot < role.capacity; slot++) {
      const student = studentFor(state.assignments[role.id]?.[slot]);
      rows.push([state.savedAt, state.term, role.id, role.name, role.category, role.description, role.color, role.capacity, slot + 1, student?.number || "", student?.name || ""]);
    }
  });
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

function boardFromCsv(text) {
  const rows = parseCsv(text); if (rows.length < 2) return null;
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, "")), at = name => headers.indexOf(name), roles = [], byId = new Map(), assignments = {};
  rows.slice(1).forEach(row => {
    const id = row[at("역할ID")]; if (!id) return;
    if (!byId.has(id)) {
      const role = normalizeRole({ id, name: row[at("역할명")], category: row[at("분류")], description: row[at("업무안내")], color: row[at("색상")], capacity: Number(row[at("정원")]) || 1 });
      byId.set(id, role); roles.push(role); assignments[id] = Array(role.capacity).fill("");
    }
    const slot = Math.max(0, Number(row[at("자리")]) - 1), number = row[at("학생번호")], name = row[at("학생이름")];
    if (name && slot < assignments[id].length) assignments[id][slot] = studentKey({ number, name });
  });
  if (!roles.length) return null;
  return normalizeState({ savedAt: rows[1][at("저장시각")] || "", term: rows[1][at("배정기간")] || defaultTerm(), roles, assignments });
}

async function putCsv(url, body) {
  if (!/^https?:$/.test(location.protocol)) return false;
  const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "text/csv; charset=utf-8" }, body });
  return response.ok;
}

async function syncRoster() {
  if (!/^https?:$/.test(location.protocol)) { $("#rosterState").textContent = roster.length ? "브라우저에 저장된 명렬표" : "명렬표를 연결해 주세요"; return; }
  try {
    const response = await fetch(API_ROSTER, { cache: "no-store" }), imported = response.ok ? parseRosterRows(parseCsv(await response.text())) : [];
    if (imported.length) { roster = imported; CR.save(CR.KEYS.roster, roster); }
    else if (roster.length) await putCsv(API_ROSTER, rosterCsv());
    $("#rosterState").textContent = roster.length ? "공용 데이터 폴더와 자동 연결됨" : "명렬표를 연결해 주세요";
  } catch { $("#rosterState").textContent = roster.length ? "브라우저 저장본 사용 중" : "명렬표를 연결해 주세요"; }
}

async function syncBoard() {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const response = await fetch(API_BOARD, { cache: "no-store" }), imported = response.ok ? boardFromCsv(await response.text()) : null;
    if (imported && String(imported.savedAt) >= String(state.savedAt || "")) { state = imported; CR.save(STORAGE_KEY, state); }
    else if (state.roles.length) await putCsv(API_BOARD, boardCsv());
  } catch {}
}

function reconcileAssignments() {
  const known = new Set(roster.map(studentKey)), used = new Set(); let changed = false;
  state.roles.forEach(role => {
    const source = state.assignments[role.id] || [], next = Array(role.capacity).fill("");
    for (let slot = 0; slot < role.capacity; slot++) {
      const key = source[slot];
      if (key && known.has(key) && !used.has(key)) { next[slot] = key; used.add(key); }
      else if (key) changed = true;
    }
    state.assignments[role.id] = next;
  });
  Object.keys(state.assignments).forEach(id => { if (!state.roles.some(role => role.id === id)) { delete state.assignments[id]; changed = true; } });
  return changed;
}

function scheduleFolderSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const saved = await putCsv(API_BOARD, boardCsv());
    $("#saveState").textContent = saved ? "공용 데이터 폴더에 자동 저장됨" : "브라우저에 자동 저장됨";
  }, 350);
}

function persist({ render = true } = {}) {
  state.savedAt = new Date().toISOString();
  CR.save(STORAGE_KEY, state); CR.notify("duties"); scheduleFolderSave();
  if (render) renderAll();
}

function renderSummary() {
  const assigned = new Set(allAssignedKeys()), unassigned = roster.filter(student => !assigned.has(studentKey(student))), slots = slotCount();
  $("#heroAssigned").textContent = assigned.size; $("#assignedCount").textContent = assigned.size; $("#unassignedCount").textContent = unassigned.length; $("#slotCount").textContent = slots;
  $("#rosterCount").textContent = roster.length; $("#unassignedBadge").textContent = `${unassigned.length}명`;
  $("#capacityMessage").textContent = !roster.length ? "명렬표를 연결하면 학생 이름이 배정판에 나타납니다." : slots === roster.length ? "학생 수와 역할 자리가 꼭 맞습니다." : slots < roster.length ? `역할 자리가 ${roster.length - slots}개 부족합니다. 역할의 인원수를 늘려 주세요.` : `학생 수보다 자리가 ${slots - roster.length}개 많습니다. 빈 자리는 그대로 둘 수 있습니다.`;
  $("#unassignedList").innerHTML = unassigned.length ? unassigned.map(student => `<span class="student-tag"><b>${escapeHtml(student.number)}</b>${escapeHtml(student.name)}</span>`).join("") : `<span class="all-done">✓ 모든 학생에게 역할이 있어요.</span>`;
  $("#unassignedSection").classList.toggle("complete", !unassigned.length);
}

function renderBoard() {
  const used = new Set(allAssignedKeys());
  $("#roleBoard").innerHTML = state.roles.map(role => {
    const slots = Array.from({ length: role.capacity }, (_, slot) => {
      const current = state.assignments[role.id]?.[slot] || "";
      const currentMissing = current && !studentFor(current);
      const options = roster.map(student => { const key = studentKey(student), disabled = used.has(key) && key !== current; return `<option value="${escapeHtml(key)}" ${key === current ? "selected" : ""} ${disabled ? "disabled" : ""}>${escapeHtml(student.number)}번 · ${escapeHtml(student.name)}${disabled ? " · 배정됨" : ""}</option>`; }).join("");
      return `<label class="role-slot"><span>${slot + 1}</span><select data-role="${escapeHtml(role.id)}" data-slot="${slot}" aria-label="${escapeHtml(role.name)} ${slot + 1}번째 학생"><option value="">학생 선택</option>${currentMissing ? `<option value="${escapeHtml(current)}" selected>명렬표에서 확인 필요</option>` : ""}${options}</select></label>`;
    }).join("");
    return `<article class="role-card" data-role-id="${escapeHtml(role.id)}" data-category="${escapeHtml(role.category)}" data-color="${escapeHtml(role.color)}"><header><div><span>${escapeHtml(CATEGORY_LABELS[role.category])} · ${role.capacity}명</span><h3>${escapeHtml(role.name)}</h3></div><button type="button" data-edit-role="${escapeHtml(role.id)}" aria-label="${escapeHtml(role.name)} 수정">···</button></header><p>${escapeHtml(role.description || "업무 안내를 적어 주세요.")}</p><div class="role-slots">${slots}</div></article>`;
  }).join("");
  $("#roleBoard").hidden = !state.roles.length; $("#boardEmpty").hidden = Boolean(state.roles.length);
}

function renderAll() { $("#termInput").value = state.term; renderSummary(); renderBoard(); }

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) { const random = new Uint32Array(1); crypto.getRandomValues(random); const swap = random[0] % (index + 1); [result[index], result[swap]] = [result[swap], result[index]]; }
  return result;
}

function autoAssign() {
  if (!roster.length) return toast("먼저 명렬표를 연결해 주세요.");
  if (allAssignedKeys().length && !confirm("현재 배정을 지우고 새로 자동 배정할까요?")) return;
  const students = shuffled(roster), next = {};
  state.roles.forEach(role => { next[role.id] = Array(role.capacity).fill(""); for (let slot = 0; slot < role.capacity; slot++) { const student = students.shift(); if (student) next[role.id][slot] = studentKey(student); } });
  state.assignments = next; persist(); toast("학생을 한 역할씩 자동 배정했어요.");
}

function openRole(role = null) {
  $("#roleDialogTitle").textContent = role ? "역할 수정" : "새 역할 만들기"; $("#roleId").value = role?.id || ""; $("#roleName").value = role?.name || ""; $("#roleCapacity").value = role?.capacity || 1; $("#roleCategory").value = role?.category || "classroom"; $("#roleDescription").value = role?.description || "";
  $$('[name="roleColor"]').forEach(input => input.checked = input.value === (role?.color || "coral")); $("#deleteRole").hidden = !role; $("#roleDialog").showModal();
}

async function connectRosterFile() {
  const input = document.createElement("input"); input.type = "file"; input.accept = ".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const imported = await rosterFromFile(file); if (!imported.length) throw new Error("학생을 찾지 못했습니다.");
      roster = imported; CR.save(CR.KEYS.roster, roster); CR.notify("roster"); reconcileAssignments(); const shared = await putCsv(API_ROSTER, rosterCsv()); persist(); $("#rosterState").textContent = `${file.name} · ${shared ? "공용 데이터 폴더에 저장됨" : "브라우저에 저장됨"}`; toast(`${roster.length}명의 명렬표를 연결했어요.`);
    } catch (error) { toast(error.message || "명렬표를 읽지 못했어요."); }
  };
  input.click();
}

$("#roleBoard").onchange = event => {
  const select = event.target.closest("select[data-role]"); if (!select) return;
  const roleId = select.dataset.role, slot = Number(select.dataset.slot), value = select.value;
  const duplicate = value && state.roles.some(role => (state.assignments[role.id] || []).some((key, index) => key === value && (role.id !== roleId || index !== slot)));
  if (duplicate) { toast("한 학생은 한 가지 역할에만 배정할 수 있어요."); renderBoard(); return; }
  state.assignments[roleId] ||= []; state.assignments[roleId][slot] = value; persist();
};
$("#roleBoard").onclick = event => { const button = event.target.closest("[data-edit-role]"); if (button) openRole(state.roles.find(role => role.id === button.dataset.editRole)); };
$("#autoAssign").onclick = autoAssign;
$("#clearAssignments").onclick = () => { if (allAssignedKeys().length && !confirm("현재 배정을 모두 비울까요?")) return; state.assignments = {}; persist(); toast("배정을 모두 비웠어요."); };
$("#printBoard").onclick = () => { location.href = "roles-print.html"; };
$("#addRole").onclick = () => openRole();
$("#restoreDefaults").onclick = () => { state.roles = clone(DEFAULT_ROLES); state.assignments = {}; persist(); };
$("#connectRoster").onclick = connectRosterFile;
$("#termInput").oninput = event => { state.term = event.target.value; $("#saveState").textContent = "저장 중…"; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist({ render: false }), 450); };
$("#downloadCsv").onclick = () => { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([boardCsv()], { type: "text/csv;charset=utf-8" })); link.download = `1인1역_배정_${CR.dateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href); };
$("#roleForm").onsubmit = event => {
  event.preventDefault(); const id = $("#roleId").value || CR.uid(), existing = state.roles.find(role => role.id === id), previousCapacity = existing?.capacity || 0;
  const role = normalizeRole({ id, name: $("#roleName").value.trim(), capacity: $("#roleCapacity").value, category: $("#roleCategory").value, description: $("#roleDescription").value.trim(), color: $('[name="roleColor"]:checked').value });
  const slots = state.assignments[id] || [];
  if (existing && role.capacity < previousCapacity && slots.slice(role.capacity).some(Boolean) && !confirm("줄어든 자리의 학생 배정이 해제됩니다. 계속할까요?")) return;
  if (existing) Object.assign(existing, role); else state.roles.push(role);
  state.assignments[id] = Array.from({ length: role.capacity }, (_, index) => slots[index] || "");
  $("#roleDialog").close(); persist(); toast(existing ? "역할을 수정했어요." : "새 역할을 추가했어요.");
};
$("#deleteRole").onclick = () => { const id = $("#roleId").value, role = state.roles.find(item => item.id === id); if (!role || !confirm(`“${role.name}” 역할을 삭제할까요?`)) return; state.roles = state.roles.filter(item => item.id !== id); delete state.assignments[id]; $("#roleDialog").close(); persist(); toast("역할을 삭제했어요."); };
$$('[data-close]').forEach(button => button.onclick = () => $("#" + button.dataset.close).close());

async function init() {
  await syncRoster(); await syncBoard();
  if (reconcileAssignments()) { state.savedAt = new Date().toISOString(); CR.save(STORAGE_KEY, state); scheduleFolderSave(); }
  renderAll(); $("#saveState").textContent = /^https?:$/.test(location.protocol) ? "공용 데이터 폴더와 동기화됨" : "브라우저에 자동 저장됨";
}

init();
