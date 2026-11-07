"use client";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { analysisSchema } from "@/core/audio/schema.cjs";
import { analyzeAudio } from "@/platform/audio";
import type { Clip, Project } from "@/core/project/types";
import { audioSchema, defaultAudio } from "@/core/audio/schema.cjs";
import { peakIndex, fadeGain } from "@/core/audio/engine.cjs";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
type Analysis = z.infer<typeof analysisSchema>;
const requests = new Map<string, Promise<Analysis>>();
function cached(id: string, key: string) {
  let p = requests.get(key);
  if (!p) {
    p = analyzeAudio(id);
    requests.set(key, p);
    p.catch(() => requests.delete(key));
    if (requests.size > 64) requests.delete(requests.keys().next().value ?? "");
  }
  return p;
}
export function AudioWaveform({
  clip,
  assetId,
  fingerprint,
  fps,
  zoom,
  scrollLeft,
  viewportWidth,
  document: doc,
}: {
  clip: Clip;
  assetId: string;
  fingerprint: string;
  fps: number;
  zoom: number;
  scrollLeft: number;
  viewportWidth: number;
  document: Pick<ProjectDocumentController, "project" | "executeAudio" | "busy">;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [result, setResult] = useState<{ id: string; data?: Analysis; error?: string } | null>(null),
    [draft, setDraft] = useState<Clip | null>(null);
  const gesture = useRef<{
    project: Project;
    clip: Clip;
    x: number;
    y: number;
    kind: "in" | "out" | "key";
    keyId?: string;
    latest: Clip;
    rect: DOMRect;
  } | null>(null);
  useEffect(() => {
    let canceled = false;
    void cached(assetId, `${assetId}:${fingerprint}`)
      .then((data) => {
        if (!canceled) setResult({ id: `${assetId}:${fingerprint}`, data });
      })
      .catch((e) => {
        if (!canceled)
          setResult({
            id: `${assetId}:${fingerprint}`,
            error: e instanceof Error ? e.message : "Waveform unavailable",
          });
      });
    return () => {
      canceled = true;
    };
  }, [assetId, fingerprint]);
  const view = draft ?? clip,
    offset = Math.max(0, scrollLeft - 196 - clip.start * zoom),
    width = Math.max(0, Math.min(viewportWidth + 200, clip.duration * zoom - offset)),
    data = result?.id === `${assetId}:${fingerprint}` ? result.data : undefined;
  useEffect(() => {
    const e = canvas.current;
    if (!e || !data) return;
    const draw = () => {
      const h = e.clientHeight,
        ratio = Math.min(2, window.devicePixelRatio || 1);
      e.width = Math.ceil(width * ratio);
      e.height = Math.ceil(h * ratio);
      const ctx = e.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, width, h);
      ctx.strokeStyle = "#58d4c6";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 2) {
        const a = peakIndex(clip, (offset + x) / zoom, data.step),
          b = peakIndex(clip, (offset + x + 2) / zoom, data.step);
        let peak = 0;
        for (let i = a; i <= Math.min(b, data.peaks.length - 1); i++)
          peak = Math.max(peak, data.peaks[i] ?? 0);
        const bar = Math.max(1, peak * (h - 6));
        ctx.beginPath();
        ctx.moveTo(x, (h - bar) / 2);
        ctx.lineTo(x, (h + bar) / 2);
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(e);
    return () => observer.disconnect();
  }, [data, clip, offset, width, zoom]);
  const a = audioSchema.parse(view.audio ?? defaultAudio()),
    locked =
      doc.busy || doc.project.tracks.some((t) => t.locked && t.clips.some((c) => c.id === clip.id));
  const finish = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (g && commit)
      doc.executeAudio(
        {
          type: "SetAudio",
          clipId: clip.id,
          audio: g.latest.audio ?? defaultAudio(),
          fadeIn: g.latest.fadeIn ?? 0,
          fadeOut: g.latest.fadeOut ?? 0,
        },
        g.project,
      );
  };
  const begin = (
    e: React.PointerEvent<HTMLElement>,
    kind: "in" | "out" | "key",
    keyId?: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (locked) return;
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    gesture.current = {
      project: doc.project,
      clip,
      x: e.clientX,
      y: e.clientY,
      kind,
      keyId,
      latest: clip,
      rect,
    };
    e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    e.stopPropagation();
    const dx = (e.clientX - g.x) / zoom;
    let next = { ...g.clip };
    if (g.kind === "key") {
      const old = g.clip.audio?.keys.find((k) => k.id === g.keyId);
      if (!old) return;
      const frame = Math.max(
          0,
          Math.min(Math.ceil(clip.duration * fps) - 1, Math.round(old.frame + dx * fps)),
        ),
        db = Math.max(
          -60,
          Math.min(12, old.db - ((e.clientY - g.y) / Math.max(1, g.rect.height)) * 72),
        );
      next = {
        ...next,
        audio: {
          ...(g.clip.audio ?? defaultAudio()),
          keys: (g.clip.audio?.keys ?? [])
            .filter((k) => k.id === old.id || k.frame !== frame)
            .map((k) => (k.id === old.id ? { ...k, frame, db, origin: "manual" as const } : k))
            .sort((x, y) => x.frame - y.frame),
        },
      };
    } else
      next = {
        ...next,
        [g.kind === "in" ? "fadeIn" : "fadeOut"]: Math.max(
          0,
          Math.min(
            clip.duration,
            g.kind === "in" ? (g.clip.fadeIn ?? 0) + dx : (g.clip.fadeOut ?? 0) - dx,
          ),
        ),
      };
    g.latest = next;
    setDraft(next);
  };
  const handle = {
    onPointerMove: move,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (!gesture.current) return;
      e.stopPropagation();
      finish(true);
    },
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => {
      if (gesture.current) finish(false);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      }
    },
  };
  return (
    <div
      className="absolute inset-0"
      onPointerMove={move}
      onPointerUp={handle.onPointerUp}
      onPointerCancel={handle.onPointerCancel}
      onLostPointerCapture={handle.onLostPointerCapture}
      aria-label="Audio waveform"
      title={
        result?.error ??
        "Source waveform. Double-click to add a volume keyframe; drag diamonds to automate."
      }
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (locked) return;
        const r = e.currentTarget.getBoundingClientRect(),
          frame = Math.max(
            0,
            Math.min(
              Math.ceil(clip.duration * fps) - 1,
              Math.round(((e.clientX - r.left) / zoom) * fps),
            ),
          ),
          db = Math.max(-60, Math.min(12, 12 - ((e.clientY - r.top) / r.height) * 72));
        doc.executeAudio({
          type: "SetAudio",
          clipId: clip.id,
          audio: {
            ...a,
            keys: [
              ...a.keys.filter((k) => k.frame !== frame),
              { id: crypto.randomUUID(), frame, db, origin: "manual" },
            ].sort((x, y) => x.frame - y.frame),
          },
        });
      }}
    >
      <canvas
        ref={canvas}
        aria-label={
          data
            ? "Source waveform peaks"
            : result?.error
              ? "Waveform unavailable"
              : "Analyzing waveform"
        }
        className="pointer-events-none absolute top-0 h-full"
        style={{ left: offset, width }}
      />
      {!data && (
        <span className="pointer-events-none absolute bottom-0 left-3 text-[8px]">
          {result?.error ? "Waveform unavailable" : "Analyzing audio..."}
        </span>
      )}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
        viewBox={`0 0 ${Math.max(1, clip.duration * zoom)} 100`}
      >
        {!!view.fadeIn && (
          <polyline
            fill="none"
            stroke="#fde68a"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            points={Array.from(
              { length: 21 },
              (_, i) =>
                `${(i / 20) * (view.fadeIn ?? 0) * zoom},${100 * (1 - fadeGain(i / 20, a.fadeCurve))}`,
            ).join(" ")}
          />
        )}
        {!!view.fadeOut && (
          <polyline
            fill="none"
            stroke="#fde68a"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            points={Array.from(
              { length: 21 },
              (_, i) =>
                `${(clip.duration - (view.fadeOut ?? 0) + (i / 20) * (view.fadeOut ?? 0)) * zoom},${100 * (1 - fadeGain(1 - i / 20, a.fadeCurve))}`,
            ).join(" ")}
          />
        )}
        <polyline
          fill="none"
          stroke="#fff"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          points={a.keys
            .map((k) => `${(k.frame / fps) * zoom},${((12 - k.db) / 72) * 100}`)
            .join(" ")}
        />
      </svg>
      {a.keys
        .filter(
          (k) =>
            (k.frame / fps) * zoom >= offset - 10 && (k.frame / fps) * zoom < offset + width + 10,
        )
        .map((k) => (
          <button
            key={k.id}
            aria-label={`Volume keyframe ${k.frame}`}
            title={`${(k.frame / fps).toFixed(2)}s / ${k.db.toFixed(1)} dB. Delete removes.`}
            className={`absolute z-20 h-2 w-2 rotate-45 border border-white ${k.origin === "ducking" ? "bg-violet-400" : "bg-cyan-300"}`}
            style={{
              left: (k.frame / fps) * zoom - 4,
              top: `calc(${((12 - k.db) / 72) * 100}% - 4px)`,
            }}
            onPointerDown={(e) => begin(e, "key", k.id)}
            {...handle}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                doc.executeAudio({
                  type: "SetAudio",
                  clipId: clip.id,
                  audio: { ...a, keys: a.keys.filter((x) => x.id !== k.id) },
                });
              } else if (e.key === "Escape") finish(false);
            }}
          />
        ))}
      <button
        aria-label={`Fade in ${clip.id}`}
        title="Drag fade-in"
        className="absolute top-0 z-20 h-3 w-3 bg-white/80 cursor-ew-resize"
        style={{ left: Math.min(clip.duration * zoom - 12, (view.fadeIn ?? 0) * zoom) }}
        onPointerDown={(e) => begin(e, "in")}
        {...handle}
      />
      <button
        aria-label={`Fade out ${clip.id}`}
        title="Drag fade-out"
        className="absolute bottom-0 z-20 h-3 w-3 bg-white/80 cursor-ew-resize"
        style={{ right: Math.min(clip.duration * zoom - 12, (view.fadeOut ?? 0) * zoom) }}
        onPointerDown={(e) => begin(e, "out")}
        {...handle}
      />
    </div>
  );
}
