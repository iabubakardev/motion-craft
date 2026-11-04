import type { z } from "zod";
import type { commandSchema, clipboardItemSchema } from "./commands.cjs";
import type { Clip, Layer, ProjectAsset, Scene, Track } from "../project/types";
export type TimelineCommand = z.infer<typeof commandSchema>;
export type ClipboardItem = z.infer<typeof clipboardItemSchema>;
export interface ClipRecord {
  clip: Clip;
  track: Track;
  scene?: Scene;
  layer?: Layer;
  asset?: ProjectAsset;
}
export interface TimelineIndex {
  clips: Map<string, ClipRecord>;
  tracks: Map<string, Track>;
}
export interface ClipChange {
  clip: Clip;
  sceneId?: string;
  layer?: Layer;
}
export interface EditPlan {
  changes: ClipChange[];
  removed: string[];
}
