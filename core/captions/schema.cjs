// @ts-check
const { z } = require("zod");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unit = z.number().finite().min(0).max(1);
const presetSchema = z.enum([
  "documentary",
  "bold-impact",
  "karaoke-highlight",
  "rounded-box",
  "cinematic",
  "word-pop",
]);
const boxSchema = z
  .object({
    x: unit,
    y: unit,
    width: unit.min(0.05),
    rotation: z.number().finite().min(-180).max(180),
    locked: z.boolean(),
  })
  .strict();
const displayModeSchema = z.enum(["full", "phrase", "word"]);
const styleSchema = z
  .object({
    displayMode: displayModeSchema.optional(),
    fontFamily: z.enum(["Arial", "Georgia", "Impact", "monospace"]),
    fontSize: z.number().min(0.005).max(0.3),
    fontWeight: z.number().int().min(100).max(900),
    color,
    align: z.enum(["left", "center", "right"]),
    casing: z.enum(["none", "uppercase", "lowercase"]),
    letterSpacing: z.number().min(-0.02).max(0.05),
    lineHeight: z.number().min(0.8).max(3),
    maxLines: z.number().int().min(1).max(10),
    outlineColor: color,
    outlineWidth: z.number().min(0).max(0.02),
    shadowColor: color,
    shadowBlur: z.number().min(0).max(0.05),
    shadowX: z.number().min(-0.1).max(0.1),
    shadowY: z.number().min(-0.1).max(0.1),
    backgroundColor: color,
    backgroundOpacity: unit,
    padding: z.number().min(0).max(0.1),
    radius: z.number().min(0).max(0.1),
    opacity: unit,
    animation: z.enum(["none", "fade", "pop", "slide", "bounce", "reveal", "karaoke"]),
    animationSeconds: z.number().min(0).max(5),
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
    activeColor: color,
    inactiveColor: color,
    activeScale: z.number().min(1).max(2),
  })
  .strict();
const wordSchema = z
  .object({
    text: z.string().max(1000),
    start: z.number().finite().min(0).max(86400),
    end: z.number().finite().min(0).max(86400),
    color: color.optional(),
    bold: z.boolean().optional(),
    scale: z.number().min(0.5).max(2).optional(),
  })
  .strict()
  .refine((w) => w.end > w.start, "Word must have positive duration");
const captionSchema = z
  .object({
    version: z.literal(1),
    preset: presetSchema,
    style: styleSchema,
    box: boxSchema,
    words: z.array(wordSchema).max(5000),
  })
  .strict()
  .superRefine((c, ctx) => {
    let end = 0;
    for (const w of c.words) {
      if (w.start < end - 1e-6)
        ctx.addIssue({ code: "custom", message: "Caption words must be ordered" });
      end = w.end;
    }
  });
const groupingSchema = z
  .object({
    mode: z.enum(["sentence", "word"]),
    maxWords: z.number().int().min(1).max(100),
    maxLines: z.number().int().min(1).max(10),
    maxCharacters: z.number().int().min(1).max(500),
    maxSeconds: z.number().min(0.1).max(60),
    pauseSeconds: z.number().min(0).max(10),
  })
  .strict();
module.exports = {
  displayModeSchema,
  presetSchema,
  boxSchema,
  styleSchema,
  wordSchema,
  captionSchema,
  groupingSchema,
};
