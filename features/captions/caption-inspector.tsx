"use client";
import { CaptionTemplates } from "./caption-templates";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { useMemo, useState } from "react";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { captionRecords } from "@/core/captions/commands.cjs";
import { captionForLayer } from "@/core/captions/presets.cjs";
import type { Caption } from "@/core/captions/presets.cjs";
import {
  presetSchema,
  styleSchema,
  groupingSchema,
  displayModeSchema,
} from "@/core/captions/schema.cjs";
import { parseSubtitles, exportSubtitles } from "@/core/captions/subtitles.cjs";
import { useTimeline, useTimelineStoreApi } from "@/features/timeline/timeline-store";
import { secondsToFrames } from "@/core/timeline/time.cjs";

const numericFields: {
  key: keyof Caption["style"];
  label: string;
  min: number;
  max: number;
  step: number;
  pixels?: boolean;
}[] = [
  { pixels: true, key: "fontSize", label: "Font size (px)", min: 0.005, max: 0.3, step: 0.001 },
  { key: "fontWeight", label: "Font weight", min: 100, max: 900, step: 100 },
  {
    pixels: true,
    key: "letterSpacing",
    label: "Letter spacing (px)",
    min: -0.02,
    max: 0.05,
    step: 0.001,
  },
  { key: "lineHeight", label: "Line height", min: 0.8, max: 3, step: 0.1 },
  { key: "maxLines", label: "Maximum lines", min: 1, max: 10, step: 1 },
  {
    pixels: true,
    key: "outlineWidth",
    label: "Outline width (px)",
    min: 0,
    max: 0.02,
    step: 0.001,
  },
  { pixels: true, key: "shadowBlur", label: "Shadow blur (px)", min: 0, max: 0.05, step: 0.001 },
  { pixels: true, key: "shadowX", label: "Shadow X (px)", min: -0.1, max: 0.1, step: 0.001 },
  { pixels: true, key: "shadowY", label: "Shadow Y (px)", min: -0.1, max: 0.1, step: 0.001 },
  { key: "backgroundOpacity", label: "Background opacity", min: 0, max: 1, step: 0.05 },
  { pixels: true, key: "padding", label: "Background padding (px)", min: 0, max: 0.1, step: 0.001 },
  { pixels: true, key: "radius", label: "Corner radius (px)", min: 0, max: 0.1, step: 0.001 },
  { key: "opacity", label: "Overall opacity", min: 0, max: 1, step: 0.05 },
  { key: "animationSeconds", label: "Animation seconds", min: 0, max: 5, step: 0.05 },
  { key: "activeScale", label: "Active word scale", min: 1, max: 2, step: 0.05 },
];
function saveText(text: string, format: "srt" | "vtt") {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })),
    link = document.createElement("a");
  link.href = url;
  link.download = `captions.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CaptionInspector({
  document: doc,
  onGenerateCaptions,
  sourceAssetId,
}: {
  document: ProjectDocumentController;
  onGenerateCaptions: (assetId?: string, clipId?: string) => void;
  sourceAssetId?: string;
}) {
  const showGuides = useTimeline((s) => s.captionGuides);
  const selected = useTimeline((s) => s.selectedIds),
    store = useTimelineStoreApi();
  const records = useMemo(() => captionRecords(doc.project), [doc.project]);
  const index = useMemo(() => createTimelineIndex(doc.project), [doc.project]);
  const audio = selected.map((id) => index.clips.get(id)).find((r) => r?.asset?.type === "audio");
  const ids = selected.filter((id) => records.some((r) => r.layer.id === id));
  const focused =
    records.find((r) => ids.includes(r.layer.id)) ||
    records.find((r) => r.layer.id === doc.selectedLayerId);
  const [editorTab, setEditorTab] = useState<"templates" | "edit">("templates");
  const [scope, setScope] = useState("all"),
    [message, setMessage] = useState("");
  const [grouping, setGrouping] = useState({
    mode: "sentence" as "sentence" | "word",
    maxWords: 7,
    maxLines: 2,
    maxCharacters: 32,
    maxSeconds: 4,
    pauseSeconds: 0.5,
  });
  const generatedIds = new Set(doc.project.transcripts.flatMap((t) => t.captionIds));
  const targets =
    scope === "all"
      ? records
          .filter((r) => !generatedIds.size || generatedIds.has(r.layer.id))
          .map((r) => r.layer.id)
      : scope === "track" && focused
        ? records.filter((r) => r.layer.trackId === focused.layer.trackId).map((r) => r.layer.id)
        : scope === "one" && focused
          ? [focused.layer.id]
          : ids.length
            ? ids
            : focused
              ? [focused.layer.id]
              : [];
  const c = focused ? captionForLayer(focused.layer, doc.project.resolution) : null;
  function style(patch: Partial<Caption["style"]>) {
    doc.executeCaption({ type: "StyleCaptions", ids: targets, patch });
  }
  return (
    <section
      aria-label="Caption editor"
      className="space-y-3 border-t border-[var(--editor-border)] p-4 text-[11px]"
    >
      <h3 className="font-semibold">Caption editing</h3>
      <div hidden={editorTab !== "templates"}>
        <p className="text-[10px] text-[var(--editor-muted)]">
          1. Generate or import &nbsp; 2. Choose a template &nbsp; 3. Select and edit
        </p>
        <button
          className="editor-primary w-full"
          disabled={!doc.ready || doc.busy}
          onClick={() => onGenerateCaptions(audio?.asset?.id || sourceAssetId, audio?.clip.id)}
        >
          Generate captions
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Caption editing sections">
        <button
          className="editor-secondary"
          aria-label="Show caption templates"
          aria-pressed={editorTab === "templates"}
          onClick={() => setEditorTab("templates")}
        >
          Templates
        </button>
        <button
          className="editor-secondary"
          aria-label="Edit captions"
          aria-pressed={editorTab === "edit"}
          disabled={!records.length}
          onClick={() => {
            if (!focused && records[0]) {
              const first = records[0];
              store.getState().setSelection([first.layer.id]);
              store.getState().setMonitor("timeline");
              store.getState().setPlayhead(secondsToFrames(first.start, doc.project.fps));
              doc.selectLayer(first.scene.id, first.layer.id);
            }
            setEditorTab("edit");
          }}
        >
          Edit captions
        </button>
      </div>
      <div hidden={editorTab !== "templates"}>
        <CaptionTemplates
          disabled={doc.busy || !(targets.length || records.length)}
          selected={c?.preset}
          onApply={(preset) => {
            const applied = doc.executeCaption({
              type: "StyleCaptions",
              ids: targets.length ? targets : records.map((r) => r.layer.id),
              preset,
            });
            if (applied) setEditorTab("edit");
            if (applied && !focused && records[0]) {
              const first = records[0];
              store.getState().setSelection([first.layer.id]);
              store.getState().setMonitor("timeline");
              store.getState().setPlayhead(secondsToFrames(first.start, doc.project.fps));
              doc.selectLayer(first.scene.id, first.layer.id);
            }
          }}
        />
      </div>
      {!records.length ? (
        <p>Start with audio or import subtitles. Templates become editable once captions exist.</p>
      ) : !focused ? (
        <p>
          Templates apply to {targets.length || records.length} captions in the current scope. Click
          a caption in the preview or timeline to edit its text, timing and position.
        </p>
      ) : (
        <p>Drag to move. Corner: resize. Top handle: rotate. Arrow keys: nudge.</p>
      )}
      <div hidden={editorTab !== "templates"} className="space-y-2">
        <label className="editor-secondary inline-block cursor-pointer">
          Import SRT / VTT
          <input
            aria-label="Import subtitles"
            type="file"
            accept=".srt,.vtt,text/vtt"
            className="sr-only"
            disabled={doc.busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > 5 * 1024 * 1024) throw new Error("Subtitles exceed 5 MB");
                const cues = parseSubtitles(await file.text());
                if (
                  doc.executeCaption(
                    { type: "ImportCaptions", cues, batchId: crypto.randomUUID() },
                    doc.project,
                  )
                )
                  setMessage("Subtitles imported.");
                else setMessage("Subtitles were not imported. Review project errors.");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Invalid subtitles");
              }
            }}
          />
        </label>
        <div className="flex gap-2">
          {(["srt", "vtt"] as const).map((format) => (
            <button
              key={format}
              className="editor-secondary"
              disabled={!records.length}
              onClick={() => {
                try {
                  saveText(
                    exportSubtitles(
                      records.map((r) => ({
                        start: r.start,
                        end: r.end,
                        text: r.layer.properties.text,
                      })),
                      format,
                    ),
                    format,
                  );
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Export failed");
                }
              }}
            >
              Export {format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      {!focused && (
        <p>Select caption clips in the timeline or click a caption in the preview to edit.</p>
      )}
      {focused && c && (
        <fieldset
          hidden={editorTab !== "edit"}
          disabled={
            doc.busy || doc.project.tracks.find((t) => t.id === focused.layer.trackId)?.locked
          }
          className="space-y-3"
        >
          <label className="block">
            Playback text
            <select
              className="editor-input w-full"
              aria-label="Caption playback text"
              value={c.style.displayMode || "full"}
              onChange={(e) => style({ displayMode: displayModeSchema.parse(e.target.value) })}
            >
              <option value="phrase">Current spoken phrase</option>
              <option value="word">Only the spoken word</option>
              <option value="full">Full caption text</option>
            </select>
          </label>
          <label className="block">
            Caption text
            <textarea
              aria-label="Caption text"
              className="editor-input w-full"
              key={`${focused.layer.id}:${focused.layer.properties.text}`}
              defaultValue={focused.layer.properties.text}
              rows={3}
              maxLength={10000}
              onBlur={(e) => {
                if (e.target.value !== focused.layer.properties.text)
                  doc.executeCaption({
                    type: "EditCaption",
                    id: focused.layer.id,
                    text: e.target.value,
                  });
              }}
            />
          </label>
          <p className="text-[10px] text-[var(--editor-muted)]">
            Text corrections clear this caption&apos;s word alignment; original transcript words
            remain archived.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="editor-secondary"
              onClick={() =>
                doc.executeTimeline({
                  type: "SplitClip",
                  clipId: focused.layer.id,
                  frame: store.getState().playheadFrame,
                  newClipId: crypto.randomUUID(),
                })
              }
            >
              Split at playhead
            </button>
            <button
              className="editor-secondary"
              disabled={ids.length < 2}
              onClick={() => doc.executeCaption({ type: "MergeCaptions", ids })}
            >
              Merge selected
            </button>
          </div>
          <form
            key={`${focused.layer.id}:${focused.start}:${focused.end}`}
            className="grid grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              doc.executeTimeline({
                type: "UpdateClipProperties",
                clipId: focused.layer.id,
                startFrame: secondsToFrames(Number(values.get("start")), doc.project.fps),
                durationFrames: secondsToFrames(
                  Number(values.get("end")) - Number(values.get("start")),
                  doc.project.fps,
                ),
              });
            }}
          >
            <label>
              Start seconds
              <input
                className="editor-input w-full"
                name="start"
                type="number"
                step="any"
                min={0}
                defaultValue={focused.start}
              />
            </label>
            <label>
              End seconds
              <input
                className="editor-input w-full"
                name="end"
                type="number"
                step="any"
                min={0}
                defaultValue={focused.end}
              />
            </label>
            <button className="editor-secondary col-span-2">Apply caption timing</button>
          </form>
          <label className="block">
            Style and position targets
            <select
              aria-label="Caption style scope"
              value={scope}
              className="editor-input w-full"
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">
                {generatedIds.size ? "All generated captions" : "All captions"}
              </option>
              <option value="selected">Selected captions</option>
              <option value="one">This caption</option>
              <option value="track">Entire caption track</option>
            </select>
          </label>
          <label className="block">
            Preset
            <select
              aria-label="Caption preset"
              value={c.preset}
              className="editor-input w-full"
              onChange={(e) =>
                doc.executeCaption({
                  type: "StyleCaptions",
                  ids: targets,
                  preset: presetSchema.parse(e.target.value),
                })
              }
            >
              {presetSchema.options.map((p) => (
                <option key={p} value={p}>
                  {p
                    .split("-")
                    .map((word) => word[0].toUpperCase() + word.slice(1))
                    .join(" ")}
                </option>
              ))}
            </select>
          </label>
          <button
            className="editor-secondary"
            onClick={() =>
              doc.executeCaption({ type: "StyleCaptions", ids: targets, preset: c.preset })
            }
          >
            Apply current preset to targets
          </button>
          <p className="text-[10px] text-[var(--editor-muted)]">
            Style and position use these targets. Text and timing edit the focused caption.
          </p>
          <details>
            <summary>Typography and appearance</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label>
                Font family
                <select
                  className="editor-input w-full"
                  value={c.style.fontFamily}
                  onChange={(e) =>
                    style({ fontFamily: styleSchema.shape.fontFamily.parse(e.target.value) })
                  }
                >
                  {styleSchema.shape.fontFamily.options.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Alignment
                <select
                  className="editor-input w-full"
                  value={c.style.align}
                  onChange={(e) => style({ align: styleSchema.shape.align.parse(e.target.value) })}
                >
                  {styleSchema.shape.align.options.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Case
                <select
                  className="editor-input w-full"
                  value={c.style.casing}
                  onChange={(e) =>
                    style({ casing: styleSchema.shape.casing.parse(e.target.value) })
                  }
                >
                  {styleSchema.shape.casing.options.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {(
                [
                  "color",
                  "outlineColor",
                  "shadowColor",
                  "backgroundColor",
                  "activeColor",
                  "inactiveColor",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {key.replace(/([A-Z])/g, " $1")}
                  <input
                    aria-label={`Caption ${key}`}
                    className="editor-input w-full"
                    type="color"
                    value={c.style[key]}
                    onChange={(e) => style({ [key]: e.target.value })}
                  />
                </label>
              ))}
              {numericFields.map((f) => (
                <label key={`${focused.layer.id}:${f.key}:${c.style[f.key]}`}>
                  {f.label}
                  <input
                    aria-label={`Caption ${f.key}`}
                    className="editor-input w-full"
                    type="number"
                    min={f.min * (f.pixels ? doc.project.resolution.height : 1)}
                    max={f.max * (f.pixels ? doc.project.resolution.height : 1)}
                    step={f.pixels ? 0.1 : f.step}
                    defaultValue={Number(
                      (
                        Number(c.style[f.key]) * (f.pixels ? doc.project.resolution.height : 1)
                      ).toFixed(3),
                    )}
                    onBlur={(e) => {
                      const value =
                        Number(e.target.value) / (f.pixels ? doc.project.resolution.height : 1);
                      if (Math.abs(value - Number(c.style[f.key])) > 1e-6)
                        style({ [f.key]: value });
                    }}
                  />
                </label>
              ))}
            </div>
          </details>
          <details>
            <summary>Position (normalized 0-1)</summary>
            <label className="block">
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(e) => store.getState().setCaptionGuides(e.target.checked)}
              />
              Show safe-area and alignment guides
            </label>
            <label className="block">
              Horizontal placement
              <select
                className="editor-input w-full"
                value=""
                disabled={c.box.locked}
                onChange={(e) =>
                  doc.executeCaption({
                    type: "PositionCaptions",
                    ids: targets,
                    patch: {
                      x:
                        e.target.value === "left"
                          ? Math.min(0.95, 0.05 + c.box.width / 2)
                          : e.target.value === "right"
                            ? Math.max(0.05, 0.95 - c.box.width / 2)
                            : 0.5,
                    },
                  })
                }
              >
                <option value="" disabled>
                  Align horizontally
                </option>
                <option value="left">Left safe edge</option>
                <option value="center">Center</option>
                <option value="right">Right safe edge</option>
              </select>
            </label>
            <label className="block">
              Vertical placement
              <select
                className="editor-input w-full"
                value=""
                disabled={c.box.locked}
                onChange={(e) => {
                  const half =
                    (c.style.fontSize * c.style.maxLines * c.style.lineHeight +
                      2 * c.style.padding) /
                    2;
                  doc.executeCaption({
                    type: "PositionCaptions",
                    ids: targets,
                    patch: {
                      y:
                        e.target.value === "top"
                          ? Math.min(0.95, 0.05 + half)
                          : e.target.value === "bottom"
                            ? Math.max(0.05, 0.95 - half)
                            : 0.5,
                    },
                  });
                }}
              >
                <option value="" disabled>
                  Align vertically
                </option>
                <option value="top">Top safe edge</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom safe edge</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "width", "rotation"] as const).map((key) => (
                <label key={`${focused.layer.id}:${key}:${c.box[key]}`}>
                  {key.replace(/([A-Z])/g, " $1")}
                  <input
                    aria-label={`Caption ${key}`}
                    className="editor-input w-full"
                    type="number"
                    step={key === "rotation" ? 1 : 0.001}
                    min={key === "rotation" ? -180 : key === "width" ? 0.05 : 0}
                    max={key === "rotation" ? 180 : 1}
                    defaultValue={c.box[key]}
                    disabled={c.box.locked}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== c.box[key])
                        doc.executeCaption({
                          type: "PositionCaptions",
                          ids: targets,
                          patch: { [key]: Number(e.target.value) },
                        });
                    }}
                  />
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  aria-label="Lock caption position"
                  checked={c.box.locked}
                  onChange={(e) =>
                    doc.executeCaption({
                      type: "PositionCaptions",
                      ids: targets,
                      patch: { locked: e.target.checked },
                    })
                  }
                />
                Lock position
              </label>
              <button
                className="editor-secondary"
                disabled={c.box.locked}
                onClick={() =>
                  doc.executeCaption({
                    type: "PositionCaptions",
                    ids: targets,
                    patch: { x: 0.5, y: 0.85, width: 0.8, rotation: 0 },
                  })
                }
              >
                Reset position
              </button>
              <button
                className="editor-secondary"
                disabled={c.box.locked}
                onClick={() =>
                  doc.executeCaption({ type: "PositionCaptions", ids: targets, patch: { x: 0.5 } })
                }
              >
                Center horizontally
              </button>
              <button
                className="editor-secondary"
                disabled={c.box.locked}
                onClick={() =>
                  doc.executeCaption({ type: "PositionCaptions", ids: targets, patch: { y: 0.5 } })
                }
              >
                Center vertically
              </button>
            </div>
          </details>
          <label className="block">
            Animation
            <select
              aria-label="Caption animation"
              className="editor-input w-full"
              value={c.style.animation}
              onChange={(e) =>
                style({ animation: styleSchema.shape.animation.parse(e.target.value) })
              }
            >
              {styleSchema.shape.animation.options.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Easing
            <select
              aria-label="Caption easing"
              className="editor-input w-full"
              value={c.style.easing}
              onChange={(e) => style({ easing: styleSchema.shape.easing.parse(e.target.value) })}
            >
              {styleSchema.shape.easing.options.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <details>
            <summary>Word emphasis ({c.words.length} aligned words)</summary>
            {c.words.length ? (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {c.words.map((word, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      className="truncate"
                      onClick={() =>
                        store
                          .getState()
                          .setPlayhead(secondsToFrames(focused.start + word.start, doc.project.fps))
                      }
                    >
                      {word.text}
                    </button>
                    <input
                      aria-label={`Word ${i} color`}
                      type="color"
                      value={word.color || c.style.color}
                      onChange={(e) =>
                        doc.executeCaption({
                          type: "StyleWord",
                          id: focused.layer.id,
                          index: i,
                          patch: { color: e.target.value },
                        })
                      }
                    />
                    <label>
                      <input
                        aria-label={`Word ${i} bold`}
                        type="checkbox"
                        checked={word.bold || false}
                        onChange={(e) =>
                          doc.executeCaption({
                            type: "StyleWord",
                            id: focused.layer.id,
                            index: i,
                            patch: { bold: e.target.checked },
                          })
                        }
                      />
                      Bold
                    </label>
                    <input
                      aria-label={`Word ${i} scale`}
                      className="editor-input w-16"
                      type="number"
                      min={0.5}
                      max={2}
                      step={0.05}
                      defaultValue={word.scale || 1}
                      onBlur={(e) =>
                        doc.executeCaption({
                          type: "StyleWord",
                          id: focused.layer.id,
                          index: i,
                          patch: { scale: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p>
                No aligned words. Subtitle imports and corrected text support sentence captions.
              </p>
            )}
          </details>
          <details>
            <summary>Regroup selected captions</summary>
            <div className="grid grid-cols-2 gap-2">
              <label>
                Mode
                <select
                  className="editor-input w-full"
                  value={grouping.mode}
                  onChange={(e) =>
                    setGrouping({
                      ...grouping,
                      mode: groupingSchema.shape.mode.parse(e.target.value),
                    })
                  }
                >
                  <option value="sentence">Sentence / groups</option>
                  <option value="word">One word</option>
                </select>
              </label>
              {(
                ["maxWords", "maxLines", "maxCharacters", "maxSeconds", "pauseSeconds"] as const
              ).map((key) => (
                <label key={key}>
                  {key.replace(/([A-Z])/g, " $1")}
                  <input
                    className="editor-input w-full"
                    type="number"
                    step={key.endsWith("Seconds") ? 0.1 : 1}
                    value={grouping[key]}
                    onChange={(e) => setGrouping({ ...grouping, [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <p>
              Replaces only selected caption clips using their remaining aligned words; manual
              styling uses the first selected caption.
            </p>
            <button
              className="editor-secondary"
              onClick={() =>
                doc.executeCaption({
                  type: "RegroupCaptions",
                  ids: targets,
                  options: grouping,
                  batchId: crypto.randomUUID(),
                })
              }
            >
              Regroup captions
            </button>
          </details>
        </fieldset>
      )}
    </section>
  );
}
