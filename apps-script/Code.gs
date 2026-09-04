const APP_TITLE = '오늘도, 차근차근 · 온라인 교실';
const PROP_DB_ID = 'CLASSROOM_HUB_SPREADSHEET_ID';
const PROP_MASTER_EMAILS = 'CLASSROOM_HUB_MASTER_EMAILS';
const PROP_SCHOOL_DOMAIN = 'CLASSROOM_HUB_SCHOOL_DOMAIN';
const PROP_NEIS_API_KEY = 'CLASSROOM_HUB_NEIS_API_KEY';
const PROP_KMA_API_KEY = 'CLASSROOM_HUB_KMA_API_KEY';
const MAX_TEXT = 500;
let DB_CACHE = null;
let SCHEMA_READY = false;

const ALLERGENS = Object.freeze({
  '1': '난류', '2': '우유', '3': '메밀', '4': '땅콩', '5': '대두', '6': '밀',
  '7': '고등어', '8': '게', '9': '새우', '10': '돼지고기', '11': '복숭아',
  '12': '토마토', '13': '아황산류', '14': '호두', '15': '닭고기',
  '16': '쇠고기', '17': '오징어', '18': '조개류', '19': '잣'
});

const TABLES = Object.freeze({
  Users: ['userId', 'email', 'role', 'classId', 'number', 'name', 'active', 'createdAt', 'updatedAt', 'allergenCodes'],
  Classes: ['classId', 'schoolName', 'className', 'teacherEmail', 'teacherName', 'active', 'createdAt', 'updatedAt', 'neisOfficeCode', 'neisSchoolCode', 'weatherNx', 'weatherNy'],
  State: ['classId', 'sessionId', 'subject', 'title', 'message', 'resourceLabel', 'resourceUrl', 'endsAt', 'pollQuestion', 'pollOptions', 'status', 'updatedAt'],
  Responses: ['responseId', 'sessionId', 'classId', 'email', 'name', 'type', 'value', 'createdAt', 'updatedAt'],
  HelpQueue: ['requestId', 'sessionId', 'classId', 'email', 'name', 'message', 'status', 'createdAt', 'resolvedAt'],
  AuditLog: ['auditId', 'actorEmail', 'action', 'classId', 'target', 'createdAt']
});

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = APP_TITLE;
  return template.evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Apps Script 편집기의 함수 목록에 표시되는 최초 설치 진입점이다.
 * 웹 앱 사용자가 초기화를 호출하지 못하도록 실행 계정과 접속 계정이
 * 동일한 경우에만 내부 초기화 함수를 실행한다.
 */
function setupDatabase() {
  const activeEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!activeEmail || !effectiveEmail || activeEmail !== effectiveEmail) {
    throw new Error('데이터 초기화는 Apps Script 편집기에서 배포 소유자만 실행할 수 있습니다.');
  }
  return setupDatabase_();
}

/** 브라우저에서 직접 호출할 수 없는 실제 초기화 구현이다. */
function setupDatabase_() {
  const properties = PropertiesService.getScriptProperties();
  const ownerEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!ownerEmail) throw new Error('설치 담당자의 Google Workspace 이메일을 확인할 수 없습니다.');

  let spreadsheetId = properties.getProperty(PROP_DB_ID);
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(`${APP_TITLE} 데이터`);
    spreadsheetId = spreadsheet.getId();
    properties.setProperty(PROP_DB_ID, spreadsheetId);
  }

  ensureSchema_(spreadsheet);
  DB_CACHE = spreadsheet;
  SCHEMA_READY = true;
  const masters = new Set(masterEmails_());
  masters.add(ownerEmail);
  properties.setProperty(PROP_MASTER_EMAILS, [...masters].join(','));
  if (!properties.getProperty(PROP_SCHOOL_DOMAIN)) {
    properties.setProperty(PROP_SCHOOL_DOMAIN, ownerEmail.split('@')[1] || '');
  }
  upsertRow_('Users', 'email', ownerEmail, {
    userId: id_('usr'), email: ownerEmail, role: 'master', classId: '', number: '',
    name: '관리자', active: true, createdAt: now_(), updatedAt: now_()
  });
  return { spreadsheetId, spreadsheetUrl: spreadsheet.getUrl(), masterEmail: ownerEmail };
}

function getBootstrap() {
  const actor = requireUser_(['master', 'teacher', 'student']);
  const base = { appTitle: APP_TITLE, actor: publicActor_(actor), serverTime: now_() };
  if (actor.role === 'master') return Object.assign(base, adminSnapshot_());
  if (actor.role === 'teacher') return Object.assign(base, teacherSnapshot_(actor.classId, actor));
  return Object.assign(base, studentSnapshot_(actor));
}

