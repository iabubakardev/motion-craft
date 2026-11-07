// @ts-check
const { z } = require("zod");
const assetIndex = require("../assets/index-schema.cjs");
const { fpsSchema, aspectRatioSchema, styleSchema, idSchema } = require("../project/schema.cjs");
const { presetSchema } = require("../animation/schema.cjs");
const time = z.number().finite().min(0).max(86400);
const wordSchema = z
  .object({
    text: z.string().max(500),
    start: time,
    end: time,
    probability: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((w) => w.end > w.start, "Word end must follow start");
const segmentSchema = z
  .object({
    id: idSchema,
    start: time,
    end: time,
    text: z.string().trim().min(1).max(10000),
    words: z.array(wordSchema).max(3000).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.end <= s.start)
      ctx.addIssue({ code: "custom", message: "Segment end must follow start" });
    let end = s.start;
    for (const w of s.words || []) {
      if (w.start < end - 1e-6 || w.end > s.end + 1e-6)
        ctx.addIssue({ code: "custom", message: "Words must be ordered within their segment" });
      end = w.end;
    }
  });
const transcriptSchema = z
  .object({
    version: z.literal(1),
    id: idSchema,
    sourceAssetId: idSchema,
    language: z.string().min(1).max(40),
    text: z.string().max(100000),
    duration: time.positive(),
    model: z
      .object({
        engine: z.literal("faster-whisper"),
        name: z.string().min(1).max(120),
        device: z.literal("cpu"),
        computeType: z.literal("int8"),
      })
      .strict(),
    segments: z.array(segmentSchema).min(1).max(10000),
  })
  .strict()
  .superRefine((t, ctx) => {
    let end = 0;
    const ids = new Set();
    for (const s of t.segments) {
      if (ids.has(s.id) || s.start < end - 1e-6 || s.end > t.duration + 1e-6)
        ctx.addIssue({
          code: "custom",
          message: "Transcript IDs and timing must be ordered, unique and within source duration",
        });
      end = s.end;
      ids.add(s.id);
    }
    if (t.text !== t.segments.map((s) => s.text).join(" "))
      ctx.addIssue({ code: "custom", message: "Transcript text must match its segments" });
  });
const sceneSchema = z
  .object({
    id: idSchema,
    start: time,
    end: time,
    narration: z.string().max(20000),
    visualDescription: z.string().trim().min(1).max(2000),
    keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    assetType: z.enum(["image", "video"]),
    assetId: idSchema.nullable(),
    animation: z.union([z.literal("none"), presetSchema]),
  })
  .strict();
const planSchema = z
  .object({
    version: z.literal(1),
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    sourceText: z.string().min(1).max(100000).optional(),
    modelId: z.string().min(1).max(120).optional(),
    fps: fpsSchema,
    aspectRatio: aspectRatioSchema,
    style: styleSchema,
    timing: z.enum(["narration", "estimated"]),
    duration: time.positive(),
    transcript: transcriptSchema.nullable(),
    scenes: z.array(sceneSchema).min(1).max(512),
  })
  .strict()
  .superRefine((p, ctx) => {
    let end = 0;
    const ids = new Set();
    for (const scene of p.scenes) {
      if (ids.has(scene.id) || Math.abs(scene.start - end) > 1e-6 || scene.end <= scene.start)
        ctx.addIssue({
          code: "custom",
          message: "Scenes require unique IDs and contiguous positive timing from zero",
        });
      ids.add(scene.id);
      end = scene.end;
    }
    if (Math.abs(end - p.duration) > 1e-6)
      ctx.addIssue({ code: "custom", message: "Plan duration must equal its scene sequence" });
    if (
      (p.timing === "narration") !== !!p.transcript ||
      (p.transcript && Math.abs(p.duration - p.transcript.duration) > 1e-6)
    )
      ctx.addIssue({
        code: "custom",
        message: "Narration timing must match the original transcript duration",
      });
  });
const settingsSchema = z
  .object({
    fps: fpsSchema,
    aspectRatio: aspectRatioSchema,
    style: styleSchema,
    minSeconds: z.number().min(1).max(15),
    maxSeconds: z.number().min(2).max(30),
    wordsPerMinute: z.number().min(80).max(240),
    instructions: z.string().max(2000),
    temperature: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (s) => s.maxSeconds >= s.minSeconds * 2,
    "Maximum scene duration must be at least twice the minimum",
  );
const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("script"), text: z.string().trim().min(1).max(50000) }).strict(),
  z.object({ kind: z.literal("transcript"), transcript: transcriptSchema }).strict(),
]);
const modelName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ollamaModelName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const requestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("transcription"),
      assetId: idSchema,
      model: require("../transcription/schema.cjs").modelSchema,
      device: require("../transcription/schema.cjs").deviceSchema,
      computeType: require("../transcription/schema.cjs").computeSchema,
    })
    .strict(),
  z.object({ kind: z.literal("assets"), operation: assetIndex.operationSchema }).strict(),
  z.object({ kind: z.literal("detect") }).strict(),
  z
    .object({
      kind: z.literal("transcribe"),
      assetId: idSchema,
      model: modelName,
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan"),
      model: ollamaModelName,
      input: inputSchema,
      settings: settingsSchema,
    })
    .strict(),
]);
const runtimeSchema = z
  .object({
    ollama: z
      .object({
        running: z.boolean(),
        version: z.string().min(1).max(80).optional(),
        models: z.array(ollamaModelName).max(1000),
        message: z.string().max(300),
      })
      .strict(),
    whisper: z
      .object({
        python: z.boolean(),
        available: z.boolean(),
        models: z.array(modelName).max(1000),
        device: z.literal("cpu"),
        message: z.string().max(300),
      })
      .strict(),
  })
  .strict();
const resultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("transcription"),
      transcript: require("../transcription/schema.cjs").transcriptSchema,
    })
    .strict(),
  assetIndex.resultSchema,
  z.object({ kind: z.literal("runtime"), runtime: runtimeSchema }).strict(),
  z.object({ kind: z.literal("transcript"), transcript: transcriptSchema }).strict(),
  z.object({ kind: z.literal("plan"), plan: planSchema }).strict(),
]);
const stateSchema = z.enum([
  "idle",
  "preparing",
  "running",
  "validating",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);
const jobSchema = z
  .object({
    id: idSchema,
    state: stateSchema,
    stage: z.string().max(300),
    progress: z.number().min(0).max(1).nullable(),
    error: z
      .enum(["unavailable", "invalid-input", "invalid-output", "timeout", "worker-failed"])
      .nullable(),
    result: resultSchema.nullable(),
  })
  .strict();
const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("progress"),
      state: z.enum(["preparing", "running", "validating"]),
      stage: z.string().max(300),
      progress: z.number().min(0).max(1).nullable(),
    })
    .strict(),
  z.object({ type: z.literal("done"), result: resultSchema }).strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.enum(["unavailable", "invalid-input", "invalid-output", "worker-failed"]),
      message: z.string().max(300),
    })
    .strict(),
]);
module.exports = {
  wordSchema,
  segmentSchema,
  transcriptSchema,
  sceneSchema,
  planSchema,
  settingsSchema,
  inputSchema,
  requestSchema,
  runtimeSchema,
  resultSchema,
  jobSchema,
  eventSchema,
};
