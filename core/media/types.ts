import type { z } from "zod";
import type { mediaAssetSchema, mediaMetadataSchema, importResultSchema } from "./schema.cjs";

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;
export type MediaImportResult = z.infer<typeof importResultSchema>;
export type MediaType = MediaAsset["type"];
