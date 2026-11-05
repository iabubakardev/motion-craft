// @ts-check
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { z } = require("zod");
const { validateRequest } = require("../security.cjs");
const { requestSchema, jobSchema } = require("../../core/ai/schema.cjs");
const { createAIJobs } = require("../ai-jobs.cjs");
/** @param {ReturnType<typeof import('../media-library.cjs').createMediaLibrary>} library @param {()=>boolean} [otherBusy] */
function registerAIIPC(library, otherBusy = () => false) {
  const jobs = createAIJobs();
  /** @type {Set<number>} */ const observed = new Set();
  /** @param {import('electron').IpcMainInvokeEvent} event */
  function check(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    validateRequest(event, window?.webContents);
    if (!window) throw new Error("Missing window");
    if (!observed.has(event.sender.id)) {
      observed.add(event.sender.id);
      event.sender.on("did-start-navigation", (_event, _url, _place, main) => {
        if (main) jobs.release(event.sender.id);
      });
      event.sender.once("destroyed", () => {
        jobs.release(event.sender.id);
        observed.delete(event.sender.id);
      });
    }
    return window;
  }
  ipcMain.handle("ai:start", (event, ...args) => {
    check(event);
    if (otherBusy()) throw new Error("Wait for the active export before starting local AI.");
    const [request] = z.tuple([requestSchema]).parse(args);
    let binding = null;
    if (request.kind === "transcribe") {
      const asset = library.listAssets().find((asset) => asset.id === request.assetId);
      if (
        !asset ||
        asset.type !== "audio" ||
        !["audio/mpeg", "audio/wav"].includes(asset.mimeType) ||
        asset.status === "error"
      )
        throw new Error("Import/relink an MP3 or WAV narration first.");
      binding = library.captureBindings([asset])[0];
      if (!binding) throw new Error("Narration is missing. Relink it first.");
    }
    let assetContext = null;
    if (request.kind === "assets") {
      const operation = request.operation;
      const assets =
        operation.action === "models"
          ? []
          : operation.assetIds.map((id) => {
              const asset = library.listAssets().find((a) => a.id === id);
              if (!asset || asset.type === "audio" || asset.status === "error")
                throw new Error("Import/relink the requested image/video before indexing.");
              return asset;
            });
      const bindings=assets.map(asset=>{
        const binding=library.captureBindings([asset])[0];
        if(!binding)throw new Error('Missing media. Relink before indexing.');
        return {id:binding.id,originalPath:binding.originalPath,size:binding.size,modifiedAt:binding.modifiedAt,ino:binding.ino,asset};
      });
      assetContext={directory:path.join(app.getPath('userData'),'asset-index'),bindings};
    }
    return jobSchema.parse(jobs.start(event.sender.id, request, binding, assetContext));
  });
  ipcMain.handle("ai:status", (event, ...args) => {
    check(event);
    z.tuple([]).parse(args);
    return jobSchema.nullable().parse(jobs.status(event.sender.id));
  });
  ipcMain.handle("ai:cancel", (event, ...args) => {
    check(event);
    const [id] = z.tuple([z.uuid()]).parse(args);
    return jobSchema.nullable().parse(jobs.cancel(event.sender.id, id));
  });
  app.once("before-quit", () => {
    for (const owner of observed) jobs.release(owner);
  });
  return jobs;
}
module.exports = { registerAIIPC };
