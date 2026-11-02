const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const APP_NAME = "오늘도 차근차근";
const APP_ID = "kr.classroutine.today";
const DATA_DIRECTORY_NAME = "오늘도 차근차근";
const DESKTOP_SETTINGS_FILE = "데스크톱설정.json";

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let serverInstance;
let mainWindow;
let tray;
let quitting = false;
let desktopSettings = { launchAtLogin: false, windowsNotification: false };
let dataDirectory;
let desktopSettingsPath;

function appRoot() {
  return app.getAppPath();
}

function iconPath() {
  return path.join(appRoot(), "build", "icon.png");
}

function trustedLocalUrl(value) {
  try {
    return new URL(value).origin === new URL(serverInstance.url).origin;
  } catch {
    return false;
  }
}

function trustedSender(event) {
  return Boolean(event?.senderFrame?.url && trustedLocalUrl(event.senderFrame.url));
}

function backupFileName(value) {
  const fallback = `교실루틴_전체백업_${new Date().toISOString().slice(0, 10)}.json`;
  const cleaned = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
  return cleaned.toLowerCase().endsWith(".json") ? cleaned : `${cleaned}.json`;
}

async function readDesktopSettings() {
  try {
    const parsed = JSON.parse(await fs.readFile(desktopSettingsPath, "utf8"));
    desktopSettings = { ...desktopSettings, ...parsed };
  } catch {}
}

async function saveDesktopSettings() {
  await fs.writeFile(desktopSettingsPath, JSON.stringify(desktopSettings, null, 2), "utf8");
}

function loginItemOptions(openAtLogin) {
  const portablePath = process.env.PORTABLE_EXECUTABLE_FILE;
  return {
    openAtLogin,
    path: portablePath || process.execPath,
    args: ["--hidden"]
  };
}

function applyLaunchAtLogin() {
  if (app.isPackaged) app.setLoginItemSettings(loginItemOptions(Boolean(desktopSettings.launchAtLogin)));
}

function pageUrl(page = "index.html") {
  return `${serverInstance.url}/${page}`;
}

function secureWindowOptions(extra = {}) {
  return {
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#f8f3e8",
    icon: iconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    },
    ...extra
  };
}

function configureWindow(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!trustedLocalUrl(url)) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: secureWindowOptions({ width: 1500, height: 960, show: true })
    };
  });
  window.webContents.on("will-navigate", event => {
    if (!trustedLocalUrl(event.url)) event.preventDefault();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow(secureWindowOptions());
  configureWindow(mainWindow);
  mainWindow.loadURL(pageUrl("index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!process.argv.includes("--hidden")) mainWindow.show();
  });
  mainWindow.on("close", event => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  return mainWindow;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openPage(page) {
  showMainWindow();
  mainWindow.loadURL(pageUrl(page));
}

function openRoutine(routineId) {
  if (!routineId) {
    openPage("index.html");
    return;
  }
  const target = pageUrl(`index.html?openRoutine=${encodeURIComponent(routineId)}`);
  showMainWindow();
  if (!mainWindow.webContents.getURL().includes("/index.html")) {
    mainWindow.loadURL(target);
    return;
  }
  mainWindow.webContents.send("desktop:open-routine", routineId);
}

function showWindowsNotification(payload = {}) {
  if (!Notification.isSupported()) return;
  const title = String(payload.title || APP_NAME).slice(0, 80);
  const phaseText = payload.phase === "pre" ? "곧 시작해요" : "시작할 시간이에요";
  const body = String(payload.body || `${payload.time || ""} ${phaseText}`).slice(0, 240);
  const notification = new Notification({ title, body, silent: true, icon: iconPath(), timeoutType: "default" });
  const closeTimer = setTimeout(() => notification.close(), 60 * 1000);
  notification.on("click", () => {
    clearTimeout(closeTimer);
    notification.close();
    openRoutine(String(payload.id || ""));
  });
  notification.on("close", () => clearTimeout(closeTimer));
  notification.show();
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "대시보드 열기", click: () => openPage("index.html") },
    { label: "학생 화면 열기", click: () => openPage("student.html") },
    { label: "설정 열기", click: () => openPage("settings.html") },
    { type: "separator" },
    {
      label: "Windows 데스크톱 알림 사용",
      type: "checkbox",
      checked: Boolean(desktopSettings.windowsNotification),
      click: async menuItem => {
        desktopSettings.windowsNotification = menuItem.checked;
        await saveDesktopSettings();
        rebuildTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("desktop:windows-notification-changed", Boolean(desktopSettings.windowsNotification));
        }
      }
    },
    { label: "Windows 알림 시험", click: () => showWindowsNotification({ title: "알림 시험", body: "Windows 알림을 누르면 대시보드가 열립니다." }) },
    { label: "데이터 폴더 열기", click: () => shell.openPath(dataDirectory) },
    {
      label: "Windows 시작 시 자동 실행",
      type: "checkbox",
      checked: Boolean(desktopSettings.launchAtLogin),
      click: async menuItem => {
        desktopSettings.launchAtLogin = menuItem.checked;
        await saveDesktopSettings();
        applyLaunchAtLogin();
        rebuildTrayMenu();
      }
    },
    { type: "separator" },
    { label: "완전히 종료", click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 24, height: 24 });
  tray = new Tray(image);
  tray.setToolTip(`${APP_NAME} · 일정 알림 실행 중`);
  tray.on("click", showMainWindow);
  rebuildTrayMenu();
}