function getAppState(request) {
  const actor = requireUser_(['master', 'teacher', 'student']);
  const requestedClassId = cleanText_(request && request.classId, 80);
  if (actor.role === 'master') return Object.assign({ actor: publicActor_(actor), serverTime: now_() }, requestedClassId ? teacherSnapshot_(requestedClassId, actor) : adminSnapshot_());
  if (actor.role === 'teacher') return Object.assign({ actor: publicActor_(actor), serverTime: now_() }, teacherSnapshot_(actor.classId, actor));
  return Object.assign({ actor: publicActor_(actor), serverTime: now_() }, studentSnapshot_(actor));
}

function saveClass(payload) {
  const actor = requireUser_(['master']);
  const teacherEmail = requireEmail_(payload && payload.teacherEmail);
  assertSchoolDomain_(teacherEmail);
  const classId = cleanText_(payload && payload.classId, 80) || id_('cls');
  const current = findRow_('Classes', row => row.classId === classId);
  const timestamp = now_();
  const row = {
    classId,
    schoolName: cleanText_(payload && payload.schoolName, 80),
    className: cleanText_(payload && payload.className, 50),
    teacherEmail,
    teacherName: cleanText_(payload && payload.teacherName, 40),
    active: true,
    createdAt: current ? current.createdAt : timestamp,
    updatedAt: timestamp
  };
  if (!row.className || !row.teacherName) throw new Error('학급 이름과 교사 이름을 입력해 주세요.');

  withScriptLock_(() => {
    upsertRow_('Classes', 'classId', classId, row);
    upsertUser_(teacherEmail, {
      role: 'teacher', classId, number: '', name: row.teacherName, active: true
    });
    audit_(actor.email, current ? 'class.update' : 'class.create', classId, teacherEmail);
  });
  return adminSnapshot_();
}

function saveRoster(payload) {
  const actor = requireUser_(['master', 'teacher']);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const entries = Array.isArray(payload && payload.entries) ? payload.entries.slice(0, 80) : [];
  if (!entries.length) throw new Error('등록할 학생 이메일 명렬을 입력해 주세요.');

  const normalized = entries.map(entry => {
    const email = requireEmail_(entry.email);
    assertSchoolDomain_(email);
    const name = cleanText_(entry.name, 40);
    if (!name) throw new Error(`${email} 학생의 이름이 비어 있습니다.`);
    return {
      email, name, number: cleanText_(entry.number, 12),
      allergenCodes: normalizeAllergenCodes_(entry.allergenCodes).join('|')
    };
  });
  if (new Set(normalized.map(item => item.email)).size !== normalized.length) throw new Error('중복된 학생 이메일이 있습니다.');

  const existingUsers = readRows_('Users');
  normalized.forEach(entry => {
    const existing = existingUsers.find(row => normalizeEmail_(row.email) === entry.email);
    if (existing && existing.classId && existing.classId !== classId && actor.role !== 'master') {
      throw new Error(`${entry.email} 계정은 다른 학급에 등록되어 있습니다.`);
    }
  });
  withScriptLock_(() => {
    normalized.forEach(entry => upsertUser_(entry.email, {
      role: 'student', classId, number: entry.number, name: entry.name,
      allergenCodes: entry.allergenCodes, active: true
    }));
    audit_(actor.email, 'roster.upsert', classId, `${normalized.length}명`);
  });
  return teacherSnapshot_(classId, actor);
}

function saveServiceSettings(payload) {
  const actor = requireUser_(['master', 'teacher']);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const classroom = findRow_('Classes', row => row.classId === classId && truthy_(row.active));
  if (!classroom) throw new Error('담당 학급을 찾을 수 없습니다.');

  const neisOfficeCode = cleanCode_(payload && payload.neisOfficeCode, 10);
  const neisSchoolCode = cleanCode_(payload && payload.neisSchoolCode, 20);
  const weatherNx = cleanGrid_(payload && payload.weatherNx, '기상청 X 좌표');
  const weatherNy = cleanGrid_(payload && payload.weatherNy, '기상청 Y 좌표');
  const neisKey = cleanApiKey_(payload && payload.neisApiKey);
  const kmaKey = cleanApiKey_(payload && payload.kmaApiKey);

  withScriptLock_(() => {
    upsertRow_('Classes', 'classId', classId, Object.assign({}, classroom, {
      neisOfficeCode, neisSchoolCode, weatherNx, weatherNy, updatedAt: now_()
    }));
    const properties = PropertiesService.getScriptProperties();
    if (neisKey) properties.setProperty(PROP_NEIS_API_KEY, neisKey);
    if (kmaKey) properties.setProperty(PROP_KMA_API_KEY, kmaKey);
    audit_(actor.email, 'services.update', classId, 'NEIS/KMA configuration');
  });
  return teacherSnapshot_(classId, actor);
}

