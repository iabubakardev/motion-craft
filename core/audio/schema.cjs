// @ts-check
const { z } = require("zod");
const keySchema = z
  .object({
    id: z.uuid(),
    frame: z.number().int().min(0).max(5184000),
    db: z.number().min(-60).max(12),
    origin: z.enum(["manual", "ducking"]).default("manual"),
  })
  .strict();
const effectsSchema = z
  .object({
    bypass: z.boolean(),
    highpass: z.number().min(0).max(1000),
    lowDb: z.number().min(-18).max(18),
    midDb: z.number().min(-18).max(18),
    highDb: z.number().min(-18).max(18),
    compressor: z.boolean(),
    thresholdDb: z.number().min(-60).max(0),
    ratio: z.number().min(1).max(20),
    limiter: z.boolean(),
    ceilingDb: z.number().min(-12).max(0),
    noiseGate: z.boolean(),
    noiseFloorDb: z.number().min(-80).max(-10),
  })
  .strict();
const audioSchema = z
  .object({
    gainDb: z.number().min(-60).max(12),
    pan: z.number().min(-1).max(1),
    fadeCurve: z.enum(["linear", "equal-power"]),
    keys: z.array(keySchema).max(2000),
    effects: effectsSchema,
  })
  .strict()
  .refine(
    (a) => a.keys.every((k, i) => !i || k.frame > a.keys[i - 1].frame),
    "Volume keys must be sorted with one key per frame",
  );
/** @returns {import("zod").infer<typeof audioSchema>} */
const defaultAudio = () => ({
  gainDb: 0,
  pan: 0,
  fadeCurve: "linear",
  keys: [],
  effects: {
    bypass: false,
    highpass: 0,
    lowDb: 0,
    midDb: 0,
    highDb: 0,
    compressor: false,
    thresholdDb: -18,
    ratio: 3,
    limiter: true,
    ceilingDb: -1,
    noiseGate: false,
    noiseFloorDb: -45,
  },
});
const analysisSchema = z
  .object({
    version: z.literal(1),
    duration: z.number().min(0).max(86400),
    step: z.number().positive(),
    peaks: z.array(z.number().min(0).max(1)).max(60001),
    peakDb: z.number().finite().nullable(),
    lufs: z.number().finite().nullable(),
    truePeakDb: z.number().finite().nullable(),
    speech: z.array(z.tuple([z.number().min(0), z.number().max(86400)])).max(20000),
  })
  .strict();
module.exports = { keySchema, effectsSchema, audioSchema, defaultAudio, analysisSchema };
