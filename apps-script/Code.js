const APP_TITLE = '오늘도, 차근차근 · 교실 루틴';
const PROP_DB_ID = 'CLASSROOM_HUB_SPREADSHEET_ID';
const PROP_MASTER_EMAILS = 'CLASSROOM_HUB_MASTER_EMAILS';
const PROP_SCHOOL_DOMAIN = 'CLASSROOM_HUB_SCHOOL_DOMAIN';
const PROP_NEIS_API_KEY = 'CLASSROOM_HUB_NEIS_API_KEY';
const PROP_KMA_API_KEY = 'CLASSROOM_HUB_KMA_API_KEY';
const PROP_AUTH_SECRET = 'CLASSROOM_HUB_AUTH_SECRET';
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
  StudentProfiles: ['email', 'classId', 'gender', 'updatedAt'],
  Classes: ['classId', 'schoolName', 'className', 'teacherEmail', 'teacherName', 'active', 'createdAt', 'updatedAt', 'neisOfficeCode', 'neisSchoolCode', 'weatherNx', 'weatherNy'],
  State: ['classId', 'sessionId', 'subject', 'title', 'message', 'resourceLabel', 'resourceUrl', 'endsAt', 'pollQuestion', 'pollOptions', 'status', 'updatedAt'],
  Responses: ['responseId', 'sessionId', 'classId', 'email', 'name', 'type', 'value', 'createdAt', 'updatedAt'],
  HelpQueue: ['requestId', 'sessionId', 'classId', 'email', 'name', 'message', 'status', 'createdAt', 'resolvedAt'],
  AuditLog: ['auditId', 'actorEmail', 'action', 'classId', 'target', 'createdAt'],
  SubjectSettings: ['subjectKey', 'classId', 'subjectId', 'name', 'message', 'resourceLabel', 'resourceUrl', 'color', 'enabled', 'updatedAt'],
  WeekPlans: ['planId', 'classId', 'weekStart', 'planJson', 'revision', 'updatedAt'],
  ClassAnnouncements: ['classId', 'message', 'emphasis', 'updatedAt'],
  ClassPreferences: ['classId', 'preferencesJson', 'updatedAt'],
  RoutineSets: ['classId', 'routinesJson', 'updatedAt'],
  RoutineRecords: ['recordKey', 'classId', 'date', 'routineId', 'title', 'scheduledTime', 'completedAt', 'status', 'updatedBy', 'updatedAt'],
  RoutineHandoffs: ['handoffId', 'classId', 'sourceDate', 'sourceRoutineId', 'targetDate', 'targetRoutineId', 'studentNote', 'teacherNote', 'createdAt', 'archivedAt'],
  DutyBoards: ['classId', 'term', 'rolesJson', 'assignmentsJson', 'updatedAt'],
  SeatingBoards: ['classId', 'boardJson', 'revision', 'updatedAt'],
  SeatingHistory: ['historyKey', 'classId', 'round', 'savedAt', 'layoutJson', 'seatsJson'],
  ClassControls: ['classId', 'timerId', 'timerLabel', 'timerStartedAt', 'timerEndsAt', 'timerDurationSeconds', 'updatedAt'],
  LoginChallenges: ['challengeId', 'email', 'codeHash', 'attempts', 'expiresAt', 'usedAt', 'requestKeyHash', 'createdAt'],
  AuthSessions: ['sessionId', 'tokenHash', 'userId', 'email', 'requestKeyHash', 'expiresAt', 'revokedAt', 'createdAt']
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
  if (!properties.getProperty(PROP_SCHOOL_DOMAIN) && !/@gmail\.com$/.test(ownerEmail)) {
    properties.setProperty(PROP_SCHOOL_DOMAIN, ownerEmail.split('@')[1] || '');
  }
  authSecret_();
  upsertRow_('Users', 'email', ownerEmail, {
    userId: id_('usr'), email: ownerEmail, role: 'master', classId: '', number: '',
    name: '관리자', active: true, createdAt: now_(), updatedAt: now_()
  });
  return { spreadsheetId, spreadsheetUrl: spreadsheet.getUrl(), masterEmail: ownerEmail };
}

/**
 * 최초 1회 편집기에서 실행해 메일 발송 권한을 승인한다. 실제 메일은 보내지 않는다.
 */
function authorizeEmailLogin() {
  const activeEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!activeEmail || activeEmail !== effectiveEmail || !masterEmails_().includes(activeEmail)) {
    throw new Error('앱 소유자 계정으로 Apps Script 편집기에서 실행해 주세요.');
  }
  return { authorized: true, remainingDailyQuota: MailApp.getRemainingDailyQuota() };
}

function requestLoginCode(payload) {
  getDb_();
  const email = requireEmail_(payload && payload.email);
  const requestKeyHash = temporaryUserKeyHash_();
  const generic = { ok: true, message: '등록된 이메일이면 인증번호를 보냈습니다. 메일함을 확인해 주세요.' };
  const actor = registeredActor_(email);
  if (!actor) return generic;

  return withScriptLock_(() => {
    pruneAuthRows_();
    const now = Date.now();
    const recent = readRows_('LoginChallenges').filter(row => {
      const createdAt = Date.parse(row.createdAt || '');
      return Number.isFinite(createdAt) && createdAt >= now - 10 * 60 * 1000;
    });
    if (recent.filter(row => normalizeEmail_(row.email) === email).length >= 3 || recent.filter(row => row.requestKeyHash === requestKeyHash).length >= 5) {
      throw new Error('인증번호 요청이 너무 잦습니다. 10분 뒤 다시 시도해 주세요.');
    }

    const challengeId = id_('login');
    const code = randomDigits_(6);
    upsertRow_('LoginChallenges', 'challengeId', challengeId, {
      challengeId, email, codeHash: loginCodeHash_(email, challengeId, code), attempts: 0,
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(), usedAt: '', requestKeyHash, createdAt: now_()
    });
    const classroom = actor.classId ? findRow_('Classes', row => row.classId === actor.classId) : null;
    const classLabel = classroom ? `${classroom.schoolName || ''} ${classroom.className || ''}`.trim() : APP_TITLE;
    MailApp.sendEmail({
      to: email,
      subject: `[오늘도 차근차근] 로그인 인증번호 ${code}`,
      body: `${actor.name || '사용자'}님, ${classLabel} 로그인 인증번호는 ${code}입니다.\n\n인증번호는 10분 동안 유효하며 다른 사람에게 알려주지 마세요.`
    });
    audit_(email, 'auth.code.request', actor.classId || '', challengeId);
    return Object.assign({}, generic, { challengeId });
  });
}

function verifyLoginCode(payload) {
  getDb_();
  const email = requireEmail_(payload && payload.email);
  const challengeId = cleanIdentifier_(payload && payload.challengeId, 100);
  const code = String(payload && payload.code || '').replace(/\D/g, '').slice(0, 6);
  const requestKeyHash = temporaryUserKeyHash_();
  if (!challengeId || !/^\d{6}$/.test(code)) throw new Error('6자리 인증번호를 입력해 주세요.');

  return withScriptLock_(() => {
    const challenge = findRow_('LoginChallenges', row => row.challengeId === challengeId && normalizeEmail_(row.email) === email);
    if (!challenge || challenge.usedAt || challenge.requestKeyHash !== requestKeyHash || Date.parse(challenge.expiresAt || '') <= Date.now()) {
      throw new Error('인증번호가 만료되었거나 유효하지 않습니다. 새 인증번호를 받아 주세요.');
    }
    const attempts = Number(challenge.attempts) || 0;
    if (attempts >= 5) throw new Error('인증 시도 횟수를 초과했습니다. 새 인증번호를 받아 주세요.');
    if (challenge.codeHash !== loginCodeHash_(email, challengeId, code)) {
      upsertRow_('LoginChallenges', 'challengeId', challengeId, Object.assign({}, challenge, { attempts: attempts + 1 }));
      throw new Error('인증번호가 맞지 않습니다. 다시 확인해 주세요.');
    }

    const actor = registeredActor_(email);
    if (!actor) throw new Error('등록되지 않았거나 사용 중지된 계정입니다. 담당 교사에게 문의해 주세요.');
    upsertRow_('LoginChallenges', 'challengeId', challengeId, Object.assign({}, challenge, { attempts: attempts + 1, usedAt: now_() }));
    const token = randomToken_();
    const authSessionId = id_('auth');
    upsertRow_('AuthSessions', 'sessionId', authSessionId, {
      sessionId: authSessionId, tokenHash: authTokenHash_(token), userId: actor.userId || '', email,
      requestKeyHash, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), revokedAt: '', createdAt: now_()
    });
    audit_(email, 'auth.login', actor.classId || '', authSessionId);
    return { authToken: token, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), actor: publicActor_(actor) };
  });
}

function logoutSession(payload) {
  getDb_();
  const token = cleanText_(payload && payload._authToken, 200);
  if (!token) return { ok: true };
  return withScriptLock_(() => {
    const tokenHash = authTokenHash_(token);
    const session = findRow_('AuthSessions', row => row.tokenHash === tokenHash && !row.revokedAt);
    if (session) upsertRow_('AuthSessions', 'sessionId', session.sessionId, Object.assign({}, session, { revokedAt: now_() }));
    return { ok: true };
  });
}

function getBootstrap(request) {
  const actor = requireUser_(['master', 'teacher', 'student'], request);
  const base = { appTitle: APP_TITLE, actor: publicActor_(actor), serverTime: now_() };
  if (actor.role === 'master') return Object.assign(base, adminSnapshot_());
  if (actor.role === 'teacher') return Object.assign(base, teacherSnapshot_(actor.classId, actor));
  return Object.assign(base, studentSnapshot_(actor));
}