function refreshDailyInfo(payload) {
  const actor = requireUser_(['master', 'teacher']);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const classroom = findRow_('Classes', row => row.classId === classId && truthy_(row.active));
  if (!classroom) throw new Error('담당 학급을 찾을 수 없습니다.');
  clearDailyCaches_(classroom);
  return teacherSnapshot_(classId, actor);
}

function publishSession(payload) {
  const actor = requireUser_(['master', 'teacher']);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const resourceUrl = cleanHttpsUrl_(payload && payload.resourceUrl);
  const options = Array.isArray(payload && payload.pollOptions)
    ? payload.pollOptions.map(value => cleanText_(value, 60)).filter(Boolean).slice(0, 6)
    : [];
  const timestamp = now_();
  const endsAt = String(payload && payload.endsAt || '');
  if (endsAt && !Number.isFinite(Date.parse(endsAt))) throw new Error('종료 시각이 올바르지 않습니다.');
  const row = {
    classId,
    sessionId: id_('ses'),
    subject: cleanText_(payload && payload.subject, 30),
    title: cleanText_(payload && payload.title, 80),
    message: cleanText_(payload && payload.message, MAX_TEXT),
    resourceLabel: cleanText_(payload && payload.resourceLabel, 50),
    resourceUrl,
    endsAt,
    pollQuestion: cleanText_(payload && payload.pollQuestion, 160),
    pollOptions: JSON.stringify(options),
    status: 'active',
    updatedAt: timestamp
  };
  if (!row.title) throw new Error('학생에게 표시할 활동 이름을 입력해 주세요.');
  withScriptLock_(() => {
    upsertRow_('State', 'classId', classId, row);
    audit_(actor.email, 'session.publish', classId, row.sessionId);
  });
  return teacherSnapshot_(classId, actor);
}

function closeSession(payload) {
  const actor = requireUser_(['master', 'teacher']);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const state = findRow_('State', row => row.classId === classId);
  if (!state) return teacherSnapshot_(classId, actor);
  state.status = 'closed';
  state.updatedAt = now_();
  withScriptLock_(() => {
    upsertRow_('State', 'classId', classId, state);
    audit_(actor.email, 'session.close', classId, state.sessionId);
  });
  return teacherSnapshot_(classId, actor);
}

function submitStudentResponse(payload) {
  const actor = requireUser_(['student']);
  const state = activeStateForStudent_(actor, payload && payload.sessionId);
  const type = String(payload && payload.type || '');
  if (!['ready', 'understanding', 'poll', 'exit', 'duty'].includes(type)) throw new Error('허용되지 않은 응답 종류입니다.');
  const value = cleanText_(payload && payload.value, type === 'exit' ? 300 : 80);
  if (!value) throw new Error('응답 내용을 선택하거나 입력해 주세요.');
  const timestamp = now_();
  const existing = findRow_('Responses', row => row.sessionId === state.sessionId && normalizeEmail_(row.email) === actor.email && row.type === type);
  const response = {
    responseId: existing ? existing.responseId : id_('rsp'), sessionId: state.sessionId,
    classId: actor.classId, email: actor.email, name: actor.name, type, value,
    createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp
  };
  withScriptLock_(() => {
    upsertRow_('Responses', 'responseId', response.responseId, response);
    audit_(actor.email, `response.${type}`, actor.classId, state.sessionId);
  });
  return studentSnapshot_(actor);
}

function requestHelp(payload) {
  const actor = requireUser_(['student']);
  const state = activeStateForStudent_(actor, payload && payload.sessionId);
  const message = cleanText_(payload && payload.message, 160) || '도움이 필요해요.';
  const existing = findRow_('HelpQueue', row => row.sessionId === state.sessionId && normalizeEmail_(row.email) === actor.email && row.status === 'waiting');
  const request = existing || {
    requestId: id_('help'), sessionId: state.sessionId, classId: actor.classId,
    email: actor.email, name: actor.name, status: 'waiting', createdAt: now_(), resolvedAt: ''
  };
  request.message = message;
  withScriptLock_(() => upsertRow_('HelpQueue', 'requestId', request.requestId, request));
  return studentSnapshot_(actor);
}

