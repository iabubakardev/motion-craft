/* eslint-disable @next/next/no-img-element -- Approved media protocol URLs bypass the Next image optimizer. */
"use client";
import { EditorIcon } from "@/features/editor/editor-icon";
import { useState } from "react";
import { formatTimecode, parseTimecode, secondsToFrames } from "@/core/timeline/time.cjs";
import { TimelineRuler } from "./timeline-ruler";
import { useTimeline, useTimelineStoreApi } from "./timeline-store";
const HEADER = 196;
export function ClipBlock({
  id,
  label,
  thumbnail,
  audio,
  start,
  width,
  onPointerDown,
  onTrim,
  onFocus,
}: {
  id: string;
  label: string;
  thumbnail?: string;
  audio: boolean;
  start: number;
  width: number;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onTrim: (e: React.PointerEvent<HTMLButtonElement>, edge: "left" | "right") => void;
  onFocus: () => void;
}) {
  const selected = useTimeline((s) => s.selectedIds.includes(id)),
    store = useTimelineStoreApi();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Timeline layer ${label}`}
      aria-pressed={selected}
      data-clip-id={id}
      title={`${label}${audio ? " · Audio (waveform not generated)" : ""}`}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      onClick={(e) => {
        if (e.detail === 0) store.getState().selectClip(id, e.ctrlKey || e.metaKey || e.shiftKey);
      }}
      className={`absolute inset-y-1 flex touch-none items-center overflow-hidden rounded border text-[10px] ${selected ? "border-cyan-300 ring-1 ring-cyan-300" : "border-slate-500"} ${audio ? "bg-emerald-950" : "bg-slate-700"}`}
      style={{ left: start, width }}
    >
      <button
        style={{ width: Math.min(8, width / 4) }}
        tabIndex={-1}
        aria-label={`Trim start ${label}`}
        className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-white/10"
        onPointerDown={(e) => onTrim(e, "left")}
      />
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
        />
      )}
      <span className="relative truncate px-3">
        {audio ? "A " : "V "}
        {label}
      </span>
      <button
        style={{ width: Math.min(8, width / 4) }}
        tabIndex={-1}
        aria-label={`Trim end ${label}`}
        className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-white/10"
        onPointerDown={(e) => onTrim(e, "right")}
      />
    </div>
  );
}
export function TrackGhost({ trackId, zoom }: { trackId: string; zoom: number }) {
  const drag = useTimeline((s) => s.drag);
  return (
    <>
      {drag?.changes
        .filter((c) => c.clip.trackId === trackId)
        .map((c) => (
          <div
            key={c.clip.id}
            className="pointer-events-none absolute inset-y-0 z-20 rounded border-2 border-cyan-200 bg-cyan-400/30"
            style={{ left: c.clip.start * zoom, width: c.clip.duration * zoom }}
          />
        ))}
      {drag && drag.trackId === trackId && !drag.valid && (
        <span className="pointer-events-none sticky left-[210px] z-20 bg-red-950 px-2 text-[10px] text-red-200">
          {drag.error}
        </span>
      )}
    </>
  );
}
export function Playhead({ zoom, fps }: { zoom: number; fps: number }) {
  const frame = useTimeline((s) => s.playheadFrame),
    guide = useTimeline((s) => s.drag?.guide);
  return (
    <>
      <div
        aria-hidden
        data-testid="timeline-playhead"
        className="pointer-events-none absolute bottom-0 top-6 z-10 w-px bg-cyan-300"
        style={{ left: HEADER + (frame / fps) * zoom }}
      />
      {guide !== null && guide !== undefined && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 top-6 z-20 w-px bg-amber-300"
          style={{ left: HEADER + (guide / fps) * zoom }}
        />
      )}
    </>
  );
}
export function FrameRuler({ zoom, extent, fps }: { zoom: number; extent: number; fps: number }) {
  const frame = useTimeline((s) => s.playheadFrame),
    store = useTimelineStoreApi();
  return (
    <TimelineRuler
      zoom={zoom}
      duration={extent}
      playhead={frame / fps}
      fps={fps}
      onSeek={(seconds) => store.getState().setPlayhead(secondsToFrames(seconds, fps))}
    />
  );
}
export function SnapButton() {
  const enabled = useTimeline((s) => s.snapEnabled),
    store = useTimelineStoreApi();
  return (
    <button
      aria-label="Toggle timeline snapping"
      aria-pressed={enabled}
      onClick={() => store.getState().toggleSnap()}
      title="Snap to playhead, clip edges and scene boundaries"
      className={`editor-icon-button ${enabled ? "is-active" : ""}`}
    >
      <EditorIcon name="magnet" />
      <span className="sr-only">Snap {enabled ? "on" : "off"}</span>
    </button>
  );
}
export function TimelineMessage() {
  const message = useTimeline((s) => s.message);
  return message ? (
    <p role="status" className="px-2 text-[10px] text-amber-200">
      {message}
    </p>
  ) : null;
}
export function TimelineReadout({ fps }: { fps: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const frame = useTimeline((s) => s.playheadFrame),
    store = useTimelineStoreApi();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        store.getState().setMonitor("timeline");
        const data = new FormData(e.currentTarget);
        try {
          store.getState().setPlayhead(parseTimecode(String(data.get("timecode")), fps));
          setDraft(null);
        } catch (error) {
          store.getState().setMessage(error instanceof Error ? error.message : "Invalid timecode");
        }
      }}
    >
      <input
        aria-label="Timeline timecode"
        name="timecode"
        value={draft ?? formatTimecode(frame, fps)}
        title="HH:MM:SS:FF - press Enter to seek"
        onFocus={() => setDraft(formatTimecode(frame, fps))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        className="w-24 bg-transparent font-mono"
      />
      <button type="submit" className="sr-only">
        Seek timecode
      </button>
      <output aria-label="Timeline marker time" className="sr-only">
        {(frame / fps).toFixed(1)} s
      </output>
    </form>
  );
}