async function runSmokeTest() {
  const response = await fetch(pageUrl("index.html"));
  if (!response.ok) throw new Error(`Smoke test HTTP ${response.status}`);
  console.log(`SMOKE_OK ${response.status} ${serverInstance.url} ${dataDirectory}`);
  await serverInstance.close();
  app.exit(0);
}

if (gotLock) {
  app.on("second-instance", () => showMainWindow());
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => { quitting = true; });
  app.whenReady().then(async () => {
    dataDirectory = path.join(app.getPath("documents"), DATA_DIRECTORY_NAME);
    desktopSettingsPath = path.join(dataDirectory, DESKTOP_SETTINGS_FILE);
    const { startClassRoutineServer } = await import("./local-server.mjs");
    serverInstance = await startClassRoutineServer({ rootDirectory: appRoot(), dataDirectory, port: 0 });
    await readDesktopSettings();
    await saveDesktopSettings();
    applyLaunchAtLogin();

    if (process.argv.includes("--smoke-test")) {
      await runSmokeTest();
      return;
    }

    ipcMain.on("desktop:notify-routine", (event, payload) => {
      if (!trustedLocalUrl(event.senderFrame.url)) return;
      if (payload?.phase !== "start" || !desktopSettings.windowsNotification) return;
      showWindowsNotification(payload);
    });
    ipcMain.on("desktop:set-windows-notification", async (event, enabled) => {
      if (!trustedLocalUrl(event.senderFrame.url)) return;
      desktopSettings.windowsNotification = Boolean(enabled);
      await saveDesktopSettings();
      rebuildTrayMenu();
    });
    ipcMain.handle("desktop:open-data-folder", async event => {
      if (!trustedSender(event)) return { ok: false, error: "untrusted" };
      const error = await shell.openPath(dataDirectory);
      return { ok: !error, error };
    });
    ipcMain.handle("desktop:open-external", async (event, rawUrl) => {
      if (!trustedSender(event)) return { ok: false, error: "untrusted" };
      try {
        const url = new URL(String(rawUrl || ""));
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return { ok: false, error: "invalid-url" };
        await shell.openExternal(url.href);
        return { ok: true };
      } catch { return { ok: false, error: "open-failed" }; }
    });
    ipcMain.handle("desktop:save-backup", async (event, payload = {}) => {
      if (!trustedSender(event)) return { ok: false, error: "untrusted" };
      const content = String(payload.content || "");
      if (!content || Buffer.byteLength(content, "utf8") > 10 * 1024 * 1024) return { ok: false, error: "invalid-size" };
      try { JSON.parse(content.replace(/^\uFEFF/, "")); }
      catch { return { ok: false, error: "invalid-json" }; }
      const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      const result = await dialog.showSaveDialog(owner, {
        title: "교실 루틴 전체 백업 저장",
        defaultPath: path.join(dataDirectory, backupFileName(payload.fileName)),
        filters: [{ name: "교실 루틴 JSON 백업", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.writeFile(result.filePath, content, "utf8");
      return { ok: true, filePath: result.filePath };
    });
    ipcMain.handle("desktop:open-backup", async event => {
      if (!trustedSender(event)) return { ok: false, error: "untrusted" };
      const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      const result = await dialog.showOpenDialog(owner, {
        title: "교실 루틴 전체 백업 불러오기",
        defaultPath: dataDirectory,
        properties: ["openFile"],
        filters: [{ name: "교실 루틴 JSON 백업", extensions: ["json"] }]
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const stat = await fs.stat(result.filePaths[0]);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return { ok: false, error: "invalid-size" };
      return { ok: true, filePath: result.filePaths[0], content: await fs.readFile(result.filePaths[0], "utf8") };
    });
    createMainWindow();
    createTray();
  }).catch(error => {
    console.error(error);
    app.exit(1);
  });
}
