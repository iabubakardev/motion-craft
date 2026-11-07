// @ts-check
const { spawn } = require("node:child_process");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const { eventSchema, requestSchema, configSchema } = require("../core/transcription/schema.cjs");
/** Incremental UTF-8 NDJSON; bounded total and line sizes. @param {(event:import('zod').infer<typeof eventSchema>)=>void} emit */
function createParser(emit) {
  const decoder = new StringDecoder("utf8");
  let buffer = "",
    total = 0;
  /** @param {Buffer} chunk */
  function push(chunk) {
    total += chunk.length;
    if (total > 32 * 1024 * 1024)
      throw new Error("Transcription exceeds the 32 MB stream limit. Split the source.");
    buffer += decoder.write(chunk);
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.length > 8 * 1024 * 1024) throw new Error("Worker event exceeds limit");
      emit(eventSchema.parse(JSON.parse(line)));
    }
    if (buffer.length > 8 * 1024 * 1024) throw new Error("Worker event exceeds limit");
  }
  function finish() {
    buffer += decoder.end();
    if (buffer.trim()) throw new Error("Worker ended with a partial NDJSON event.");
  }
  return { push, finish };
}
/** @param {unknown} rawConfig @param {unknown} rawRequest @param {(stage:string)=>void} progress @param {(child:import('node:child_process').ChildProcess|null)=>void} own @param {typeof spawn} [launch] */
function transcribe(rawConfig, rawRequest, progress, own, launch = spawn) {
  const config = configSchema.parse(rawConfig),
    request = requestSchema.parse(rawRequest);
  return new Promise((resolve, reject) => {
    const child = launch(config.pythonPath, ["-m", "motion_craft_ai.worker"], {
      cwd: path.dirname(path.dirname(config.workerPath)),
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    own(child);
    let state = "idle",
      settled = false,
      diagnostics = "";
    /** @type {import('zod').infer<typeof import('../core/transcription/schema.cjs').resultSchema>|undefined} */ let result;
    /** @type {import('zod').infer<typeof import('../core/transcription/schema.cjs').segmentSchema>[]} */ const segments =
      [];
    /** @param {Error} error */
    function fail(error) {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    }
    const parser = createParser((event) => {
      if (event.jobId !== request.jobId) throw new Error("Worker returned a foreign job ID.");
      if (event.type === "error") {
        fail(
          new Error(
            event.code === "model_missing"
              ? "The selected model is not cached. Install it in the external AI environment using its models CLI, then retry."
              : "Transcription failed. Check source decoding, selected language, model cache and device/compute compatibility.",
          ),
        );
        return;
      }
      if (event.type === "started" && state === "idle") {
        state = "started";
        progress("Starting transcription");
      } else if (
        event.type === "model_loading" &&
        state === "started" &&
        event.model === request.model
      ) {
        state = "loading";
        progress("Loading cached model");
      } else if (
        event.type === "model_ready" &&
        state === "loading" &&
        event.model === request.model
      ) {
        state = "ready";
        progress("Transcribing locally");
      } else if (event.type === "segment" && state === "ready") {
        const previous = segments.at(-1);
        if (
          previous &&
          (event.segment.start < previous.end - 1e-6 ||
            segments.some((s) => s.id === event.segment.id))
        )
          throw new Error("Unordered transcription segments");
        segments.push(event.segment);
        progress(`Transcribed through ${event.segment.end.toFixed(1)} seconds`);
      } else if (event.type === "completed" && state === "ready") {
        if (
          event.result.jobId !== request.jobId ||
          event.result.audioPath !== request.audioPath ||
          event.result.model !== request.model ||
          event.result.device !== request.device ||
          event.result.computeType !== request.computeType ||
          JSON.stringify(event.result.segments) !== JSON.stringify(segments)
        )
          throw new Error("Worker result differs from its request or streamed segments.");
        result = event.result;
        state = "completed";
      } else throw new Error("Invalid transcription event transition.");
    });
    child.stdout?.on("data", (chunk) => {
      if (settled) return;
      try {
        parser.push(chunk);
      } catch {
        fail(
          new Error(
            "Invalid transcription worker event or sequence. Check worker protocol v1 compatibility.",
          ),
        );
      }
    });
    child.stderr?.on("data", (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-16384);
    });
    child.stdout?.on("error", () => fail(new Error("Could not read transcription events.")));
    child.stderr?.on("error", () => fail(new Error("Could not read worker diagnostics.")));
    child.stdin?.on("error", () => fail(new Error("Could not send request to Python worker.")));
    child.on("error", () =>
      fail(
        new Error(
          "Python could not start. Verify the configured interpreter and worker entrypoint.",
        ),
      ),
    );
    child.on("close", (code) => {
      own(null);
      if (settled) return;
      try {
        parser.finish();
        if (code !== 0 || !result)
          throw new Error(
            "Worker exited without a successful transcript. Check cached models and Python dependencies.",
          );
        settled = true;
        resolve(result);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid transcript"));
      } finally {
        diagnostics = "";
      }
    });
    child.stdin?.end(JSON.stringify(request) + "\n");
  });
}
module.exports = { createParser, transcribe };
