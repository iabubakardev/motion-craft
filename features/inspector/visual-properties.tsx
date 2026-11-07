"use client";
import { useMemo } from "react";
import { useTimeline } from "@/features/timeline/timeline-store";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { defaultVisual, visualSchema } from "@/core/timeline/visual-schema.cjs";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
export function VisualProperties({
  document: doc,
  transitionsOnly = false,
}: {
  document: ProjectDocumentController;
  transitionsOnly?: boolean;
}) {
  const ids = useTimeline((s) => s.selectedIds),
    index = useMemo(() => createTimelineIndex(doc.project), [doc.project]);
  const item = index.clips.get(
    ids.length === 1 ? ids[0] : ids.length === 0 ? (doc.selectedLayerId ?? "") : "",
  );
  if (!item) return null;
  const { clip, layer, track, asset } = item;
  const visual = !clip.audioOnly && asset?.type !== "audio" && layer?.type !== "caption";
  const v = visualSchema.parse(clip.visual ?? defaultVisual(layer));
  const update = (patch: Partial<typeof v>) =>
    doc.executeVisual({ type: "UpdateVisual", clipId: clip.id, visual: { ...v, ...patch } });
  return (
    <section aria-label="Visual editing" className="space-y-4 p-4 text-xs">
      <h3 className="font-medium truncate">{asset?.filename ?? layer?.type ?? "Clip"}</h3>
      {!transitionsOnly && layer?.type === "text" && (
        <fieldset disabled={doc.busy || track.locked} className="space-y-2">
          <label>
            Text
            <textarea
              aria-label="Visual text"
              className="editor-input w-full"
              key={`${layer.id}:${layer.properties.text}`}
              defaultValue={layer.properties.text}
              onBlur={(e) => doc.updateLayer(layer.id, { text: e.target.value })}
            />
          </label>
          <label>
            Font size
            <input
              aria-label="Visual font size"
              className="editor-input w-full"
              type="number"
              min={1}
              max={1000}
              key={layer.properties.fontSize}
              defaultValue={layer.properties.fontSize}
              onBlur={(e) => doc.updateLayer(layer.id, { fontSize: Number(e.target.value) })}
            />
          </label>
          <label>
            Font family
            <select
              aria-label="Visual font family"
              className="editor-input w-full"
              value={layer.properties.fontFamily}
              onChange={(e) => doc.updateLayer(layer.id, { fontFamily: e.target.value })}
            >
              {[
                ...new Set([
                  layer.properties.fontFamily,
                  "Arial",
                  "Georgia",
                  "Impact",
                  "monospace",
                ]),
              ].map((font) => (
                <option key={font}>{font}</option>
              ))}
            </select>
          </label>
          <label>
            Text color
            <input
              aria-label="Visual text color"
              className="editor-input w-full"
              type="color"
              defaultValue={layer.properties.color}
              key={layer.properties.color}
              onBlur={(e) => doc.updateLayer(layer.id, { color: e.target.value })}
            />
          </label>
        </fieldset>
      )}
      {visual && (
        <fieldset disabled={doc.busy || track.locked} className="space-y-4">
          <div hidden={transitionsOnly}>
            <div className="flex items-center justify-between">
              <h4>Transform</h4>
              <button
                className="editor-secondary !p-1"
                onClick={() =>
                  update({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 })
                }
              >
                Reset transform
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["x", "Position X", -100000, 100000, 1],
                  ["y", "Position Y", -100000, 100000, 1],
                  ["scaleX", "Scale X", 0.01, 100, 0.01],
                  ["scaleY", "Scale Y", 0.01, 100, 0.01],
                  ["rotation", "Rotation", -36000, 36000, 1],
                  ["opacity", "Opacity", 0, 1, 0.01],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <label key={`${clip.id}:${key}:${v[key]}`}>
                  {label}
                  <input
                    aria-label={`Visual ${label}`}
                    className="editor-input w-full mt-1"
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    defaultValue={v[key]}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== v[key])
                        update({ [key]: Number(e.target.value) });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              {(["contain", "cover"] as const).map((fit) => (
                <button
                  key={fit}
                  aria-pressed={v.fit === fit}
                  className="editor-secondary flex-1"
                  onClick={() => update({ fit })}
                >
                  {fit === "contain" ? "Fit" : "Fill"}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="editor-secondary flex-1"
                aria-pressed={v.flipX}
                onClick={() => update({ flipX: !v.flipX })}
              >
                Flip horizontal
              </button>
              <button
                className="editor-secondary flex-1"
                aria-pressed={v.flipY}
                onClick={() => update({ flipY: !v.flipY })}
              >
                Flip vertical
              </button>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="Visual alignment">
              {(["Left", "Center X", "Right", "Top", "Center Y", "Bottom"] as const).map(
                (align) => (
                  <button
                    className="editor-secondary !px-2"
                    key={align}
                    onClick={() => {
                      const { width, height } = doc.project.resolution,
                        ratio =
                          asset?.width && asset.height
                            ? asset.width / asset.height
                            : width / height;
                      const w = v.fit === "cover" ? width : Math.min(width, height * ratio),
                        h = v.fit === "cover" ? height : Math.min(height, width / ratio);
                      update(
                        align === "Left"
                          ? { x: -(width - w * v.scaleX) / 2 }
                          : align === "Right"
                            ? { x: (width - w * v.scaleX) / 2 }
                            : align === "Top"
                              ? { y: -(height - h * v.scaleY) / 2 }
                              : align === "Bottom"
                                ? { y: (height - h * v.scaleY) / 2 }
                                : align === "Center X"
                                  ? { x: 0 }
                                  : { y: 0 },
                      );
                    }}
                  >
                    {align}
                  </button>
                ),
              )}
            </div>
            <details>
              <summary className="cursor-pointer font-medium">Crop</summary>
              <p className="my-2 text-[var(--editor-muted)]">
                Trim edges by percentage. Original media is preserved.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["top", "right", "bottom", "left"] as const).map((edge) => (
                  <label key={`${clip.id}:${edge}:${v.crop[edge]}`}>
                    {edge}
                    <input
                      aria-label={`Crop ${edge}`}
                      className="editor-input w-full"
                      type="number"
                      min={0}
                      max={95}
                      defaultValue={Math.round(v.crop[edge] * 100)}
                      onBlur={(e) =>
                        update({ crop: { ...v.crop, [edge]: Number(e.target.value) / 100 } })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                className="editor-secondary mt-2"
                onClick={() => update({ crop: { top: 0, right: 0, bottom: 0, left: 0 } })}
              >
                Reset crop
              </button>
            </details>
          </div>
          <details open={transitionsOnly || undefined}>
            <summary className="cursor-pointer font-medium">Clip transitions</summary>
            <p className="my-2 text-[var(--editor-muted)]">
              Animate this clip entrance and exit. These do not overlap neighboring clips.
            </p>
            {(["entrance", "exit"] as const).map((key) => (
              <label className="block my-2" key={key}>
                {key}
                <select
                  aria-label={`Visual ${key}`}
                  value={v[key]}
                  className="editor-input w-full"
                  onChange={(e) => update({ [key]: visualSchema.shape[key].parse(e.target.value) })}
                >
                  {visualSchema.shape[key].options.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Seconds
              <input
                aria-label="Transition seconds"
                className="editor-input w-full"
                type="number"
                min={0}
                max={10}
                step={0.1}
                defaultValue={v.transitionSeconds}
                key={v.transitionSeconds}
                onBlur={(e) => update({ transitionSeconds: Number(e.target.value) })}
              />
            </label>
          </details>
        </fieldset>
      )}
      {!transitionsOnly && clip.sourceStart !== null && (
        <fieldset disabled={doc.busy || track.locked || !!clip.layerId}>
          <label>
            Playback speed
            <select
              aria-label="Clip playback speed"
              className="editor-input w-full mt-1"
              value={clip.playbackRate ?? 1}
              onChange={(e) =>
                doc.executeVisual({
                  type: "SetPlaybackRate",
                  clipId: clip.id,
                  rate: Number(e.target.value),
                })
              }
            >
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}�
                </option>
              ))}
            </select>
          </label>
          {clip.layerId && (
            <p className="mt-1 text-[var(--editor-muted)]">
              Scene layers retain their scene timing. Speed is available on independent timeline
              media.
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}
