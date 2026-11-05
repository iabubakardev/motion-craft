import { jobSchema } from "@/rendering/contracts.cjs";
import type { z } from "zod";
import type { Project } from "@/core/project/types";
export type RenderJob = z.infer<typeof jobSchema>;
export function renderAvailable() {
  return typeof window !== "undefined" && !!window.motioncraft?.render;
}
function bridge() {
  if (!renderAvailable()) throw new Error("Video export is available in the Electron desktop app.");
  return window.motioncraft!.render;
}
export async function startRender(project: Project) {
  return jobSchema.nullable().parse(await bridge().start(project));
}
export async function renderStatus() {
  return jobSchema.nullable().parse(await bridge().status());
}
export async function cancelRender(id: string) {
  return jobSchema.nullable().parse(await bridge().cancel(id));
}
