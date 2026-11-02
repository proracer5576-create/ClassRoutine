const ALLERGENS = Object.freeze({
  "1":"난류", "2":"우유", "3":"메밀", "4":"땅콩", "5":"대두", "6":"밀",
  "7":"고등어", "8":"게", "9":"새우", "10":"돼지고기", "11":"복숭아",
  "12":"토마토", "13":"아황산류", "14":"호두", "15":"닭고기",
  "16":"쇠고기", "17":"오징어", "18":"조개류", "19":"잣"
});

const cache = new Map();
const kstParts = (date, options) => new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Seoul", ...options }).formatToParts(date).reduce((result, part) => (result[part.type] = part.value, result), {});
const dateKey = date => { const p = kstParts(date, { year:"numeric", month:"2-digit", day:"2-digit" }); return `${p.year}${p.month}${p.day}`; };
const timeKey = date => { const p = kstParts(date, { hour:"2-digit", minute:"2-digit", hourCycle:"h23" }); return `${p.hour}${p.minute}`; };

export function normalizeAllergenCodes(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[|,./\s]+/);
  return [...new Set(values.map(item => String(item).replace(/\D/g, "")).filter(code => ALLERGENS[code]))].sort((a, b) => Number(a) - Number(b));
}

export function parseMealDishes(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split(/\r?\n/).map(line => line.replace(/<[^>]+>/g, "").trim()).filter(Boolean).map(line => {
      const allergenCodes = [];
      line.replace(/\(([\d.]+)\)/g, (_match, group) => {
        group.split(".").filter(Boolean).forEach(code => { if (ALLERGENS[code] && !allergenCodes.includes(code)) allergenCodes.push(code); });
        return "";
      });
      return { name: line.replace(/\([\d.]+\)/g, "").replace(/\s+/g, " ").trim().slice(0, 100), allergenCodes };
    });
}

export function mealWarnings(meal, roster = []) {
  const dishes = Array.isArray(meal?.dishes) ? meal.dishes : [];
  return roster.map(student => {
    const codes = normalizeAllergenCodes(student.allergenCodes);
    const dishesToAvoid = dishes.filter(dish => dish.allergenCodes.some(code => codes.includes(code))).map(dish => ({
      name: dish.name,
      matchedCodes: dish.allergenCodes.filter(code => codes.includes(code)),
      matchedNames: dish.allergenCodes.filter(code => codes.includes(code)).map(code => ALLERGENS[code])
    }));
    return { number: student.number, name: student.name, allergenCodes: codes, allergenNames: codes.map(code => ALLERGENS[code]), dishes: dishesToAvoid };
  }).filter(item => item.dishes.length);
}

export function latestForecastBase(now = new Date()) {
  const lagged = new Date(now.getTime() - 45 * 60000);
  const hour = Number(timeKey(lagged).slice(0, 2));
  const selected = [2,5,8,11,14,17,20,23].filter(value => value <= hour).pop();
  if (selected != null) return { date:dateKey(lagged), time:`${String(selected).padStart(2, "0")}00` };
  const previous = new Date(lagged.getTime() - 24 * 60 * 60000);
  return { date:dateKey(previous), time:"2300" };
}

export function outdoorGuidance({ temperature, precipitationProbability, windSpeed, precipitationType }) {
  if (Number(precipitationType) > 0) return { level:"indoor", label:"실내활동 권장", message:"비나 눈 예보가 있어 실내 대체 활동을 준비해 주세요." };
  if ((temperature != null && (temperature >= 33 || temperature <= -10)) || (windSpeed != null && windSpeed >= 8) || (precipitationProbability != null && precipitationProbability >= 60)) return { level:"indoor", label:"실내활동 권장", message:"기온·바람·강수 가능성을 고려해 실내 대체 활동을 권장합니다." };
  if ((temperature != null && (temperature >= 30 || temperature <= 0)) || (windSpeed != null && windSpeed >= 5) || (precipitationProbability != null && precipitationProbability >= 30)) return { level:"caution", label:"조건 확인", message:"활동 전 운동장 상태와 학생 건강 상태를 한 번 더 확인해 주세요." };
  return { level:"good", label:"실외활동 가능", message:"현재 예보상 실외활동이 무난해 보여요. 현장 상태를 확인해 진행하세요." };
}

function weatherCondition(sky, precipitationType) {
  const precipitation = { 1:"비", 2:"비·눈", 3:"눈", 4:"소나기", 5:"빗방울", 6:"빗방울·눈날림", 7:"눈날림" };
  return precipitation[precipitationType] || (sky === 4 ? "흐림" : sky === 3 ? "구름많음" : "맑음");
}

