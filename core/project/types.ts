import type { z } from "zod";
import type { projectSchema, sceneSchema, layerSchema, clipSchema, trackSchema, projectAssetSchema } from "./schema.cjs";

export type Project = z.infer<typeof projectSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type ProjectAsset = z.infer<typeof projectAssetSchema>;
export interface ValidationIssue { path: string; message: string }
export type ProjectValidation = { success: true; project: Project } | { success: false; errors: ValidationIssue[] };
export interface ProjectHistory { present: Project; past: Project[]; future: Project[]; savedJSON: string }