function getAppState(request) {
  const actor = requireUser_(['master', 'teacher', 'student'], request);
  const requestedClassId = cleanText_(request && request.classId, 80);
  const requestedWeekStart = cleanText_(request && request.weekStart, 10);
  if (actor.role === 'master') return Object.assign({ actor: publicActor_(actor), serverTime: now_() }, requestedClassId ? teacherSnapshot_(requestedClassId, actor, requestedWeekStart) : adminSnapshot_());
  if (actor.role === 'teacher') return Object.assign({ actor: publicActor_(actor), serverTime: now_() }, teacherSnapshot_(actor.classId, actor, requestedWeekStart));
  return Object.assign({ actor: publicActor_(actor), serverTime: now_() }, studentSnapshot_(actor));
}

function saveClass(payload) {
  const actor = requireUser_(['master'], payload);
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
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
  if (!entries.length) throw new Error('등록할 학생 이메일 명렬을 입력해 주세요.');
  if (entries.length > 80) throw new Error('학생 명렬은 한 번에 80명까지 등록할 수 있습니다.');

  const normalized = entries.map(entry => {
    const email = requireEmail_(entry.email);
    assertSchoolDomain_(email);
    const name = cleanText_(entry.name, 40);
    if (!name) throw new Error(`${email} 학생의 이름이 비어 있습니다.`);
    return {
      email, name, number: cleanText_(entry.number, 12),
      gender: entry && entry.gender != null ? normalizeGender_(entry.gender) : null,
      allergenCodes: normalizeAllergenCodes_(entry.allergenCodes).join('|')
    };
  });
  if (new Set(normalized.map(item => item.email)).size !== normalized.length) throw new Error('중복된 학생 이메일이 있습니다.');

  withScriptLock_(() => {
    const existingUsers = readRows_('Users');
    normalized.forEach(entry => {
      const existing = existingUsers.find(row => normalizeEmail_(row.email) === entry.email);
      if (existing && ['master', 'teacher'].includes(existing.role)) throw new Error(`${entry.email} 계정은 학생으로 변경할 수 없습니다.`);
      if (existing && existing.classId && existing.classId !== classId && actor.role !== 'master') {
        throw new Error(`${entry.email} 계정은 다른 학급에 등록되어 있습니다.`);
      }
    });
    normalized.forEach(entry => upsertUser_(entry.email, {
      role: 'student', classId, number: entry.number, name: entry.name,
      allergenCodes: entry.allergenCodes, active: true
    }));
    normalized.forEach(entry => {
      const previous = findRow_('StudentProfiles', row => normalizeEmail_(row.email) === entry.email);
      upsertRow_('StudentProfiles', 'email', entry.email, {
        email: entry.email, classId, gender: entry.gender == null ? String(previous && previous.gender || '') : entry.gender, updatedAt: now_()
      });
    });
    audit_(actor.email, 'roster.upsert', classId, `${normalized.length}명`);
  });
  return teacherSnapshot_(classId, actor);
}

