// Optional real-model checks. No downloads; skipped capabilities are printed explicitly.
const fs = require("node:fs/promises"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { run } = require("./ai.cjs");
async function main() {
  const detection = await run({ id: randomUUID(), request: { kind: "detect" }, binding: null });
  console.log(JSON.stringify(detection, null, 2));
  const { runtime } = detection;
  if (runtime.ollama.models.length) {
    const model = process.env.MOTIONCRAFT_TEST_OLLAMA_MODEL || runtime.ollama.models[0];
    const result = await run({
      id: randomUUID(),
      request: {
        kind: "plan",
        model,
        input: {
          kind: "script",
          text: "Sunlight filters through a forest. A river flows between the trees.",
        },
        settings: {
          fps: 30,
          aspectRatio: "16:9",
          style: "default",
          minSeconds: 2,
          maxSeconds: 12,
          wordsPerMinute: 150,
          instructions: "Nature documentary",
          temperature: 0,
        },
      },
      binding: null,
    });
    console.log(
      `PASS: real Ollama returned ${result.plan.scenes.length} validated scene descriptions.`,
    );
  } else console.log("SKIP: real Ollama generation — no installed local model.");
  if (
    runtime.whisper.available &&
    runtime.whisper.models.length &&
    process.env.MOTIONCRAFT_TEST_AUDIO
  ) {
    const filename = await fs.realpath(process.env.MOTIONCRAFT_TEST_AUDIO);
    if (![".mp3", ".wav"].includes(path.extname(filename).toLowerCase()))
      throw new Error("Set MOTIONCRAFT_TEST_AUDIO to an MP3 or WAV.");
    const stat = await fs.stat(filename);
    if (!stat.isFile()) throw new Error("Audio must be a regular file.");
    const assetId = randomUUID();
    const result = await run({
      id: randomUUID(),
      request: {
        kind: "transcribe",
        assetId,
        model: process.env.MOTIONCRAFT_TEST_WHISPER_MODEL || runtime.whisper.models[0],
        language: null,
      },
      binding: {
        id: assetId,
        originalPath: filename,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        ino: stat.ino,
      },
    });
    console.log(
      `PASS: real transcription returned ${result.transcript.segments.length} validated segments.`,
    );
  } else
    console.log(
      "SKIP: real transcription — install faster-whisper, provide a local model and set MOTIONCRAFT_TEST_AUDIO.",
    );
}
main().catch(() => {
  console.error(
    "Real-model check failed. Verify local runtime/model configuration and the input audio.",
  );
  process.exitCode = 1;
});
