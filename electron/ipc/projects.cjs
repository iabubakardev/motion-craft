const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const fs = require("node:fs/promises");
const { validateRequest } = require("../security.cjs");
const { createProjectStore } = require("../project-store.cjs");
const { idSchema, projectSchema, projectAssetSchema, serializeProject } = require("../../core/project/schema.cjs");
const { openResultSchema, activationResultSchema, saveResultSchema, relinkResultSchema } = require("../../core/project/ipc.cjs");

function registerProjectIPC(library) {
  const store = createProjectStore(path.join(app.getPath("userData"), "project-media"), library);
  const states = new Map();
  const empty = z.tuple([]);
  const check = (event, args, schema) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    validateRequest(event, window?.webContents);
    schema.parse(args);
    if (!states.has(event.sender.id)) {
      const state = { filename: null, candidate: null, busy: false, generation: 0 };
      states.set(event.sender.id, state);
      // A renderer reload starts a new unsaved document, never a silent overwrite of its previous file.
      event.sender.on("did-finish-load", () => { state.filename = null; state.candidate = null; state.generation++; });
      event.sender.once("destroyed", () => states.delete(event.sender.id));
    }
    return { window, state: states.get(event.sender.id) };
  };
  const handle = (channel, schema, operation) => ipcMain.handle(channel, async (event, ...args) => {
    const context = check(event, args, schema);
    if (context.state.busy) throw new Error("Another project operation is in progress.");
    context.state.busy = true;
    const generation = context.state.generation;
    const recheck = () => {
      if (context.state.generation !== generation) throw new Error("The originating document was replaced.");
      return check(event, args, schema);
    };
    try { return await operation(context, args, recheck); }
    catch { throw new Error("The project operation failed. Check file access and try again. Your current project was kept."); }
    finally { context.state.busy = false; }
  });

  handle("projects:open", empty, async ({ window, state }, _args, recheck) => {
    const selection = await dialog.showOpenDialog(window, { title: "Open MotionCraft project", properties: ["openFile", "dontAddToRecent"], filters: [{ name: "MotionCraft project JSON", extensions: ["json"] }] });
    if (selection.canceled || !selection.filePaths[0]) return openResultSchema.parse({ status: "canceled" });
    recheck();
    const result = await store.read(selection.filePaths[0]);
    recheck();
    if (!result.success) return openResultSchema.parse({ status: "error", errors: result.errors });
    const candidateId = randomUUID();
    state.candidate = { candidateId, project: result.project, filename: selection.filePaths[0] };
    return openResultSchema.parse({ status: "ready", project: result.project, filename: path.basename(selection.filePaths[0]), candidateId });
  });
  handle("projects:activate", z.tuple([projectSchema, idSchema.nullable()]), async ({ state }, [project, candidateId], recheck) => {
    if (candidateId && (state.candidate?.candidateId !== candidateId || serializeProject(state.candidate.project) !== serializeProject(project))) throw new Error("Open candidate changed. Select the file again.");
    const filename = candidateId ? state.candidate.filename : null;
    const resolved = await store.resolve(project);
    recheck();
    state.filename = filename;
    state.candidate = null;
    return activationResultSchema.parse({ project, ...resolved, filename: filename ? path.basename(filename) : null });
  });
  handle("projects:save", z.tuple([projectSchema, z.boolean()]), async ({ window, state }, [project, saveAs], recheck) => {
    let filename = saveAs ? null : state.filename;
    if (!filename) {
      const result = await dialog.showSaveDialog(window, { title: "Save MotionCraft project", defaultPath: `${project.name.replace(/[^a-zA-Z0-9 _-]/g, "_") || "Project"}.motioncraft.json`, filters: [{ name: "MotionCraft project", extensions: ["json"] }] });
      if (result.canceled || !result.filePath) return saveResultSchema.parse({ status: "canceled" });
      filename = result.filePath.toLowerCase().endsWith(".motioncraft.json") ? result.filePath : `${result.filePath}.motioncraft.json`;
      if (filename !== result.filePath) {
        const exists = await fs.stat(filename).then(() => true, () => false);
        if (exists) {
          const confirmation = await dialog.showMessageBox(window, { type: "warning", title: "Replace project file?", message: "The MotionCraft project filename already exists. Replace it?", buttons: ["Cancel", "Replace"], defaultId: 0, cancelId: 0 });
          if (confirmation.response !== 1) return saveResultSchema.parse({ status: "canceled" });
        }
      }
    }
    recheck();
    await store.save(filename, project);
    recheck();
    state.filename = filename;
    return saveResultSchema.parse({ status: "saved", filename: path.basename(filename) });
  });
  handle("projects:relink", z.tuple([projectAssetSchema]), async ({ window }, [asset], recheck) => {
    const extensions = asset.type === "image" ? ["png", "jpg", "jpeg", "webp"] : asset.type === "video" ? ["mp4", "mov", "webm"] : ["mp3", "wav"];
    const result = await dialog.showOpenDialog(window, { title: `Relink ${asset.filename}`, properties: ["openFile", "dontAddToRecent"], filters: [{ name: `${asset.type} media`, extensions }] });
    if (result.canceled || !result.filePaths[0]) return null;
    recheck();
    return relinkResultSchema.parse(await library.relinkAsset(asset, result.filePaths[0]));
  });
}

module.exports = { registerProjectIPC };