function cancelHelp(payload) {
  const actor = requireUser_(['student']);
  const requestId = cleanText_(payload && payload.requestId, 80);
  const request = findRow_('HelpQueue', row => row.requestId === requestId && normalizeEmail_(row.email) === actor.email);
  if (request && request.status === 'waiting') {
    request.status = 'cancelled'; request.resolvedAt = now_();
    withScriptLock_(() => upsertRow_('HelpQueue', 'requestId', request.requestId, request));
  }
  return studentSnapshot_(actor);
}

function resolveHelp(payload) {
  const actor = requireUser_(['master', 'teacher']);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const requestId = cleanText_(payload && payload.requestId, 80);
  const request = findRow_('HelpQueue', row => row.requestId === requestId && row.classId === classId);
  if (request) {
    request.status = 'resolved'; request.resolvedAt = now_();
    withScriptLock_(() => {
      upsertRow_('HelpQueue', 'requestId', request.requestId, request);
      audit_(actor.email, 'help.resolve', classId, request.email);
    });
  }
  return teacherSnapshot_(classId, actor);
}

function adminSnapshot_() {
  const classes = readRows_('Classes').filter(row => truthy_(row.active)).map(row => ({
    classId: row.classId, schoolName: row.schoolName, className: row.className,
    teacherEmail: row.teacherEmail, teacherName: row.teacherName,
    studentCount: readRows_('Users').filter(user => user.classId === row.classId && user.role === 'student' && truthy_(user.active)).length
  }));
  return { view: 'master', classes, schoolDomain: PropertiesService.getScriptProperties().getProperty(PROP_SCHOOL_DOMAIN) || '' };
}

function teacherSnapshot_(classId, actor) {
  classId = authorizeClass_(actor, classId, ['master', 'teacher']);
  const classroom = findRow_('Classes', row => row.classId === classId && truthy_(row.active));
  if (!classroom) throw new Error('담당 학급을 찾을 수 없습니다.');
  const roster = readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active))
    .sort((a, b) => Number(a.number || 999) - Number(b.number || 999))
    .map(row => ({
      email: row.email, number: row.number, name: row.name,
      allergenCodes: normalizeAllergenCodes_(row.allergenCodes)
    }));
  const state = publicState_(findRow_('State', row => row.classId === classId));
  const sessionResponses = state && state.sessionId ? readRows_('Responses').filter(row => row.sessionId === state.sessionId) : [];
  const help = state && state.sessionId ? readRows_('HelpQueue').filter(row => row.sessionId === state.sessionId && row.status === 'waiting') : [];
  const counts = { ready: 0, exit: 0, duty: 0, understanding: {}, poll: {} };
  sessionResponses.forEach(row => {
    if (row.type === 'ready') counts.ready += 1;
    else if (row.type === 'exit') counts.exit += 1;
    else if (row.type === 'duty') counts.duty += 1;
    else if (row.type === 'understanding') counts.understanding[row.value] = (counts.understanding[row.value] || 0) + 1;
    else if (row.type === 'poll') counts.poll[row.value] = (counts.poll[row.value] || 0) + 1;
  });
  return {
    view: 'teacher', classId,
    classroom: { schoolName: classroom.schoolName, className: classroom.className, teacherName: classroom.teacherName },
    roster, state, counts,
    serviceSettings: publicServiceSettings_(classroom),
    dailyInfo: dailyInfoForClass_(classroom, [], roster),
    helpQueue: help.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(row => ({ requestId: row.requestId, number: roster.find(user => user.email === row.email)?.number || '', name: row.name, message: row.message, createdAt: row.createdAt }))
  };
}

function studentSnapshot_(actor) {
  authorizeClass_(actor, actor.classId, ['student']);
  const classroom = findRow_('Classes', row => row.classId === actor.classId && truthy_(row.active));
  if (!classroom) throw new Error('등록된 학급을 찾을 수 없습니다.');
  const state = publicState_(findRow_('State', row => row.classId === actor.classId));
  const ownResponses = {};
  if (state && state.sessionId) {
    readRows_('Responses').filter(row => row.sessionId === state.sessionId && normalizeEmail_(row.email) === actor.email)
      .forEach(row => { ownResponses[row.type] = row.value; });
  }
  const help = state && state.sessionId ? findRow_('HelpQueue', row => row.sessionId === state.sessionId && normalizeEmail_(row.email) === actor.email && row.status === 'waiting') : null;
  return {
    view: 'student', classId: actor.classId,
    classroom: { schoolName: classroom.schoolName, className: classroom.className },
    student: {
      number: actor.number, name: actor.name,
      allergenCodes: normalizeAllergenCodes_(actor.allergenCodes),
      allergenNames: allergenNames_(actor.allergenCodes)
    },
    dailyInfo: dailyInfoForClass_(classroom, normalizeAllergenCodes_(actor.allergenCodes), []),
    state, ownResponses,
    helpRequest: help ? { requestId: help.requestId, message: help.message, createdAt: help.createdAt } : null
  };
}

