// @ts-check
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { bundle } = require("@remotion/bundler");
const {
  ensureBrowser,
  renderMedia,
  selectComposition,
  makeCancelSignal,
} = require("@remotion/renderer");
const { workerRequestSchema } = require("../rendering/contracts.cjs");
const { buildComposition } = require("../rendering/input.cjs");
const { probe } = require("../electron/render-binaries.cjs");
const {
  verifyRender,
  sourceDuration,
  verifySourceRange,
} = require("../electron/verify-render.cjs");
const { createRenderMediaServer } = require("../electron/render-media-server.cjs");
const { cancel, cancelSignal } = makeCancelSignal();
let cancelled = false,
  started = false;
/** @param {import('zod').infer<typeof import('../rendering/contracts.cjs').workerEventSchema>} event */
const send = (event) => {
  if (process.connected) process.send?.(event);
};
process.on("message", async (message) => {
  if (message && typeof message === "object" && "cancel" in message) {
    cancelled = true;
    cancel();
    return;
  }
  if (started) return;
  started = true;
  let directory, media;
  try {
    const request = workerRequestSchema.parse(message);
    media = await createRenderMediaServer(request.bindings);
    const input = { project: request.project, sources: media.sources },
      model = buildComposition(input);
    if (model.clips.some((clip) => clip.assetId && !clip.src)) throw new Error("Missing media");
    send({ type: "progress", state: "preparing", progress: 0 });
    /** @type {Map<string, number>} */
    const durations = new Map();
    for (const clip of model.clips) {
      if ((clip.type !== "video" && clip.type !== "audio") || !clip.assetId) continue;
      if (cancelled) throw new Error("Cancelled");
      let duration = durations.get(clip.assetId);
      if (duration === undefined) {
        const binding = request.bindings.find((item) => item.id === clip.assetId);
        if (!binding) throw new Error("Missing source binding");
        duration = sourceDuration(await probe(binding.originalPath), clip.type);
        durations.set(clip.assetId, duration);
      }
      verifySourceRange(clip.sourceStart, clip.durationInFrames, model.fps, duration);
    }
    await ensureBrowser();
    if (cancelled) throw new Error("Cancelled");
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "motioncraft-render-"));
    send({ type: "progress", state: "bundling", progress: 0 });
    const serveUrl = await bundle({
      entryPoint: path.join(__dirname, "../rendering/entry.tsx"),
      outDir: path.join(directory, "bundle"),
      publicDir: null,
      onProgress: (progress) =>
        send({ type: "progress", state: "bundling", progress: progress / 100 }),
    });
    if (cancelled) throw new Error("Cancelled");
    const composition = await selectComposition({
      serveUrl,
      id: "MotionCraft",
      inputProps: { input },
    });
    if (cancelled) throw new Error("Cancelled");
    await renderMedia({
      composition,
      serveUrl,
      inputProps: { input },
      outputLocation: request.output,
      codec: "h264",
      audioCodec: "aac",
      sampleRate: request.project.settings.audioSampleRate,
      pixelFormat: "yuv420p",
      concurrency: 2,
      cancelSignal,
      onProgress: ({ progress, stitchStage }) =>
        send({
          type: "progress",
          state: stitchStage === "muxing" ? "finalizing" : "rendering",
          progress,
        }),
    });
    if (cancelled) throw new Error("Cancelled");
    const metadata = verifyRender(
      await probe(request.output),
      model,
      model.clips.some((clip) => clip.type === "audio" && !clip.muted),
    );
    console.log("Verified export:", JSON.stringify(metadata));
    send({ type: "done" });
  } catch (error) {
    if (cancelled) send({ type: "cancelled" });
    else {
      console.error("[render-worker]", error);
      send({
        type: "failed",
        message:
          error instanceof Error && /^(A source trim|Source media has)/.test(error.message)
            ? error.message
            : "Rendering failed. Check media availability, codecs, browser installation and disk space.",
      });
    }
  } finally {
    await media?.close();
    if (
      directory &&
      path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith("motioncraft-render-")
    )
      await fs.rm(directory, { recursive: true, force: true });
    if (process.connected) process.disconnect();
  }
});
process.on("disconnect", () => {
  cancelled = true;
  cancel();
  setTimeout(() => {
    if (process.platform === "win32")
      execFile(
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(process.pid), "/T", "/F"],
        { windowsHide: true },
        () => {},
      );
    else process.exit(1);
  }, 10000).unref();
});
