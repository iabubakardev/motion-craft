"use client";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { formatTimecode, secondsToFrames } from "@/core/timeline/time.cjs";
import { useTimeline } from "./timeline-store";
export function ClipProperties({ document: doc }: { document: ProjectDocumentController }) {
  const ids = useTimeline((s) => s.selectedIds);
  if (!ids.length) return null;
  const records = createTimelineIndex(doc.project);
  const item = ids.length === 1 ? records.clips.get(ids[0]) : undefined;
  if (!item)
    return (
      <div className="border-t border-[var(--editor-border)] p-4 text-xs">
        {ids.length} timeline clips selected. Ctrl/Shift-click toggles selection.
      </div>
    );
  const { clip, track } = item,
    fps = doc.project.fps;
  const start = secondsToFrames(clip.start, fps),
    duration = secondsToFrames(clip.duration, fps);
  return (
    <section
      className="border-t border-[var(--editor-border)] p-4 text-[11px]"
      aria-label="Timeline clip properties"
    >
      <h3 className="mb-3 font-medium">Timeline clip · {track.name}</h3>
      <form
        key={`${clip.id}:${start}:${duration}`}
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          doc.executeTimeline(
            {
              type: "UpdateClipProperties",
              clipId: clip.id,
              startFrame: Number(form.get("start")),
              durationFrames: Number(form.get("duration")),
            },
            doc.project,
          );
        }}
      >
        <label>
          Start frame
          <input
            name="start"
            aria-label="Clip start frame"
            type="number"
            min={0}
            max={86400 * fps}
            step={1}
            defaultValue={start}
            required
            className="editor-input mt-1 w-full"
          />
        </label>
        <label>
          Duration frames
          <input
            name="duration"
            aria-label="Clip duration frames"
            type="number"
            min={1}
            max={86400 * fps}
            step={1}
            defaultValue={duration}
            required
            className="editor-input mt-1 w-full"
          />
        </label>
        <p className="font-mono text-[10px]">
          {formatTimecode(start, fps)} + {formatTimecode(duration, fps)}
        </p>
        <p>
          Source:{" "}
          {clip.sourceStart === null
            ? "Still / generated content"
            : `${clip.sourceStart.toFixed(3)}–${clip.sourceEnd?.toFixed(3)} s`}
        </p>
        <button type="submit" className="editor-primary" disabled={doc.busy || track.locked}>
          Apply clip timing
        </button>
      </form>
    </section>
  );
}
