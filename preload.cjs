const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("classRoutineDesktop", Object.freeze({
  isDesktop: true,
  notifyRoutine(payload) {
    ipcRenderer.send("desktop:notify-routine", payload);
  },
  openDataFolder() {
    return ipcRenderer.invoke("desktop:open-data-folder");
  },
  saveBackup(payload) {
    return ipcRenderer.invoke("desktop:save-backup", payload);
  },
  openBackup() {
    return ipcRenderer.invoke("desktop:open-backup");
  },
  onOpenRoutine(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, routineId) => callback(routineId);
    ipcRenderer.on("desktop:open-routine", listener);
    return () => ipcRenderer.removeListener("desktop:open-routine", listener);
  }
}));
