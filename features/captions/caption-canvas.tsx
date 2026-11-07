"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import type { Project } from "@/core/project/types";
import { captionRecords } from "@/core/captions/commands.cjs";
import { captionForLayer } from "@/core/captions/presets.cjs";
import type { Caption } from "@/core/captions/presets.cjs";
import { pointerToCanvas, resizeCaptionWidth } from "@/core/captions/engine.cjs";
import { useTimeline, useTimelineStoreApi } from "@/features/timeline/timeline-store";

type Box = Caption["box"];
export function CaptionCanvas({
  project,
  document: doc,
  onPreview,
  onBegin,
}: {
  project: Project;
  document: ProjectDocumentController;
  onBegin: () => void;
  onPreview: (value: { id: string; box: Box } | null) => void;
}) {
  const frame = useTimeline((s) => s.playheadFrame),
    selection = useTimeline((s) => s.selectedIds),
    showGuides = useTimeline((s) => s.captionGuides),
    store = useTimelineStoreApi();
  const records = useMemo(() => captionRecords(project), [project]);
  const buckets = useMemo(
    () =>
      project.tracks
        .filter((track) => track.visible)
        .sort((a, b) => b.order - a.order)
        .map((track) => {
          const items = records
            .filter((r) => r.layer.trackId === track.id)
            .map((record) => ({
              record,
              start: Math.ceil(record.start * project.fps - 1e-8),
              end: Math.ceil(record.end * project.fps - 1e-8),
            }));
          let maxEnd = 0;
          return items.map((item) => {
            maxEnd = Math.max(maxEnd, item.end);
            return { ...item, maxEnd };
          });
        }),
    [records, project.tracks, project.fps],
  );
  const active = buckets.flatMap((items) => {
    let low = 0,
      high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (items[mid].start <= frame) low = mid + 1;
      else high = mid;
    }
    const found: typeof records = [];
    for (let i = low - 1; i >= 0 && items[i].maxEnd > frame; i--)
      if (items[i].end > frame) found.push(items[i].record);
    return found.reverse();
  });
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: string;
    project: Project;
    box: Box;
    latest: Box;
    point: { x: number; y: number };
    mode: "move" | "resize" | "rotate";
    rect: DOMRect;
  } | null>(null);
  const [draft, setDraft] = useState<{ id: string; box: Box } | null>(null),
    [guides, setGuides] = useState<string[]>([]);
  useEffect(() => () => onPreview(null), [onPreview]);
  function begin(
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    box: Box,
    mode: "move" | "resize" | "rotate",
  ) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.closest<HTMLElement>('[aria-label^="Position caption"]')?.focus();
    const record = records.find((r) => r.layer.id === id);
    store.getState().setSelection([id]);
    if (!record) return;
    doc.selectLayer(record.scene.id, id);
    onBegin();
    if (box.locked || doc.busy || project.tracks.find((t) => t.id === record.layer.trackId)?.locked)
      return;
    if (project.animations[id]?.keyframes.length) {
      store
        .getState()
        .setMessage("Edit caption position after removing transform keyframes in Animation.");
      return;
    }
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    gesture.current = {
      latest: box,
      id,
      project,
      box,
      point: pointerToCanvas(rect, event.clientX, event.clientY),
      mode,
      rect,
    };
    setDraft({ id, box });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function finish(commit: boolean) {
    const g = gesture.current;
    gesture.current = null;
    if (commit && g && JSON.stringify(g.box) !== JSON.stringify(g.latest))
      doc.executeCaption({ type: "PositionCaptions", ids: [g.id], patch: g.latest }, g.project);
    setDraft(null);
    setGuides([]);
    onPreview(null);
  }
  return (
    <div
      ref={root}
      className="pointer-events-none absolute inset-0"
      aria-label="Caption canvas controls"
    >
      {showGuides &&
        guides.map((guide) => {
          const [axis, position] = guide.split(":");
          return (
            <div
              key={guide}
              className={`absolute border-cyan-300 ${axis === "x" ? "inset-y-0 border-l" : "inset-x-0 border-t"}`}
              style={
                axis === "x"
                  ? { left: `${Number(position) * 100}%` }
                  : { top: `${Number(position) * 100}%` }
              }
            />
          );
        })}
      {active.map(({ layer, scene }) => {
        const c = captionForLayer(layer, project.resolution),
          box = draft?.id === layer.id ? draft.box : c.box,
          selected = selection.includes(layer.id);
        const height =
          c.style.fontSize * c.style.maxLines * c.style.lineHeight + 2 * c.style.padding;
        return (
          <div
            key={layer.id}
            tabIndex={0}
            role="button"
            aria-label={`Position caption ${layer.id}`}
            aria-pressed={selected}
            onFocus={() => {
              if (!selected) {
                store.getState().setSelection([layer.id]);
                doc.selectLayer(scene.id, layer.id);
              }
            }}
            className={`pointer-events-auto absolute touch-none outline-none ${selected ? "border border-cyan-300" : "border border-transparent hover:border-cyan-300/50"}`}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${height * 100}%`,
              transform: `translate(-50%,-50%) rotate(${box.rotation}deg)`,
              cursor: box.locked ? "not-allowed" : "move",
            }}
            onPointerDown={(e) => begin(e, layer.id, box, "move")}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g || g.id !== layer.id) return;
              const p = pointerToCanvas(g.rect, e.clientX, e.clientY),
                next = { ...g.box },
                found: string[] = [];
              if (g.mode === "move") {
                next.x = Math.max(0, Math.min(1, g.box.x + p.x - g.point.x));
                next.y = Math.max(0, Math.min(1, g.box.y + p.y - g.point.y));
                if (store.getState().snapEnabled)
                  for (const key of ["x", "y"] as const)
                    for (const target of [0.05, 0.5, 0.95])
                      if (Math.abs(next[key] - target) < 0.012) {
                        next[key] = target;
                        found.push(`${key}:${target}`);
                        break;
                      }
              } else if (g.mode === "resize") {
                next.width = resizeCaptionWidth(g.box, g.rect, p.x - g.point.x, p.y - g.point.y);
              } else
                next.rotation = Math.max(
                  -180,
                  Math.min(
                    180,
                    (Math.atan2((p.y - g.box.y) * g.rect.height, (p.x - g.box.x) * g.rect.width) *
                      180) /
                      Math.PI +
                      90,
                  ),
                );
              g.latest = next;
              setDraft({ id: layer.id, box: next });
              onPreview({ id: layer.id, box: next });
              setGuides(found);
            }}
            onPointerUp={(e) => {
              finish(true);
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => finish(false)}
            onLostPointerCapture={() => {
              if (gesture.current) finish(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                finish(false);
                return;
              }
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              e.stopPropagation();
              if (box.locked) return;
              const amount = e.shiftKey ? 0.01 : 0.001;
              doc.executeCaption(
                {
                  type: "PositionCaptions",
                  ids: [layer.id],
                  patch: {
                    x: Math.max(
                      0,
                      Math.min(
                        1,
                        box.x +
                          (e.key === "ArrowRight" ? amount : e.key === "ArrowLeft" ? -amount : 0),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1,
                        box.y +
                          (e.key === "ArrowDown" ? amount : e.key === "ArrowUp" ? -amount : 0),
                      ),
                    ),
                  },
                },
                project,
              );
            }}
          >
            {selected && (
              <>
                <div className="pointer-events-none absolute inset-[5%] border border-dashed border-white/25" />
                <div
                  role="button"
                  aria-label="Resize caption"
                  className="absolute -right-1.5 -bottom-1.5 h-3 w-3 bg-cyan-300"
                  onPointerDown={(e) => begin(e, layer.id, box, "resize")}
                />
                <div
                  role="button"
                  aria-label="Rotate caption"
                  className="absolute -top-5 left-1/2 h-3 w-3 rounded-full bg-cyan-300"
                  onPointerDown={(e) => begin(e, layer.id, box, "rotate")}
                />
              </>
            )}
          </div>
        );
      })}
      {showGuides && selection.length > 0 && (
        <div className="absolute inset-[5%] border border-dashed border-white/20" />
      )}
    </div>
  );
}
