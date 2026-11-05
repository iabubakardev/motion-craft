const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("motioncraft", {
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  ai: {
    start: (request) => ipcRenderer.invoke("ai:start", request),
    status: () => ipcRenderer.invoke("ai:status"),
    cancel: (id) => ipcRenderer.invoke("ai:cancel", id),
  },
  render: {
    start: (project) => ipcRenderer.invoke("render:start", project),
    status: () => ipcRenderer.invoke("render:status"),
    cancel: (id) => ipcRenderer.invoke("render:cancel", id),
  },
  media: {
    selectFiles: () => ipcRenderer.invoke("media:selectFiles"),
    listAssets: () => ipcRenderer.invoke("media:listAssets"),
    updateMetadata: (id, metadata) => ipcRenderer.invoke("media:updateMetadata", id, metadata),
  },
  projects: {
    openFile: () => ipcRenderer.invoke("projects:open"),
    activate: (project, candidateId) =>
      ipcRenderer.invoke("projects:activate", project, candidateId),
    save: (project, saveAs = false) => ipcRenderer.invoke("projects:save", project, saveAs),
    relink: (asset) => ipcRenderer.invoke("projects:relink", asset),
  },
});
