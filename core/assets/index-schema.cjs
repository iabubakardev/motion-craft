// @ts-check
const { z } = require("zod");
const { projectAssetSchema } = require("../project/schema.cjs");
const modelName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const modelSchema = z.object({ name: modelName, digest: z.string().min(1).max(200) }).strict();
const tags = z.array(z.string().trim().min(1).max(80)).max(40);
const observationSchema = z
  .object({
    description: z.string().trim().min(1).max(2000),
    subjects: tags,
    actions: tags,
    settings: tags,
    tags,
  })
  .strict();
const vectorSchema = z
  .array(z.number().finite().min(-1e6).max(1e6))
  .min(1)
  .max(4096)
  .refine((v) => Math.hypot(...v) > 0, "Embedding cannot be a zero vector");
const entrySchema = z
  .object({
    asset: projectAssetSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    description: z.string().trim().min(1).max(8000),
    tags,
    origin: z.enum(["model", "manual"]),
    vision: modelSchema.nullable(),
    frames: z
      .array(
        z
          .object({
            at: z.number().finite().nonnegative().max(86400),
            observation: observationSchema,
          })
          .strict(),
      )
      .max(3),
    analyzedAt: z.iso.datetime(),
    embedding: z
      .object({
        model: modelSchema,
        sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
        vector: vectorSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
const catalogSchema = z
  .object({ version: z.literal(1), entries: z.array(entrySchema).max(512) })
  .strict()
  .refine(
    (c) => new Set(c.entries.map((e) => e.asset.id)).size === c.entries.length,
    "Index asset IDs must be unique",
  );
const ids = z
  .array(z.uuid())
  .min(1)
  .max(512)
  .refine((v) => new Set(v).size === v.length, "Asset IDs must be unique");
const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("models") }).strict(),
  z.object({ action: z.literal("list"), assetIds: ids }).strict(),
  z
    .object({
      action: z.literal("analyze"),
      assetIds: ids.max(8),
      model: modelName,
      force: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("embed"), assetIds: ids.max(8), model: modelName }).strict(),
  z
    .object({
      action: z.literal("search"),
      assetIds: ids,
      query: z.string().trim().min(1).max(2000),
      model: modelName.nullable(),
      type: z.enum(["all", "image", "video"]),
      aspectRatio: z.number().positive().max(10),
      duration: z.number().positive().max(86400).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      assetIds: ids.length(1),
      description: z.string().trim().min(1).max(8000),
      tags,
    })
    .strict(),
]);
const matchSchema = z
  .object({
    assetId: z.uuid(),
    score: z.number().min(0).max(1),
    reasons: z.array(z.string().max(200)).max(12),
    missing: z.array(z.string().max(100)).max(8),
  })
  .strict();
const resultSchema = z
  .object({
    kind: z.literal("assets"),
    entries: z
      .array(
        entrySchema.omit({ embedding: true }).extend({ embeddingModel: modelSchema.nullable() }),
      )
      .max(512),
    matches: z.array(matchSchema).max(512),
    models: z
      .array(
        z.object({ ...modelSchema.shape, vision: z.boolean(), embedding: z.boolean() }).strict(),
      )
      .max(1000),
    message: z.string().max(300),
  })
  .strict();
module.exports = {
  modelSchema,
  observationSchema,
  vectorSchema,
  entrySchema,
  catalogSchema,
  operationSchema,
  resultSchema,
  matchSchema,
};
