import { z } from "zod";
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

export async function inspectAudio(assetId: string) {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge?.inspectAudio) throw new Error("Restart Electron to load audio inspection.");
  const { audioInfoSchema } = await import("@/core/transcription/schema.cjs");
  return audioInfoSchema.parse(await bridge.inspectAudio(assetId));
}

export async function copyTranscript(text: string) {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (bridge?.copyTranscript) {
    const result = z
      .object({ copied: z.literal(true) })
      .strict()
      .parse(await bridge.copyTranscript(text));
    return result;
  }
  await navigator.clipboard.writeText(text);
  return { copied: true };
}
export async function saveTranscriptExport(
  format: "txt" | "srt" | "vtt" | "json" | "csv",
  text: string,
) {
  const bridge = typeof window !== "undefined" ? window.motioncraft?.ai : undefined;
  if (!bridge?.saveTranscript)
    throw new Error("Open the current Electron desktop app to save transcript exports.");
  return bridge.saveTranscript({ format, text });
}
