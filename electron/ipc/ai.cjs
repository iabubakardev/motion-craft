// @ts-check
const path = require("node:path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { z } = require("zod");
const { validateRequest } = require("../security.cjs");
const { requestSchema, jobSchema } = require("../../core/ai/schema.cjs");
const { createAIJobs } = require("../ai-jobs.cjs");
/** @param {ReturnType<typeof import('../media-library.cjs').createMediaLibrary>} library @param {()=>boolean} [otherBusy] */
function registerAIIPC(library, otherBusy = () => false) {
  const jobs = createAIJobs();
  const settings = require("../transcription-settings.cjs").createTranscriptionSettings(
    app.getPath("userData"),
    app.isPackaged ? null : path.resolve(__dirname, "../.."),
  );
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
    if (request.kind === "transcribe" || request.kind === "transcription") {
      const asset = library.listAssets().find((asset) => asset.id === request.assetId);
      if (
        !asset ||
        (request.kind === "transcription"
          ? !["audio", "video"].includes(asset.type)
          : asset.type !== "audio") ||
        (request.kind === "transcribe" && !["audio/mpeg", "audio/wav"].includes(asset.mimeType)) ||
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
      const bindings = assets.map((asset) => {
        const binding = library.captureBindings([asset])[0];
        if (!binding) throw new Error("Missing media. Relink before indexing.");
        return {
          id: binding.id,
          originalPath: binding.originalPath,
          size: binding.size,
          modifiedAt: binding.modifiedAt,
          ino: binding.ino,
          asset,
        };
      });
      assetContext = { directory: path.join(app.getPath("userData"), "asset-index"), bindings };
    }
    const config = request.kind === "transcription" ? settings.read().config : null;
    if (request.kind === "transcription" && !config)
      throw new Error("Configure the external Python worker in Transcription settings first.");
    return jobSchema.parse(jobs.start(event.sender.id, request, binding, assetContext, config));
  });
  ipcMain.handle("ai:inspect-audio", async (event, ...args) => {
    check(event);
    const [id] = z.tuple([z.uuid()]).parse(args);
    const asset = library
      .listAssets()
      .find((a) => a.id === id && a.type !== "image" && a.status !== "error");
    if (!asset) throw new Error("Import or relink the selected media first.");
    const binding = library.captureBindings([asset])[0];
    if (!binding) throw new Error("Media is offline. Relink it first.");
    const fs = require("node:fs/promises");
    const canonical = await fs.realpath(binding.originalPath);
    const before = await fs.stat(binding.originalPath);
    if (!before.isFile()) throw new Error("Media is not a regular file.");
    if (
      canonical !== binding.originalPath ||
      before.ino !== binding.ino ||
      before.size !== binding.size ||
      before.mtimeMs !== binding.modifiedAt
    )
      throw new Error("Media changed. Relink it first.");
    const probe = z
      .object({
        streams: z.array(z.object({ codec_type: z.string() })),
        format: z.object({ duration: z.coerce.number().finite().nonnegative() }),
      })
      .parse(await require("../render-binaries.cjs").probe(binding.originalPath));
    check(event);
    const after = await fs.stat(binding.originalPath);
    if (
      (await fs.realpath(binding.originalPath)) !== canonical ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error("Media changed during inspection.");
    return require("../../core/transcription/schema.cjs").audioInfoSchema.parse({
      hasAudio: probe.streams.some((s) => s.codec_type === "audio"),
      duration: probe.format.duration,
      size: after.size,
      modifiedAt: after.mtimeMs,
    });
  });
  ipcMain.handle("ai:copy-transcript", (event, ...args) => {
    check(event);
    const [text] = z.tuple([z.string().max(5 * 1024 * 1024)]).parse(args);
    if (Buffer.byteLength(text, "utf8") > 5 * 1024 * 1024)
      throw new Error("Transcript copy exceeds 5 MB.");
    require("electron").clipboard.writeText(text);
    return { copied: true };
  });
  ipcMain.handle("ai:save-transcript", async (event, ...args) => {
    const owner = check(event),
      url = event.sender.getURL(),
      [document] = z
        .tuple([require("../../core/transcription/schema.cjs").exportFileSchema])
        .parse(args);
    if (Buffer.byteLength(document.text, "utf8") > 5 * 1024 * 1024)
      throw new Error("Transcript export exceeds 5 MB.");
    const selected = await dialog.showSaveDialog(owner, {
      title: "Export transcript",
      defaultPath: `transcript.${document.format}`,
      filters: [{ name: document.format.toUpperCase(), extensions: [document.format] }],
      properties: ["showOverwriteConfirmation", "dontAddToRecent"],
    });
    check(event);
    if (event.sender.getURL() !== url || owner.isDestroyed())
      throw new Error("Window changed during export.");
    if (selected.canceled || !selected.filePath) return { saved: false };
    const fs = require("node:fs/promises"),
      temporary = selected.filePath + `.${require("node:crypto").randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, document.text, { encoding: "utf8", flag: "wx" });
      check(event);
      if (event.sender.getURL() !== url) throw new Error("Window changed during export.");
      await fs.rename(temporary, selected.filePath);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    return { saved: true };
  });
  ipcMain.handle("ai:transcription-settings", (event, ...args) => {
    check(event);
    z.tuple([]).parse(args);
    return settings.read();
  });
  ipcMain.handle("ai:configure-transcription", async (event, ...args) => {
    const window = check(event),
      url = event.sender.getURL();
    const [preferences, choosePaths] = z
      .tuple([require("../../core/transcription/schema.cjs").preferencesSchema, z.boolean()])
      .parse(args);
    if (jobs.isBusy())
      throw new Error("Wait for the active AI task before changing worker settings.");
    let config = settings.read().config;
    if (choosePaths) {
      const python = await dialog.showOpenDialog(window, {
        title: "Choose Python interpreter",
        defaultPath: config?.pythonPath,
        properties: ["openFile"],
        filters: [{ name: "Python", extensions: ["exe"] }],
      });
      check(event);
      if (event.sender.getURL() !== url || window.isDestroyed())
        throw new Error("Window changed during configuration.");
      if (python.canceled) return settings.read();
      const worker = await dialog.showOpenDialog(window, {
        title: "Choose motion_craft_ai/worker.py",
        defaultPath: config?.workerPath,
        properties: ["openFile"],
        filters: [{ name: "Python worker", extensions: ["py"] }],
      });
      check(event);
      if (event.sender.getURL() !== url || window.isDestroyed())
        throw new Error("Window changed during configuration.");
      if (worker.canceled) return settings.read();
      config = { pythonPath: python.filePaths[0], workerPath: worker.filePaths[0], ...preferences };
    }
    if (!config) throw new Error("Select the Python interpreter and worker entrypoint first.");
    if (jobs.isBusy())
      throw new Error(
        "An AI task started while selecting configuration. Try again after it finishes.",
      );
    return settings.save({ ...config, ...preferences });
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
