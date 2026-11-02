// Private recovery files are created by this app through Drive API drive.file.
// They are not copies of the source Sheet and never include authentication secrets.
const PROP_RECOVERY_INSTALLATION_ID = 'CLASSROOM_HUB_RECOVERY_INSTALLATION_ID';
const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_MAX_BYTES = 5 * 1024 * 1024;
const RECOVERY_KIND = 'class_recovery_v1';

/** Run once from the Apps Script editor as the deployment owner, after setupDatabase. */
function setupRecoveryMaintenance() {
  const active = normalizeEmail_(Session.getActiveUser().getEmail());
  const effective = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!active || active !== effective || !masterEmails_().includes(active)) {
    throw new Error('복구 사본 설정은 배포 소유자가 Apps Script 편집기에서 실행해 주세요.');
  }
  getDb_();
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(PROP_RECOVERY_INSTALLATION_ID)) {
    properties.setProperty(PROP_RECOVERY_INSTALLATION_ID, Utilities.getUuid());
  }
  // A list request alone does not prove that this owner can create, read and delete private copies.
  verifyRecoveryStorage_(properties.getProperty(PROP_RECOVERY_INSTALLATION_ID));
  if (!recoveryTriggerInstalled_()) ScriptApp.newTrigger('cleanupRecoveryCopies_').timeBased().everyDays(1).create();
  return { ready: recoveryTriggerInstalled_(), retentionDays: 30 };
}

function verifyRecoveryStorage_(installationId) {
  const operationId = id_('recovery');
  const content = JSON.stringify({ format: 'class_recovery_probe_v1', createdAt: now_() });
  const checksum = hashText_(content);
  const expiresAt = new Date(Date.now() + RECOVERY_RETENTION_MS).toISOString();
  let copyId = '';
  let failure = null;
  try {
    const metadata = {
      name: `classroutine-recovery-probe-${operationId}.json`, mimeType: 'application/json',
      appProperties: { installationId, kind: RECOVERY_KIND, operationId, expiresAt, checksum }
    };
    const created = JSON.parse(driveRecoveryFetch_('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'post', contentType: `multipart/related; boundary=${operationId}`,
      payload: recoveryMultipartBody_(operationId, metadata, content)
    }).getContentText());
    copyId = String(created.id || '');
    if (!/^[A-Za-z0-9_-]+$/.test(copyId)) throw new Error('Recovery storage probe did not return a valid Drive file ID.');
    assertPrivateRecoveryFile_(recoveryFileMetadata_(copyId), installationId, operationId, checksum);
    const downloaded = driveRecoveryFetch_(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copyId)}?alt=media`, { method: 'get' }).getContentText();
    if (hashText_(downloaded) !== checksum) throw new Error('Recovery storage probe read-back failed.');
  } catch (error) {
    failure = error;
  }
  if (copyId) {
    try {
      // The probe contains no classroom data. If deletion fails, maintenance can find its tagged file.
      driveRecoveryFetch_(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copyId)}`, { method: 'delete' });
    } catch (error) {
      if (!failure) failure = error;
    }
  }
  if (failure) throw failure;
}

function recoveryTriggerInstalled_() {
  return ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'cleanupRecoveryCopies_');
}