function publicServiceSettings_(classroom) {
  const properties = PropertiesService.getScriptProperties();
  return {
    neisOfficeCode: String(classroom.neisOfficeCode || ''),
    neisSchoolCode: String(classroom.neisSchoolCode || ''),
    weatherNx: String(classroom.weatherNx || ''),
    weatherNy: String(classroom.weatherNy || ''),
    hasNeisApiKey: Boolean(properties.getProperty(PROP_NEIS_API_KEY)),
    hasKmaApiKey: Boolean(properties.getProperty(PROP_KMA_API_KEY))
  };
}

function dailyInfoForClass_(classroom, personalAllergenCodes, roster) {
  const meal = fetchMeal_(classroom);
  const weather = fetchWeather_(classroom);
  const personalCodes = normalizeAllergenCodes_(personalAllergenCodes);
  const dishes = Array.isArray(meal.dishes) ? meal.dishes : [];
  const menuCodes = new Set(dishes.flatMap(dish => dish.allergenCodes || []));
  const warningDishes = dishes.filter(dish => (dish.allergenCodes || []).some(code => personalCodes.includes(code)))
    .map(dish => ({
      name: dish.name,
      matchedCodes: dish.allergenCodes.filter(code => personalCodes.includes(code)),
      matchedNames: allergenNames_(dish.allergenCodes.filter(code => personalCodes.includes(code)))
    }));
  const students = Array.isArray(roster) ? roster : [];
  const registeredAllergyStudents = students.filter(student => normalizeAllergenCodes_(student.allergenCodes).length).length;
  const warningStudentCount = students.filter(student => normalizeAllergenCodes_(student.allergenCodes).some(code => menuCodes.has(code))).length;

  return {
    date: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'),
    meal: Object.assign({}, meal, {
      personalAllergens: allergenNames_(personalCodes),
      warningDishes,
      registeredAllergyStudents,
      warningStudentCount
    }),
    weather,
    notice: '급식 알레르기 표시는 참고 정보입니다. 실제 배식 전 학교 제공 식단표와 제품 표시를 다시 확인해 주세요.'
  };
}

function fetchMeal_(classroom) {
  if (!classroom.neisOfficeCode || !classroom.neisSchoolCode) {
    return { status: 'unconfigured', message: '나이스 교육청 코드와 학교 코드를 설정해 주세요.', dishes: [] };
  }
  const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  const cache = CacheService.getScriptCache();
  const cacheKey = mealCacheKey_(classroom, date);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  try {
    const properties = PropertiesService.getScriptProperties();
    const params = {
      Type: 'json', pIndex: 1, pSize: 10,
      ATPT_OFCDC_SC_CODE: classroom.neisOfficeCode,
      SD_SCHUL_CODE: classroom.neisSchoolCode,
      MLSV_YMD: date
    };
    const apiKey = properties.getProperty(PROP_NEIS_API_KEY);
    if (apiKey) params.KEY = apiKey;
    const data = fetchJson_(`https://open.neis.go.kr/hub/mealServiceDietInfo?${queryString_(params)}`);
    const blocks = Array.isArray(data.mealServiceDietInfo) ? data.mealServiceDietInfo : [];
    const rowBlock = blocks.find(block => Array.isArray(block.row));
    const rows = rowBlock ? rowBlock.row : [];
    const lunch = rows.find(row => String(row.MMEAL_SC_CODE) === '2' || String(row.MMEAL_SC_NM).includes('중식')) || rows[0];
    const result = lunch ? {
      status: 'ready', date: String(lunch.MLSV_YMD || date), mealName: cleanText_(lunch.MMEAL_SC_NM || '오늘 급식', 30),
      dishes: parseDishes_(lunch.DDISH_NM), calories: cleanText_(lunch.CAL_INFO, 40),
      source: '나이스 교육정보 개방 포털', sampleMode: !apiKey
    } : { status: 'empty', date, message: '오늘 등록된 급식 정보가 없습니다.', dishes: [], source: '나이스 교육정보 개방 포털', sampleMode: !apiKey };
    cache.put(cacheKey, JSON.stringify(result), 1800);
    return result;
  } catch (error) {
    return { status: 'error', message: `급식 정보를 불러오지 못했습니다: ${cleanText_(error.message, 120)}`, dishes: [] };
  }
}

