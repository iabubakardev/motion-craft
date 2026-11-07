// @ts-check
const { z } = require("zod");
const seconds = z.number().finite().min(0).max(86400);
const modelSchema = z.enum(["tiny", "base", "small", "medium"]);
const deviceSchema = z.enum(["cpu", "cuda", "auto"]);
const computeSchema = z.enum([
  "int8",
  "float32",
  "float16",
  "int8_float16",
  "int8_float32",
  "bfloat16",
  "int8_bfloat16",
  "default",
  "auto",
]);
const wordSchema = z
  .object({
    start: seconds,
    end: seconds,
    text: z.string().max(1000),
    probability: z.number().min(0).max(1),
  })
  .strict()
  .refine((w) => w.end >= w.start, "Invalid word interval");
const segmentSchema = z
  .object({
    id: z.number().int().nonnegative(),
    start: seconds,
    end: seconds,
    text: z.string().max(10000),
    words: z.array(wordSchema).max(5000),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.end <= s.start)
      ctx.addIssue({ code: "custom", message: "Segment must have positive duration" });
    let end = s.start;
    for (const w of s.words) {
      if (w.start < end - 1e-6 || w.end > s.end + 1e-6)
        ctx.addIssue({ code: "custom", message: "Words must be ordered within segment" });
      end = w.end;
    }
  });
const optionsSchema = z
  .object({
    beamSize: z.number().int().min(1).max(100),
    wordTimestamps: z.boolean(),
    vadFilter: z.boolean(),
    language: z
      .string()
      .regex(/^[a-z]{2,3}$/)
      .nullable(),
  })
  .strict();
const requestSchema = z
  .object({
    protocolVersion: z.literal(1),
    jobId: z.uuid(),
    action: z.literal("transcribe"),
    audioPath: z.string().min(1).max(32768),
    model: modelSchema,
    device: deviceSchema,
    computeType: computeSchema,
    options: optionsSchema,
  })
  .strict();
const resultSchema = z
  .object({
    jobId: z.uuid(),
    audioPath: z.string().min(1).max(32768),
    language: z.string().max(40),
    languageProbability: z.number().min(0).max(1),
    duration: seconds,
    model: modelSchema,
    device: deviceSchema,
    computeType: computeSchema,
    segments: z.array(segmentSchema).max(10000),
    execution: z
      .object({
        startedAt: z.string().datetime({ offset: true }),
        elapsedSeconds: z.number().finite().nonnegative(),
        fasterWhisperVersion: z.string().max(80),
        options: optionsSchema,
        actualDevice: z.string().max(80),
        actualComputeType: z.string().max(80),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    let end = 0;
    const ids = new Set();
    for (const s of r.segments) {
      if (s.start < end - 1e-6 || s.end > r.duration + 0.1 || ids.has(s.id))
        ctx.addIssue({
          code: "custom",
          message: "Segments must be unique, ordered and inside source duration",
        });
      ids.add(s.id);
      end = s.end;
    }
  });
const base = { protocolVersion: z.literal(1), jobId: z.uuid().nullable() };
const errorSchema = z
  .object({
    ...base,
    type: z.literal("error"),
    code: z.enum([
      "invalid_json",
      "invalid_request",
      "audio_not_found",
      "model_missing",
      "transcription_failed",
    ]),
    message: z.string().max(16000),
  })
  .strict();
const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("started") }).strict(),
  z.object({ ...base, type: z.literal("model_loading"), model: modelSchema }).strict(),
  z.object({ ...base, type: z.literal("model_ready"), model: modelSchema }).strict(),
  z.object({ ...base, type: z.literal("segment"), segment: segmentSchema }).strict(),
  z.object({ ...base, type: z.literal("completed"), result: resultSchema }).strict(),
  errorSchema,
]);
const configSchema = z
  .object({
    pythonPath: z.string().min(1).max(32768),
    workerPath: z.string().min(1).max(32768),
    model: modelSchema,
    device: deviceSchema,
    computeType: computeSchema,
  })
  .strict();
const preferencesSchema = configSchema.pick({ model: true, device: true, computeType: true });
const settingsSchema = z
  .object({ config: configSchema.nullable(), available: z.boolean(), message: z.string().max(500) })
  .strict();
const sourceRangeSchema = z
  .object({
    clipId: z.uuid().optional(),
    sourceStart: seconds,
    sourceEnd: seconds,
    timelineStart: seconds,
    rate: z.number().min(0.25).max(4),
  })
  .strict()
  .refine((r) => r.sourceEnd > r.sourceStart, "Invalid source range");
const audioInfoSchema = z
  .object({
    hasAudio: z.boolean(),
    duration: seconds,
    size: z.number().nonnegative(),
    modifiedAt: z.number().finite(),
  })
  .strict();
const exportFileSchema = z
  .object({
    format: z.enum(["txt", "srt", "vtt", "json", "csv"]),
    text: z.string().max(5 * 1024 * 1024),
  })
  .strict();
const transcriptSchema = z
  .object({
    version: z.literal(1),
    context: sourceRangeSchema.optional(),
    status: z.literal("completed").optional(),
    id: z.uuid(),
    assetId: z.uuid(),
    source: z
      .object({
        filename: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[^\\/\x00-\x1f:]+$/),
        size: z.number().nonnegative(),
        modifiedAt: z.number().finite(),
      })
      .strict(),
    result: z.object({ ...resultSchema.shape, audioPath: z.never().optional() }).strict(),
    originalSegments: z.array(segmentSchema).max(10000),
    captionIds: z.array(z.uuid()).max(20000),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (
      t.id !== t.result.jobId ||
      new Set(t.captionIds).size !== t.captionIds.length ||
      !resultSchema.safeParse({ ...t.result, audioPath: "internal" }).success ||
      !resultSchema.safeParse({ ...t.result, segments: t.originalSegments, audioPath: "internal" })
        .success
    )
      ctx.addIssue({
        code: "custom",
        message: "Transcript identity, timing or caption references are invalid",
      });
    if (
      t.result.segments.length !== t.originalSegments.length ||
      t.result.segments.some(
        (s, i) =>
          s.id !== t.originalSegments[i]?.id ||
          s.start !== t.originalSegments[i]?.start ||
          s.end !== t.originalSegments[i]?.end,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Edited transcripts must retain original segment identity and timestamps",
      });
  });
module.exports = {
  sourceRangeSchema,
  audioInfoSchema,
  exportFileSchema,
  wordSchema,
  segmentSchema,
  modelSchema,
  deviceSchema,
  computeSchema,
  requestSchema,
  resultSchema,
  eventSchema,
  errorSchema,
  configSchema,
  preferencesSchema,
  settingsSchema,
  transcriptSchema,
};