function createClassRecoveryCopy_(classId, operation, incomingEmails) {
  const installationId = PropertiesService.getScriptProperties().getProperty(PROP_RECOVERY_INSTALLATION_ID);
  if (!installationId || !recoveryTriggerInstalled_()) {
    throw new Error('복구 사본의 30일 정리가 설정되지 않았습니다. 소유자가 setupRecoveryMaintenance를 실행해 주세요.');
  }
  const createdAt = now_();
  const expiresAt = new Date(Date.parse(createdAt) + RECOVERY_RETENTION_MS).toISOString();
  const operationId = id_('recovery');
  const snapshot = classRecoveryData_(classId, operation, incomingEmails, createdAt, expiresAt);
  const content = JSON.stringify(snapshot);
  if (Utilities.newBlob(content).getBytes().length > RECOVERY_MAX_BYTES) {
    throw new Error('복구 사본이 5MB를 넘습니다. 가져오기를 중단하고 관리자에게 문의해 주세요.');
  }
  const checksum = hashText_(content);
  const rowCounts = Object.fromEntries(Object.entries(snapshot.tables).map(([name, table]) => [name, table.rows.length]));
  const base = {
    operationId, classId, copyId: '', createdAt, expiresAt, status: 'PREPARING',
    checksum, rowCountsJson: JSON.stringify(rowCounts), updatedAt: now_()
  };
  upsertRow_('RecoveryCopies', 'operationId', operationId, base);
  let copyId = '';
  try {
    const metadata = {
      name: `classroutine-recovery-${operationId}.json`, mimeType: 'application/json',
      appProperties: {
        installationId, kind: RECOVERY_KIND, operationId, expiresAt, checksum
      }
    };
    const created = JSON.parse(driveRecoveryFetch_('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'post', contentType: `multipart/related; boundary=${operationId}`,
      payload: recoveryMultipartBody_(operationId, metadata, content)
    }).getContentText());
    copyId = String(created.id || '');
    if (!/^[A-Za-z0-9_-]+$/.test(copyId)) throw new Error('복구 사본의 Drive ID를 확인할 수 없습니다.');
    const verified = recoveryFileMetadata_(copyId);
    assertPrivateRecoveryFile_(verified, installationId, operationId, checksum);
    const downloaded = driveRecoveryFetch_(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copyId)}?alt=media`, { method: 'get' }).getContentText();
    if (hashText_(downloaded) !== checksum) throw new Error('복구 사본 읽기 검증에 실패했습니다.');
    upsertRow_('RecoveryCopies', 'operationId', operationId, Object.assign({}, base, {
      copyId, status: 'READY', updatedAt: now_()
    }));
    return { operationId, copyId, expiresAt };
  } catch (error) {
    // A failed upload/verification never permits the destructive import to start.
    if (copyId) {
      try {
        const candidate = recoveryFileMetadata_(copyId);
        assertOwnedRecoveryFile_(candidate, installationId, operationId, checksum);
        driveRecoveryFetch_(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copyId)}`, { method: 'delete' });
      } catch (_) { /* Tagged orphan can be found by the maintenance task. */ }
    }
    try { upsertRow_('RecoveryCopies', 'operationId', operationId, Object.assign({}, base, { copyId, status: 'FAILED', updatedAt: now_() })); } catch (_) { /* Drive appProperties still allow orphan discovery. */ }
    throw error;
  }
}

function classRecoveryData_(classId, operation, incomingEmails, createdAt, expiresAt) {
  const extraEmails = new Set((incomingEmails || []).map(normalizeEmail_).filter(Boolean));
  const excluded = new Set(['LoginChallenges', 'AuthSessions', 'RecoveryCopies', 'AuditLog']);
  const tables = {};
  Object.entries(TABLES).forEach(([name, headers]) => {
    if (excluded.has(name)) return;
    const rows = readRows_(name).filter(row => {
      if (name === 'Users') return row.classId === classId || extraEmails.has(normalizeEmail_(row.email));
      if (name === 'StudentProfiles') return row.classId === classId || extraEmails.has(normalizeEmail_(row.email));
      return row.classId === classId;
    }).map(row => headers.map(header => row[header] == null ? '' : row[header]));
    tables[name] = { headers, rows };
  });
  return { format: RECOVERY_KIND, schemaVersion: 1, operation, classId, createdAt, expiresAt, tables };
}

function recoveryMultipartBody_(boundary, metadata, content) {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--\r\n`;
}

function driveRecoveryFetch_(url, options) {
  const response = UrlFetchApp.fetch(url, Object.assign({}, options || {}, {
    headers: Object.assign({}, options && options.headers || {}, { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }),
    muteHttpExceptions: true
  }));
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(`Google Drive 복구 사본 요청에 실패했습니다 (${status}). 가져오기는 중단했습니다.`);
  return response;
}

function recoveryFileMetadata_(copyId) {
  const fields = 'id,name,mimeType,shared,owners(emailAddress),permissions(type,role,emailAddress),appProperties';
  return JSON.parse(driveRecoveryFetch_(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(copyId)}?fields=${encodeURIComponent(fields)}`, { method: 'get' }).getContentText());
}

