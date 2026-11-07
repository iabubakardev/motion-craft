"use client";
import { useMemo, useState } from "react";
import type { z } from "zod";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { useTimeline, useTimelineStoreApi } from "@/features/timeline/timeline-store";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { secondsToFrames } from "@/core/timeline/time.cjs";
import { basePose, clipFrames } from "@/core/animation/commands.cjs";
import { pose } from "@/core/animation/engine.cjs";
import type { keyframeSchema } from "@/core/animation/schema.cjs";
import { propertySchema, presetSchema, easeSchema } from "@/core/animation/schema.cjs";
type Keyframe = z.infer<typeof keyframeSchema>;
export function AnimationProperties({ document: doc }: { document: ProjectDocumentController }) {
  const ids = useTimeline((s) => s.selectedIds),
    frame = useTimeline((s) => s.playheadFrame),
    store = useTimelineStoreApi();
  const [property, setProperty] = useState<z.infer<typeof propertySchema>>("opacity");
  const index = useMemo(() => createTimelineIndex(doc.project), [doc.project]);
  const item = index.clips.get(
    ids.length === 1 ? ids[0] : ids.length === 0 ? doc.selectedLayerId || "" : "",
  );
  if (!item || item.track.type === "audio") return null;
  const { clip, layer, track } = item,
    motion = doc.project.animations[clip.id];
  const start = secondsToFrames(clip.start, doc.project.fps, "ceil"),
    total = clipFrames(clip, doc.project.fps),
    local = frame - start;
  const keys = [...(motion?.keyframes || [])].sort(
    (a, b) => a.frame - b.frame || a.property.localeCompare(b.property),
  );
  const seek = (key: Keyframe) => {
    store.getState().setMonitor("timeline");
    store.getState().setPlaying(false);
    store.getState().setPlayhead(start + key.frame);
  };
  const disabled = doc.busy || track.locked;
  return (
    <section
      aria-label="Animation properties"
      className="border-t border-[var(--editor-border)] p-4 text-[11px]"
    >
      <h3 className="mb-3 font-medium">Animation</h3>
      <fieldset disabled={disabled} className="grid gap-3">
        <div className="flex items-center gap-2">
          <select
            aria-label="Animated property"
            className="editor-input min-w-0 flex-1"
            value={property}
            onChange={(e) => setProperty(propertySchema.parse(e.target.value))}
          >
            {propertySchema.options.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button
            className="editor-icon-button"
            aria-label="Add keyframe at playhead"
            title="Add keyframe at playhead"
            disabled={local < 0 || local >= total}
            onClick={() => {
              const existing = keys.find((k) => k.property === property && k.frame === local);
              doc.executeMotion(
                {
                  type: "SetKeyframe",
                  clipId: clip.id,
                  keyframe: existing || {
                    id: crypto.randomUUID(),
                    property,
                    frame: local,
                    value: pose(keys, basePose(layer, clip.visual), local)[property],
                    easing: { type: "linear" },
                  },
                },
                doc.project,
              );
            }}
          >
            ◆
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="editor-icon-button"
            aria-label="Previous keyframe"
            disabled={!keys.some((k) => k.frame < local)}
            onClick={() => {
              const key = keys.filter((k) => k.frame < local).at(-1);
              if (key) seek(key);
            }}
          >
            ◀
          </button>
          <span className="flex-1 text-center font-mono">
            Local frame {local} / {total - 1}
          </span>
          <button
            className="editor-icon-button"
            aria-label="Next keyframe"
            disabled={!keys.some((k) => k.frame > local)}
            onClick={() => {
              const key = keys.find((k) => k.frame > local);
              if (key) seek(key);
            }}
          >
            ▶
          </button>
        </div>
        <form
          className="grid grid-cols-2 gap-2"
          key={`preset:${clip.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            doc.executeMotion(
              {
                type: "ApplyPreset",
                clipId: clip.id,
                name: presetSchema.parse(data.get("preset")),
                durationFrames: Number(data.get("duration")),
              },
              doc.project,
            );
          }}
        >
          <select className="editor-input col-span-2" name="preset" aria-label="Animation preset">
            {presetSchema.options.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <label>
            Frames
            <input
              className="editor-input w-full"
              type="number"
              aria-label="Preset duration frames"
              name="duration"
              min={2}
              max={total}
              defaultValue={Math.min(30, total)}
              required
            />
          </label>
          <button className="editor-secondary self-end" disabled={total < 2}>
            Apply preset
          </button>
          <p className="col-span-2 text-[10px] text-[var(--editor-muted)]">
            Applying a preset replaces this clip’s keyframes. Undo restores them.
          </p>
        </form>
        {motion?.preset && (
          <button
            className="editor-secondary"
            onClick={() =>
              doc.executeMotion({ type: "ConvertPreset", clipId: clip.id }, doc.project)
            }
          >
            Convert {motion.preset.name} to manual keys
          </button>
        )}
        {keys.map((key) => (
          <form
            key={`${key.id}:${key.frame}:${key.value}:${JSON.stringify(key.easing)}`}
            className={`grid grid-cols-2 gap-2 rounded border p-2 ${key.frame === local ? "border-cyan-400" : "border-[var(--editor-border)]"}`}
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const type = easeSchema.shape.type.parse(data.get("easing"));
              doc.executeMotion(
                {
                  type: "SetKeyframe",
                  clipId: clip.id,
                  keyframe: {
                    ...key,
                    frame: Number(data.get("frame")),
                    value: Number(data.get("value")),
                    easing:
                      type === "bezier"
                        ? {
                            type,
                            control: [
                              Number(data.get("x1")),
                              Number(data.get("y1")),
                              Number(data.get("x2")),
                              Number(data.get("y2")),
                            ],
                          }
                        : { type },
                  },
                },
                doc.project,
              );
            }}
          >
            <button type="button" className="col-span-2 text-left" onClick={() => seek(key)}>
              ◆ {key.property}
            </button>
            <label>
              Frame
              <input
                aria-label={`${key.property} keyframe frame`}
                className="editor-input w-full"
                name="frame"
                type="number"
                step={1}
                min={0}
                max={total - 1}
                defaultValue={key.frame}
                required
              />
            </label>
            <label>
              Value
              <input
                aria-label={`${key.property} keyframe value`}
                className="editor-input w-full"
                name="value"
                type="number"
                step="any"
                defaultValue={key.value}
                required
              />
            </label>
            <select
              className="editor-input col-span-2"
              name="easing"
              aria-label={`${key.property} keyframe easing`}
              defaultValue={key.easing.type}
            >
              {easeSchema.shape.type.options.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            <details className="col-span-2">
              <summary>Bezier controls (0–1)</summary>
              <div className="grid grid-cols-2 gap-1">
                {["x1", "y1", "x2", "y2"].map((name, i) => (
                  <label key={name}>
                    {name}
                    <input
                      className="editor-input w-full"
                      name={name}
                      aria-label={`Bezier ${name}`}
                      type="number"
                      step="any"
                      min={0}
                      max={1}
                      defaultValue={key.easing.control?.[i] ?? [0.42, 0, 0.58, 1][i]}
                      required
                    />
                  </label>
                ))}
              </div>
            </details>
            <button className="editor-secondary">Update keyframe</button>
            <button
              type="button"
              className="editor-secondary"
              onClick={() =>
                doc.executeMotion(
                  { type: "DeleteKeyframe", clipId: clip.id, keyframeId: key.id },
                  doc.project,
                )
              }
            >
              Delete
            </button>
          </form>
        ))}
        {!!keys.length && (
          <button
            className="editor-secondary"
            onClick={() =>
              doc.executeMotion({ type: "ClearAnimation", clipId: clip.id }, doc.project)
            }
          >
            Clear animation
          </button>
        )}
      </fieldset>
    </section>
  );
}