function publicError(error, prefix) {
  const message = String(error?.message || error || "알 수 없는 오류").replace(/[\r\n]/g, " ").slice(0, 120);
  return { status:"error", message:`${prefix}: ${message}` };
}

async function fetchJson(url, fetchFn) {
  const response = await fetchFn(url, { headers:{ "User-Agent":"ClassRoutine/1.0" } });
  if (!response.ok) throw new Error(`외부 정보 서비스 응답 코드 ${response.status}`);
  return response.json();
}

export async function searchSchools(config = {}, query = "", { fetchFn = globalThis.fetch } = {}) {
  const safe = sanitizeIntegrationSettings(config);
  const schoolName = String(query || "").replace(/[\x00-\x1F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  if (schoolName.length < 2) return { status:"invalid", message:"학교 이름을 두 글자 이상 입력해 주세요.", schools:[] };
  if (!safe.neisApiKey) return { status:"unconfigured", message:"나이스 API 인증키를 먼저 입력해 주세요.", schools:[] };
  try {
    const params = new URLSearchParams({ KEY:safe.neisApiKey, Type:"json", pIndex:"1", pSize:"50", SCHUL_NM:schoolName });
    const data = await fetchJson(`https://open.neis.go.kr/hub/schoolInfo?${params}`, fetchFn);
    const blocks = Array.isArray(data.schoolInfo) ? data.schoolInfo : [];
    const rows = blocks.find(block => Array.isArray(block.row))?.row || [];
    const schools = rows.map(row => ({
      officeCode:String(row.ATPT_OFCDC_SC_CODE || "").slice(0, 10),
      officeName:String(row.ATPT_OFCDC_SC_NM || "").slice(0, 40),
      schoolCode:String(row.SD_SCHUL_CODE || "").slice(0, 20),
      schoolName:String(row.SCHUL_NM || "").slice(0, 60),
      schoolType:String(row.SCHUL_KND_SC_NM || "").slice(0, 30),
      address:String(row.ORG_RDNMA || row.ORG_RDNDA || "").slice(0, 120)
    })).filter(item => item.officeCode && item.schoolCode && item.schoolName);
    return schools.length
      ? { status:"ready", message:`${schools.length}개 학교를 찾았습니다.`, schools }
      : { status:"empty", message:"일치하는 학교가 없습니다. 정식 학교명을 확인해 주세요.", schools:[] };
  } catch (error) {
    return { ...publicError(error, "학교를 검색하지 못했습니다"), schools:[] };
  }
}

async function fetchMeal(config, now, fetchFn, force) {
  if (!config.neisApiKey) return { status:"unconfigured", message:"나이스 API 인증키를 설정해 주세요.", dishes:[] };
  if (!config.neisOfficeCode || !config.neisSchoolCode) return { status:"unconfigured", message:"나이스 교육청 코드와 학교 코드를 설정해 주세요.", dishes:[] };
  const date = dateKey(now), key = `meal:${config.neisOfficeCode}:${config.neisSchoolCode}:${date}`;
  if (!force && cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  try {
    const params = new URLSearchParams({ Type:"json", pIndex:"1", pSize:"10", ATPT_OFCDC_SC_CODE:config.neisOfficeCode, SD_SCHUL_CODE:config.neisSchoolCode, MLSV_YMD:date });
    params.set("KEY", config.neisApiKey);
    const data = await fetchJson(`https://open.neis.go.kr/hub/mealServiceDietInfo?${params}`, fetchFn);
    const blocks = Array.isArray(data.mealServiceDietInfo) ? data.mealServiceDietInfo : [];
    const rows = blocks.find(block => Array.isArray(block.row))?.row || [];
    const lunch = rows.find(row => String(row.MMEAL_SC_CODE) === "2" || String(row.MMEAL_SC_NM).includes("중식")) || rows[0];
    const value = lunch ? { status:"ready", date:String(lunch.MLSV_YMD || date), mealName:String(lunch.MMEAL_SC_NM || "오늘 급식").slice(0, 30), dishes:parseMealDishes(lunch.DDISH_NM), calories:String(lunch.CAL_INFO || "").slice(0, 40), source:"나이스 교육정보 개방 포털" } : { status:"empty", date, message:"오늘 등록된 급식 정보가 없습니다.", dishes:[], source:"나이스 교육정보 개방 포털" };
    cache.set(key, { value, expiresAt:Date.now() + 30 * 60000 });
    return value;
  } catch (error) { return { ...publicError(error, "급식 정보를 불러오지 못했습니다"), dishes:[] }; }
}

async function fetchWeather(config, now, fetchFn, force) {
  if (!config.weatherNx || !config.weatherNy || !config.kmaApiKey) return { status:"unconfigured", message:"기상청 격자 좌표와 API 인증키를 설정해 주세요." };
  const base = latestForecastBase(now), key = `weather:${config.weatherNx}:${config.weatherNy}:${base.date}:${base.time}`;
  if (!force && cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  try {
    const params = new URLSearchParams({ serviceKey:config.kmaApiKey, pageNo:"1", numOfRows:"1000", dataType:"JSON", base_date:base.date, base_time:base.time, nx:String(config.weatherNx), ny:String(config.weatherNy) });
    const data = await fetchJson(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${params}`, fetchFn);
    const response = data.response || {};
    if (String(response.header?.resultCode) !== "00") throw new Error(String(response.header?.resultMsg || "기상청 응답 오류"));
    const items = Array.isArray(response.body?.items?.item) ? response.body.items.item : [], grouped = {};
    for (const item of items) (grouped[`${item.fcstDate || ""}${item.fcstTime || ""}`] ||= {})[item.category] = item.fcstValue;
    const nowForecastKey = `${dateKey(now)}${timeKey(now)}`;
    const keys = Object.keys(grouped).filter(item => item.slice(0, 8) === nowForecastKey.slice(0, 8)).sort();
    const forecastAt = keys.find(item => item >= nowForecastKey) || keys.at(-1);
    if (!forecastAt) throw new Error("오늘 시간별 예보가 없습니다.");
    const values = grouped[forecastAt], number = value => Number.isFinite(Number(value)) ? Number(value) : null;
    const temperature = number(values.TMP), precipitationProbability = number(values.POP), windSpeed = number(values.WSD), humidity = number(values.REH), precipitationType = Number(values.PTY || 0);
    const value = { status:"ready", forecastAt, temperature, precipitationProbability, windSpeed, humidity, precipitation:String(values.PCP || "").slice(0, 30), condition:weatherCondition(Number(values.SKY || 1), precipitationType), guidance:outdoorGuidance({ temperature, precipitationProbability, windSpeed, precipitationType }), source:"기상청 단기예보" };
    cache.set(key, { value, expiresAt:Date.now() + 10 * 60000 });
    return value;
  } catch (error) { return publicError(error, "날씨를 불러오지 못했습니다"); }
}

export function sanitizeIntegrationSettings(value = {}, previous = {}) {
  const code = (input, max) => String(input || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);
  const grid = input => { const number = Number(input); return Number.isInteger(number) && number >= 1 && number <= 300 ? String(number) : ""; };
  const key = input => { let text = String(input || "").trim(); if (!text) return ""; try { text = decodeURIComponent(text); } catch {} return !/\s/.test(text) && text.length <= 1000 ? text : ""; };
  return {
    schoolName:String(value.schoolName ?? previous.schoolName ?? "").replace(/[\x00-\x1F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60),
    neisOfficeCode:code(value.neisOfficeCode ?? previous.neisOfficeCode, 10),
    neisSchoolCode:code(value.neisSchoolCode ?? previous.neisSchoolCode, 20),
    weatherNx:grid(value.weatherNx ?? previous.weatherNx), weatherNy:grid(value.weatherNy ?? previous.weatherNy),
    neisApiKey:value.clearNeisApiKey ? "" : key(value.neisApiKey) || String(previous.neisApiKey || ""),
    kmaApiKey:value.clearKmaApiKey ? "" : key(value.kmaApiKey) || String(previous.kmaApiKey || "")
  };
}

export function publicIntegrationSettings(value = {}) {
  return { schoolName:value.schoolName || "", neisOfficeCode:value.neisOfficeCode || "", neisSchoolCode:value.neisSchoolCode || "", weatherNx:value.weatherNx || "", weatherNy:value.weatherNy || "", hasNeisApiKey:Boolean(value.neisApiKey), hasKmaApiKey:Boolean(value.kmaApiKey) };
}

export async function loadDailyInfo(config = {}, { now = new Date(), fetchFn = globalThis.fetch, force = false } = {}) {
  const safe = sanitizeIntegrationSettings(config);
  const [meal, weather] = await Promise.all([fetchMeal(safe, now, fetchFn, force), fetchWeather(safe, now, fetchFn, force)]);
  return { date:dateKey(now), meal, weather, notice:"급식 알레르기와 실외활동 표시는 참고 정보입니다. 배식 전 학교 식단표와 현장 기상 상태를 다시 확인해 주세요." };
}

export { ALLERGENS };