function assertPrivateRecoveryFile_(file, installationId, operationId, checksum) {
  assertOwnedRecoveryFile_(file, installationId, operationId, checksum);
  const permissions = Array.isArray(file.permissions) ? file.permissions : [];
  if (file.shared !== false || permissions.length !== 1 || permissions[0].role !== 'owner') {
    throw new Error('복구 사본의 접근권한을 확인할 수 없습니다. 가져오기는 중단했습니다.');
  }
}

function assertOwnedRecoveryFile_(file, installationId, operationId, checksum) {
  const ownerEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  const owners = Array.isArray(file.owners) ? file.owners : [];
  if (file.mimeType !== 'application/json' ||
      !owners.some(owner => normalizeEmail_(owner.emailAddress) === ownerEmail) ||
      file.appProperties?.installationId !== installationId || file.appProperties?.kind !== RECOVERY_KIND ||
      file.appProperties?.operationId !== operationId || file.appProperties?.checksum !== checksum) {
    throw new Error('복구 사본의 소유자와 식별 정보를 확인할 수 없습니다. 가져오기는 중단했습니다.');
  }
}

function updateRecoveryStatus_(operationId, status) {
  const current = findRow_('RecoveryCopies', row => row.operationId === operationId);
  if (!current) throw new Error('복구 사본의 작업 기록을 찾을 수 없습니다.');
  upsertRow_('RecoveryCopies', 'operationId', operationId, Object.assign({}, current, { status, updatedAt: now_() }));
}

/** Owner-installed time trigger. Never accepts a client-provided deletion target. */
function cleanupRecoveryCopies_() {
  const installationId = PropertiesService.getScriptProperties().getProperty(PROP_RECOVERY_INSTALLATION_ID);
  if (!installationId) return { deleted: 0, failed: 0 };
  const all = [];
  let pageToken = '';
  do {
    const query = `appProperties has { key='installationId' and value='${installationId}' } and appProperties has { key='kind' and value='${RECOVERY_KIND}' }`;
    const params = `q=${encodeURIComponent(query)}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,appProperties)')}&pageSize=100`;
    const url = `https://www.googleapis.com/drive/v3/files?${params}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const page = JSON.parse(driveRecoveryFetch_(url, { method: 'get' }).getContentText());
    all.push(...(page.files || []));
    pageToken = String(page.nextPageToken || '');
  } while (pageToken);
  const liveDbId = PropertiesService.getScriptProperties().getProperty(PROP_DB_ID);
  let deleted = 0, failed = 0;
  all.forEach(file => {
    const props = file.appProperties || {};
    if (!/^[A-Za-z0-9_-]+$/.test(String(file.id || '')) || file.id === liveDbId ||
        file.mimeType !== 'application/json' || props.installationId !== installationId ||
        props.kind !== RECOVERY_KIND || !/^recovery_[A-Za-z0-9]+$/.test(String(props.operationId || '')) ||
        !Number.isFinite(Date.parse(props.expiresAt || '')) || Date.parse(props.expiresAt) > Date.now()) return;
    try {
      const verified = recoveryFileMetadata_(file.id);
      assertOwnedRecoveryFile_(verified, installationId, props.operationId, props.checksum);
      driveRecoveryFetch_(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, { method: 'delete' });
      deleted += 1;
      try { updateRecoveryStatus_(props.operationId, 'EXPIRED'); } catch (_) { /* Source DB may be unavailable. */ }
    } catch (_) {
      failed += 1;
      try { updateRecoveryStatus_(props.operationId, 'DELETE_FAILED'); } catch (_) { /* Keep Drive copy for retry. */ }
    }
  });
  if (failed) throw new Error(`${failed}개 복구 사본의 만료 삭제에 실패했습니다. Apps Script 실행 기록을 확인해 주세요.`);
  return { deleted, failed };
}
