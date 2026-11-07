"use client";
import { analysisSchema } from "@/core/audio/schema.cjs";
import { z } from "zod";
import type { Project } from "@/core/project/types";
export async function analyzeAudio(id: string, range?: { start: number; end: number }) {
  if (!window.motioncraft?.audio) throw new Error("Restart Electron to load audio analysis.");
  return analysisSchema.parse(await window.motioncraft.audio.analyze(id, range));
}
export async function prepareAudioMix(project: Project) {
  if (!window.motioncraft?.audio)
    throw new Error("Open the updated Electron app for processed audio preview.");
  const response = z
    .union([
      z.object({ url: z.string().regex(/^motioncraft-media:\/\/asset\/[0-9a-f-]+$/i) }).strict(),
      z.object({ canceled: z.literal(true) }).strict(),
    ])
    .parse(await window.motioncraft.audio.mix(project));
  if ("canceled" in response) throw new Error("Audio preparation superseded by a newer edit.");
  return response;
}

export async function inspectProcessedClip(project: Project, id: string) {
  if (!window.motioncraft?.audio) throw new Error("Restart Electron to load audio processing.");
  return analysisSchema.parse(await window.motioncraft.audio.inspectClip(project, id));
}
