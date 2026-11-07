const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("motioncraft", {
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  ai: {
    inspectAudio: (assetId) => ipcRenderer.invoke("ai:inspect-audio", assetId),
    saveTranscript: (document) => ipcRenderer.invoke("ai:save-transcript", document),
    copyTranscript: (text) => ipcRenderer.invoke("ai:copy-transcript", text),
    transcriptionSettings: () => ipcRenderer.invoke("ai:transcription-settings"),
    configureTranscription: (preferences, choosePaths) =>
      ipcRenderer.invoke("ai:configure-transcription", preferences, choosePaths),
    start: (request) => ipcRenderer.invoke("ai:start", request),
    status: () => ipcRenderer.invoke("ai:status"),
    cancel: (id) => ipcRenderer.invoke("ai:cancel", id),
  },
  audio: {
    analyze: (id, range) => ipcRenderer.invoke("audio:analyze", id, range),
    inspectClip: (project, id) => ipcRenderer.invoke("audio:inspect-clip", project, id),
    mix: (project) => ipcRenderer.invoke("audio:mix", project),
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
