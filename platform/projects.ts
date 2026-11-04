import { openResultSchema, activationResultSchema, saveResultSchema, relinkResultSchema } from "@/core/project/ipc.cjs";
import { idSchema, projectSchema, projectAssetSchema } from "@/core/project/schema.cjs";
import type { Project, ProjectAsset } from "@/core/project/types";

export function isProjectDesktopAvailable() { return typeof window !== "undefined" && !!window.motioncraft?.projects; }
function bridge() {
  if (!isProjectDesktopAvailable()) throw new Error("Native project files are available in the desktop app.");
  return window.motioncraft!.projects;
}
export async function openProjectFile() { return openResultSchema.parse(await bridge().openFile()); }
export async function activateProject(project: Project, candidateId: string | null) {
  projectSchema.parse(project);
  if (candidateId) idSchema.parse(candidateId);
  if (!isProjectDesktopAvailable()) return activationResultSchema.parse({ project, assets: project.assets.map((asset) => ({ ...asset, url: `motioncraft-media://asset/${asset.id}`, status: "error", ...(asset.type === "image" ? { thumbnailUrl: `motioncraft-media://asset/${asset.id}` } : {}) })), filename: null, missingAssetIds: project.assets.map((asset) => asset.id) });
  return activationResultSchema.parse(await bridge().activate(project, candidateId));
}
export async function saveProjectFile(project: Project, saveAs = false) { return saveResultSchema.parse(await bridge().save(projectSchema.parse(project), saveAs)); }
export async function relinkProjectAsset(asset: ProjectAsset) { return relinkResultSchema.parse(await bridge().relink(projectAssetSchema.parse(asset))); }
