// @ts-check
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const { validateRequest } = require("../security.cjs");
const { createRenderJobs } = require("../render-jobs.cjs");
const { startArgsSchema, workerRequestSchema } = require("../../rendering/contracts.cjs");
const { idSchema } = require("../../core/project/schema.cjs");
const { buildComposition } = require("../../rendering/input.cjs");
/** @param {ReturnType<typeof import('../media-library.cjs').createMediaLibrary>} library @param {()=>boolean} [otherBusy] */
function registerRenderIPC(library, otherBusy = () => false) {
  const jobs = createRenderJobs();
  let choosing = false;
  /** @type {Set<number>} */
  const observed = new Set();
  /** @param {import('electron').IpcMainInvokeEvent} event */
  function check(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    validateRequest(event, window?.webContents);
    if (!window) throw new Error("Missing window");
    if (!observed.has(event.sender.id)) {
      observed.add(event.sender.id);
      event.sender.on("did-start-navigation", (_e, _url, _inPlace, isMain) => {
        if (isMain) jobs.release(event.sender.id);
      });
      event.sender.once("destroyed", () => {
        jobs.release(event.sender.id);
        observed.delete(event.sender.id);
      });
    }
    return window;
  }
  ipcMain.handle("render:start", async (event, ...args) => {
    const window = check(event),
      [project] = startArgsSchema.parse(args);
    if (choosing || jobs.isBusy() || otherBusy())
      throw new Error("Another export or AI task is already in progress.");
    if (!project.duration) throw new Error("Add content before exporting.");
    if (project.resolution.width % 2 || project.resolution.height % 2)
      throw new Error("H.264 export requires even project dimensions.");
    const bindings = workerRequestSchema.shape.bindings.parse(
      library.captureBindings(project.assets),
    );
    const model = buildComposition({
      project,
      sources: Object.fromEntries(
        bindings.map((binding) => [binding.id, `motioncraft-media://asset/${binding.id}`]),
      ),
    });
    if (model.clips.some((clip) => clip.assetId && !clip.src))
      throw new Error("Relink missing media before exporting.");
    choosing = true;
    let obsolete = false;
    const invalidate = () => {
      obsolete = true;
    };
    event.sender.once("did-start-loading", invalidate);
    try {
      const result = await dialog.showSaveDialog(window, {
        title: "Export H.264 MP4",
        defaultPath: `${project.name.replace(/[^a-zA-Z0-9 _-]/g, "_") || "Project"}.mp4`,
        filters: [{ name: "MP4 video", extensions: ["mp4"] }],
      });
      check(event);
      if (obsolete) throw new Error("The originating document was replaced.");
      if (result.canceled || !result.filePath) return null;
      const output = result.filePath.toLowerCase().endsWith(".mp4")
        ? result.filePath
        : `${result.filePath}.mp4`;
      if (
        bindings.some(
          (binding) =>
            path.resolve(binding.originalPath).toLowerCase() === path.resolve(output).toLowerCase(),
        )
      )
        throw new Error("Choose a destination different from the source media.");
      const existing = await fs.stat(output).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing) {
        const confirmation = await dialog.showMessageBox(window, {
          type: "warning",
          title: "Replace exported video?",
          message: "This output already exists. Replace it only after the new render succeeds?",
          buttons: ["Cancel", "Replace"],
          defaultId: 0,
          cancelId: 0,
        });
        check(event);
        if (obsolete) throw new Error("The originating document was replaced.");
        if (confirmation.response !== 1) return null;
      }
      return await jobs.start(
        event.sender.id,
        {
          project,
          output,
          bindings,
          audioCache: path.join(require("electron").app.getPath("userData"), "audio-cache"),
        },
        existing,
      );
    } catch (error) {
      console.error("[render:start]", error instanceof Error ? error.name : "Error");
      throw new Error(
        error instanceof Error && /^(Choose|Relink|The originating)/.test(error.message)
          ? error.message
          : "Export could not start. Check the destination and available disk space.",
      );
    } finally {
      choosing = false;
      event.sender.removeListener("did-start-loading", invalidate);
    }
  });
  ipcMain.handle("render:status", (event, ...args) => {
    check(event);
    z.tuple([]).parse(args);
    return jobs.status(event.sender.id);
  });
  ipcMain.handle("render:cancel", (event, ...args) => {
    check(event);
    const [id] = z.tuple([idSchema]).parse(args);
    return jobs.cancel(event.sender.id, id);
  });
  app.on("before-quit", () => jobs.dispose());
  return { ...jobs, isBusy: () => choosing || jobs.isBusy() };
}
module.exports = { registerRenderIPC };
