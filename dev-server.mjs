import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const csvStores = new Map([
  ["/api/timetable-csv", { fileName: "주간시간표_이력.csv", maxBytes: 5 * 1024 * 1024 }],
  ["/api/roster-csv", { fileName: "학생명렬표.csv", maxBytes: 2 * 1024 * 1024 }],
  ["/api/roles-csv", { fileName: "1인1역_배정.csv", maxBytes: 2 * 1024 * 1024 }]
]);
const ignoredWatchFiles = new Set([...csvStores.values()].map(store => store.fileName));
const clients = new Set();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const liveReload = `
<script>
  (() => {
    const stream = new EventSource('/__live_reload');
    stream.addEventListener('reload', () => location.reload());
  })();
</script>`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const csvStore = csvStores.get(url.pathname);
  if (csvStore) {
    const csvFilePath = path.join(root, csvStore.fileName);
    if (request.method === "GET") {
      try {
        const body = await fsp.readFile(csvFilePath);
        response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" });
        response.end(body);
      } catch (error) {
        if (error.code !== "ENOENT") { response.writeHead(500).end("CSV 파일을 읽지 못했습니다."); return; }
        response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" });
        response.end("");
      }
      return;
    }
    if (request.method === "PUT") {
      try {
        const declared = Number(request.headers["content-length"] || 0);
        if (declared > csvStore.maxBytes) { response.writeHead(413).end("CSV 파일이 너무 큽니다."); return; }
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > csvStore.maxBytes) { response.writeHead(413).end("CSV 파일이 너무 큽니다."); return; }
          chunks.push(chunk);
        }
        await fsp.writeFile(csvFilePath, Buffer.concat(chunks));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: true, file: csvStore.fileName, bytes: size }));
      } catch {
        response.writeHead(500).end("CSV 파일을 저장하지 못했습니다.");
      }
      return;
    }
    response.writeHead(405, { "Allow": "GET, PUT" }).end("Method Not Allowed");
    return;
  }
  if (url.pathname === "/__live_reload") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    response.write("retry: 500\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    const extension = path.extname(filePath).toLowerCase();
    let body = await fsp.readFile(filePath);
    if (extension === ".html") {
      body = body.toString("utf8").replace("</body>", `${liveReload}</body>`);
    }
    response.writeHead(200, {
      "Content-Type": mime[extension] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("파일을 찾을 수 없습니다.");
  }
});

let reloadTimer;
fs.watch(root, { recursive: true }, (_event, filename) => {
  if (!filename || filename.endsWith(".log") || ignoredWatchFiles.has(filename)) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const client of clients) client.write("event: reload\ndata: changed\n\n");
  }, 120);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ClassRoutine dev server: http://127.0.0.1:${port}`);
});
