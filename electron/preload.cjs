const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("motioncraft", {
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
});