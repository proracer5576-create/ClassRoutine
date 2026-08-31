const CR = window.ClassRoutine;
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const CATEGORY_LABELS = { classroom: "교실 관리", delivery: "배부·전달", cleaning: "청소·환경", support: "생활 지원", tech: "기기·시설" };
let printData = null;

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

function fromCsv(text) {
  const rows = parseCsv(text); if (rows.length < 2) return null;
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, "")), at = name => headers.indexOf(name), roles = [], byId = new Map();
  rows.slice(1).forEach(row => {
    const id = row[at("역할ID")]; if (!id) return;
    if (!byId.has(id)) {
      const role = { id, name: row[at("역할명")] || "역할", category: row[at("분류")] || "classroom", description: row[at("업무안내")] || "", color: row[at("색상")] || "coral", capacity: Number(row[at("정원")]) || 1, students: [] };
      byId.set(id, role); roles.push(role);
    }
    const role = byId.get(id), slot = Math.max(0, Number(row[at("자리")]) - 1), name = row[at("학생이름")], number = row[at("학생번호")];
    role.students[slot] = name ? { number, name } : null;
  });
  return { term: rows[1][at("배정기간")] || "", savedAt: rows[1][at("저장시각")] || "", roles };
}

function fromLocal() {
  try {
    const state = JSON.parse(localStorage.getItem("classRoutine.duties.v1")); if (!state?.roles?.length) return null;
    return { term: state.term || "", savedAt: state.savedAt || "", roles: state.roles.map(role => ({ ...role, students: Array.from({ length: role.capacity }, (_, index) => { const key = state.assignments?.[role.id]?.[index]; if (!key) return null; const [number, name] = key.split("\u241f"); return name ? { number, name } : null; }) })) };
  } catch { return null; }
}

function chunks(items, size) { const result = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }

function printOrderedRoles(roles) {
  const order = ["board", "rocket", "environment", "milk", "health", "clean-mon", "clean-tue", "clean-wed", "clean-thu", "clean-fri", "notice", "materials", "engineer", "windows"];
  const rank = new Map(order.map((id, index) => [id, index]));
  return roles.map((role, index) => ({ role, index })).sort((a, b) => (rank.get(a.role.id) ?? 1000 + a.index) - (rank.get(b.role.id) ?? 1000 + b.index)).map(item => item.role);
}

function roleHtml(role, showEmpty, span = 1) {
  const students = Array.from({ length: role.capacity }, (_, index) => role.students[index] || null);
  const names = students.map(student => student
    ? `<div class="student-name"><b>${escapeHtml(student.number)}번</b><strong>${escapeHtml(student.name)}</strong></div>`
    : showEmpty ? `<div class="student-name empty"><b>－</b><strong>미배정</strong></div>` : `<div class="student-name empty"><strong>&nbsp;</strong></div>`).join("");
  return `<article class="print-role" data-color="${escapeHtml(role.color)}" data-capacity="${role.capacity}" style="--span:${span}"><div class="role-title"><small>${escapeHtml(CATEGORY_LABELS[role.category] || "우리 반 역할")} · ${role.capacity}명</small><h2>${escapeHtml(role.name)}</h2><p>${escapeHtml(role.description || "")}</p></div><div class="role-students">${names}</div></article>`;
}

function render() {
  if (!printData?.roles?.length) { $("#printPages").innerHTML = `<div class="loading"><b>출력할 역할이 없습니다.</b><span>배정 화면에서 역할을 만든 뒤 다시 열어 주세요.</span></div>`; return; }
  const showEmpty = $("#showEmpty").checked, roles = printOrderedRoles(printData.roles), settings = CR.getSettings(), columns = roles.length > 15 ? 6 : 5;
  const remainder = roles.length % columns, finalSpan = remainder ? columns - remainder + 1 : 1;
  $("#printPages").innerHTML = `<section class="print-page ${columns === 6 ? "dense" : ""}"><header class="sheet-head"><div><p>ONE STUDENT · ONE ROLE</p><h1>우리 반 1인 1역</h1></div><aside><strong>${escapeHtml(printData.term || "배정표")}</strong><span>${escapeHtml(settings.className || "우리 반")}</span></aside></header><div class="print-grid" data-columns="${columns}">${roles.map((role, index) => roleHtml(role, showEmpty, index === roles.length - 1 ? finalSpan : 1)).join("")}</div><footer class="sheet-foot"><b>오늘도, 차근차근</b><span>한 장 배정표</span></footer></section>`;
}

async function load() {
  const local = fromLocal(); printData = local;
  if (/^https?:$/.test(location.protocol)) {
    try { const response = await fetch("/api/roles-csv", { cache: "no-store" }), server = response.ok ? fromCsv(await response.text()) : null; if (server && (!local || String(server.savedAt) >= String(local.savedAt))) printData = server; } catch {}
  }
  render();
}

$("#printNow").onclick = () => window.print();
$("#showEmpty").onchange = render;
load();
