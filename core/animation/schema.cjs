// @ts-check
const { z } = require("zod");
const frame = z
  .number()
  .int()
  .min(0)
  .max(86400 * 60);
const propertySchema = z.enum(["x", "y", "scaleX", "scaleY", "rotation", "opacity"]);
const easeSchema = z
  .object({
    type: z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "bezier"]),
    control: z
      .tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ])
      .optional(),
  })
  .strict()
  .refine((e) => e.type !== "bezier" || !!e.control, "Cubic Bezier needs four control values");
const keyframeSchema = z
  .object({
    id: z.uuid(),
    property: propertySchema,
    frame,
    value: z.number().finite(),
    easing: easeSchema,
  })
  .strict()
  .superRefine((key, ctx) => {
    const [min, max] =
      key.property === "opacity"
        ? [0, 1]
        : key.property.startsWith("scale")
          ? [0.001, 100]
          : key.property === "rotation"
            ? [-36000, 36000]
            : [-100000, 100000];
    if (key.value < min || key.value > max)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `${key.property} must be ${min} to ${max}`,
      });
  });
const presetSchema = z.enum([
  "fade-in",
  "fade-out",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "zoom-in",
  "zoom-out",
  "pan",
  "pop-in",
  "documentary-zoom",
]);
const motionSchema = z
  .object({
    keyframes: z.array(keyframeSchema).max(2000),
    preset: z
      .object({ name: presetSchema, durationFrames: frame.min(2) })
      .strict()
      .optional(),
  })
  .strict();
module.exports = { propertySchema, easeSchema, keyframeSchema, presetSchema, motionSchema };
