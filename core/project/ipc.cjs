const { z } = require("zod");
const { projectSchema, idSchema } = require("./schema.cjs");
const { mediaAssetsSchema, mediaAssetSchema } = require("../media/schema.cjs");
const issuesSchema = z.array(z.object({ path: z.string(), message: z.string() }).strict()).max(100);
const openResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("canceled") }).strict(),
  z.object({ status: z.literal("error"), errors: issuesSchema }).strict(),
  z
    .object({
      status: z.literal("ready"),
      project: projectSchema,
      filename: z.string(),
      candidateId: idSchema,
      migratedFrom: z.union([z.literal(1), z.literal(2)]).optional(),
    })
    .strict(),
]);
const activationResultSchema = z
  .object({
    project: projectSchema,
    assets: mediaAssetsSchema,
    filename: z.string().nullable(),
    missingAssetIds: z.array(idSchema),
  })
  .strict();
const saveResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("canceled") }).strict(),
  z.object({ status: z.literal("saved"), filename: z.string() }).strict(),
]);
module.exports = {
  issuesSchema,
  openResultSchema,
  activationResultSchema,
  saveResultSchema,
  relinkResultSchema: mediaAssetSchema.nullable(),
};
