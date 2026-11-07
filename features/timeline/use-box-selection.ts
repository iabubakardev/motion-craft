"use client";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import type { Project } from "@/core/project/types";
import { selectionBounds, selectInBox } from "./selection.cjs";
import { useTimelineStoreApi } from "./timeline-store";

export function useBoxSelection(
  project: Project,
  viewport: RefObject<HTMLDivElement | null>,
  disabled: boolean,
  force: boolean,
) {
  const store = useTimelineStoreApi();
  const cancel = useRef<((restore: boolean) => void) | null>(null);
  const [box, setBox] = useState<ReturnType<typeof selectionBounds> | null>(null);
  useEffect(() => () => cancel.current?.(false), [project, disabled, force]);
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !(event.target instanceof Element)) return;
    const track = event.target.closest<HTMLElement>(".timeline-track"),
      clip = event.target.closest<HTMLElement>("[data-clip-id]");
    if (!track || (!force && clip)) return;
    if (!clip && event.target.closest("button,input,select,textarea")) return;
    const view = viewport.current;
    if (!view) return;
    event.preventDefault();
    event.stopPropagation();
    cancel.current?.(false);
    view.focus({ preventScroll: true });
    store.getState().cancelDrag();
    const initial = [...store.getState().selectedIds],
      additive = event.shiftKey || event.ctrlKey || event.metaKey,
      zoom = store.getState().zoom;
    const originRect = view.getBoundingClientRect(),
      origin = {
        x: event.clientX - originRect.left + view.scrollLeft,
        y: event.clientY - originRect.top + view.scrollTop,
      };
    let x = event.clientX,
      y = event.clientY,
      moved = false,
      raf = 0,
      done = false;
    const startX = x,
      startY = y;
    const trackId = track.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
    if (trackId) store.getState().selectTrack(trackId);
    view.setPointerCapture(event.pointerId);
    function update(schedule = true) {
      const rect = view!.getBoundingClientRect();
      moved ||= Math.abs(x - startX) > 3 || Math.abs(y - startY) > 3;
      if (moved) {
        if (x > rect.right - 24) view!.scrollLeft += 12;
        else if (x < rect.left + 220) view!.scrollLeft -= 12;
        if (y > rect.bottom - 20) view!.scrollTop += 10;
        else if (y < rect.top + 30) view!.scrollTop -= 10;
        const bounds = selectionBounds(origin, {
          x: x - rect.left + view!.scrollLeft,
          y: y - rect.top + view!.scrollTop,
        });
        const items = project.tracks.flatMap((t) => {
          const row = view!.querySelector<HTMLElement>(`[data-track-id="${t.id}"] .timeline-track`);
          if (!row) return [];
          const r = row.getBoundingClientRect(),
            left = r.left - rect.left + view!.scrollLeft,
            top = r.top - rect.top + view!.scrollTop + 4;
          return t.clips.map((c) => ({
            id: c.id,
            rect: {
              left: left + c.start * zoom,
              top,
              width: Math.max(4, c.duration * zoom - 2),
              height: Math.max(1, r.height - 8),
            },
          }));
        });
        const ids = selectInBox(bounds, items, additive ? initial : []);
        if (ids.join("|") !== store.getState().selectedIds.join("|"))
          store.getState().setSelection(ids);
        setBox(bounds);
      }
      if (schedule) raf = requestAnimationFrame(() => update());
    }
    function cleanup(restore: boolean) {
      if (done) return;
      done = true;
      cancel.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
      window.removeEventListener("keydown", key, true);
      view!.removeEventListener("lostpointercapture", abort);
      if (view!.hasPointerCapture(event.pointerId)) view!.releasePointerCapture(event.pointerId);
      if (restore) store.getState().setSelection(initial);
      setBox(null);
    }
    function move(e: globalThis.PointerEvent) {
      if (e.pointerId === event.pointerId) {
        x = e.clientX;
        y = e.clientY;
      }
    }
    function finish(e: globalThis.PointerEvent) {
      if (e.pointerId !== event.pointerId) return;
      x = e.clientX;
      y = e.clientY;
      update(false);
      if (!moved) {
        const id = clip?.dataset.clipId;
        if (id) store.getState().selectClip(id, additive);
        else if (!additive) store.getState().setSelection([]);
      }
      cleanup(false);
    }
    function abort() {
      cleanup(true);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        cleanup(true);
      }
    }
    cancel.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", abort);
    window.addEventListener("keydown", key, true);
    view.addEventListener("lostpointercapture", abort);
    raf = requestAnimationFrame(() => update());
  }
  return { box, begin };
}