function fetchWeather_(classroom) {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = properties.getProperty(PROP_KMA_API_KEY);
  if (!classroom.weatherNx || !classroom.weatherNy || !apiKey) {
    return { status: 'unconfigured', message: '기상청 격자 좌표와 API 인증키를 설정해 주세요.' };
  }
  const base = latestForecastBase_();
  const nowKey = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmm');
  const cache = CacheService.getScriptCache();
  const cacheKey = weatherCacheKey_(classroom, base.date, base.time);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  try {
    const params = {
      serviceKey: apiKey, pageNo: 1, numOfRows: 1000, dataType: 'JSON',
      base_date: base.date, base_time: base.time,
      nx: classroom.weatherNx, ny: classroom.weatherNy
    };
    const data = fetchJson_(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${queryString_(params)}`);
    const response = data.response || {};
    if (!response.header || String(response.header.resultCode) !== '00') {
      throw new Error(cleanText_(response.header && response.header.resultMsg || '기상청 응답 오류', 100));
    }
    const items = response.body && response.body.items && Array.isArray(response.body.items.item) ? response.body.items.item : [];
    const grouped = {};
    items.forEach(item => {
      const key = `${item.fcstDate || ''}${item.fcstTime || ''}`;
      if (!grouped[key]) grouped[key] = {};
      grouped[key][item.category] = item.fcstValue;
    });
    const keys = Object.keys(grouped).filter(key => key.slice(0, 8) === nowKey.slice(0, 8)).sort();
    const forecastKey = keys.find(key => key >= nowKey) || keys[keys.length - 1];
    if (!forecastKey) throw new Error('오늘 시간별 예보가 없습니다.');
    const values = grouped[forecastKey];
    const temperature = numberOrNull_(values.TMP);
    const precipitationProbability = numberOrNull_(values.POP);
    const windSpeed = numberOrNull_(values.WSD);
    const humidity = numberOrNull_(values.REH);
    const precipitationType = Number(values.PTY || 0);
    const guidance = outdoorGuidance_({ temperature, precipitationProbability, windSpeed, precipitationType });
    const result = {
      status: 'ready', forecastAt: forecastKey,
      temperature, precipitationProbability, windSpeed, humidity,
      precipitation: cleanText_(values.PCP || '', 30),
      condition: weatherCondition_(Number(values.SKY || 1), precipitationType),
      guidance, source: '기상청 단기예보'
    };
    cache.put(cacheKey, JSON.stringify(result), 600);
    return result;
  } catch (error) {
    return { status: 'error', message: `날씨를 불러오지 못했습니다: ${cleanText_(error.message, 120)}` };
  }
}

function parseDishes_(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split(/\r?\n/).map(line => line.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
    .map(line => {
      const codes = [];
      line.replace(/\(([\d.]+)\)/g, (_, group) => {
        group.split('.').filter(Boolean).forEach(code => { if (ALLERGENS[code] && !codes.includes(code)) codes.push(code); });
        return '';
      });
      return { name: cleanText_(line.replace(/\([\d.]+\)/g, '').replace(/\s+/g, ' '), 100), allergenCodes: codes };
    });
}

function latestForecastBase_() {
  const lagged = new Date(Date.now() - 45 * 60000);
  const dateText = Utilities.formatDate(lagged, 'Asia/Seoul', 'yyyyMMdd');
  const hour = Number(Utilities.formatDate(lagged, 'Asia/Seoul', 'HH'));
  const hours = [2, 5, 8, 11, 14, 17, 20, 23];
  const selected = hours.filter(value => value <= hour).pop();
  if (selected != null) return { date: dateText, time: `${String(selected).padStart(2, '0')}00` };
  const previous = new Date(lagged.getTime() - 24 * 60 * 60000);
  return { date: Utilities.formatDate(previous, 'Asia/Seoul', 'yyyyMMdd'), time: '2300' };
}

function outdoorGuidance_(weather) {
  const temp = weather.temperature;
  const pop = weather.precipitationProbability;
  const wind = weather.windSpeed;
  if (weather.precipitationType > 0) return { level: 'indoor', label: '실내활동 권장', message: '비나 눈 예보가 있어 실내 대체 활동을 준비해 주세요.' };
  if ((temp != null && (temp >= 33 || temp <= -10)) || (wind != null && wind >= 8) || (pop != null && pop >= 60)) {
    return { level: 'indoor', label: '실내활동 권장', message: '기온·바람·강수 가능성을 고려해 실내 대체 활동을 권장합니다.' };
  }
  if ((temp != null && (temp >= 30 || temp <= 0)) || (wind != null && wind >= 5) || (pop != null && pop >= 30)) {
    return { level: 'caution', label: '조건 확인', message: '활동 전 운동장 상태와 학생 건강 상태를 한 번 더 확인해 주세요.' };
  }
  return { level: 'good', label: '실외활동 가능', message: '현재 예보상 실외활동이 무난해 보여요. 현장 상태를 확인해 진행하세요.' };
}

function weatherCondition_(sky, precipitationType) {
  const precipitation = { 1: '비', 2: '비·눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울·눈날림', 7: '눈날림' };
  if (precipitation[precipitationType]) return precipitation[precipitationType];
  return sky === 4 ? '흐림' : sky === 3 ? '구름많음' : '맑음';
}

function clearDailyCaches_(classroom) {
  const cache = CacheService.getScriptCache();
  const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  const base = latestForecastBase_();
  cache.remove(mealCacheKey_(classroom, date));
  cache.remove(weatherCacheKey_(classroom, base.date, base.time));
}

function mealCacheKey_(classroom, date) {
  return `meal:${classroom.neisOfficeCode || ''}:${classroom.neisSchoolCode || ''}:${date}`;
}

function weatherCacheKey_(classroom, date, time) {
  return `weather:${classroom.weatherNx || ''}:${classroom.weatherNy || ''}:${date}:${time}`;
}

function fetchJson_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(`외부 정보 서비스 응답 코드 ${code}`);
  try { return JSON.parse(response.getContentText('UTF-8')); }
  catch (error) { throw new Error('외부 정보 서비스의 응답 형식을 읽을 수 없습니다.'); }
}

function queryString_(params) {
  return Object.keys(params).filter(key => params[key] !== '' && params[key] != null)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`).join('&');
}

function normalizeAllergenCodes_(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[|,./\s]+/);
  return [...new Set(values.map(item => String(item).replace(/\D/g, '')).filter(code => ALLERGENS[code]))]
    .sort((a, b) => Number(a) - Number(b));
}

