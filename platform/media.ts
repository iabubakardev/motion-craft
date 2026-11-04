import { assetIdSchema, importResultSchema, mediaAssetSchema, mediaAssetsSchema, mediaMetadataSchema } from "@/core/media/schema.cjs";
import type { MediaMetadata } from "@/core/media/types";

export function isMediaAvailable() {
  return typeof window !== "undefined" && !!window.motioncraft?.media;
}

function bridge() {
  if (!isMediaAvailable()) throw new Error("Open MotionCraft in the desktop app to import local media.");
  return window.motioncraft!.media;
}

export async function selectMediaFiles() {
  return importResultSchema.parse(await bridge().selectFiles());
}

export async function listMediaAssets() {
  if (!isMediaAvailable()) return [];
  return mediaAssetsSchema.parse(await bridge().listAssets());
}

export async function updateMediaMetadata(id: string, metadata: MediaMetadata) {
  return mediaAssetSchema.parse(await bridge().updateMetadata(assetIdSchema.parse(id), mediaMetadataSchema.parse(metadata)));
}
