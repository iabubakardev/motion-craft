// @ts-check
const { app, BrowserWindow, ipcMain } = require("electron"),
  path = require("node:path"),
  { z } = require("zod");
const { validateRequest } = require("../security.cjs"),
  { projectSchema } = require("../../core/project/schema.cjs"),
  { createAudioService } = require("../audio-service.cjs");
/** @param {ReturnType<typeof import("../media-library.cjs").createMediaLibrary>} library */
function registerAudioIPC(library) {
  const service = createAudioService(path.join(app.getPath("userData"), "audio-cache")),
    observed = new Set();
  /** @param {import("electron").IpcMainInvokeEvent} event */
  function check(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    validateRequest(event, window?.webContents);
    if (!window) throw new Error("Missing owner");
    if (!observed.has(event.sender.id)) {
      observed.add(event.sender.id);
      event.sender.on("did-start-navigation", (_, __, ___, main) => {
        if (main) service.release(event.sender.id);
      });
      event.sender.once("destroyed", () => {
        service.release(event.sender.id);
        observed.delete(event.sender.id);
      });
    }
    return window;
  }
  ipcMain.handle("audio:analyze", async (event, ...args) => {
    check(event);
    const [id, range] = z
        .tuple([
          z.uuid(),
          z
            .object({ start: z.number().min(0), end: z.number().max(86400) })
            .strict()
            .refine((r) => r.end > r.start)
            .optional(),
        ])
        .parse(args),
      asset = library
        .listAssets()
        .find((a) => a.id === id && a.type !== "image" && a.status !== "error"),
      binding = asset && library.captureBindings([asset])[0];
    if (!binding) throw new Error("Import or relink the audio source first.");
    const result = await service.analyze(event.sender.id, binding, range);
    check(event);
    return result;
  });
  ipcMain.handle("audio:mix", async (event, ...args) => {
    check(event);
    const [project] = z.tuple([projectSchema]).parse(args),
      bindings =
        (require("../../core/project/schema.cjs").serializeProject(project),
        library.captureBindings(project.assets));
    let binding;
    try {
      binding = await service.mix(event.sender.id, project, bindings);
    } catch (error) {
      if (
        error instanceof Error &&
        ["Audio processing canceled.", "Audio request superseded."].includes(error.message)
      )
        return { canceled: true };
      throw error;
    }
    check(event);
    const asset = await library.registerDerived(binding.originalPath);
    check(event);
    return { url: asset.url };
  });
  ipcMain.handle("audio:inspect-clip", async (event, ...args) => {
    check(event);
    const [project, id] = z.tuple([projectSchema, z.uuid()]).parse(args),
      record = require("../../core/timeline/commands.cjs")
        .createTimelineIndex(project)
        .clips.get(id);
    if (!record?.asset || record.asset.type === "image")
      throw new Error("Select an audio/video clip.");
    require("../../core/project/schema.cjs").serializeProject(project);
    const original = { ...record.clip };
    delete original.layerId;
    const clip = {
      ...original,
      start: 0,
      assetId: record.asset.id,
      volume:
        record.clip.volume ??
        (record.layer && "volume" in record.layer.properties ? record.layer.properties.volume : 1),
      muted:
        !!record.clip.muted ||
        !!(record.layer && "muted" in record.layer.properties && record.layer.properties.muted),
      ...(record.asset.type === "video" ? { audioOnly: true } : {}),
    };
    const isolated = projectSchema.parse({
      ...project,
      duration: clip.duration,
      scenes: [],
      transcripts: [],
      animations: {},
      tracks: [
        {
          ...record.track,
          type: "audio",
          order: 0,
          muted: false,
          visible: true,
          solo: false,
          clips: [clip],
        },
      ],
    });
    const bindings = library.captureBindings(project.assets),
      binding = await service.mix(event.sender.id, isolated, bindings, "inspect:" + id),
      result = await service.analyze(event.sender.id, binding);
    check(event);
    return result;
  });
  return service;
}
module.exports = { registerAudioIPC };
