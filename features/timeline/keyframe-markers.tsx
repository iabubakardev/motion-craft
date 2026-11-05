"use client";
import { useRef, useState } from "react";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import type { Project, Clip } from "@/core/project/types";
import { clipFrames } from "@/core/animation/commands.cjs";
import { secondsToFrames } from "@/core/timeline/time.cjs";
import { useTimeline, useTimelineStoreApi } from "./timeline-store";
export function KeyframeMarkers({
  project,
  clip,
  zoom,
  busy,
  execute,
}: {
  project: Project;
  clip: Clip;
  zoom: number;
  busy: boolean;
  execute: ProjectDocumentController["executeMotion"];
}) {
  const selected = useTimeline((s) => s.selectedIds.includes(clip.id)),
    store = useTimelineStoreApi();
  const [draft, setDraft] = useState<{ origin: number; frame: number } | null>(null);
  const drag = useRef<{
    x: number;
    frame: number;
    next: number;
    ids: string[];
    baseline: Project;
  } | null>(null);
  const motion = project.animations[clip.id];
  if (!selected || !motion) return null;
  const frames = [...new Set(motion.keyframes.map((key) => key.frame))].sort((a, b) => a - b);
  const locked = project.tracks.find((t) => t.id === clip.trackId)?.locked;
  const seek = (frame: number) => {
    store.getState().setMonitor("timeline");
    store.getState().setPlaying(false);
    store.getState().setPlayhead(secondsToFrames(clip.start, project.fps, "ceil") + frame);
  };
  return frames.map((frame) => (
    <button
      key={frame}
      type="button"
      disabled={busy || locked}
      aria-label={`Keyframes at local frame ${frame}`}
      title={`${motion.keyframes
        .filter((k) => k.frame === frame)
        .map((k) => k.property)
        .join(", ")} · frame ${frame} · drag to move`}
      className="absolute bottom-0 z-20 h-3 w-3 -translate-x-1/2 touch-none text-cyan-200"
      style={{ left: ((draft?.origin === frame ? draft.frame : frame) / project.fps) * zoom }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.detail === 0) seek(frame);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          drag.current = null;
          setDraft(null);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const next = Math.max(
            0,
            Math.min(clipFrames(clip, project.fps) - 1, frame + (e.key === "ArrowLeft" ? -1 : 1)),
          );
          if (
            execute(
              {
                type: "MoveKeyframes",
                clipId: clip.id,
                keyframeIds: motion.keyframes.filter((k) => k.frame === frame).map((k) => k.id),
                frame: next,
              },
              project,
            )
          )
            seek(next);
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.focus();
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          frame,
          next: frame,
          ids: motion.keyframes.filter((k) => k.frame === frame).map((k) => k.id),
          baseline: project,
        };
        seek(frame);
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current) return;
        current.next = Math.max(
          0,
          Math.min(
            clipFrames(clip, project.fps) - 1,
            current.frame + Math.round(((e.clientX - current.x) / zoom) * project.fps),
          ),
        );
        setDraft({ origin: current.frame, frame: current.next });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const current = drag.current;
        drag.current = null;
        setDraft(null);
        if (
          current &&
          current.next !== current.frame &&
          execute(
            {
              type: "MoveKeyframes",
              clipId: clip.id,
              keyframeIds: current.ids,
              frame: current.next,
            },
            current.baseline,
          )
        )
          seek(current.next);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraft(null);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDraft(null);
      }}
    >
      ◆
    </button>
  ));
}
