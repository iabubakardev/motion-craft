import type { z } from "zod";
import { jobSchema, requestSchema } from "@/core/ai/schema.cjs";
export type AIJob = z.infer<typeof jobSchema>;
export type AIRequest = z.infer<typeof requestSchema>;
export function isAIAvailable() {
  return typeof window !== "undefined" && !!window.motioncraft?.ai;
}
export async function startAI(request: AIRequest) {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge)
    throw new Error(
      "Local inference requires the Electron desktop app. External plan JSON review works in the browser.",
    );
  return jobSchema.parse(await bridge.start(requestSchema.parse(request)));
}
export async function statusAI() {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge) return null;
  return jobSchema.nullable().parse(await bridge.status());
}
export async function cancelAI(id: string) {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge) return null;
  return jobSchema.nullable().parse(await bridge.cancel(id));
}
