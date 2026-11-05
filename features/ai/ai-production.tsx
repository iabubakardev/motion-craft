"use client";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { Project, ProjectAsset } from "@/core/project/types";
import { planSchema, transcriptSchema, settingsSchema } from "@/core/ai/schema.cjs";
import type { runtimeSchema } from "@/core/ai/schema.cjs";
import { rankAssets, suggestAssets } from "@/core/ai/planning.cjs";
import { isAIAvailable } from "@/platform/ai";
import { AssetSearch } from "@/features/media/asset-search";
import { StylePackPicker } from "./style-pack-picker";
import type { StylePack } from "./style-pack-picker";
import { useAIJob } from "./use-ai-job";
type Plan = z.infer<typeof planSchema>;
type Transcript = z.infer<typeof transcriptSchema>;
const defaults = {
  minSeconds: 2,
  maxSeconds: 12,
  wordsPerMinute: 150,
  instructions: "",
  temperature: 0.2,
};
export function AIProduction({
  project,
  availableAssets,
  onApply,
  onClose,
}: {
  project: Project;
  availableAssets: ProjectAsset[];
  onApply: (plan: Plan, expected: Project) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    consumed = useRef<string | null>(null);
  const [stylePack, setStylePack] = useState<StylePack | null>(null);
  const [matchSceneId, setMatchSceneId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(project);
  const { job, error, running, start, cancel } = useAIJob();
  const [runtime, setRuntime] = useState<z.infer<typeof runtimeSchema> | null>(null),
    [model, setModel] = useState(""),
    [whisperModel, setWhisperModel] = useState(""),
    [assetId, setAssetId] = useState(""),
    [script, setScript] = useState(""),
    [language, setLanguage] = useState(""),
    [transcript, setTranscript] = useState<Transcript | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [json, setJSON] = useState(""),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [inputKind, setInputKind] = useState<"script" | "narration">("script");
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  useEffect(() => {
    if (!isAIAvailable()) return;
    const timer = setTimeout(() => void start({ kind: "detect" }), 0);
    return () => clearTimeout(timer);
  }, [start]);
  useEffect(() => {
    if (job?.state !== "completed" || !job.result || consumed.current === job.id) return;
    consumed.current = job.id;
    const result = job.result;
    queueMicrotask(() => {
      if (result.kind === "runtime") {
        setRuntime(result.runtime);
        setModel((current) =>
          result.runtime.ollama.models.includes(current)
            ? current
            : result.runtime.ollama.models[0] || "",
        );
        setWhisperModel((current) =>
          result.runtime.whisper.models.includes(current)
            ? current
            : result.runtime.whisper.models[0] || "",
        );
      } else if (result.kind === "transcript") {
        setTranscript(result.transcript);
        setPlan(null);
        setConfirmed(false);
      } else if (result.kind === "plan") {
        setPlan(
          suggestAssets(
            {
              ...result.plan,
              scenes: result.plan.scenes.map((scene) => ({
                ...scene,
                animation:
                  scene.animation === "none" && stylePack
                    ? stylePack.animationDefault
                    : scene.animation,
              })),
            },
            availableAssets,
          ),
        );
        setConfirmed(false);
      }
    });
  }, [job, availableAssets, stylePack]);
  const download = (value: unknown, name: string) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJSON = () => {
    try {
      if (new TextEncoder().encode(json).length > 5 * 1024 * 1024)
        throw new Error("AI JSON exceeds 5 MB.");
      const raw: unknown = JSON.parse(json);
      const t = transcriptSchema.safeParse(raw);
      if (t.success) {
        setTranscript(t.data);
        setInputKind("narration");
        setAssetId(t.data.sourceAssetId);
        setPlan(null);
      } else {
        setPlan(planSchema.parse(raw));
        setBaseline(project);
      }
      setConfirmed(false);
      setMessage("Validated. Review the result before applying.");
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Invalid AI JSON");
    }
  };
  const changeScene = (id: string, patch: Partial<Plan["scenes"][number]>) => {
    setPlan((current) =>
      current
        ? {
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.id === id ? { ...scene, ...patch } : scene,
            ),
          }
        : current,
    );
    setConfirmed(false);
  };
  const matchScene = plan?.scenes.find((scene) => scene.id === matchSceneId);
  const unavailable =
    !!plan &&
    (plan.scenes.some(
      (scene) => scene.assetId && !availableAssets.some((asset) => asset.id === scene.assetId),
    ) ||
      (!!plan.transcript &&
        !availableAssets.some(
          (asset) => asset.id === plan.transcript?.sourceAssetId && asset.type === "audio",
        )));
  return (
    <dialog
      ref={dialog}
      aria-label="AI Production"
      className="project-settings-dialog !w-[min(960px,95vw)] !max-w-none"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {matchScene && (
        <AssetSearch
          assets={availableAssets.map((asset) => ({
            ...asset,
            url: `motioncraft-media://asset/${asset.id}`,
            status: "ready",
          }))}
          selectedId={matchScene.assetId}
          initialQuery={`${matchScene.visualDescription} ${matchScene.keywords.join(" ")}`}
          aspectRatio={project.resolution.width / project.resolution.height}
          targetDuration={matchScene.end - matchScene.start}
          onSelect={(id) => changeScene(matchScene.id, { assetId: id })}
          onClose={() => setMatchSceneId(null)}
        />
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">AI Production</h2>
        <button className="editor-icon-button" aria-label="Close AI Production" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="my-3 text-xs text-[var(--editor-muted)]">
        Local inference · review before appending · existing edits stay in place
      </p>
      <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-2 text-xs">
        <section aria-label="Local AI runtime" className="space-y-2">
          <h3 className="font-semibold">1. Local models</h3>
          <button
            className="editor-secondary"
            disabled={running || !isAIAvailable()}
            onClick={() => start({ kind: "detect" })}
          >
            Detect local AI
          </button>
          {!isAIAvailable() && (
            <p>
              {typeof window !== "undefined" && window.motioncraft
                ? "Restart Electron to load the local AI bridge. Reloading the page alone does not update preload capabilities."
                : "Open Electron for local inference. External JSON review and apply are available here."}
            </p>
          )}
          {runtime && (
            <>
              <p role="status" aria-label="Ollama connection status">
                {runtime.ollama.running
                  ? `Connected to Ollama${runtime.ollama.version ? ` ${runtime.ollama.version}` : ""}. `
                  : ""}
                {runtime.ollama.message}
              </p>
              <p>
                {runtime.whisper.message} {runtime.whisper.models.length} transcription models.
              </p>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label>
              Ollama model
              <select
                aria-label="Ollama model"
                className="editor-input mt-1 w-full"
                value={model}
                disabled={running || !runtime?.ollama.models.length}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">
                  {runtime?.ollama.running && !runtime.ollama.models.length
                    ? "No local models installed"
                    : "Select installed model"}
                </option>
                {runtime?.ollama.models.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Transcription model (CPU int8)
              <select
                aria-label="Transcription model"
                className="editor-input mt-1 w-full"
                value={whisperModel}
                disabled={running}
                onChange={(e) => setWhisperModel(e.target.value)}
              >
                <option value="">Select local model</option>
                {runtime?.whisper.models.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section aria-label="AI input" className="space-y-2">
          <h3 className="font-semibold">2. Narration or script</h3>
          <select
            className="editor-input"
            aria-label="AI input type"
            disabled={running}
            value={inputKind}
            onChange={(e) => {
              setInputKind(e.target.value === "script" ? "script" : "narration");
              setPlan(null);
              setConfirmed(false);
            }}
          >
            <option value="script">Script (estimated timing)</option>
            <option value="narration">Narration (source timestamps)</option>
          </select>
          {inputKind === "script" ? (
            <textarea
              aria-label="AI script"
              rows={4}
              maxLength={50000}
              className="editor-input w-full"
              disabled={running}
              value={script}
              onChange={(e) => {
                setScript(e.target.value);
                setPlan(null);
                setConfirmed(false);
              }}
            />
          ) : (
            <>
              <select
                aria-label="Narration asset"
                className="editor-input w-full"
                value={assetId}
                disabled={running}
                onChange={(e) => {
                  setAssetId(e.target.value);
                  setTranscript(null);
                  setPlan(null);
                }}
              >
                <option value="">Choose imported MP3/WAV</option>
                {availableAssets
                  .filter((a) => a.type === "audio")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.filename}
                    </option>
                  ))}
              </select>
              <label>
                Language code (blank = detect)
                <input
                  aria-label="Transcription language"
                  maxLength={3}
                  className="editor-input ml-2 w-20"
                  value={language}
                  disabled={running}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </label>
              <button
                className="editor-secondary"
                disabled={running || !assetId || !whisperModel || !!transcript}
                onClick={() => {
                  setMessage("");
                  start({
                    kind: "transcribe",
                    assetId,
                    model: whisperModel,
                    language: language.trim() || null,
                  });
                }}
              >
                Transcribe locally
              </button>
              {transcript && (
                <button
                  className="editor-secondary"
                  disabled={running}
                  onClick={() => {
                    setTranscript(null);
                    setPlan(null);
                    setConfirmed(false);
                  }}
                >
                  Discard transcript draft and plan
                </button>
              )}
            </>
          )}
          {transcript && inputKind === "narration" && (
            <div className="space-y-2">
              <p>
                {transcript.language} · {transcript.duration.toFixed(3)} s · source timestamps
                retained. Correcting a segment clears its word alignment.
              </p>
              {transcript.segments.map((segment) => (
                <label className="block" key={segment.id}>
                  {segment.start.toFixed(3)}–{segment.end.toFixed(3)} s
                  <textarea
                    aria-label={`Transcript ${segment.id}`}
                    rows={2}
                    disabled={running}
                    className="editor-input w-full"
                    value={segment.text}
                    onChange={(e) => {
                      const text = e.target.value;
                      setTranscript((current) => {
                        if (!current) return current;
                        const segments = current.segments.map((s) => {
                          if (s.id !== segment.id) return s;
                          const { words: unused, ...rest } = s;
                          void unused;
                          return { ...rest, text };
                        });
                        return {
                          ...current,
                          segments,
                          text: segments.map((s) => s.text).join(" "),
                        };
                      });
                      setPlan(null);
                      setConfirmed(false);
                    }}
                  />
                </label>
              ))}
              <button
                className="editor-secondary"
                onClick={() => download(transcript, "transcript.motioncraft-ai.json")}
              >
                Save transcript JSON
              </button>
            </div>
          )}
        </section>
        <StylePackPicker value={stylePack} onChange={setStylePack} disabled={running} />
        <form
          aria-label="Scene planning settings"
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage("");
            try {
              const data = new FormData(e.currentTarget);
              const settings = settingsSchema.parse({
                ...defaults,
                fps: project.fps,
                aspectRatio: project.aspectRatio,
                style: data.get("style"),
                minSeconds: Number(data.get("minimum")),
                maxSeconds: Number(data.get("maximum")),
                wordsPerMinute: Number(data.get("wpm")),
                instructions: [
                  stylePack?.planningGuidance,
                  ...(stylePack?.visualPreferences || []),
                  String(data.get("instructions")),
                ]
                  .filter(Boolean)
                  .join("\n"),
                temperature: Number(data.get("temperature")),
              });
              setBaseline(project);
              setPlan(null);
              setConfirmed(false);
              start({
                kind: "plan",
                model,
                input:
                  inputKind === "narration" && transcript
                    ? { kind: "transcript", transcript: transcriptSchema.parse(transcript) }
                    : { kind: "script", text: script },
                settings,
              });
            } catch (failure) {
              setMessage(failure instanceof Error ? failure.message : "Invalid planning input");
            }
          }}
        >
          <h3 className="col-span-2 font-semibold">3. Scene planning</h3>
          <p className="col-span-2">
            Uses the project’s {project.aspectRatio} canvas at {project.fps} fps. Audio timing is
            authoritative; script timing is estimated.
          </p>
          <label>
            Style
            <select
              name="style"
              aria-label="AI visual style"
              className="editor-input w-full"
              defaultValue={project.stylePreset}
            >
              {["default", "minimal", "cinematic", "bold"].map((style) => (
                <option key={style}>{style}</option>
              ))}
            </select>
          </label>
          <label>
            Estimated words/min
            <input
              name="wpm"
              className="editor-input w-full"
              type="number"
              min={80}
              max={240}
              defaultValue={150}
            />
          </label>
          <label>
            Minimum scene seconds
            <input
              name="minimum"
              className="editor-input w-full"
              type="number"
              min={1}
              max={15}
              defaultValue={2}
            />
          </label>
          <label>
            Maximum scene seconds
            <input
              name="maximum"
              className="editor-input w-full"
              type="number"
              min={2}
              max={30}
              defaultValue={12}
            />
          </label>
          <label>
            Temperature
            <input
              name="temperature"
              className="editor-input w-full"
              type="number"
              min={0}
              max={1}
              step={0.1}
              defaultValue={0.2}
            />
          </label>
          <label className="col-span-2">
            Creative instructions
            <textarea
              className="editor-input w-full"
              name="instructions"
              maxLength={2000}
              rows={2}
            />
          </label>
          <button
            className="editor-primary col-span-2"
            disabled={
              running || !model || (inputKind === "narration" ? !transcript : !script.trim())
            }
          >
            {plan ? "Regenerate and replace draft" : "Generate scene plan"}
          </button>
        </form>
        {job && (
          <div role="status" className="space-y-2">
            <p>
              {job.state}: {job.stage}
            </p>
            {job.progress !== null && <progress className="w-full" max={1} value={job.progress} />}{" "}
            {running && (
              <button className="editor-secondary" onClick={() => void cancel()}>
                Cancel AI task
              </button>
            )}
          </div>
        )}
        {(error || message) && (
          <p role="alert" className="whitespace-pre-wrap text-amber-200">
            {error || message}
          </p>
        )}
        <details>
          <summary>External scene-plan / transcript JSON</summary>
          <textarea
            aria-label="AI JSON"
            rows={5}
            className="editor-input mt-2 w-full"
            maxLength={5 * 1024 * 1024}
            value={json}
            disabled={running}
            onChange={(e) => setJSON(e.target.value)}
          />
          <input
            aria-label="Upload AI JSON"
            type="file"
            accept="application/json,.json"
            disabled={running}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                setMessage("AI JSON exceeds 5 MB.");
                return;
              }
              try {
                setJSON(await file.text());
              } catch {
                setMessage("Unable to read the selected AI JSON file.");
              }
            }}
          />
          <button className="editor-secondary" disabled={running || !json} onClick={importJSON}>
            Validate AI JSON
          </button>
        </details>
        {plan && (
          <section aria-label="AI plan review" className="space-y-3">
            <h3 className="font-semibold">4. Review visuals and assets</h3>
            <p>
              {plan.scenes.length} scenes · {plan.duration.toFixed(2)} seconds ·{" "}
              {plan.timing === "estimated"
                ? "Estimated script timing; no captions or narration audio"
                : "Source narration timing; editable captions on V4"}
              .
            </p>
            <p className="text-[var(--editor-muted)]">
              Matching uses filenames, type, duration and dimensions. It does not analyze image
              content. Unmatched scenes keep the project background.
            </p>
            {plan.scenes.map((scene, i) => (
              <article
                key={scene.id}
                className="space-y-2 rounded border border-[var(--editor-border)] p-3"
              >
                <h4>
                  Scene {i + 1}: {scene.start.toFixed(2)}–{scene.end.toFixed(2)} s
                </h4>
                <p>{scene.narration}</p>
                <label className="block">
                  Visual description
                  <textarea
                    aria-label={`Visual description ${i + 1}`}
                    className="editor-input w-full"
                    rows={2}
                    maxLength={2000}
                    value={scene.visualDescription}
                    onChange={(e) => changeScene(scene.id, { visualDescription: e.target.value })}
                  />
                </label>
                <p>{scene.keywords.join(", ")}</p>
                <select
                  aria-label={`Asset for scene ${i + 1}`}
                  className="editor-input w-full"
                  value={scene.assetId || ""}
                  onChange={(e) => changeScene(scene.id, { assetId: e.target.value || null })}
                >
                  <option value="">Unmatched / background</option>
                  {scene.assetId &&
                    !availableAssets.some((asset) => asset.id === scene.assetId) && (
                      <option value={scene.assetId} disabled>
                        Unavailable asset ? choose a replacement
                      </option>
                    )}
                  {availableAssets
                    .filter((a) => a.type !== "audio")
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.filename}
                      </option>
                    ))}
                </select>
                <ul className="text-[10px] text-[var(--editor-muted)]">
                  {rankAssets(scene, availableAssets, plan.aspectRatio)
                    .slice(0, 3)
                    .map((candidate) => (
                      <li key={candidate.assetId}>
                        {availableAssets.find((a) => a.id === candidate.assetId)?.filename}:{" "}
                        {Math.round(candidate.score * 100)}% metadata score —{" "}
                        {candidate.reasons.join("; ")}
                      </li>
                    ))}
                </ul>
                <button
                  type="button"
                  className="editor-secondary"
                  disabled={running}
                  onClick={() => setMatchSceneId(scene.id)}
                >
                  Find indexed assets for this scene
                </button>
                <p>Animation: {scene.animation}</p>
              </article>
            ))}
            <button
              className="editor-secondary"
              onClick={() => download(plan, "plan.motioncraft-ai.json")}
            >
              Save scene-plan JSON
            </button>
            <h3 className="font-semibold">5. Apply to timeline</h3>
            {unavailable && (
              <p role="alert">
                Relink the original narration or replace unavailable visual assets before applying.
              </p>
            )}
            <p>
              Appends after {baseline.duration.toFixed(2)} s in one undoable edit. V1 receives
              visuals; V4 receives timestamped captions; A1 receives original narration. Short
              footage leaves background after its end. Existing scenes are retained.
            </p>
            <label className="flex items-start gap-2">
              <input
                aria-label="Approve AI plan"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the timing, descriptions and asset choices and approve appending this plan.
            </label>
            <button
              className="editor-primary w-full"
              disabled={!confirmed || running || unavailable}
              onClick={() => {
                try {
                  if (onApply(planSchema.parse(plan), baseline)) onClose();
                  else
                    setMessage(
                      "The plan was not applied. Check project errors; existing edits were retained.",
                    );
                } catch (failure) {
                  setMessage(failure instanceof Error ? failure.message : "Invalid plan");
                }
              }}
            >
              Append approved plan
            </button>
          </section>
        )}
      </div>
    </dialog>
  );
}
