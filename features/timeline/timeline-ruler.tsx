"use client";

import { formatDuration } from "@/features/media/library.cjs";

export function TimelineRuler({ zoom, duration = 120, playhead, onSeek }: { zoom: number; duration?: number; playhead: number; onSeek: (time: number) => void }) {
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((seconds) => seconds * zoom >= 55 && duration / seconds <= 1000) || 600;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);
  const position = (event: React.PointerEvent<HTMLDivElement>) => Math.max(0, Math.min(duration, (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom));
  return <div role="slider" tabIndex={0} aria-label="Timeline playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Number(playhead.toFixed(2))} aria-valuetext={`${playhead.toFixed(1)} seconds, project timeline`} className="timeline-ruler" style={{ width: duration * zoom }}
    title="Position the project timeline marker. This does not seek the source preview."
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); onSeek(position(event)); }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(position(event)); }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={(event) => {
      if (!["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      onSeek(event.key === "Home" ? 0 : event.key === "End" ? duration : Math.max(0, Math.min(duration, playhead + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1))));
    }}>
    {ticks.map((time) => <span key={time} className="absolute top-0 h-full border-l border-[var(--editor-border)] pl-1 pt-1" style={{ left: time * zoom }}><span className="font-mono text-[9px] text-[var(--editor-muted)]">{formatDuration(time)}</span></span>)}
    <span className="timeline-playhead-head" style={{ left: playhead * zoom }} />
  </div>;
}