function allergenNames_(value) {
  return normalizeAllergenCodes_(value).map(code => ALLERGENS[code]);
}

function cleanCode_(value, maxLength) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, maxLength);
}

function cleanGrid_(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1 || number > 300) throw new Error(`${label}는 1~300 사이 정수로 입력해 주세요.`);
  return String(number);
}

function cleanApiKey_(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 1000 || /\s/.test(text)) throw new Error('API 인증키 형식을 확인해 주세요.');
  try { text = decodeURIComponent(text); } catch (error) {}
  return text;
}

function numberOrNull_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicState_(row) {
  if (!row || row.status !== 'active') return null;
  let pollOptions = [];
  try { pollOptions = JSON.parse(row.pollOptions || '[]'); } catch (error) {}
  return {
    classId: row.classId, sessionId: row.sessionId, subject: row.subject, title: row.title,
    message: row.message, resourceLabel: row.resourceLabel, resourceUrl: row.resourceUrl,
    endsAt: row.endsAt, pollQuestion: row.pollQuestion, pollOptions, status: row.status, updatedAt: row.updatedAt
  };
}

function activeStateForStudent_(actor, sessionId) {
  const state = findRow_('State', row => row.classId === actor.classId && row.status === 'active');
  if (!state || state.sessionId !== cleanText_(sessionId, 80)) throw new Error('현재 활동이 바뀌었습니다. 화면을 새로고침해 주세요.');
  return state;
}

function publicActor_(actor) {
  return { email: actor.email, role: actor.role, classId: actor.classId || '', number: actor.number || '', name: actor.name || '' };
}

function requireUser_(roles) {
  getDb_();
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!email) throw new Error('학교 Google 계정 정보를 확인할 수 없습니다. 학교 계정으로 로그인하고 조직 전용 배포 주소를 이용해 주세요.');
  const masters = masterEmails_();
  if (masters.includes(email)) return { email, role: 'master', classId: '', number: '', name: '관리자', active: true };
  const user = findRow_('Users', row => normalizeEmail_(row.email) === email);
  if (!user || !truthy_(user.active)) throw new Error('등록되지 않았거나 사용 중지된 계정입니다. 담당 교사에게 이메일 등록을 요청하세요.');
  if (!roles.includes(user.role)) throw new Error('이 기능을 사용할 권한이 없습니다.');
  user.email = email;
  return user;
}

