import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_FILES, prepareDataDirectory } from "./storage-config.mjs";
import { loadDailyInfo, publicIntegrationSettings, sanitizeIntegrationSettings, searchSchools } from "./daily-info.mjs";

const CSV_STORES = new Map([
  ["/api/timetable-csv", { fileName: DATA_FILES.timetable, maxBytes: 5 * 1024 * 1024 }],
  ["/api/roster-csv", { fileName: DATA_FILES.roster, maxBytes: 2 * 1024 * 1024 }],
  ["/api/roles-csv", { fileName: DATA_FILES.roles, maxBytes: 2 * 1024 * 1024 }],
  ["/api/seating-csv", { fileName: DATA_FILES.seating, maxBytes: 5 * 1024 * 1024 }],
  ["/api/records-csv", { fileName: DATA_FILES.records, maxBytes: 5 * 1024 * 1024 }]
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const LIVE_RELOAD_SCRIPT = `
<script>
  (() => {
    const stream = new EventSource('/__live_reload');
    stream.addEventListener('reload', () => location.reload());
  })();
</script>`;

async function readRequestBody(request, maxBytes) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > maxBytes) throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function startClassRoutineServer({
  rootDirectory,
  dataDirectory,
  port = 0,
  liveReload = false,
  watchFiles = false
} = {}) {
  const root = path.resolve(rootDirectory || process.cwd());
  const prepared = await prepareDataDirectory(root, dataDirectory);
  const storageDirectory = prepared.dataDirectory;
  const stateFilePath = path.join(storageDirectory, DATA_FILES.state);
  const stateBackupFilePath = `${stateFilePath}.bak`;
  const integrationFilePath = path.join(storageDirectory, DATA_FILES.integrations);
  const clients = new Set();
  let stateWriteQueue = Promise.resolve();

  function parseStateSnapshot(text) {
    const snapshot = JSON.parse(text);
    if (!snapshot || typeof snapshot !== "object" || !snapshot.storage || typeof snapshot.storage !== "object" || Array.isArray(snapshot.storage)) throw new Error("Invalid state snapshot");
    return snapshot;
  }

  async function atomicWrite(filePath, content) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fsp.open(temporaryPath, "wx");
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(temporaryPath, filePath);
    } finally {
      await handle?.close();
      await fsp.unlink(temporaryPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function readStateSnapshot() {
    try {
      return parseStateSnapshot(await fsp.readFile(stateFilePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      try {
        const backupText = await fsp.readFile(stateBackupFilePath, "utf8");
        const backup = parseStateSnapshot(backupText);
        await fsp.copyFile(stateFilePath, `${stateFilePath}.corrupt-${Date.now()}`);
        await atomicWrite(stateFilePath, backupText);
        return backup;
      } catch {
        throw Object.assign(new Error("Stored state is unreadable"), { code: "STATE_CORRUPT" });
      }
    }
  }

  async function readIntegrationSettings() {
    try { return sanitizeIntegrationSettings(JSON.parse(await fsp.readFile(integrationFilePath, "utf8"))); }
    catch { return sanitizeIntegrationSettings({}); }
  }

  async function writeIntegrationSettings(value) {
    const previous = await readIntegrationSettings();
    const safe = sanitizeIntegrationSettings(value, previous);
    await fsp.writeFile(integrationFilePath, JSON.stringify(safe, null, 2), "utf8");
    return safe;
  }

  async function stateBootstrap() {
    const parsed = await readStateSnapshot();
    if (!parsed) return "";
    const safe = JSON.stringify(parsed).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
    return `<script>window.__CLASS_ROUTINE_BOOTSTRAP__=${safe};</script>`;
  }

  async function storageStatus() {
    const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, fileName]) => {
      try {
        const stat = await fsp.stat(path.join(storageDirectory, fileName));
        return [key, { fileName, exists: stat.isFile(), bytes: stat.size, modifiedAt: stat.mtime.toISOString() }];
      } catch (error) {
        if (error.code === "ENOENT") return [key, { fileName, exists: false, bytes: 0, modifiedAt: null }];
        return [key, { fileName, exists: false, bytes: 0, modifiedAt: null, error: true }];
      }
    }));
    return Object.fromEntries(entries);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/integration-settings") {
      if (request.method === "GET") {
        const settings = await readIntegrationSettings();
        response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
        response.end(JSON.stringify(publicIntegrationSettings(settings)));
        return;
      }
      if (request.method === "PUT") {
        try {
          const body = await readRequestBody(request, 32 * 1024);
          const settings = await writeIntegrationSettings(JSON.parse(body.toString("utf8")));
          response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
          response.end(JSON.stringify({ ok:true, settings:publicIntegrationSettings(settings), file:DATA_FILES.integrations }));
        } catch (error) {
          response.writeHead(error.statusCode || 400, { "Content-Type":"application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok:false, error:"외부 연동 설정을 저장하지 못했습니다." }));
        }
        return;
      }
      response.writeHead(405, { Allow:"GET, PUT" }).end("Method Not Allowed");
      return;
    }

    if (url.pathname === "/api/daily-info" && request.method === "GET") {
      const settings = await readIntegrationSettings();
      const daily = await loadDailyInfo(settings, { force:url.searchParams.get("refresh") === "1" });
      response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
      response.end(JSON.stringify(daily));
      return;
    }

    if (url.pathname === "/api/school-search" && request.method === "GET") {
      const settings = await readIntegrationSettings();
      const result = await searchSchools(settings, url.searchParams.get("q") || "");
      response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
      response.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === "/api/storage-info" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ dataDirectory: storageDirectory, files: DATA_FILES, status: await storageStatus() }));
      return;
    }

    if (url.pathname === "/api/state-json") {
      if (request.method === "GET") {
        try {
          const body = JSON.stringify(await readStateSnapshot() || {});
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(body);
        } catch (error) {
          response.writeHead(500).end("설정 작업본을 읽지 못했습니다. 자동 저장이 중단되었습니다.");
        }
        return;
      }
      if (request.method === "PUT") {
        try {
          const body = await readRequestBody(request, 10 * 1024 * 1024);
          const parsed = parseStateSnapshot(body.toString("utf8"));
          if (typeof parsed.savedAt !== "string" || !Number.isFinite(Date.parse(parsed.savedAt))) throw new Error("Invalid state timestamp");
          const operation = stateWriteQueue.then(async () => {
            const current = await readStateSnapshot();
            if (current?.savedAt && parsed.savedAt <= current.savedAt) return false;
            if (current) await fsp.copyFile(stateFilePath, stateBackupFilePath);
            await atomicWrite(stateFilePath, JSON.stringify(parsed, null, 2));
            return true;
          });
          stateWriteQueue = operation.catch(() => {});
          if (!await operation) {
            response.writeHead(409, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ ok: false, error: "stale-state" }));
            return;
          }
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ ok: true, file: DATA_FILES.state }));
        } catch (error) {
          response.writeHead(error.statusCode || (error.code === "STATE_CORRUPT" ? 503 : 400)).end(error.statusCode === 413 ? "설정 백업이 너무 큽니다." : "설정 백업을 저장하지 못했습니다.");
        }
        return;
      }
      response.writeHead(405, { Allow: "GET, PUT" }).end("Method Not Allowed");
      return;
    }

    const csvStore = CSV_STORES.get(url.pathname);
    if (csvStore) {
      const csvFilePath = path.join(storageDirectory, csvStore.fileName);
      if (request.method === "GET") {
        try {
          const body = await fsp.readFile(csvFilePath);
          response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" });
          response.end(body);
        } catch (error) {
          if (error.code !== "ENOENT") {
            response.writeHead(500).end("CSV 파일을 읽지 못했습니다.");
            return;
          }
          response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" }).end("");
        }
        return;
      }
      if (request.method === "PUT") {
        try {
          const body = await readRequestBody(request, csvStore.maxBytes);
          await fsp.writeFile(csvFilePath, body);
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ ok: true, file: csvStore.fileName, bytes: body.length }));
        } catch (error) {
          response.writeHead(error.statusCode || 500).end(error.statusCode === 413 ? "CSV 파일이 너무 큽니다." : "CSV 파일을 저장하지 못했습니다.");
        }
        return;
      }
      response.writeHead(405, { Allow: "GET, PUT" }).end("Method Not Allowed");
      return;
    }

    if (url.pathname === "/__live_reload") {
      if (!liveReload) {
        response.writeHead(404).end("Not Found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      response.write("retry: 500\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.resolve(root, `.${requested}`);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error("Not a file");
      const extension = path.extname(filePath).toLowerCase();
      let body = await fsp.readFile(filePath);
      if (extension === ".html") {
        body = body.toString("utf8").replace("</head>", `${await stateBootstrap()}</head>`);
        if (liveReload) body = body.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`);
      }
      response.writeHead(200, {
        "Content-Type": MIME[extension] || "application/octet-stream",
        "Cache-Control": "no-store, max-age=0"
      });
      response.end(body);
    } catch (error) {
      if (error.code === "STATE_CORRUPT") {
        response.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end("<!doctype html><html lang=ko><meta charset=utf-8><title>저장 파일 확인 필요</title><body style='font:20px sans-serif;padding:3rem;line-height:1.6'><h1>저장 파일을 읽지 못했습니다</h1><p>데이터를 보호하기 위해 앱 실행과 자동 저장을 중단했습니다. 문서의 ‘오늘도 차근차근’ 폴더에 있는 교실루틴_설정.json과 .bak 파일을 보존한 뒤 복구해 주세요.</p></body></html>");
      } else {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("파일을 찾을 수 없습니다.");
      }
    }
  });

  let watcher = null;
  let reloadTimer = null;
  if (watchFiles) {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith(".log") || filename.includes("node_modules") || filename.includes("release")) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        for (const client of clients) client.write("event: reload\ndata: changed\n\n");
      }, 120);
    });
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const close = async () => {
    clearTimeout(reloadTimer);
    watcher?.close();
    for (const client of clients) client.end();
    await new Promise(resolve => server.close(resolve));
  };

  return {
    server,
    url: `http://127.0.0.1:${actualPort}`,
    dataDirectory: storageDirectory,
    migrated: prepared.migrated,
    close
  };
}
