// @ts-check
const { z } = require("zod");
const { projectSchema } = require("../core/project/schema.cjs");
const { workerRequestSchema } = require("../rendering/contracts.cjs");
const bindingSchema = workerRequestSchema.shape.bindings.element;
const requestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("analyze"),
      binding: bindingSchema,
      range: z
        .object({ start: z.number().min(0), end: z.number().max(86400) })
        .strict()
        .refine((r) => r.end > r.start)
        .optional(),
      directory: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("mix"),
      project: projectSchema,
      bindings: workerRequestSchema.shape.bindings,
      directory: z.string().min(1),
    })
    .strict(),
]);
if (require.main === module) {
  process.once("message", async (raw) => {
    try {
      const r = requestSchema.parse(raw),
        engine = require("./audio-processing.cjs");
      const result =
        r.action === "analyze"
          ? await engine.analyze(r.binding, r.directory, r.range)
          : await engine.mix(r.project, r.bindings, r.directory);
      process.send?.({ ok: true, result });
      process.disconnect?.();
    } catch (e) {
      process.send?.({
        ok: false,
        error:
          e instanceof Error && !("code" in e)
            ? e.message.slice(0, 250)
            : "Local audio processing failed. Check disk space and media availability.",
      });
      process.disconnect?.();
    }
  });
  process.once("disconnect", () => process.exit(0));
}
module.exports = { requestSchema };
