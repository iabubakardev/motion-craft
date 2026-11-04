"use client";
import { useEffect, useRef } from "react";
import type { PointerEvent, RefObject } from "react";
import type { Project } from "@/core/project/types";
import type { TimelineCommand } from "@/core/timeline/types";
import { createTimelineIndex, planTimelineEdit } from "@/core/timeline/commands.cjs";
import { pixelsToFrames, secondsToFrames } from "@/core/timeline/time.cjs";
import { snapEdges, snapTargets } from "@/core/timeline/snapping.cjs";
import { useTimelineStoreApi } from "./timeline-store";

export function useClipGesture(
  project: Project,
  execute: (command: TimelineCommand, expected?: Project) => boolean,
  viewport: RefObject<HTMLDivElement | null>,
  disabled: boolean,
) {
  const store = useTimelineStoreApi();
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), [project, disabled]);
  return (event: PointerEvent<HTMLElement>, id: string, edge?: "left" | "right") => {
    if (event.button !== 0 || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    cancel.current?.();
    const initial = store.getState();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (additive) {
      initial.selectClip(id, true);
      return;
    }
    const index = createTimelineIndex(project);
    const ids =
      !edge && initial.selectedIds.includes(id)
        ? initial.selectedIds.filter((value) => index.clips.has(value))
        : [id];
    initial.setSelection(ids);
    const item = index.clips.get(id);
    if (!item || item.track.locked) {
      initial.setMessage("Unlock the track before editing.");
      return;
    }
    const target = event.currentTarget,
      startX = event.clientX,
      scroll = viewport.current?.scrollLeft || 0;
    const targets = snapTargets(project, initial.playheadFrame, ids);
    let x = startX,
      y = event.clientY,
      moved = false,
      raf = 0;
    let command: TimelineCommand | null = null,
      valid = false;
    target.setPointerCapture(event.pointerId);
    const update = (schedule = true) => {
      const view = viewport.current;
      if (!view) return;
      const rect = view.getBoundingClientRect();
      if (x > rect.right - 28) view.scrollLeft += 12;
      if (x < rect.left + 206) view.scrollLeft -= 12;
      const delta = pixelsToFrames(
        x - startX + view.scrollLeft - scroll,
        initial.zoom,
        project.fps,
      );
      moved ||= Math.abs(x - startX) > 3 || view.scrollLeft !== scroll;
      let guide: number | null = null;
      const state = store.getState();
      let adjustment = 0;
      if (state.snapEnabled) {
        const edges = edge
          ? [
              secondsToFrames(
                item.clip.start + (edge === "right" ? item.clip.duration : 0),
                project.fps,
              ) + delta,
            ]
          : ids.flatMap((clipId) => {
              const c = index.clips.get(clipId)!.clip;
              return [
                secondsToFrames(c.start, project.fps) + delta,
                secondsToFrames(c.start + c.duration, project.fps) + delta,
              ];
            });
        const snap = snapEdges(edges, targets, (8 * project.fps) / initial.zoom);
        adjustment = snap.delta;
        guide = snap.guide;
      }
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-track-id]")
        ?.dataset.trackId;
      const trackId = !edge && ids.length === 1 && hit ? hit : item.track.id;
      command = edge
        ? {
            type: "TrimClip",
            clipId: id,
            edge,
            frame:
              secondsToFrames(
                item.clip.start + (edge === "right" ? item.clip.duration : 0),
                project.fps,
              ) +
              delta +
              adjustment,
          }
        : {
            type: "MoveClip",
            clipIds: ids,
            deltaFrames: delta + adjustment,
            ...(ids.length === 1 ? { trackId } : {}),
          };
      try {
        const plan = planTimelineEdit(project, command, index);
        valid = true;
        state.setDrag({ changes: plan.changes, guide, valid, error: "", trackId });
      } catch (error) {
        valid = false;
        state.setDrag({
          changes: [],
          guide,
          valid,
          error: error instanceof Error ? error.message : "Invalid edit",
          trackId,
        });
      }
      if (schedule) raf = requestAnimationFrame(() => update());
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      x = e.clientX;
      y = e.clientY;
    };
    const cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
      window.removeEventListener("keydown", key, true);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      store.getState().cancelDrag();
      cancel.current = null;
    };
    const abort = () => cleanup();
    const finish = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      x = e.clientX;
      y = e.clientY;
      cancelAnimationFrame(raf);
      update(false);
      const error = store.getState().drag?.error;
      cleanup();
      if (moved && valid && command) execute(command, project);
      else if (moved && error) store.getState().setMessage(error);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        abort();
      }
    };
    cancel.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", abort);
    window.addEventListener("keydown", key, true);
    raf = requestAnimationFrame(() => update());
  };
}
