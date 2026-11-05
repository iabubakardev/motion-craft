// @ts-check
const { z } = require("zod");
const { projectSchema, idSchema } = require("../core/project/schema.cjs");
const jobStateSchema = z.enum([
  "idle",
  "preparing",
  "bundling",
  "rendering",
  "finalizing",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
]);
const jobSchema = z
  .object({
    id: idSchema,
    state: jobStateSchema,
    progress: z.number().finite().min(0).max(1),
    filename: z
      .string()
      .max(255)
      .regex(/^[^\\/]*$/),
    message: z.string().max(500),
  })
  .strict();
const startArgsSchema = z.tuple([projectSchema]);
const workerRequestSchema = z
  .object({
    project: projectSchema,
    output: z.string().min(1),
    bindings: z
      .array(
        z
          .object({
            id: idSchema,
            originalPath: z.string().min(1),
            size: z.number().int().nonnegative(),
            modifiedAt: z.number().finite(),
            ino: z.number().finite(),
            type: z.enum(["image", "video", "audio"]),
            mimeType: z.string(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
const workerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("progress"),
      state: z.enum(["preparing", "bundling", "rendering", "finalizing"]),
      progress: z.number().finite().min(0).max(1),
    })
    .strict(),
  z.object({ type: z.literal("done") }).strict(),
  z.object({ type: z.literal("cancelled") }).strict(),
  z.object({ type: z.literal("failed"), message: z.string().max(500) }).strict(),
]);
module.exports = {
  jobStateSchema,
  jobSchema,
  startArgsSchema,
  workerRequestSchema,
  workerEventSchema,
};
