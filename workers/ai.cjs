// @ts-check
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const { z } = require("zod");
const { requestSchema, transcriptSchema, eventSchema } = require("../core/ai/schema.cjs");
const { preparePlan } = require("../core/ai/planning.cjs");
const { stableId } = require("../core/animation/engine.cjs");
const { createOllamaProvider } = require("./ollama.cjs");
const { toScenePlan } = require("../core/ai/scene-plan.cjs");
const provider = createOllamaProvider();
const { contextSchema: assetContextSchema, runAssets } = require("./asset-index.cjs");
const { killTree } = require("../electron/child-process.cjs");
/** @type {import('node:child_process').ChildProcess|null} */
let ownedPython = null;
const bindingSchema = z.object({
  id: z.uuid(),
  originalPath: z.string().min(1),
  size: z.number(),
  modifiedAt: z.number(),
  ino: z.number(),
});
const workerRequestSchema = z
  .object({
    id: z.uuid(),
    request: requestSchema,
    binding: bindingSchema.nullable(),
    assetContext: assetContextSchema.nullable().optional(),
  })
  .strict();
const pythonEvent = z.discriminatedUnion("type", [
  z
    .object({
      version: z.literal(1),
      type: z.literal("runtime"),
      available: z.boolean(),
      models: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)).max(1000),
      message: z.string().max(300),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("progress"),
      progress: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("transcript"),
      language: z.string(),
      duration: z.number(),
      segments: z
        .array(
          z
            .object({
              start: transcriptSchema.shape.segments.element.shape.start,
              end: transcriptSchema.shape.segments.element.shape.end,
              text: transcriptSchema.shape.segments.element.shape.text,
              words: transcriptSchema.shape.segments.element.shape.words,
            })
            .strict(),
        )
        .max(10000),
    })
    .strict(),
  z
    .object({ version: z.literal(1), type: z.literal("error"), message: z.string().max(300) })
    .strict(),
]);
/** @param {import('zod').infer<typeof eventSchema>} event */
function send(event) {
  process.send?.(eventSchema.parse(event));
}
/** @param {string} stage @param {number|null} [progress] */
function progress(stage, progress = null) {
  send({ type: "progress", state: "running", stage, progress });
}
/** @param {object} request @returns {Promise<import('zod').infer<typeof pythonEvent>>} */
function python(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.MOTIONCRAFT_PYTHON || "python",
      ["-I", "-u", path.join(__dirname, "transcribe.py")],
      {
        windowsHide: true,
        env: {
          ...process.env,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          PYTHONIOENCODING: "utf-8",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    ownedPython = child;
    let buffer = "",
      total = 0;
    /** @type {import('zod').infer<typeof pythonEvent>|undefined} */
    let result;
    child.stderr.resume();
    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error("Python worker timed out."));
      },
      "action" in request && request.action === "detect" ? 20000 : 29 * 60 * 1000,
    );
    child.stdout.on("data", (data) => {
      total += data.length;
      if (total > 8 * 1024 * 1024) {
        child.kill();
        reject(new Error("Transcript exceeds the worker response limit."));
        return;
      }
      buffer += String(data);
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          const event = pythonEvent.parse(JSON.parse(line));
          if (event.type === "progress") progress("Transcribing local audio", event.progress);
          else result = event;
        } catch {
          child.kill();
          reject(new Error("Python returned an invalid response."));
        }
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Python is unavailable. Configure MOTIONCRAFT_PYTHON."));
    });
    child.on("close", (code) => {
      if (ownedPython === child) ownedPython = null;
      clearTimeout(timer);
      if (code || !result || result.type === "error")
        reject(
          new Error(
            "Local transcription is unavailable. Check Python, faster-whisper and the selected local model.",
          ),
        );
      else resolve(result);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ version: 1, ...request }) + "\n");
  });
}
/** @param {unknown} raw */
async function run(raw) {
  const { id, request, binding, assetContext } = workerRequestSchema.parse(raw);
  send({ type: "progress", state: "preparing", stage: "Preparing local AI", progress: null });
  if (request.kind === "assets") return runAssets(request.operation, assetContext, progress);
  if (request.kind === "detect") {
    const [ollama, whisper] = await Promise.allSettled([
      provider.healthCheck(),
      python({ action: "detect" }),
    ]);
    const py =
      whisper.status === "fulfilled" && whisper.value.type === "runtime" ? whisper.value : null;
    return {
      kind: "runtime",
      runtime: {
        ollama:
          ollama.status === "fulfilled"
            ? ollama.value
            : {
                running: false,
                models: [],
                message: "Ollama discovery failed. Start Ollama and detect again.",
              },
        whisper: {
          python: !!py,
          available: py?.available ?? false,
          models: py?.models ?? [],
          device: "cpu",
          message: py?.message || "Configure Python and install faster-whisper.",
        },
      },
    };
  }
  if (request.kind === "plan") {
    const plan = await provider.generateStructured(
      preparePlan(request.input, request.settings, id),
      request.model,
      request.settings,
      (stage) => progress(stage),
    );
    const result = {
      ...plan,
      sourceText:
        request.input.kind === "script" ? request.input.text : request.input.transcript.text,
      modelId: request.model,
    };
    toScenePlan(result);
    return {
      kind: "plan",
      plan: result,
    };
  }
  if (request.kind === "transcribe") {
    if (!binding || binding.id !== request.assetId)
      throw new Error("Import/relink the narration before transcription.");
    const fingerprint = async () => {
      const real = await fs.realpath(binding.originalPath);
      const stat = await fs.stat(real);
      if (
        real !== binding.originalPath ||
        !stat.isFile() ||
        stat.size !== binding.size ||
        stat.mtimeMs !== binding.modifiedAt ||
        stat.ino !== binding.ino
      )
        throw new Error("Narration changed. Relink it before transcription.");
    };
    await fingerprint();
    progress("Loading local CPU model");
    const result = await python({
      action: "transcribe",
      audio: binding.originalPath,
      model: request.model,
      language: request.language,
    });
    await fingerprint();
    if (result.type !== "transcript")
      throw new Error("Install faster-whisper and a local transcription model first.");
    return {
      kind: "transcript",
      transcript: transcriptSchema.parse({
        version: 1,
        id,
        sourceAssetId: request.assetId,
        language: result.language,
        duration: result.duration,
        text: result.segments.map((s) => s.text).join(" "),
        segments: result.segments.map((s, i) => ({ ...s, id: stableId(`${id}:segment:${i}`) })),
        model: {
          engine: "faster-whisper",
          name: request.model,
          device: "cpu",
          computeType: "int8",
        },
      }),
    };
  }
  throw new Error("Unsupported AI request.");
}
if (require.main === module) {
  process.once("disconnect", () => {
    provider.cancel();
    if (ownedPython) killTree(ownedPython);
    process.exit(0);
  });
  process.once("message", (raw) => {
    run(raw)
      .then((result) => {
        send({
          type: "progress",
          state: "validating",
          stage: "Validating local result",
          progress: null,
        });
        send({ type: "done", result: require("../core/ai/schema.cjs").resultSchema.parse(result) });
        process.disconnect?.();
      })
      .catch((error) => {
        send({
          type: "error",
          code:
            error instanceof z.ZodError ||
            (error instanceof Error &&
              error.message.startsWith("Scene description validation failed"))
              ? "invalid-output"
              : "unavailable",
          message:
            error instanceof z.ZodError
              ? "The AI result failed validation."
              : error instanceof Error && "code" in error
                ? "The local runtime or narration file is unavailable. Check setup and relink the source."
                : error instanceof Error
                  ? error.message.slice(0, 300)
                  : "Local AI failed.",
        });
        process.disconnect?.();
      });
  });
}
module.exports = { workerRequestSchema, run, python };
