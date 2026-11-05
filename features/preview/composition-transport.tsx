"use client";
import { useState } from "react";
import type { RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { EditorIcon } from "@/features/editor/editor-icon";
import { formatTimecode } from "@/core/timeline/time.cjs";
import { useTimeline, useTimelineStoreApi } from "@/features/timeline/timeline-store";

export function CompositionTransport({
  player,
  duration,
  fps,
  onToggle,
  onFullscreen,
}: {
  player: RefObject<PlayerRef | null>;
  duration: number;
  fps: number;
  onToggle: () => void;
  onFullscreen: () => void;
}) {
  const store = useTimelineStoreApi(),
    frame = useTimeline((s) => s.playheadFrame),
    playing = useTimeline((s) => s.playing);
  const [volume, setVolume] = useState(1);
  const seek = (value: number) =>
    store.getState().setPlayhead(Math.max(0, Math.min(duration - 1, value)));
  return (
    <div className="composition-transport">
      <div className="flex items-center gap-1">
        <button
          className="editor-icon-button"
          title="Go to start"
          aria-label="Go to timeline start"
          onClick={() => seek(0)}
        >
          <EditorIcon name="start" />
        </button>
        <button
          className="editor-icon-button"
          title="Previous frame"
          aria-label="Previous timeline frame"
          onClick={() => seek(frame - 1)}
        >
          <EditorIcon name="previous" />
        </button>
        <button
          className="editor-icon-button canvas-play"
          title="Play / pause timeline (Space)"
          aria-label={playing ? "Pause timeline preview" : "Play timeline preview"}
          onClick={onToggle}
        >
          <EditorIcon name={playing ? "pause" : "play"} />
        </button>
        <button
          className="editor-icon-button"
          title="Next frame"
          aria-label="Next timeline frame"
          onClick={() => seek(frame + 1)}
        >
          <EditorIcon name="next" />
        </button>
      </div>
      <output
        aria-label="Composition timecode"
        className="shrink-0 font-mono text-[10px] text-[var(--editor-muted)]"
      >
        {formatTimecode(frame, fps)}{" "}
        <span className="opacity-40">/ {formatTimecode(duration, fps)}</span>
      </output>
      <input
        className="editor-range min-w-8 flex-1"
        aria-label="Timeline preview position"
        type="range"
        min={0}
        max={duration - 1}
        step={1}
        value={Math.min(frame, duration - 1)}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <button
        className="editor-icon-button"
        aria-label={volume ? "Mute timeline preview" : "Unmute timeline preview"}
        title="Toggle preview sound"
        onClick={() => {
          const next = volume ? 0 : 1;
          player.current?.setVolume(next);
          setVolume(next);
        }}
      >
        <EditorIcon name={volume ? "volume" : "mute"} />
      </button>
      <input
        aria-label="Timeline preview volume"
        title="Preview volume"
        className="editor-range w-12"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => {
          const next = Number(e.target.value);
          player.current?.setVolume(next);
          setVolume(next);
        }}
      />
      <button
        className="editor-icon-button"
        aria-label="Fullscreen timeline preview"
        title="Fullscreen canvas"
        onClick={onFullscreen}
      >
        <EditorIcon name="fullscreen" />
      </button>
    </div>
  );
}