function saveServiceSettings(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
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

function searchSchools(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const query = cleanText_(payload && payload.query, 50);
  if (query.length < 2) throw new Error('학교 이름을 두 글자 이상 입력해 주세요.');
  const apiKey = cleanApiKey_(payload && payload.neisApiKey) || PropertiesService.getScriptProperties().getProperty(PROP_NEIS_API_KEY);
  if (!apiKey) throw new Error('나이스 API 인증키를 먼저 입력해 주세요.');
  const data = fetchJson_(`https://open.neis.go.kr/hub/schoolInfo?${queryString_({
    KEY: apiKey, Type: 'json', pIndex: 1, pSize: 50, SCHUL_NM: query
  })}`);
  const blocks = Array.isArray(data.schoolInfo) ? data.schoolInfo : [];
  const rowBlock = blocks.find(block => Array.isArray(block.row));
  const schools = (rowBlock ? rowBlock.row : []).map(row => ({
    officeCode: cleanCode_(row.ATPT_OFCDC_SC_CODE, 10),
    officeName: cleanText_(row.ATPT_OFCDC_SC_NM, 40),
    schoolCode: cleanCode_(row.SD_SCHUL_CODE, 20),
    schoolName: cleanText_(row.SCHUL_NM, 60),
    schoolType: cleanText_(row.SCHUL_KND_SC_NM, 30),
    address: cleanText_(row.ORG_RDNMA || row.ORG_RDNDA, 120)
  })).filter(school => school.officeCode && school.schoolCode && school.schoolName);
  return { schools, message: schools.length ? `${schools.length}개 학교를 찾았습니다.` : '일치하는 학교가 없습니다. 정식 학교명을 확인해 주세요.' };
}

function refreshDailyInfo(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const classroom = findRow_('Classes', row => row.classId === classId && truthy_(row.active));
  if (!classroom) throw new Error('담당 학급을 찾을 수 없습니다.');
  clearDailyCaches_(classroom);
  return teacherSnapshot_(classId, actor);
}

function saveSubjectSetting(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const subjectId = cleanIdentifier_(payload && payload.subjectId, 80) || id_('sub');
  const row = {
    subjectKey: `${classId}::${subjectId}`,
    classId,
    subjectId,
    name: cleanText_(payload && payload.name, 40),
    message: cleanText_(payload && payload.message, 300),
    resourceLabel: cleanText_(payload && payload.resourceLabel, 60),
    resourceUrl: cleanHttpsUrl_(payload && payload.resourceUrl),
    color: cleanColor_(payload && payload.color),
    enabled: payload && payload.enabled !== false,
    updatedAt: now_()
  };
  if (!row.name) throw new Error('과목 이름을 입력해 주세요.');
  withScriptLock_(() => {
    upsertRow_('SubjectSettings', 'subjectKey', row.subjectKey, row);
    audit_(actor.email, 'subject.save', classId, row.name);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function saveWeekPlan(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const weekStart = normalizeWeekStart_(payload && payload.weekStart);
  const planId = `${classId}::${weekStart}`;
  const plan = normalizeWeekPlan_(payload && payload.plan);
  const expectedRevision = Math.max(0, Math.floor(Number(payload && payload.revision) || 0));
  withScriptLock_(() => {
    const current = findRow_('WeekPlans', row => row.planId === planId);
    const currentRevision = current ? Number(current.revision) || 0 : 0;
    if (currentRevision !== expectedRevision) throw new Error('다른 화면에서 시간표가 먼저 변경되었습니다. 새로고침 후 다시 저장해 주세요.');
    upsertRow_('WeekPlans', 'planId', planId, {
      planId, classId, weekStart, planJson: JSON.stringify(plan),
      revision: currentRevision + 1, updatedAt: now_()
    });
    audit_(actor.email, 'weekplan.save', classId, weekStart);
  });
  return teacherSnapshot_(classId, actor, weekStart);
}

function copyPreviousWeek(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const targetWeek = normalizeWeekStart_(payload && payload.weekStart);
  const plans = readRows_('WeekPlans').filter(row => row.classId === classId && String(row.weekStart) < targetWeek)
    .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
  if (!plans.length) throw new Error('복사할 이전 시간표가 없습니다.');
  const source = plans[0];
  const planId = `${classId}::${targetWeek}`;
  withScriptLock_(() => {
    const current = findRow_('WeekPlans', row => row.planId === planId);
    if (current && !(payload && payload.overwrite)) throw new Error('선택한 주에 이미 시간표가 있습니다. 덮어쓰기를 확인해 주세요.');
    upsertRow_('WeekPlans', 'planId', planId, {
      planId, classId, weekStart: targetWeek, planJson: source.planJson,
      revision: (Number(current && current.revision) || 0) + 1, updatedAt: now_()
    });
    audit_(actor.email, 'weekplan.copy', classId, `${source.weekStart} -> ${targetWeek}`);
  });
  return teacherSnapshot_(classId, actor, targetWeek);
}

function saveRoutine(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const input = payload && payload.routine || {};
  const normalized = normalizeRoutineSet_([Object.assign({}, input, { generated: false })])[0];
  if (!normalized || !normalized.title) throw new Error('일정 이름·시작 시각·요일을 확인해 주세요.');
  if (normalized.weekStart) normalizeWeekStart_(normalized.weekStart);
  withScriptLock_(() => {
    const row = findRow_('RoutineSets', item => item.classId === classId);
    const routines = normalizeRoutineSet_(parseJson_(row && row.routinesJson, []));
    const index = routines.findIndex(item => item.id === normalized.id);
    if (index >= 0 && routines[index].generated) throw new Error('시간표에서 자동 생성된 일정은 주간 시간표에서 수정해 주세요.');
    if (index < 0 && routines.length >= 180) throw new Error('반복 일정은 최대 180개까지 저장할 수 있습니다.');
    if (index >= 0) routines[index] = normalized;
    else routines.push(normalized);
    upsertRow_('RoutineSets', 'classId', classId, { classId, routinesJson: JSON.stringify(routines), updatedAt: now_() });
    audit_(actor.email, 'routine.save', classId, normalized.id);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function deleteRoutine(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const routineId = cleanIdentifier_(payload && payload.routineId, 100);
  if (!routineId) throw new Error('삭제할 일정을 선택해 주세요.');
  withScriptLock_(() => {
    const row = findRow_('RoutineSets', item => item.classId === classId);
    const routines = normalizeRoutineSet_(parseJson_(row && row.routinesJson, []));
    const target = routines.find(item => item.id === routineId);
    if (!target || target.generated) throw new Error('삭제할 개별 일정을 찾지 못했습니다.');
    upsertRow_('RoutineSets', 'classId', classId, { classId, routinesJson: JSON.stringify(routines.filter(item => item.id !== routineId)), updatedAt: now_() });
    audit_(actor.email, 'routine.delete', classId, routineId);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function completeRoutine(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const routineId = cleanIdentifier_(payload && payload.routineId, 100);
  const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const subjects = subjectSettingsFor_(classId);
  const schedule = scheduleForDate_(classId, subjects, date, 'teacher');
  const source = schedule.find(item => item.id === routineId);
  if (!source) throw new Error('오늘 일정에서 종료할 항목을 찾지 못했습니다.');
  const studentNote = cleanText_(payload && payload.studentNote, 300);
  const teacherNote = cleanText_(payload && payload.teacherNote, 300);
  if (source.type !== 'class' && (studentNote || teacherNote)) throw new Error('전달 메모는 수업 일정에만 남길 수 있습니다.');
  const next = studentNote || teacherNote ? nextClassAfter_(classId, subjects, date, source) : null;
  if ((studentNote || teacherNote) && !next) throw new Error('7일 안에 다음 수업이 없어 메모를 전달할 수 없습니다.');
  const recordKey = `${classId}::${date}::${routineId}`;
  const timestamp = now_();
  withScriptLock_(() => {
    upsertRow_('RoutineRecords', 'recordKey', recordKey, {
      recordKey, classId, date, routineId, title: source.title, scheduledTime: source.startTime,
      completedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm'), status: '완료', updatedBy: actor.email, updatedAt: timestamp
    });
    readRows_('RoutineHandoffs').filter(row => row.classId === classId && row.sourceDate === date && row.sourceRoutineId === routineId && !row.archivedAt)
      .forEach(row => upsertRow_('RoutineHandoffs', 'handoffId', row.handoffId, Object.assign({}, row, { archivedAt: timestamp })));
    if (next) {
      const handoffId = id_('handoff');
      upsertRow_('RoutineHandoffs', 'handoffId', handoffId, {
        handoffId, classId, sourceDate: date, sourceRoutineId: routineId,
        targetDate: next.date, targetRoutineId: next.item.id,
        studentNote, teacherNote, createdAt: timestamp, archivedAt: ''
      });
    }
    audit_(actor.email, 'routine.complete', classId, routineId);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function undoRoutineCompletion(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const routineId = cleanIdentifier_(payload && payload.routineId, 100);
  const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const recordKey = `${classId}::${date}::${routineId}`;
  withScriptLock_(() => {
    const record = findRow_('RoutineRecords', row => row.recordKey === recordKey);
    if (!record || record.status !== '완료') throw new Error('취소할 종료 기록이 없습니다.');
    const timestamp = now_();
    upsertRow_('RoutineRecords', 'recordKey', recordKey, Object.assign({}, record, { status: '취소', updatedBy: actor.email, updatedAt: timestamp }));
    readRows_('RoutineHandoffs').filter(row => row.classId === classId && row.sourceDate === date && row.sourceRoutineId === routineId && !row.archivedAt)
      .forEach(row => upsertRow_('RoutineHandoffs', 'handoffId', row.handoffId, Object.assign({}, row, { archivedAt: timestamp })));
    audit_(actor.email, 'routine.undo', classId, routineId);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function getRoutineHistory(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const date = String(payload && payload.date || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('기록 날짜를 확인해 주세요.');
  return {
    date,
    records: readRows_('RoutineRecords').filter(row => row.classId === classId && row.date === date && row.status === '완료')
      .sort((a, b) => String(a.scheduledTime).localeCompare(String(b.scheduledTime)))
      .map(row => ({ title: row.title, scheduledTime: row.scheduledTime, completedAt: row.completedAt, status: row.status }))
  };
}

function exportClassBackup(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  return withScriptLock_(() => {
    const classroom = findRow_('Classes', row => row.classId === classId);
    const users = readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active));
    const profiles = new Map(readRows_('StudentProfiles').filter(row => row.classId === classId).map(row => [normalizeEmail_(row.email), row]));
    const roster = users.map(row => ({
      number: String(row.number || ''), name: String(row.name || ''), email: String(row.email || ''),
      gender: String(profiles.get(normalizeEmail_(row.email))?.gender || ''),
      allergenCodes: normalizeAllergenCodes_(row.allergenCodes)
    }));
    const subjectSettings = subjectSettingsFor_(classId);
    const subjects = subjectSettings.map(item => ({
      id: item.subjectId, name: item.name, defaultMessage: item.message,
      resourceLabel: item.resourceLabel, resourceUrl: item.resourceUrl, color: item.color, enabled: item.enabled
    }));
    const routineRow = findRow_('RoutineSets', row => row.classId === classId);
    const routines = normalizeRoutineSet_(parseJson_(routineRow && routineRow.routinesJson, []));
    const records = readRows_('RoutineRecords').filter(row => row.classId === classId && row.status === '완료').map(row => ({
      id: row.recordKey, date: row.date, routineId: row.routineId, title: row.title,
      scheduledTime: row.scheduledTime, completedAt: row.completedAt, status: row.status
    }));
    const handoffs = readRows_('RoutineHandoffs').filter(row => row.classId === classId).map(row => ({
      id: row.handoffId, sourceRoutineId: row.sourceRoutineId, targetRoutineId: row.targetRoutineId,
      targetDate: row.targetDate, studentNote: row.studentNote, teacherNote: row.teacherNote,
      createdAt: row.createdAt, archived: Boolean(row.archivedAt), archivedAt: row.archivedAt
    }));
    const weeklyTimetables = {};
    readRows_('WeekPlans').filter(row => row.classId === classId).forEach(row => {
      const plan = normalizeWeekPlan_(parseJson_(row.planJson, {}));
      weeklyTimetables[String(row.weekStart)] = {
        start: String(row.weekStart), schedule: plan.schedule, timetable: plan.timetable, savedAt: String(row.updatedAt || '')
      };
    });
    const preferences = classPreferencesFor_(classId);
    const currentPlan = weekPlanFor_(classId, currentWeekStart_()).plan;
    const board = seatingBoardFor_(classId);
    const emailToKey = new Map(roster.map(item => [normalizeEmail_(item.email), `${item.number}␟${item.name}`]));
    const desktopSeats = entry => !entry ? null : {
      savedAt: entry.savedAt, layout: entry.layout,
      seats: Object.fromEntries(Object.entries(entry.seats || {}).map(([seat, email]) => [seat, emailToKey.get(normalizeEmail_(email)) || '']).filter(([, key]) => key))
    };
    audit_(actor.email, 'backup.export', classId, `${records.length}건 기록`);
    return {
      version: 4, exportedAt: now_(),
      settings: Object.assign({}, currentPlan.schedule, preferences, { className: classroom && classroom.className || '', timetable: currentPlan.timetable }),
      subjects, routines, records, handoffs, memos: {}, roster, weeklyTimetables,
      duties: dutyBoardFor_(classId),
      seating: { layout: board.layout, options: board.options, current: desktopSeats(board.current), history: board.history.map(desktopSeats) }
    };
  });
}

function saveSeatingBoard(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const roster = readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active));
  const board = normalizeSeatingBoard_(payload && payload.board, roster);
  const expectedRevision = Math.max(0, Math.floor(Number(payload && payload.revision) || 0));
  withScriptLock_(() => {
    const current = findRow_('SeatingBoards', row => row.classId === classId);
    const revision = Number(current && current.revision) || 0;
    if (revision !== expectedRevision) throw new Error('다른 화면에서 자리 배치가 변경되었습니다. 새로고침 후 다시 저장해 주세요.');
    const history = readRows_('SeatingHistory').filter(row => row.classId === classId).sort((a, b) => Number(a.round) - Number(b.round));
    if (board.history.length < history.length) throw new Error('저장된 자리 배치 이력은 이 화면에서 삭제할 수 없습니다.');
    history.forEach((row, index) => {
      const prior = board.history[index];
      if (!prior || prior.savedAt !== row.savedAt || JSON.stringify(prior.seats) !== JSON.stringify(parseJson_(row.seatsJson, {}))) {
        throw new Error('저장된 자리 배치 이력이 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
      }
    });
    board.history.slice(history.length).forEach((entry, index) => {
      const round = history.length + index + 1;
      upsertRow_('SeatingHistory', 'historyKey', `${classId}::${round}`, {
        historyKey: `${classId}::${round}`, classId, round, savedAt: entry.savedAt,
        layoutJson: JSON.stringify(entry.layout), seatsJson: JSON.stringify(entry.seats)
      });
    });
    upsertRow_('SeatingBoards', 'classId', classId, {
      classId, boardJson: JSON.stringify({ layout: board.layout, options: board.options, current: board.current }), revision: revision + 1, updatedAt: now_()
    });
    audit_(actor.email, 'seating.save', classId, `${board.history.length}회차`);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function saveDutyBoard(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const duty = normalizeDutyBoard_(payload && payload.board);
  const roster = readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active));
  const validStudents = new Set(roster.map(row => `${cleanText_(row.number, 12)}␟${cleanText_(row.name, 40)}`));
  Object.values(duty.assignments).flat().filter(Boolean).forEach(value => {
    if (!validStudents.has(value)) throw new Error('역할 배정에 현재 명렬과 일치하지 않는 학생이 있습니다.');
  });
  withScriptLock_(() => {
    const current = findRow_('DutyBoards', row => row.classId === classId);
    if (String(current && current.updatedAt || '') !== String(payload && payload.expectedUpdatedAt || '')) {
      throw new Error('다른 화면에서 1인 1역 배정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.');
    }
    upsertRow_('DutyBoards', 'classId', classId, {
      classId, term: duty.term, rolesJson: JSON.stringify(duty.roles),
      assignmentsJson: JSON.stringify(duty.assignments), updatedAt: now_()
    });
    audit_(actor.email, 'duty.save', classId, `${duty.roles.length}개 역할`);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function saveClassAnnouncement(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const row = {
    classId,
    message: cleanText_(payload && payload.message, 500),
    emphasis: ['normal', 'important', 'celebrate'].includes(String(payload && payload.emphasis)) ? String(payload.emphasis) : 'normal',
    updatedAt: now_()
  };
  withScriptLock_(() => {
    upsertRow_('ClassAnnouncements', 'classId', classId, row);
    audit_(actor.email, 'announcement.save', classId, row.emphasis);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function saveClassPreferences(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const preferences = normalizeClassPreferences_(payload && payload.preferences);
  withScriptLock_(() => {
    upsertRow_('ClassPreferences', 'classId', classId, { classId, preferencesJson: JSON.stringify(preferences), updatedAt: now_() });
    audit_(actor.email, 'preferences.save', classId, '');
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function startClassTimer(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const minutes = Math.max(1, Math.min(60, Math.floor(Number(payload && payload.minutes) || 0)));
  const row = {
    classId, timerId: id_('timer'),
    timerLabel: cleanText_(payload && payload.label, 60) || `${minutes}분 타이머`,
    timerStartedAt: now_(), timerEndsAt: new Date(Date.now() + minutes * 60000).toISOString(),
    timerDurationSeconds: minutes * 60, updatedAt: now_()
  };
  withScriptLock_(() => {
    upsertRow_('ClassControls', 'classId', classId, row);
    audit_(actor.email, 'timer.start', classId, `${minutes}분`);
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function stopClassTimer(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  withScriptLock_(() => {
    upsertRow_('ClassControls', 'classId', classId, { classId, timerId: '', timerLabel: '', timerStartedAt: '', timerEndsAt: '', timerDurationSeconds: '', updatedAt: now_() });
    audit_(actor.email, 'timer.stop', classId, '');
  });
  return teacherSnapshot_(classId, actor, payload && payload.weekStart);
}

function importDesktopBackup(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
  const classId = authorizeClass_(actor, payload && payload.classId, ['master', 'teacher']);
  const backup = payload && payload.backup;
  const options = payload && payload.options || {};
  if (!backup || typeof backup !== 'object') throw new Error('설치형 백업 파일을 확인할 수 없습니다.');
  const rawSize = JSON.stringify(backup).length;
  if (rawSize > 800000) throw new Error('백업 파일이 너무 큽니다. 800KB 이하 파일을 사용해 주세요.');
  if (options.subjects && !Array.isArray(backup.subjects)) throw new Error('백업 파일에 과목 목록이 없습니다.');
  if (options.timetables && (!backup.weeklyTimetables || typeof backup.weeklyTimetables !== 'object')) throw new Error('백업 파일에 주간 시간표가 없습니다.');
  if (options.routines && !Array.isArray(backup.routines)) throw new Error('백업 파일에 반복 일정이 없습니다.');
  if (options.duties && (!backup.duties || typeof backup.duties !== 'object')) throw new Error('백업 파일에 1인 1역 배정이 없습니다.');
  if (options.duties && !Array.isArray(backup.duties.roles)) throw new Error('백업 파일의 1인 1역 목록을 확인해 주세요.');
  if ((options.students || options.allergies) && !Array.isArray(backup.roster)) throw new Error('백업 파일에 학생 명렬이 없습니다.');
  if (options.subjects && Array.isArray(backup.subjects) && backup.subjects.length > 40) throw new Error('과목은 최대 40개까지 가져올 수 있습니다.');
  if (options.timetables && backup.weeklyTimetables && Object.keys(backup.weeklyTimetables).length > 16) throw new Error('주간 시간표는 최대 16주까지 가져올 수 있습니다.');
  if (options.routines && Array.isArray(backup.routines) && backup.routines.length > 180) throw new Error('반복 일정은 최대 180개까지 가져올 수 있습니다.');
  if ((options.students || options.allergies) && Array.isArray(backup.roster) && backup.roster.length > 80) throw new Error('학생 명렬은 최대 80명까지 가져올 수 있습니다.');
  if (options.records && Array.isArray(backup.records) && backup.records.length > 200) throw new Error('종료 기록은 한 번에 200건까지 가져올 수 있습니다.');
  if (options.handoffs && Array.isArray(backup.handoffs) && backup.handoffs.length > 200) throw new Error('전달 메모는 한 번에 200건까지 가져올 수 있습니다.');
  const summary = { subjects: 0, weeks: 0, routines: 0, duties: 0, students: 0, allergyUpdates: 0, records: 0, handoffs: 0, seatingHistory: 0, preferences: 0, rosterDrafts: 0, latestWeek: '' };

  withScriptLock_(() => {
    if (options.subjects) backup.subjects.forEach(item => {
      if (!cleanText_(item && item.name, 40)) throw new Error('백업 과목에 이름이 없는 항목이 있습니다.');
      cleanHttpsUrl_(item && item.resourceUrl);
    });
    if (options.timetables) Object.keys(backup.weeklyTimetables).forEach(key => {
      normalizeWeekStart_(key);
      const source = backup.weeklyTimetables[key] || {};
      normalizeWeekPlan_({ timetable: source.timetable, schedule: source.schedule });
    });
    if (options.routines && normalizeRoutineSet_(backup.routines).length !== backup.routines.length) {
      throw new Error('백업 일정 중 시각이나 요일이 빠진 항목이 있습니다.');
    }
    if (options.routines && !backup.routines.length && !(payload && payload.confirmEmptyRoutines)) {
      const existing = findRow_('RoutineSets', row => row.classId === classId);
      if (existing && normalizeRoutineSet_(parseJson_(existing.routinesJson, [])).length) throw new Error('현재 일정을 비우려면 덮어쓰기를 확인해 주세요.');
    }
    if (options.duties && normalizeDutyBoard_(backup.duties).roles.length !== (backup.duties.roles || []).length) {
      throw new Error('백업 역할 중 이름이 없는 항목이 있습니다.');
    }
    if (options.duties && !(backup.duties.roles || []).length && !(payload && payload.confirmEmptyDuties)) {
      const existing = findRow_('DutyBoards', row => row.classId === classId);
      if (existing && parseJson_(existing.rolesJson, []).length) throw new Error('현재 역할을 비우려면 덮어쓰기를 확인해 주세요.');
    }
    // Validate every selected student before writing any of the selected backup sections.
    if (options.students && Array.isArray(backup.roster)) {
      const users = readRows_('Users');
      const seenEmails = new Set();
      backup.roster.forEach(item => {
        const email = normalizeEmail_(item && item.email);
        if (!email) return;
        requireEmail_(email);
        assertSchoolDomain_(email);
        if (item.gender != null) normalizeGender_(item.gender);
        if (!cleanText_(item && item.name, 40)) throw new Error(`${email} 학생의 이름이 비어 있습니다.`);
        if (seenEmails.has(email)) throw new Error(`${email} 학생 이메일이 백업 명렬에서 중복되었습니다.`);
        seenEmails.add(email);
        const existing = users.find(row => normalizeEmail_(row.email) === email);
        if (existing && ['master', 'teacher'].includes(existing.role)) throw new Error(`${email} 계정은 학생으로 변경할 수 없습니다.`);
        if (existing && existing.classId && existing.classId !== classId && actor.role !== 'master') {
          throw new Error(`${email} 계정은 다른 학급에 등록되어 있습니다.`);
        }
      });
    }
    const importRecords = options.records ? normalizeImportedRecords_(backup.records, classId) : [];
    const importHandoffs = options.handoffs ? normalizeImportedHandoffs_(backup.handoffs, classId) : [];
    if (options.preferences && (!backup.settings || typeof backup.settings !== 'object')) throw new Error('백업 파일에 공통 설정이 없습니다. 이 항목을 해제하고 다시 가져와 주세요.');
    const importPreferences = options.preferences ? normalizeClassPreferences_(backup.settings) : null;
    let importSeating = null;
    if (options.seating) {
      if (!backup.seating || typeof backup.seating !== 'object') throw new Error('백업 파일에 자리 배치 데이터가 없습니다.');
      const currentRoster = readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active));
      const incomingRoster = options.students && Array.isArray(backup.roster) ? backup.roster.filter(item => normalizeEmail_(item && item.email)) : [];
      const futureRoster = new Map(currentRoster.map(item => [normalizeEmail_(item.email), item]));
      incomingRoster.forEach(item => futureRoster.set(normalizeEmail_(item.email), item));
      importSeating = normalizeSeatingBoard_(backup.seating, [...futureRoster.values()]);
      if (findRow_('SeatingBoards', row => row.classId === classId) && !(payload && payload.overwriteSeating)) {
        throw new Error('기존 자리 배치가 있습니다. 덮어쓰기를 확인한 뒤 다시 가져와 주세요.');
      }
    }
    if (options.subjects && Array.isArray(backup.subjects)) {
      backup.subjects.forEach(item => {
        const subjectId = cleanIdentifier_(item && item.id, 80) || id_('sub');
        const name = cleanText_(item && item.name, 40);
        if (!name) return;
        upsertRow_('SubjectSettings', 'subjectKey', `${classId}::${subjectId}`, {
          subjectKey: `${classId}::${subjectId}`, classId, subjectId, name,
          message: cleanText_(item.defaultMessage || item.message, 300),
          resourceLabel: cleanText_(item.resourceLabel, 60),
          resourceUrl: cleanHttpsUrl_(item.resourceUrl), color: cleanColor_(item.color),
          enabled: item.enabled !== false, updatedAt: now_()
        });
        summary.subjects += 1;
      });
    }
    if (options.timetables && backup.weeklyTimetables && typeof backup.weeklyTimetables === 'object') {
      Object.keys(backup.weeklyTimetables).sort().forEach(key => {
        const weekStart = normalizeWeekStart_(key);
        const source = backup.weeklyTimetables[key] || {};
        const importedSchedule = Object.assign({}, source.schedule || {});
        if (!importedSchedule.schoolLevel && backup.settings && backup.settings.schoolLevel) importedSchedule.schoolLevel = backup.settings.schoolLevel;
        const plan = normalizeWeekPlan_({ timetable: source.timetable, schedule: importedSchedule });
        const planId = `${classId}::${weekStart}`;
        const current = findRow_('WeekPlans', row => row.planId === planId);
        upsertRow_('WeekPlans', 'planId', planId, {
          planId, classId, weekStart, planJson: JSON.stringify(plan),
          revision: (Number(current && current.revision) || 0) + 1, updatedAt: now_()
        });
        summary.weeks += 1;
        if (!summary.latestWeek || weekStart > summary.latestWeek) summary.latestWeek = weekStart;
      });
    }
    if (options.routines && Array.isArray(backup.routines)) {
      const routines = normalizeRoutineSet_(backup.routines);
      upsertRow_('RoutineSets', 'classId', classId, { classId, routinesJson: JSON.stringify(routines), updatedAt: now_() });
      summary.routines = routines.length;
    }
    if (importPreferences) {
      upsertRow_('ClassPreferences', 'classId', classId, { classId, preferencesJson: JSON.stringify(importPreferences), updatedAt: now_() });
      summary.preferences = 1;
    }
    if (options.duties && backup.duties && typeof backup.duties === 'object') {
      const duty = normalizeDutyBoard_(backup.duties);
      upsertRow_('DutyBoards', 'classId', classId, {
        classId, term: duty.term, rolesJson: JSON.stringify(duty.roles),
        assignmentsJson: JSON.stringify(duty.assignments), updatedAt: now_()
      });
      summary.duties = duty.roles.length;
    }
    if (Array.isArray(backup.roster)) {
      summary.rosterDrafts = backup.roster.filter(item => !normalizeEmail_(item && item.email)).length;
    }
    if (options.students && Array.isArray(backup.roster)) {
      const seenEmails = new Set();
      backup.roster.forEach(item => {
        const email = normalizeEmail_(item && item.email);
        const name = cleanText_(item && item.name, 40);
        if (!email || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seenEmails.has(email)) return;
        seenEmails.add(email);
        assertSchoolDomain_(email);
        const existing = findRow_('Users', row => normalizeEmail_(row.email) === email);
        if (existing && ['master', 'teacher'].includes(existing.role)) return;
        upsertUser_(email, Object.assign({
          role: 'student', classId, number: cleanText_(item.number, 12), name, active: true
        }, options.allergies ? { allergenCodes: normalizeAllergenCodes_(item.allergenCodes).join('|') } : {}));
        const previousProfile = findRow_('StudentProfiles', row => normalizeEmail_(row.email) === email);
        upsertRow_('StudentProfiles', 'email', email, {
          email, classId, gender: item.gender == null ? String(previousProfile && previousProfile.gender || '') : normalizeGender_(item.gender), updatedAt: now_()
        });
        summary.students += 1;
      });
    }
    if (options.allergies && Array.isArray(backup.roster)) {
      const imported = backup.roster.slice(0, 80).map(item => ({
        number: cleanText_(item && item.number, 12), name: cleanText_(item && item.name, 40),
        allergenCodes: normalizeAllergenCodes_(item && item.allergenCodes).join('|')
      })).filter(item => item.number && item.name);
      readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active)).forEach(user => {
        const match = imported.find(item => item.number === cleanText_(user.number, 12) && item.name === cleanText_(user.name, 40));
        if (!match) return;
        upsertUser_(normalizeEmail_(user.email), { allergenCodes: match.allergenCodes });
        summary.allergyUpdates += 1;
      });
    }
    importRecords.forEach(record => {
      if (findRow_('RoutineRecords', row => row.recordKey === record.recordKey)) return;
      upsertRow_('RoutineRecords', 'recordKey', record.recordKey, record);
      summary.records += 1;
    });
    importHandoffs.forEach(handoff => {
      if (findRow_('RoutineHandoffs', row => row.handoffId === handoff.handoffId)) return;
      upsertRow_('RoutineHandoffs', 'handoffId', handoff.handoffId, handoff);
      summary.handoffs += 1;
    });
    if (importSeating) {
      const current = findRow_('SeatingBoards', row => row.classId === classId);
      if (current) deleteRowsWhere_('SeatingHistory', row => row.classId === classId);
      importSeating.history.forEach((entry, index) => upsertRow_('SeatingHistory', 'historyKey', `${classId}::${index + 1}`, {
        historyKey: `${classId}::${index + 1}`, classId, round: index + 1, savedAt: entry.savedAt,
        layoutJson: JSON.stringify(entry.layout), seatsJson: JSON.stringify(entry.seats)
      }));
      upsertRow_('SeatingBoards', 'classId', classId, {
        classId, boardJson: JSON.stringify({ layout: importSeating.layout, options: importSeating.options, current: importSeating.current }),
        revision: (Number(current && current.revision) || 0) + 1, updatedAt: now_()
      });
      summary.seatingHistory = importSeating.history.length;
    }
    audit_(actor.email, 'desktop.import', classId, JSON.stringify(summary));
  });
  const snapshotWeek = summary.latestWeek || payload && payload.weekStart;
  const snapshot = teacherSnapshot_(classId, actor, snapshotWeek);
  snapshot.importSummary = summary;
  return snapshot;
}

function publishSession(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
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
  const actor = requireUser_(['master', 'teacher'], payload);
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
  const actor = requireUser_(['student'], payload);
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
  const actor = requireUser_(['student'], payload);
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
  const actor = requireUser_(['student'], payload);
  const requestId = cleanText_(payload && payload.requestId, 80);
  const request = findRow_('HelpQueue', row => row.requestId === requestId && normalizeEmail_(row.email) === actor.email);
  if (request && request.status === 'waiting') {
    request.status = 'cancelled'; request.resolvedAt = now_();
    withScriptLock_(() => upsertRow_('HelpQueue', 'requestId', request.requestId, request));
  }
  return studentSnapshot_(actor);
}

function resolveHelp(payload) {
  const actor = requireUser_(['master', 'teacher'], payload);
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
  return {
    view: 'master', classes,
    schoolDomain: personalAccountMode_() ? '' : PropertiesService.getScriptProperties().getProperty(PROP_SCHOOL_DOMAIN) || '',
    accountMode: personalAccountMode_() ? 'personal' : 'workspace'
  };
}

function teacherSnapshot_(classId, actor, requestedWeekStart) {
  classId = authorizeClass_(actor, classId, ['master', 'teacher']);
  const classroom = findRow_('Classes', row => row.classId === classId && truthy_(row.active));
  if (!classroom) throw new Error('담당 학급을 찾을 수 없습니다.');
  const profiles = new Map(readRows_('StudentProfiles').filter(row => row.classId === classId).map(row => [normalizeEmail_(row.email), row]));
  const roster = readRows_('Users').filter(row => row.classId === classId && row.role === 'student' && truthy_(row.active))
    .sort((a, b) => Number(a.number || 999) - Number(b.number || 999))
    .map(row => ({
      email: row.email, number: row.number, name: row.name,
      gender: profiles.get(normalizeEmail_(row.email))?.gender || '',
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
  const weekStart = requestedWeekStart ? normalizeWeekStart_(requestedWeekStart) : currentWeekStart_();
  const subjects = subjectSettingsFor_(classId);
  const routineRow = findRow_('RoutineSets', row => row.classId === classId);
  const routines = normalizeRoutineSet_(parseJson_(routineRow && routineRow.routinesJson, [])).filter(item => !item.generated);
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  return {
    view: 'teacher', classId,
    classroom: { schoolName: classroom.schoolName, className: classroom.className, teacherName: classroom.teacherName },
    roster, state, counts, subjects, routines, preferences: classPreferencesFor_(classId),
    seating: seatingBoardFor_(classId),
    dutyBoard: dutyBoardFor_(classId),
    selectedWeekStart: weekStart,
    weekPlan: weekPlanFor_(classId, weekStart),
    todaySchedule: scheduleForDate_(classId, subjects, today, 'teacher'),
    todayRecords: readRows_('RoutineRecords').filter(row => row.classId === classId && row.date === today && row.status === '완료')
      .map(row => ({ routineId: row.routineId, completedAt: row.completedAt, title: row.title })),
    announcement: publicAnnouncement_(classId),
    classTimer: publicClassTimer_(classId),
    dutyToday: publicDutyForToday_(classId),
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
    preferences: classPreferencesFor_(actor.classId),
    todaySchedule: todayScheduleFor_(actor.classId, subjectSettingsFor_(actor.classId)),
    announcement: publicAnnouncement_(actor.classId),
    classTimer: publicClassTimer_(actor.classId),
    dutyToday: publicDutyForToday_(actor.classId),
    state, ownResponses,
    helpRequest: help ? { requestId: help.requestId, message: help.message, createdAt: help.createdAt } : null
  };
}

function defaultSubjectSettings_() {
  const names = ['국어', '사회', '도덕', '수학', '과학', '체육', '음악', '미술', '영어', '자율', '자치', '동아리'];
  const colors = ['green', 'orange', 'yellow', 'blue'];
  return names.map((name, index) => ({
    subjectId: `subject-${index + 1}`, name, message: '', resourceLabel: '', resourceUrl: '',
    color: colors[index % colors.length], enabled: true, updatedAt: ''
  }));
}

function subjectSettingsFor_(classId) {
  const merged = new Map(defaultSubjectSettings_().map(item => [item.subjectId, item]));
  readRows_('SubjectSettings').filter(row => row.classId === classId).forEach(row => {
    merged.set(String(row.subjectId), {
      subjectId: String(row.subjectId), name: String(row.name || ''), message: String(row.message || ''),
      resourceLabel: String(row.resourceLabel || ''), resourceUrl: String(row.resourceUrl || ''),
      color: cleanColor_(row.color), enabled: truthy_(row.enabled), updatedAt: String(row.updatedAt || '')
    });
  });
  return [...merged.values()].filter(item => item.name).slice(0, 40);
}

function weekPlanFor_(classId, weekStart) {
  weekStart = normalizeWeekStart_(weekStart);
  const row = findRow_('WeekPlans', item => item.classId === classId && String(item.weekStart) === weekStart);
  if (!row) return { weekStart, revision: 0, updatedAt: '', plan: normalizeWeekPlan_({}) };
  return {
    weekStart, revision: Number(row.revision) || 0, updatedAt: String(row.updatedAt || ''),
    plan: normalizeWeekPlan_(parseJson_(row.planJson, {}))
  };
}

function normalizeWeekPlan_(value) {
  value = value && typeof value === 'object' ? value : {};
  const sourceSchedule = value.schedule && typeof value.schedule === 'object' ? value.schedule : {};
  const activeDays = Array.isArray(sourceSchedule.activeDays)
    ? [...new Set(sourceSchedule.activeDays.map(Number).filter(day => day >= 1 && day <= 5))]
    : [1, 2, 3, 4, 5];
  const schoolLevel = ['elementary', 'middle', 'high', 'custom'].includes(String(sourceSchedule.schoolLevel))
    ? String(sourceSchedule.schoolLevel) : Number(sourceSchedule.classMinutes) === 45 ? 'middle' : Number(sourceSchedule.classMinutes) === 50 ? 'high' : 'elementary';
  const schedule = {
    activeDays: activeDays.length ? activeDays : [1, 2, 3, 4, 5],
    schoolLevel,
    firstStart: cleanTime_(sourceSchedule.firstStart) || '09:00',
    classMinutes: boundedInt_(sourceSchedule.classMinutes, 20, 90, 40),
    breakMinutes: boundedInt_(sourceSchedule.breakMinutes, 0, 40, 10),
    periodCount: boundedInt_(sourceSchedule.periodCount, 1, 8, 6),
    defaultPreAlert: boundedInt_(sourceSchedule.defaultPreAlert, 0, 30, 2),
    middlePlay: normalizeBreakSetting_(sourceSchedule.middlePlay, 2, 20),
    lunch: normalizeBreakSetting_(sourceSchedule.lunch, 4, 50),
    dismissal: {
      enabled: sourceSchedule.dismissal && typeof sourceSchedule.dismissal.enabled === 'boolean'
        ? sourceSchedule.dismissal.enabled : schoolLevel === 'elementary',
      afterFive: cleanTime_(sourceSchedule.dismissal && sourceSchedule.dismissal.afterFive) || '13:50',
      afterSix: cleanTime_(sourceSchedule.dismissal && sourceSchedule.dismissal.afterSix) || '14:40'
    }
  };
  const timetable = {};
  const sourceTable = value.timetable && typeof value.timetable === 'object' ? value.timetable : {};
  schedule.activeDays.forEach(day => {
    const sourceDay = sourceTable[day] && typeof sourceTable[day] === 'object' ? sourceTable[day] : {};
    timetable[day] = {};
    for (let period = 1; period <= schedule.periodCount; period += 1) {
      const subjectId = cleanIdentifier_(sourceDay[period], 80);
      if (subjectId) timetable[day][period] = subjectId;
    }
  });
  return { schedule, timetable };
}

function normalizeBreakSetting_(value, defaultAfter, defaultDuration) {
  value = value && typeof value === 'object' ? value : {};
  return {
    enabled: value.enabled === true || String(value.enabled).toLowerCase() === 'true',
    afterPeriod: boundedInt_(value.afterPeriod, 1, 8, defaultAfter),
    duration: boundedInt_(value.duration, 1, 120, defaultDuration)
  };
}

function currentWeekStart_() {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const date = new Date(`${today}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function normalizeWeekStart_(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('주간 시간표 날짜가 올바르지 않습니다.');
  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text || date.getUTCDay() !== 1) {
    throw new Error('주간 시간표의 시작일은 월요일이어야 합니다.');
  }
  return text;
}

function todayScheduleFor_(classId, subjects) {
  const dateText = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  return scheduleForDate_(classId, subjects, dateText, 'student');
}

function scheduleForDate_(classId, subjects, dateText, audience) {
  const day = new Date(`${dateText}T12:00:00Z`).getUTCDay();
  const weekStart = weekStartForDate_(dateText);
  const plan = weekPlanFor_(classId, weekStart).plan;
  const preferences = classPreferencesFor_(classId);
  const routineRow = findRow_('RoutineSets', row => row.classId === classId);
  const routines = normalizeRoutineSet_(parseJson_(routineRow && routineRow.routinesJson, []));
  const datedGenerated = routines.filter(item => item.generated && item.weekStart === weekStart && item.activeDays.includes(day));
  const items = datedGenerated.length
    ? datedGenerated.filter(item => item.enabled).map(item => publicRoutineScheduleItem_(item, subjects, plan.schedule.defaultPreAlert, preferences))
    : materializePlanDay_(plan, day, subjects, preferences);
  routines.filter(item => item.enabled && !item.generated && (!item.weekStart || item.weekStart === weekStart) && item.activeDays.includes(day))
    .forEach(item => items.push(publicRoutineScheduleItem_(item, subjects, plan.schedule.defaultPreAlert, preferences)));
  const unique = new Map();
  items.forEach(item => unique.set(`${item.startTime}|${item.type}|${item.title}`, item));
  const handoffs = readRows_('RoutineHandoffs').filter(row => row.classId === classId && row.targetDate === dateText && !row.archivedAt);
  return [...unique.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 32).map(item => {
    const handoff = handoffs.find(row => row.targetRoutineId === item.id);
    if (!handoff) return item;
    return Object.assign({}, item, { handoffMessage: String(handoff.studentNote || '') },
      audience === 'teacher' ? { teacherNote: String(handoff.teacherNote || '') } : {});
  });
}

function weekStartForDate_(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function nextClassAfter_(classId, subjects, dateText, source) {
  const start = new Date(`${dateText}T12:00:00Z`);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    const targetDate = date.toISOString().slice(0, 10);
    const classes = scheduleForDate_(classId, subjects, targetDate, 'teacher').filter(item => item.type === 'class');
    const next = classes.find(item => offset > 0 || item.startTime > source.startTime);
    if (next) return { date: targetDate, item: next };
  }
  return null;
}

function publicRoutineScheduleItem_(item, subjects, defaultPreAlert, preferences) {
  const subject = subjects.find(entry => entry.subjectId === item.subjectId);
  const isDismissal = /하교/.test(`${item.title} ${item.category}`);
  const common = preferences && preferences.commonMessages || {};
  const commonMessage = /중간놀이/.test(`${item.title} ${item.category}`) ? common.middlePlay
    : /점심|급식/.test(`${item.title} ${item.category}`) ? common.lunch
      : item.type === 'break' ? common.break : '';
  return {
    id: item.id, startTime: item.startTime, endTime: timeFromMinutes_(timeToMinutes_(item.startTime) + item.duration),
    type: item.type, period: Number(item.period) || 0,
    title: item.title || (subject && subject.name) || item.category || '일정',
    category: item.category || '', subject: subject ? subject.name : '',
    message: item.eventMessage || (subject && subject.message) || commonMessage || '',
    resourceLabel: subject && subject.resourceLabel || '', resourceUrl: subject && subject.resourceUrl || '',
    preAlertMinutes: isDismissal || item.preAlertMode === 'off' ? null
      : item.preAlertMode === 'custom' ? item.preAlertMinutes : defaultPreAlert
  };
}

function materializePlanDay_(plan, day, subjects, preferences) {
  const schedule = plan.schedule;
  if (!schedule.activeDays.includes(day)) return [];
  const table = plan.timetable[day] || {};
  const assigned = Object.keys(table).map(Number).filter(period => table[period]);
  const lastPeriod = assigned.length ? Math.max(...assigned) : 0;
  if (!lastPeriod) return [];
  const items = [];
  let cursor = timeToMinutes_(schedule.firstStart);
  for (let period = 1; period <= lastPeriod; period += 1) {
    const subjectId = String(table[period] || '');
    const subject = subjects.find(item => item.subjectId === subjectId);
    const startTime = timeFromMinutes_(cursor);
    const endTime = timeFromMinutes_(cursor + schedule.classMinutes);
    if (subjectId && subject) {
      items.push({
        id: `period-${day}-${period}`, startTime, endTime, type: 'class', period,
        title: subject.name, category: `${period}교시`, subject: subject.name,
        message: subject.message || '', resourceLabel: subject.resourceLabel || '', resourceUrl: subject.resourceUrl || '',
        preAlertMinutes: schedule.defaultPreAlert
      });
    }
    cursor += schedule.classMinutes;
    const middleHere = schedule.middlePlay.enabled && schedule.middlePlay.afterPeriod === period;
    const lunchHere = schedule.lunch.enabled && schedule.lunch.afterPeriod === period;
    if (period >= lastPeriod && !middleHere && !lunchHere) continue;
    let breakName = '쉬는 시간', breakType = 'break', breakDuration = schedule.breakMinutes;
    if (middleHere) {
      breakName = '중간놀이'; breakDuration = schedule.middlePlay.duration;
    } else if (lunchHere) {
      breakName = '점심시간'; breakType = 'other'; breakDuration = schedule.lunch.duration;
    }
    if (breakDuration > 0) {
      items.push({
        id: `break-${day}-${period}`, startTime: timeFromMinutes_(cursor), endTime: timeFromMinutes_(cursor + breakDuration),
        type: breakType, period: 0, title: breakName, category: breakName, subject: '',
        message: preferences && preferences.commonMessages && (breakName === '중간놀이' ? preferences.commonMessages.middlePlay : breakName === '점심시간' ? preferences.commonMessages.lunch : preferences.commonMessages.break) || '',
        resourceLabel: '', resourceUrl: '', preAlertMinutes: null
      });
      cursor += breakDuration;
    }
  }
  if (schedule.dismissal.enabled && (lastPeriod === 5 || lastPeriod === 6)) {
    const startTime = lastPeriod === 5 ? schedule.dismissal.afterFive : schedule.dismissal.afterSix;
    items.push({
      id: `dismissal-${day}-${lastPeriod}`, startTime, endTime: timeFromMinutes_(timeToMinutes_(startTime) + 1),
      type: 'other', period: 0, title: '하교', category: '하교', subject: '',
      message: '하교 준비를 마쳐요.', resourceLabel: '', resourceUrl: '', preAlertMinutes: null
    });
  }
  return items;
}

function publicAnnouncement_(classId) {
  const row = findRow_('ClassAnnouncements', item => item.classId === classId);
  return row ? { message: String(row.message || ''), emphasis: String(row.emphasis || 'normal'), updatedAt: String(row.updatedAt || '') } : { message: '', emphasis: 'normal', updatedAt: '' };
}

function normalizeClassPreferences_(value) {
  value = value && typeof value === 'object' ? value : {};
  const messages = value.commonMessages && typeof value.commonMessages === 'object' ? value.commonMessages : {};
  return {
    sound: value.sound !== false,
    globalSound: ['chime', 'wood', 'sparkle', 'none'].includes(String(value.globalSound)) ? String(value.globalSound) : 'chime',
    soundVolume: boundedInt_(value.soundVolume, 0, 150, 100),
    commonMessages: {
      break: Object.prototype.hasOwnProperty.call(messages, 'break') ? cleanText_(messages.break, 300) : '물을 마시거나 화장실을 다녀온 뒤 다음 수업을 준비해요.',
      middlePlay: Object.prototype.hasOwnProperty.call(messages, 'middlePlay') ? cleanText_(messages.middlePlay, 300) : '안전하게 놀이하고 종이 울리기 전에 교실로 돌아와요.',
      lunch: Object.prototype.hasOwnProperty.call(messages, 'lunch') ? cleanText_(messages.lunch, 300) : '손을 깨끗이 씻고 질서를 지켜 맛있게 먹어요.'
    }
  };
}

function classPreferencesFor_(classId) {
  const row = findRow_('ClassPreferences', item => item.classId === classId);
  return normalizeClassPreferences_(parseJson_(row && row.preferencesJson, {}));
}

function publicClassTimer_(classId) {
  const row = findRow_('ClassControls', item => item.classId === classId);
  if (!row || !row.timerId || !row.timerEndsAt) return null;
  return {
    timerId: String(row.timerId), label: String(row.timerLabel || '교실 타이머'),
    startedAt: String(row.timerStartedAt || ''), endsAt: String(row.timerEndsAt),
    durationSeconds: Number(row.timerDurationSeconds) || 0, updatedAt: String(row.updatedAt || '')
  };
}

function publicDutyForToday_(classId) {
  const row = findRow_('DutyBoards', item => item.classId === classId);
  if (!row) return { term: '', roles: [] };
  const roles = parseJson_(row.rolesJson, []);
  const assignments = parseJson_(row.assignmentsJson, {});
  const day = new Date(`${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')}T12:00:00Z`).getUTCDay();
  const dayName = ['', '월', '화', '수', '목', '금', '토'][day] || '';
  const visible = roles.filter(role => {
    const name = String(role && role.name || '');
    return name.includes('우유') || (name.includes('크린토피아') && (!/[월화수목금]/.test(name) || name.includes(dayName)));
  }).slice(0, 6).map(role => ({
    id: String(role.id || ''), name: String(role.name || ''), description: String(role.description || ''),
    students: (Array.isArray(assignments[role.id]) ? assignments[role.id] : []).slice(0, 8).map(value => {
      const parts = String(value || '').split('␟');
      return { number: cleanText_(parts[0], 12), name: cleanText_(parts.slice(1).join('␟'), 40) };
    }).filter(student => student.name)
  }));
  return { term: String(row.term || ''), roles: visible };
}

function dutyBoardFor_(classId) {
  const row = findRow_('DutyBoards', item => item.classId === classId);
  return row ? Object.assign(normalizeDutyBoard_({ term: row.term, roles: parseJson_(row.rolesJson, []), assignments: parseJson_(row.assignmentsJson, {}) }), { updatedAt: String(row.updatedAt || '') })
    : { term: '', roles: [], assignments: {}, updatedAt: '' };
}

function normalizeRoutineSet_(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 180).map(item => ({
    id: cleanIdentifier_(item && item.id, 100) || id_('routine'),
    startTime: cleanTime_(item && item.startTime),
    type: ['class', 'break', 'other'].includes(String(item && item.type)) ? String(item.type) : 'other',
    category: cleanText_(item && item.category, 40), subjectId: cleanIdentifier_(item && item.subjectId, 80),
    title: cleanText_(item && item.title, 80), duration: boundedInt_(item && item.duration, 1, 240, 10),
    eventMessage: cleanText_(item && item.eventMessage, 300),
    preAlertMode: ['default', 'custom', 'off'].includes(String(item && item.preAlertMode)) ? String(item.preAlertMode) : 'default',
    preAlertMinutes: boundedInt_(item && item.preAlertMinutes, 0, 30, 2),
    activeDays: Array.isArray(item && item.activeDays) ? [...new Set(item.activeDays.map(Number).filter(day => day >= 0 && day <= 6))] : [1, 2, 3, 4, 5],
    enabled: item && item.enabled !== false, generated: Boolean(item && item.generated), period: boundedInt_(item && item.period, 0, 8, 0),
    weekStart: /^\d{4}-\d{2}-\d{2}$/.test(String(item && item.weekStart || '')) ? String(item.weekStart) : ''
  })).filter(item => item.startTime && item.activeDays.length);
}

function normalizeGender_(value) {
  const gender = String(value || '').trim();
  if (gender && gender !== '남' && gender !== '여') throw new Error('성별은 남 또는 여로 입력해 주세요.');
  return gender;
}

function normalizeDutyBoard_(value) {
  value = value && typeof value === 'object' ? value : {};
  if (Array.isArray(value.roles) && value.roles.length > 60) throw new Error('1인 1역은 최대 60개까지 저장할 수 있습니다.');
  const roles = Array.isArray(value.roles) ? value.roles.map(role => ({
    id: cleanIdentifier_(role && role.id, 80) || id_('duty'), name: cleanText_(role && role.name, 60),
    description: cleanText_(role && role.description, 200), category: cleanText_(role && role.category, 30),
    capacity: boundedInt_(role && role.capacity, 1, 12, 1), color: cleanColor_(role && role.color)
  })).filter(role => role.name) : [];
  const validIds = new Set(roles.map(role => role.id));
  const assignments = {};
  const source = value.assignments && typeof value.assignments === 'object' ? value.assignments : {};
  Object.keys(source).filter(key => validIds.has(key)).forEach(key => {
    if (Array.isArray(source[key]) && source[key].length > 12) throw new Error('한 역할에 최대 12명까지 배정할 수 있습니다.');
    assignments[key] = (Array.isArray(source[key]) ? source[key] : []).map(item => cleanText_(item, 80));
  });
  return { term: cleanText_(value.term, 80), roles, assignments };
}

function normalizeSeatingBoard_(value, roster) {
  value = value && typeof value === 'object' ? value : {};
  const sourceLayout = value.layout && typeof value.layout === 'object' ? value.layout : {};
  const layout = {
    sections: boundedInt_(sourceLayout.sections, 1, 6, 3),
    rows: boundedInt_(sourceLayout.rows, 1, 10, 5), seats: []
  };
  layout.seats = Array.from({ length: layout.sections }, (_, index) => boundedInt_(sourceLayout.seats && sourceLayout.seats[index], 1, 6, 2));
  const sourceOptions = value.options && typeof value.options === 'object' ? value.options : {};
  const options = {
    mixGender: sourceOptions.mixGender !== false,
    avoidPairs: sourceOptions.avoidPairs !== false,
    avoidSeats: sourceOptions.avoidSeats !== false
  };
  const keyToEmail = new Map();
  roster.forEach(student => {
    const email = normalizeEmail_(student.email);
    keyToEmail.set(email, email);
    keyToEmail.set(`${cleanText_(student.number, 12)}␟${cleanText_(student.name, 40)}`, email);
  });
  const normalizeEntry = raw => {
    if (!raw || typeof raw !== 'object') return null;
    const entryLayout = raw.layout && typeof raw.layout === 'object' ? raw.layout : layout;
    const normalizedLayout = {
      sections: boundedInt_(entryLayout.sections, 1, 6, layout.sections),
      rows: boundedInt_(entryLayout.rows, 1, 10, layout.rows), seats: []
    };
    normalizedLayout.seats = Array.from({ length: normalizedLayout.sections }, (_, index) => boundedInt_(entryLayout.seats && entryLayout.seats[index], 1, 6, 2));
    const seats = {}, seen = new Set();
    Object.entries(raw.seats && typeof raw.seats === 'object' ? raw.seats : {}).forEach(([id, studentKey]) => {
      if (!studentKey) return;
      const parts = /^(\d+)-(\d+)-(\d+)$/.exec(id);
      if (!parts) throw new Error('자리 배치의 좌석 번호가 올바르지 않습니다.');
      const [section, row, column] = parts.slice(1).map(Number);
      if (section >= normalizedLayout.sections || row >= normalizedLayout.rows || column >= normalizedLayout.seats[section]) throw new Error('자리 배치에 교실 크기를 벗어난 좌석이 있습니다.');
      const email = keyToEmail.get(String(studentKey).trim());
      if (!email) throw new Error('자리 배치에 현재 학생 이메일 명렬과 일치하지 않는 학생이 있습니다. 명렬을 먼저 등록해 주세요.');
      if (seen.has(email)) throw new Error('자리 배치에 같은 학생이 두 자리 이상 배정되었습니다.');
      seen.add(email);
      seats[id] = email;
    });
    return { savedAt: cleanText_(raw.savedAt, 40) || now_(), layout: normalizedLayout, seats };
  };
  const historyInput = Array.isArray(value.history) ? value.history : [];
  if (historyInput.length > 100) throw new Error('자리 배치 이력은 최대 100회차까지 보관할 수 있습니다.');
  return {
    layout, options, current: normalizeEntry(value.current),
    history: historyInput.map(normalizeEntry).filter(Boolean)
  };
}

function seatingBoardFor_(classId) {
  const row = findRow_('SeatingBoards', item => item.classId === classId);
  const base = parseJson_(row && row.boardJson, {});
  const history = readRows_('SeatingHistory').filter(item => item.classId === classId).sort((a, b) => Number(a.round) - Number(b.round))
    .map(item => ({ savedAt: String(item.savedAt || ''), layout: parseJson_(item.layoutJson, {}), seats: parseJson_(item.seatsJson, {}) }));
  return {
    revision: Number(row && row.revision) || 0,
    updatedAt: String(row && row.updatedAt || ''),
    layout: base.layout || { sections: 3, rows: 5, seats: [2, 2, 2] },
    options: base.options || { mixGender: true, avoidPairs: true, avoidSeats: true },
    current: base.current || null, history
  };
}

function normalizeImportedRecords_(items, classId) {
  if (!Array.isArray(items)) throw new Error('백업 파일에 종료 기록 배열이 없습니다.');
  return items.map(item => {
    const date = String(item && item.date || '');
    const routineId = cleanIdentifier_(item && item.routineId, 100);
    const title = cleanText_(item && item.title, 80);
    const scheduledTime = cleanTime_(item && item.scheduledTime);
    const completedAt = cleanTime_(item && item.completedAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !routineId || !title || !scheduledTime || !completedAt) {
      throw new Error('백업의 종료 기록에 날짜·일정·시각이 빠져 있습니다.');
    }
    return {
      recordKey: `${classId}::${date}::${routineId}`, classId, date, routineId, title,
      scheduledTime, completedAt, status: item.status === '취소' ? '취소' : '완료',
      updatedBy: 'desktop.import', updatedAt: now_()
    };
  });
}

function normalizeImportedHandoffs_(items, classId) {
  if (!Array.isArray(items)) throw new Error('백업 파일에 전달 메모 배열이 없습니다.');
  return items.map(item => {
    const sourceRoutineId = cleanIdentifier_(item && item.sourceRoutineId, 100);
    const targetRoutineId = cleanIdentifier_(item && item.targetRoutineId, 100);
    const targetDate = String(item && item.targetDate || '');
    const createdAt = String(item && item.createdAt || '');
    if (!sourceRoutineId || !targetRoutineId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error('백업의 전달 메모에 수업·대상 날짜·생성 시각이 빠져 있습니다.');
    }
    const sourceDate = Utilities.formatDate(new Date(createdAt), 'Asia/Seoul', 'yyyy-MM-dd');
    const sourceId = cleanIdentifier_(item && item.id, 100) || `${sourceDate}-${sourceRoutineId}-${targetRoutineId}`;
    const handoffId = sourceId.startsWith(`${classId}::`) ? sourceId : `${classId}::${sourceId}`;
    return {
      handoffId, classId, sourceDate, sourceRoutineId, targetDate, targetRoutineId,
      studentNote: cleanText_(item.studentNote, 300), teacherNote: cleanText_(item.teacherNote, 300),
      createdAt, archivedAt: item.archived ? String(item.archivedAt || createdAt) : ''
    };
  });
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
  const warningStudents = students.map(student => {
    const codes = normalizeAllergenCodes_(student.allergenCodes);
    const matchedDishes = dishes.filter(dish => (dish.allergenCodes || []).some(code => codes.includes(code))).map(dish => dish.name);
    return { number: student.number, name: student.name, dishes: matchedDishes };
  }).filter(student => student.dishes.length);

  return {
    date: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'),
    meal: Object.assign({}, meal, {
      personalAllergens: allergenNames_(personalCodes),
      warningDishes,
      registeredAllergyStudents,
      warningStudentCount,
      warningStudents
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

function requireUser_(roles, request) {
  getDb_();
  const activeEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  const googleActor = activeEmail ? registeredActor_(activeEmail) : null;
  if (googleActor && roles.includes(googleActor.role)) return googleActor;

  const token = cleanText_(request && request._authToken, 200);
  if (!token) {
    if (googleActor) throw new Error('이 기능을 사용할 권한이 없습니다.');
    throw new Error('LOGIN_REQUIRED: 등록된 이메일로 인증번호를 받아 로그인해 주세요.');
  }
  const requestKeyHash = temporaryUserKeyHash_();
  const tokenHash = authTokenHash_(token);
  const session = findRow_('AuthSessions', row => row.tokenHash === tokenHash && !row.revokedAt);
  if (!session || session.requestKeyHash !== requestKeyHash || Date.parse(session.expiresAt || '') <= Date.now()) {
    throw new Error('LOGIN_REQUIRED: 로그인 시간이 만료되었습니다. 다시 인증해 주세요.');
  }
  const actor = registeredActor_(session.email);
  if (!actor || (session.userId && actor.userId && session.userId !== actor.userId)) {
    throw new Error('LOGIN_REQUIRED: 등록이 변경되었습니다. 다시 인증해 주세요.');
  }
  if (!roles.includes(actor.role)) throw new Error('이 기능을 사용할 권한이 없습니다.');
  return actor;
}

function registeredActor_(email) {
  email = normalizeEmail_(email);
  if (!email) return null;
  if (masterEmails_().includes(email)) {
    const storedMaster = findRow_('Users', row => normalizeEmail_(row.email) === email && truthy_(row.active));
    return Object.assign({}, storedMaster || {}, { email, role: 'master', classId: '', number: '', name: storedMaster && storedMaster.name || '관리자', active: true });
  }
  const user = findRow_('Users', row => normalizeEmail_(row.email) === email && truthy_(row.active));
  if (!user || !['teacher', 'student'].includes(user.role)) return null;
  return Object.assign({}, user, { email });
}

function temporaryUserKeyHash_() {
  const key = String(Session.getTemporaryActiveUserKey() || '');
  if (!key) throw new Error('브라우저 사용자 확인에 실패했습니다. Google 계정에 로그인한 뒤 다시 시도해 주세요.');
  return hashText_(key);
}

function authSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty(PROP_AUTH_SECRET);
  if (!secret) {
    secret = `${Utilities.getUuid()}${Utilities.getUuid()}`;
    properties.setProperty(PROP_AUTH_SECRET, secret);
  }
  return secret;
}

function hashText_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(byte => ((Number(byte) + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function loginCodeHash_(email, challengeId, code) {
  return hashText_(`${normalizeEmail_(email)}|${challengeId}|${code}|${authSecret_()}`);
}

function authTokenHash_(token) {
  return hashText_(`${String(token)}|${authSecret_()}`);
}

function randomDigits_(length) {
  const source = Utilities.getUuid().replace(/-/g, '');
  const maximum = Math.pow(10, length);
  return String(parseInt(source.slice(0, 12), 16) % maximum).padStart(length, '0');
}

function randomToken_() {
  return `${Utilities.getUuid().replace(/-/g, '')}${Utilities.getUuid().replace(/-/g, '')}`;
}

function pruneAuthRows_() {
  const now = Date.now();
  deleteRowsWhere_('LoginChallenges', row => Date.parse(row.expiresAt || '') < now - 24 * 60 * 60 * 1000);
  deleteRowsWhere_('AuthSessions', row => row.revokedAt || Date.parse(row.expiresAt || '') < now);
}

function deleteRowsWhere_(name, predicate) {
  const rows = readRows_(name).filter(predicate).sort((a, b) => b.__row - a.__row);
  const sheet = sheet_(name);
  rows.forEach(row => sheet.deleteRow(row.__row));
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
  if (personalAccountMode_()) return;
  const domain = String(PropertiesService.getScriptProperties().getProperty(PROP_SCHOOL_DOMAIN) || '').toLowerCase();
  if (domain && email.split('@')[1] !== domain) throw new Error(`학교 계정(@${domain})만 등록할 수 있습니다.`);
}

function personalAccountMode_() {
  return masterEmails_().some(email => /@gmail\.com$/.test(email));
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

function cleanIdentifier_(value, maxLength) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, maxLength || 100);
}

function cleanColor_(value) {
  const color = String(value || '').toLowerCase();
  return ['green', 'orange', 'yellow', 'blue', 'coral'].includes(color) ? color : 'green';
}

function cleanTime_(value) {
  const text = String(value || '').trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) return '';
  return text;
}

function timeToMinutes_(value) {
  const time = cleanTime_(value) || '00:00';
  const parts = time.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function timeFromMinutes_(value) {
  const minutes = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function boundedInt_(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function parseJson_(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); }
  catch (_) { return fallback; }
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
