"use client";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { Project, ProjectAsset } from "@/core/project/types";
import type { Plan } from "@/core/ai/planning.cjs";
import { narrationTranscript, reusableTranscript, matchMedia } from "@/core/ai/create-video.cjs";
import { settingsSchema } from "@/core/ai/schema.cjs";
import { presetSchema } from "@/core/captions/schema.cjs";
import type { transcriptSchema } from "@/core/transcription/schema.cjs";
import { sourceRangeSchema } from "@/core/transcription/schema.cjs";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { inspectAudio, transcriptionSettings } from "@/platform/transcription";
import { isAIAvailable } from "@/platform/ai";
import { useAIJob } from "./use-ai-job";
type Transcript = z.infer<typeof transcriptSchema>;
type Range = z.infer<typeof sourceRangeSchema>;
type Metadata = Record<string, { description: string; tags: string[] }>;
export function AICreateVideo({
  project,
  assets,
  initialAssetId,
  clipId,
  onApply,
  onClose,
}: {
  project: Project;
  assets: ProjectAsset[];
  initialAssetId?: string;
  clipId?: string;
  onApply: (
    plan: Plan,
    transcript: Transcript,
    options: { range: Range; preset: z.infer<typeof presetSchema>; replace: boolean },
    expected: Project,
  ) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    baseline = useRef(project),
    consumed = useRef(""),
    preparationId = useRef(0);
  const { job, error, running, start, cancel } = useAIJob();
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [ratio, setRatio] = useState<"16:9" | "9:16">(
    project.aspectRatio === "9:16" ? "9:16" : "16:9",
  );
  const [preset, setPreset] = useState<z.infer<typeof presetSchema>>("documentary");
  const [target, setTarget] = useState(6),
    [instructions, setInstructions] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null),
    [range, setRange] = useState<Range | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null),
    [message, setMessage] = useState("");
  const [preparing, setPreparing] = useState(false),
    [approved, setApproved] = useState(false),
    [replace, setReplace] = useState(false);
  const [metadata, setMetadata] = useState<Metadata>({});
  const pendingSettings = useRef<z.infer<typeof settingsSchema> | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const visuals = assets.filter((a) => a.type !== "audio");
  // Load descriptions/tags from the existing trusted local index; no new service/cache.
  useEffect(() => {
    if (visuals.length && isAIAvailable())
      void start({
        kind: "assets",
        operation: { action: "list", assetIds: visuals.map((a) => a.id) },
      });
    // The library is a fixed review snapshot for this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  const launchPlan = (t: Transcript, r: Range) => {
    const settings = pendingSettings.current;
    if (!settings) return;
    void start({
      kind: "plan",
      model: "qwen3:8b",
      input: { kind: "transcript", transcript: narrationTranscript(t, r) },
      settings,
    });
  };
  useEffect(() => {
    if (job?.state !== "completed" || !job.result || consumed.current === job.id) return;
    consumed.current = job.id;
    const result = job.result;
    queueMicrotask(() => {
      try {
        if (result.kind === "assets")
          setMetadata(
            Object.fromEntries(
              result.entries.map((e) => [e.asset.id, { description: e.description, tags: e.tags }]),
            ),
          );
        if (result.kind === "transcription") {
          setTranscript(result.transcript);
          if (range) launchPlan(result.transcript, range);
        }
        if (result.kind === "plan") {
          setPlan({
            ...result.plan,
            scenes: result.plan.scenes.map((s) => {
              const best = matchMedia(s, assets, metadata)[0];
              return { ...s, assetId: best?.suitable ? best.assetId : null };
            }),
          });
          setMessage(
            "Review each visual and match rationale. Unresolved scenes must be assigned before assembly.",
          );
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not validate the result.");
      }
    });
    // Job completion consumes the settings/source snapshot captured by Generate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);
  async function generate() {
    const requestId = ++preparationId.current;
    setMessage("");
    setPreparing(true);
    setPlan(null);
    setApproved(false);
    baseline.current = project;
    try {
      if (!isAIAvailable()) throw new Error("Open Electron to use local Whisper and Ollama.");
      const asset = assets.find((a) => a.id === assetId && a.type === "audio");
      if (!asset) throw new Error("Select an imported narration audio asset first.");
      const info = await inspectAudio(assetId);
      if (!dialog.current?.open || requestId !== preparationId.current) return;
      if (!info.hasAudio) throw new Error("The selected source has no audio stream.");
      const clip = clipId ? createTimelineIndex(project).clips.get(clipId)?.clip : undefined;
      if (clipId && (!clip || clip.assetId !== assetId))
        throw new Error("Selected narration changed. Reopen AI Create Video.");
      const r = sourceRangeSchema.parse({
        ...(clip ? { clipId: clip.id } : {}),
        sourceStart: clip?.sourceStart ?? 0,
        sourceEnd: clip?.sourceEnd ?? info.duration,
        timelineStart: 0,
        rate: clip?.playbackRate ?? 1,
      });
      if (r.sourceEnd > info.duration + 0.1)
        throw new Error("Narration exceeds the current source duration. Relink it first.");
      setRange(r);
      pendingSettings.current = settingsSchema.parse({
        fps: project.fps,
        aspectRatio: ratio,
        style: project.stylePreset,
        minSeconds: Math.max(1, target / 2),
        maxSeconds: target * 1.5,
        wordsPerMinute: 150,
        instructions,
        temperature: 0.2,
      });
      const cached = reusableTranscript(
        transcript ? [...project.transcripts, transcript] : project.transcripts,
        assetId,
        info,
        r,
      );
      if (cached) {
        setTranscript(cached);
        setMessage("Reusing saved reviewed transcript; Whisper was not run.");
        launchPlan(cached, r);
      } else {
        const config = await transcriptionSettings();
        if (!dialog.current?.open || requestId !== preparationId.current) return;
        if (!config.available || !config.config)
          throw new Error(
            config.message || "Configure the local Python worker in Transcribe first.",
          );
        setTranscript(null);
        void start({
          kind: "transcription",
          assetId,
          range: r,
          model: config.config.model,
          device: config.config.device,
          computeType: config.config.computeType,
        });
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not prepare narration.");
    } finally {
      setPreparing(false);
    }
  }
  const busy = running || preparing;
  const changeScene = (id: string, patch: Partial<Plan["scenes"][number]>) => {
    setPlan((p) =>
      p ? { ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : p,
    );
    setApproved(false);
  };
  return (
    <dialog
      ref={dialog}
      aria-label="AI Create Video"
      className="project-settings-dialog !w-[min(960px,95vw)] !max-w-none"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="flex items-center justify-between">
        <h2>AI Create Video</h2>
        <button className="editor-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto py-3 text-xs">
        <p>Local Whisper + Qwen3:8b / imported media only / review before assembly / 1080p</p>
        <fieldset disabled={busy || !!plan} className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            Narration
            {initialAssetId ? (
              <p>
                {assets.find((a) => a.id === assetId)?.filename}{" "}
                {clipId ? " /  selected clip range" : ""}
              </p>
            ) : (
              <select
                className="editor-input w-full"
                aria-label="Video narration"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
              >
                <option value="">Select imported audio</option>
                {assets
                  .filter((a) => a.type === "audio")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.filename}
                    </option>
                  ))}
              </select>
            )}
          </label>
          <label>
            Aspect ratio
            <select
              aria-label="Video aspect ratio"
              className="editor-input w-full"
              value={ratio}
              onChange={(e) => setRatio(e.target.value === "9:16" ? "9:16" : "16:9")}
            >
              <option>16:9</option>
              <option>9:16</option>
            </select>
          </label>
          <label>
            Caption preset
            <select
              aria-label="Video caption preset"
              className="editor-input w-full"
              value={preset}
              onChange={(e) => setPreset(presetSchema.parse(e.target.value))}
            >
              {presetSchema.options.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Target scene seconds
            <input
              className="editor-input w-full"
              aria-label="Target scene seconds"
              type="number"
              min={2}
              max={20}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>
          <label className="col-span-2">
            Visual style instructions
            <textarea
              className="editor-input w-full"
              maxLength={2000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
        </fieldset>
        <details>
          <summary>Media descriptions and tags used for matching</summary>
          {visuals.map((a) => (
            <label className="block py-1" key={a.id}>
              {a.filename}
              <textarea
                aria-label={`Description ${a.filename}`}
                className="editor-input w-full"
                maxLength={8000}
                disabled={busy || !!plan}
                value={metadata[a.id]?.description ?? ""}
                onChange={(e) =>
                  setMetadata((m) => ({
                    ...m,
                    [a.id]: { description: e.target.value, tags: m[a.id]?.tags ?? [] },
                  }))
                }
              />
              <span>{metadata[a.id]?.tags.join(", ")}</span>
            </label>
          ))}
        </details>
        <button
          className="editor-primary"
          disabled={busy || !assetId || !visuals.length}
          onClick={() => void generate()}
        >
          {plan ? "Regenerate scene plan" : "Generate video plan"}
        </button>
        {!visuals.length && <p>Import images or video before generating a plan.</p>}
        {job && (
          <p role="status">
            {job.state}: {job.stage}
          </p>
        )}
        {busy && (
          <button
            className="editor-secondary"
            onClick={() => {
              preparationId.current++;
              setPreparing(false);
              void cancel();
            }}
          >
            Cancel AI task
          </button>
        )}
        {(error || message) && <p role="alert">{error || message}</p>}
        {plan && (
          <section aria-label="Video plan review" className="space-y-4">
            <p>
              {plan.scenes.length} scenes / {plan.duration.toFixed(2)} s / {plan.aspectRatio}. Exact
              narration timing is controlled by the transcript, not the model.
            </p>
            {plan.scenes.map((s, i) => {
              const matches = matchMedia(s, assets, metadata),
                match = matches.find((m) => m.assetId === s.assetId);
              return (
                <article
                  key={s.id}
                  className="space-y-2 rounded border border-[var(--editor-border)] p-3"
                >
                  <h3>
                    Scene {i + 1} / {s.start.toFixed(2)} / {s.end.toFixed(2)} s
                  </h3>
                  <p>{s.narration || "Narration pause"}</p>
                  <label>
                    Visual description
                    <textarea
                      aria-label={`Video visual ${i + 1}`}
                      className="editor-input w-full"
                      value={s.visualDescription}
                      maxLength={2000}
                      onChange={(e) => changeScene(s.id, { visualDescription: e.target.value })}
                    />
                  </label>
                  <p>
                    Requires {s.assetType} / keywords: {s.keywords.join(", ")}
                  </p>
                  <select
                    aria-label={`Video asset ${i + 1}`}
                    className="editor-input w-full"
                    value={s.assetId ?? ""}
                    onChange={(e) => changeScene(s.id, { assetId: e.target.value || null })}
                  >
                    <option value="">Unresolved / choose a visual</option>
                    {matches.map((m) => (
                      <option
                        key={m.assetId}
                        value={m.assetId}
                        disabled={m.reasons.some((r) => r.startsWith("Too short"))}
                      >
                        {assets.find((a) => a.id === m.assetId)?.filename} /{" "}
                        {Math.round(m.score * 100)}% lexical confidence
                      </option>
                    ))}
                  </select>
                  <p>
                    {match
                      ? match.reasons.join("  /  ")
                      : "Unresolved placeholder: no asset approved."}
                    {match && !match.suitable
                      ? " Manual choice; relevance is not established."
                      : ""}
                  </p>
                  <label>
                    Animation
                    <select
                      aria-label={`Video animation ${i + 1}`}
                      className="editor-input"
                      value={s.animation}
                      onChange={(e) =>
                        changeScene(s.id, {
                          animation:
                            e.target.value === "documentary-zoom"
                              ? "documentary-zoom"
                              : e.target.value === "pan"
                                ? "pan"
                                : e.target.value === "fade-in"
                                  ? "fade-in"
                                  : "none",
                        })
                      }
                    >
                      {["none", "fade-in", "pan", "documentary-zoom"].map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Transition
                    <select
                      className="editor-input"
                      value={s.transition ?? "cut"}
                      onChange={(e) =>
                        changeScene(s.id, {
                          transition: e.target.value === "fade-in" ? "fade-in" : "cut",
                        })
                      }
                    >
                      <option value="cut">Cut</option>
                      <option value="fade-in">Fade in (when no motion preset)</option>
                    </select>
                  </label>
                </article>
              );
            })}
            <label className="block">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />{" "}
              I approve the scene plan and all asset matches, including manual choices.
            </label>
            {project.duration > 0 && (
              <label className="block">
                <input
                  aria-label="Replace existing timeline"
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />{" "}
                Replace the existing timeline with this video. Media files and library remain; Undo
                restores the timeline.
              </label>
            )}
            <button
              className="editor-primary"
              disabled={
                busy ||
                !approved ||
                !transcript ||
                !range ||
                plan.scenes.some((s) => !s.assetId) ||
                (project.duration > 0 && !replace)
              }
              onClick={async () => {
                try {
                  if (!transcript || !range) return;
                  setPreparing(true);
                  const info = await inspectAudio(transcript.assetId);
                  if (!dialog.current?.open) return;
                  if (
                    info.size !== transcript.source.size ||
                    info.modifiedAt !== transcript.source.modifiedAt
                  )
                    throw new Error("Narration changed on disk. Generate a new plan.");
                  if (onApply(plan, transcript, { range, preset, replace }, baseline.current))
                    onClose();
                  else
                    setMessage(
                      "Assembly was rejected. Check the editor message; reopen the workflow if the project changed.",
                    );
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "Assembly failed.");
                } finally {
                  setPreparing(false);
                }
              }}
            >
              Assemble video
            </button>
          </section>
        )}
      </div>
    </dialog>
  );
}
