// Shared runtime contracts: CommonJS keeps Electron main and Next.js on one schema.
const { z } = require("zod");

const assetIdSchema = z.uuid();
const mediaURLSchema = z.string().regex(/^motioncraft-media:\/\/asset\/[0-9a-f-]{36}$/);
const mediaMetadataSchema = z.object({
  duration: z.number().finite().nonnegative().optional(),
  width: z.number().int().positive().max(100000).optional(),
  height: z.number().int().positive().max(100000).optional(),
  status: z.enum(["ready", "error"]),
}).strict();

const mediaAssetSchema = z.object({
  id: assetIdSchema,
  filename: z.string().min(1).max(1024),
  type: z.enum(["image", "video", "audio"]),
  url: mediaURLSchema,
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/wav", "image/png", "image/jpeg", "image/webp"]),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  importedAt: z.iso.datetime(),
  duration: z.number().finite().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  thumbnailUrl: mediaURLSchema.optional(),
  status: z.enum(["imported", "ready", "error"]),
}).strict().refine((asset) => asset.url === `motioncraft-media://asset/${asset.id}`, { message: "Asset URL must match its ID" })
  .refine((asset) => !asset.thumbnailUrl || (asset.type === "image" && asset.thumbnailUrl === asset.url), { message: "Invalid thumbnail reference" })
  .refine((asset) => asset.mimeType.startsWith(`${asset.type}/`), { message: "MIME type does not match media type" });

const mediaAssetsSchema = z.array(mediaAssetSchema);
const importResultSchema = z.object({
  canceled: z.boolean(),
  assets: mediaAssetsSchema,
  duplicates: z.number().int().nonnegative(),
  errors: z.array(z.object({ filename: z.string(), message: z.string() }).strict()),
}).strict();

module.exports = { assetIdSchema, mediaAssetSchema, mediaAssetsSchema, mediaMetadataSchema, importResultSchema };
