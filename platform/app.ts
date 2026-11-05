import type { RenderJob } from "@/platform/render";
import type { MediaAsset, MediaImportResult, MediaMetadata } from "@/core/media/types";
import type { z } from "zod";
import type { Project, ProjectAsset } from "@/core/project/types";
import type {
  openResultSchema,
  activationResultSchema,
  saveResultSchema,
} from "@/core/project/ipc.cjs";

export interface DesktopBridge {
  getAppVersion: () => Promise<string>;
  render: {
    start: (project: Project) => Promise<RenderJob | null>;
    status: () => Promise<RenderJob | null>;
    cancel: (id: string) => Promise<RenderJob | null>;
  };
  media: {
    selectFiles: () => Promise<MediaImportResult>;
    listAssets: () => Promise<MediaAsset[]>;
    updateMetadata: (id: string, metadata: MediaMetadata) => Promise<MediaAsset>;
  };
  projects: {
    openFile: () => Promise<z.infer<typeof openResultSchema>>;
    activate: (
      project: Project,
      candidateId: string | null,
    ) => Promise<z.infer<typeof activationResultSchema>>;
    save: (project: Project, saveAs: boolean) => Promise<z.infer<typeof saveResultSchema>>;
    relink: (asset: ProjectAsset) => Promise<MediaAsset | null>;
  };
}

// A missing bridge is expected during browser development and server rendering.
export async function getAppVersion(): Promise<string | null> {
  if (typeof window === "undefined" || !window.motioncraft) return null;

  const version = await window.motioncraft.getAppVersion();
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("The main process returned an invalid app version.");
  }
  return version;
}