function authorizeClass_(actor, requestedClassId, roles) {
  if (!roles.includes(actor.role)) throw new Error('이 학급에 접근할 권한이 없습니다.');
  const classId = cleanText_(requestedClassId, 80) || actor.classId;
  if (!classId) throw new Error('학급이 지정되지 않았습니다.');
  if (actor.role !== 'master' && actor.classId !== classId) throw new Error('다른 학급에는 접근할 수 없습니다.');
  return classId;
}

function upsertUser_(email, patch) {
  const existing = findRow_('Users', row => normalizeEmail_(row.email) === email);
  const timestamp = now_();
  upsertRow_('Users', 'email', email, Object.assign({
    userId: existing ? existing.userId : id_('usr'), email,
    createdAt: existing ? existing.createdAt : timestamp, updatedAt: timestamp
  }, existing || {}, patch, { email, updatedAt: timestamp }));
}

function ensureSchema_(spreadsheet) {
  Object.entries(TABLES).forEach(([name, headers]) => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      const columnCount = Math.max(1, sheet.getLastColumn());
      if (columnCount > headers.length) throw new Error(`${name} 시트의 머리글 열이 예상보다 많습니다.`);
      const actual = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
      if (actual.join('|') !== headers.slice(0, columnCount).join('|')) throw new Error(`${name} 시트의 머리글 구조가 예상과 다릅니다.`);
      if (columnCount < headers.length) sheet.getRange(1, columnCount + 1, 1, headers.length - columnCount).setValues([headers.slice(columnCount)]);
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#173d36').setFontColor('#ffffff');
  });
  const defaultSheet = spreadsheet.getSheetByName('Sheet1') || spreadsheet.getSheetByName('시트1');
  if (defaultSheet && spreadsheet.getSheets().length > Object.keys(TABLES).length) spreadsheet.deleteSheet(defaultSheet);
}

function getDb_() {
  if (DB_CACHE) return DB_CACHE;
  const id = PropertiesService.getScriptProperties().getProperty(PROP_DB_ID);
  if (!id) throw new Error('데이터 저장소가 준비되지 않았습니다. Apps Script 편집기에서 setupDatabase 함수를 먼저 실행하세요.');
  const spreadsheet = SpreadsheetApp.openById(id);
  if (!SCHEMA_READY) { ensureSchema_(spreadsheet); SCHEMA_READY = true; }
  DB_CACHE = spreadsheet;
  return DB_CACHE;
}

function sheet_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw new Error(`${name} 데이터 시트가 없습니다.`);
  return sheet;
}

function readRows_(name) {
  const sheet = sheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = TABLES[name];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map((values, index) => {
    const row = { __row: index + 2 };
    headers.forEach((header, column) => { row[header] = values[column]; });
    return row;
  });
}

function findRow_(name, predicate) {
  return readRows_(name).find(predicate) || null;
}

function upsertRow_(name, key, keyValue, value) {
  const sheet = sheet_(name);
  const headers = TABLES[name];
  const existing = readRows_(name).find(row => String(row[key]) === String(keyValue));
  const targetRow = existing ? existing.__row : sheet.getLastRow() + 1;
  const values = headers.map(header => safeCell_(value[header] == null ? '' : value[header]));
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([values]);
}

function audit_(actorEmail, action, classId, target) {
  const sheet = sheet_('AuditLog');
  const row = { auditId: id_('audit'), actorEmail, action, classId: classId || '', target: cleanText_(target, 160), createdAt: now_() };
  sheet.appendRow(TABLES.AuditLog.map(header => safeCell_(row[header] || '')));
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function masterEmails_() {
  return String(PropertiesService.getScriptProperties().getProperty(PROP_MASTER_EMAILS) || '')
    .split(',').map(normalizeEmail_).filter(Boolean);
}

function assertSchoolDomain_(email) {
  const domain = String(PropertiesService.getScriptProperties().getProperty(PROP_SCHOOL_DOMAIN) || '').toLowerCase();
  if (domain && email.split('@')[1] !== domain) throw new Error(`학교 계정(@${domain})만 등록할 수 있습니다.`);
}

function requireEmail_(value) {
  const email = normalizeEmail_(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('올바른 이메일 주소를 입력해 주세요.');
  return email;
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText_(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength || MAX_TEXT);
}

function cleanHttpsUrl_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https:\/\//i.test(text)) throw new Error('수업 링크는 https:// 주소만 사용할 수 있습니다.');
  return text.slice(0, 1000);
}

function safeCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function truthy_(value) {
  return value === true || String(value).toLowerCase() === 'true' || value === 1;
}

function id_(prefix) {
  return `${prefix}_${Utilities.getUuid().replace(/-/g, '').slice(0, 20)}`;
}

function now_() {
  return new Date().toISOString();
}
