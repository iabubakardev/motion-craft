"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { z } from "zod";
import type { Project } from "@/core/project/types";
import type { visualSchema } from "@/core/timeline/visual-schema.cjs";
import { defaultVisual, visualSchema as parseVisual } from "@/core/timeline/visual-schema.cjs";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { useTimeline, useTimelineStoreApi } from "@/features/timeline/timeline-store";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
export type VisualPreview = { id: string; visual: z.infer<typeof visualSchema> };
export function VisualCanvas({
  document: doc,
  onPreview,
  onBegin,
}: {
  document: ProjectDocumentController;
  onPreview: (v: VisualPreview | null) => void;
  onBegin: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    store = useTimelineStoreApi(),
    frame = useTimeline((s) => s.playheadFrame),
    ids = useTimeline((s) => s.selectedIds);
  const index = useMemo(() => createTimelineIndex(doc.project), [doc.project]);
  const active = [...index.clips.values()]
    .filter(
      (r) =>
        r.track.visible &&
        !r.clip.audioOnly &&
        r.asset?.type !== "audio" &&
        r.layer?.type !== "caption" &&
        frame >= r.clip.start * doc.project.fps &&
        frame < (r.clip.start + r.clip.duration) * doc.project.fps,
    )
    .sort((a, b) => b.track.order - a.track.order);
  const gesture = useRef<{
    id: string;
    project: Project;
    value: VisualPreview["visual"];
    latest: VisualPreview["visual"];
    x: number;
    y: number;
    rect: DOMRect;
    mode: "move" | "scale" | "rotate";
  } | null>(null);
  const [draft, setDraft] = useState<VisualPreview | null>(null);
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
    onPreview(null);
  };
  useEffect(() => {
    const reset = () => {
      gesture.current = null;
      setDraft(null);
      onPreview(null);
    };
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("blur", reset);
      onPreview(null);
    };
  }, [onPreview]);
  function begin(
    e: ReactPointerEvent<HTMLDivElement>,
    id: string,
    mode: "move" | "scale" | "rotate",
  ) {
    e.stopPropagation();
    e.preventDefault();
    store.getState().setSelection([id]);
    store.getState().setPlaying(false);
    onBegin();
    e.currentTarget.focus();
    const item = index.clips.get(id),
      rect = root.current?.getBoundingClientRect();
    if (!item || !rect) return;
    if (item.track.locked || doc.busy) return;
    if (doc.project.animations[id]?.keyframes.length) {
      store.getState().setMessage("Use Animation to edit this clip�s keyframed transform.");
      return;
    }
    const actual = parseVisual.parse(item.clip.visual ?? defaultVisual(item.layer));
    gesture.current = {
      id,
      project: doc.project,
      value: actual,
      latest: actual,
      x: e.clientX,
      y: e.clientY,
      rect,
      mode,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  return (
    <div
      ref={root}
      className="absolute inset-0 pointer-events-none"
      aria-label="Visual canvas controls"
    >
      {active.map((item) => {
        const v =
            draft?.id === item.clip.id
              ? draft.visual
              : (item.clip.visual ?? defaultVisual(item.layer)),
          selected = ids.length === 1 && ids[0] === item.clip.id;
        return (
          <div
            key={item.clip.id}
            tabIndex={0}
            role="button"
            aria-label={`Transform visual ${item.clip.id}`}
            className={`absolute inset-0 pointer-events-auto ${selected ? "border border-cyan-300" : ""}`}
            style={{
              transform: `translate(${(v.x / doc.project.resolution.width) * 100}%,${(v.y / doc.project.resolution.height) * 100}%) rotate(${v.rotation}deg) scale(${v.scaleX},${v.scaleY})`,
              touchAction: "none",
              cursor: item.track.locked ? "not-allowed" : "move",
            }}
            onPointerDown={(e) => begin(e, item.clip.id, "move")}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g || g.id !== item.clip.id) return;
              const dx = ((e.clientX - g.x) / g.rect.width) * g.project.resolution.width,
                dy = ((e.clientY - g.y) / g.rect.height) * g.project.resolution.height;
              const next = { ...g.value };
              if (g.mode === "move") {
                next.x = g.value.x + dx;
                next.y = g.value.y + dy;
                if (!e.altKey) {
                  if (Math.abs(next.x) < g.project.resolution.width * 0.01) next.x = 0;
                  if (Math.abs(next.y) < g.project.resolution.height * 0.01) next.y = 0;
                }
              } else if (g.mode === "scale") {
                const factor = Math.max(
                  0.01,
                  1 + dx / g.project.resolution.width + dy / g.project.resolution.height,
                );
                next.scaleX = Math.min(100, Math.max(0.01, g.value.scaleX * factor));
                next.scaleY = Math.min(100, Math.max(0.01, g.value.scaleY * factor));
              } else next.rotation = g.value.rotation + (dx / g.project.resolution.width) * 180;
              g.latest = next;
              const value = { id: g.id, visual: next };
              setDraft(value);
              onPreview(value);
            }}
            onPointerUp={(e) => {
              const g = gesture.current;
              if (!g) return;
              const changed = JSON.stringify(g.value) !== JSON.stringify(g.latest);
              cancel();
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
              if (changed)
                doc.executeVisual(
                  { type: "UpdateVisual", clipId: g.id, visual: g.latest },
                  g.project,
                );
            }}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
              if (gesture.current) cancel();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              } else if (
                ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
                selected &&
                !item.track.locked &&
                !doc.busy &&
                !doc.project.animations[item.clip.id]?.keyframes.length
              ) {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.shiftKey ? 10 : 1;
                const value = parseVisual.parse(item.clip.visual ?? defaultVisual(item.layer));
                doc.executeVisual({
                  type: "UpdateVisual",
                  clipId: item.clip.id,
                  visual: {
                    ...value,
                    x:
                      value.x +
                      (e.key === "ArrowLeft" ? -delta : e.key === "ArrowRight" ? delta : 0),
                    y: value.y + (e.key === "ArrowUp" ? -delta : e.key === "ArrowDown" ? delta : 0),
                  },
                });
              }
            }}
          >
            {selected && (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Resize visual"
                  onPointerDown={(e) => begin(e, item.clip.id, "scale")}
                  className="absolute -bottom-1 -right-1 h-3 w-3 bg-white border border-cyan-400 cursor-nwse-resize"
                />
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Rotate visual"
                  onPointerDown={(e) => begin(e, item.clip.id, "rotate")}
                  className="absolute top-2 left-1/2 h-3 w-3 rounded-full border border-cyan-300 bg-[var(--editor-panel)] cursor-grab"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
