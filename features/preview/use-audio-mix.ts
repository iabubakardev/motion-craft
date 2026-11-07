"use client";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@/core/project/types";
import { prepareAudioMix } from "@/platform/audio";
export function useAudioMix(project: Project, versions: string) {
  const latest = useRef(project);
  useEffect(() => {
    latest.current = project;
  }, [project]);
  const needed = project.tracks.some(
    (t) =>
      t.gainDb !== undefined ||
      t.solo ||
      t.audioOverlap ||
      t.clips.some((c) => c.audio || c.audioOnly),
  );
  const key = needed
    ? JSON.stringify({
        versions,
        id: project.id,
        fps: project.fps,
        duration: project.duration,
        tracks: project.tracks.map((t) => ({
          id: t.id,
          muted: t.muted,
          visible: t.visible,
          solo: t.solo,
          gainDb: t.gainDb,
          clips: t.clips.map((c) => ({
            id: c.id,
            assetId: c.assetId,
            layerId: c.layerId,
            start: c.start,
            duration: c.duration,
            sourceStart: c.sourceStart,
            sourceEnd: c.sourceEnd,
            playbackRate: c.playbackRate,
            volume: c.volume,
            muted: c.muted,
            audio: c.audio,
            fadeIn: c.fadeIn,
            fadeOut: c.fadeOut,
            audioOnly: c.audioOnly,
          })),
        })),
        layers: project.scenes.flatMap((s) =>
          s.layers
            .filter((l) => l.type === "audio" || l.type === "video")
            .map((l) => ({ id: l.id, properties: l.properties })),
        ),
        assets: project.assets.map((a) => ({ id: a.id, size: a.size })),
      })
    : "";
  const [result, setResult] = useState<{ key: string; url?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    let canceled = false;
    const timer = setTimeout(() => {
      void prepareAudioMix(latest.current)
        .then((r) => {
          if (!canceled) setResult({ key, url: r.url });
        })
        .catch((e) => {
          if (!canceled)
            setResult({ key, error: e instanceof Error ? e.message : "Mix preparation failed." });
        });
    }, 200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [key]);
  return {
    needed,
    url: result?.key === key ? result.url : undefined,
    error: result?.key === key ? result.error : undefined,
    pending: needed && result?.key !== key,
  };
}
