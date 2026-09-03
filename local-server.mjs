import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DATA_FILES, prepareDataDirectory } from "./storage-config.mjs";

const CSV_STORES = new Map([
  ["/api/timetable-csv", { fileName: DATA_FILES.timetable, maxBytes: 5 * 1024 * 1024 }],
  ["/api/roster-csv", { fileName: DATA_FILES.roster, maxBytes: 2 * 1024 * 1024 }],
  ["/api/roles-csv", { fileName: DATA_FILES.roles, maxBytes: 2 * 1024 * 1024 }],
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
  const clients = new Set();

  async function stateBootstrap() {
    try {
      const parsed = JSON.parse(await fsp.readFile(stateFilePath, "utf8"));
      const safe = JSON.stringify(parsed).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
      return `<script>window.__CLASS_ROUTINE_BOOTSTRAP__=${safe};</script>`;
    } catch {
      return "";
    }
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
    if (url.pathname === "/api/storage-info" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ dataDirectory: storageDirectory, files: DATA_FILES, status: await storageStatus() }));
      return;
    }

    if (url.pathname === "/api/state-json") {
      if (request.method === "GET") {
        try {
          const body = await fsp.readFile(stateFilePath);
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(body);
        } catch (error) {
          if (error.code !== "ENOENT") {
            response.writeHead(500).end("설정 백업을 읽지 못했습니다.");
            return;
          }
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end("{}");
        }
        return;
      }
      if (request.method === "PUT") {
        try {
          const body = await readRequestBody(request, 10 * 1024 * 1024);
          const parsed = JSON.parse(body.toString("utf8"));
          if (!parsed || typeof parsed !== "object" || !parsed.storage || typeof parsed.storage !== "object") throw new Error("Invalid state");
          await fsp.writeFile(stateFilePath, JSON.stringify(parsed, null, 2), "utf8");
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ ok: true, file: DATA_FILES.state }));
        } catch (error) {
          response.writeHead(error.statusCode || 400).end(error.statusCode === 413 ? "설정 백업이 너무 큽니다." : "설정 백업을 저장하지 못했습니다.");
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
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("파일을 찾을 수 없습니다.");
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
