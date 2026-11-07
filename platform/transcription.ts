import type { z } from "zod";
import { settingsSchema, preferencesSchema } from "@/core/transcription/schema.cjs";
export async function transcriptionSettings() {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge?.transcriptionSettings)
    return {
      config: null,
      available: false,
      message:
        "Transcription requires the current Electron desktop app. Restart Electron after updating.",
    };
  return settingsSchema.parse(await bridge.transcriptionSettings());
}
export async function configureTranscription(
  preferences: z.infer<typeof preferencesSchema>,
  choosePaths: boolean,
) {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge?.configureTranscription)
    throw new Error("Transcription requires the current Electron desktop app.");
  return settingsSchema.parse(
    await bridge.configureTranscription(preferencesSchema.parse(preferences), choosePaths),
  );
}
