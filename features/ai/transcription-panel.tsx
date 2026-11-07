"use client";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { Project } from "@/core/project/types";
import type { MediaAsset } from "@/core/media/types";
import {
  transcriptSchema,
  modelSchema,
  deviceSchema,
  computeSchema,
} from "@/core/transcription/schema.cjs";
import { editTranscript } from "@/core/transcription/commands.cjs";
import { transcriptionSettings, configureTranscription } from "@/platform/transcription";
import { useAIJob } from "@/features/ai/use-ai-job";
type Transcript = z.infer<typeof transcriptSchema>;
export function TranscriptionPanel({
  project,
  assets,
  onClose,
  onImport,
  importing,
  onSave,
  onCaptions,
}: {
  project: Project;
  assets: MediaAsset[];
  onClose: () => void;
  onImport: () => Promise<MediaAsset[] | undefined>;
  importing: boolean;
  onSave: (transcript: Transcript, expected: Project) => boolean;
  onCaptions: (transcript: Transcript, expected: Project, offset: number) => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    media = useRef<HTMLMediaElement>(null),
    consumed = useRef<string | null>(null);
  const [settings, setSettings] = useState<Awaited<
      ReturnType<typeof transcriptionSettings>
    > | null>(null),
    [message, setMessage] = useState(""),
    [configuring, setConfiguring] = useState(false);
  const [model, setModel] = useState<z.infer<typeof modelSchema>>("tiny"),
    [device, setDevice] = useState<z.infer<typeof deviceSchema>>("cpu"),
    [compute, setCompute] = useState<z.infer<typeof computeSchema>>("int8");
  const [assetId, setAssetId] = useState(assets.find((a) => a.type !== "image")?.id || ""),
    [draft, setDraft] = useState<Transcript | null>(null),
    [baseline, setBaseline] = useState(project),
    [offset, setOffset] = useState(0);
  const { job, error, running, start, cancel } = useAIJob();
  const asset = assets.find((a) => a.id === assetId);
  const startIssues = [
    running ? "A transcription job is running. Wait for it to finish or cancel it." : "",
    configuring ? "Wait for worker configuration to finish." : "",
    !settings ? "Checking worker configuration. Please wait." : "",
    settings && !settings.available
      ? `${settings.message} Open Advanced settings and use Choose Python and worker to select both files. If the desktop bridge is unavailable, restart Electron first.`
      : "",
    !asset
      ? "Select an imported audio or video in Audio source, or use Choose audio file to browse your computer."
      : "",
    asset?.status === "error"
      ? "The selected source is unavailable. Relink or reimport it, then select it again."
      : "",
  ].filter(Boolean);
  useEffect(() => {
    const currentDialog = dialog.current;
    currentDialog?.showModal();
    let obsolete = false;
    void transcriptionSettings()
      .then((value) => {
        if (obsolete) return;
        setSettings(value);
        if (value.config) {
          setModel(value.config.model);
          setDevice(value.config.device);
          setCompute(value.config.computeType);
        }
      })
      .catch(() => {
        if (!obsolete) {
          const message = "Could not read worker settings. Restart Electron and try again.";
          setSettings({ config: null, available: false, message });
          setMessage(message);
        }
      });
    return () => {
      obsolete = true;
      currentDialog?.close();
    };
  }, []);
  useEffect(() => {
    if (
      job?.state !== "completed" ||
      job.result?.kind !== "transcription" ||
      consumed.current === job.id
    )
      return;
    const result = job.result.transcript;
    consumed.current = job.id;
    queueMicrotask(() => setDraft(result));
  }, [job]);
  async function configure(choosePaths: boolean) {
    setConfiguring(true);
    setMessage("");
    try {
      setSettings(
        await configureTranscription({ model, device, computeType: compute }, choosePaths),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Configuration failed");
    } finally {
      setConfiguring(false);
    }
  }
  function saved() {
    if (!draft) return;
    try {
      if (onSave(transcriptSchema.parse(draft), baseline)) onClose();
      else
        setMessage(
          "Transcript was not saved. Check project errors and reopen review if the project changed.",
        );
    } catch {
      setMessage("Correct invalid transcript fields before saving.");
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-label="Transcription"
      className="project-settings-dialog !w-[min(900px,95vw)] !max-w-none max-h-[90vh] overflow-y-auto"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="space-y-4 p-5">
        <div className="flex justify-between">
          <h2 className="text-lg font-semibold">Transcription</h2>
          <button className="editor-secondary" onClick={onClose}>
            Close transcription
          </button>
        </div>
        <button
          className="editor-secondary"
          disabled={running || importing}
          onClick={async () => {
            const selected = await onImport();
            if (!dialog.current?.open || !selected) return;
            const source = selected.find(
              (item) => (item.type === "audio" || item.type === "video") && item.status !== "error",
            );
            if (!source) {
              setMessage("Choose an audio or video file for transcription.");
              return;
            }
            setAssetId(source.id);
            setDraft(null);
            setMessage("");
          }}
        >
          {importing ? "Selecting..." : "Choose audio file"}
        </button>
        {!assets.some((a) => a.type === "audio" || a.type === "video") && (
          <p>Choose an audio file from your computer to get started.</p>
        )}
        <label className="block">
          Audio source
          <select
            aria-label="Transcription source"
            className="editor-input w-full"
            disabled={running}
            value={assetId}
            onChange={(e) => {
              setAssetId(e.target.value);
              setDraft(null);
              setMessage("");
            }}
          >
            <option value="">Select audio or video</option>
            {assets
              .filter((a) => a.type === "audio" || a.type === "video")
              .map((a) => (
                <option key={a.id} value={a.id} disabled={a.status === "error"}>
                  {a.filename}
                  {a.status === "error" ? " (unavailable; relink source)" : ""}
                </option>
              ))}
          </select>
        </label>
        {asset && (
          <div className="space-y-2">
            <p className="break-words text-sm">{asset.filename}</p>
            {asset.type === "audio" ? (
              <audio
                key={asset.id}
                aria-label="Transcription source preview"
                ref={(element) => {
                  media.current = element;
                }}
                src={asset.url}
                controls
                className="block h-12 w-full"
              />
            ) : (
              <video
                key={asset.id}
                aria-label="Transcription source preview"
                ref={(element) => {
                  media.current = element;
                }}
                src={asset.url}
                controls
                className="block max-h-48 w-full"
              />
            )}
          </div>
        )}
        <details className="text-xs" aria-label="Advanced transcription settings">
          <summary className="cursor-pointer">Advanced settings</summary>
          <fieldset disabled={running || configuring} className="space-y-2">
            <legend>External Python worker settings</legend>
            <p role="status">{settings?.message || "Checking worker configuration…"}</p>
            {settings?.config && (
              <div className="space-y-2">
                <p role="status">
                  Python and worker selected. You can start transcription after selecting a source.
                </p>
                <label className="block">
                  Python interpreter
                  <input
                    aria-label="Selected transcription Python"
                    className="editor-input w-full"
                    value={settings.config.pythonPath}
                    readOnly
                  />
                </label>
                <label className="block">
                  Worker entrypoint
                  <input
                    aria-label="Selected transcription worker"
                    className="editor-input w-full"
                    value={settings.config.workerPath}
                    readOnly
                  />
                </label>
              </div>
            )}
            <label className="block">
              Model
              <select
                aria-label="Transcription model"
                className="editor-input w-full"
                value={model}
                onChange={(e) => setModel(modelSchema.parse(e.target.value))}
              >
                {modelSchema.options.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Device
              <select
                aria-label="Transcription device"
                className="editor-input w-full"
                value={device}
                onChange={(e) => setDevice(deviceSchema.parse(e.target.value))}
              >
                {deviceSchema.options.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Compute type
              <select
                aria-label="Transcription compute"
                className="editor-input w-full"
                value={compute}
                onChange={(e) => setCompute(computeSchema.parse(e.target.value))}
              >
                {computeSchema.options.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <p className="text-xs">
              CPU / int8 is the verified baseline. CUDA and auto require compatible local hardware.
              Models must already be cached; transcription never downloads them.
            </p>
            <button className="editor-secondary" onClick={() => void configure(true)}>
              {settings?.available ? "Change Python and worker" : "Choose Python and worker"}
            </button>
            <button
              className="editor-secondary"
              disabled={!settings?.available}
              onClick={() => void configure(false)}
            >
              Save transcription defaults
            </button>
          </fieldset>
        </details>
        <button
          className="editor-primary"
          disabled={startIssues.length > 0}
          aria-describedby="transcription-start-help"
          onClick={() => {
            setBaseline(project);
            setDraft(null);
            setMessage("");
            void start({ kind: "transcription", assetId, model, device, computeType: compute });
          }}
        >
          Start transcription
        </button>
        <div id="transcription-start-help" role="status" className="text-xs">
          {startIssues.length ? (
            <ul className="list-disc pl-5">
              {startIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p>
              Ready to start with {model} / {device} / {compute}. Python dependencies and the cached
              model are checked when the worker starts; no downloads are automatic.
            </p>
          )}
        </div>
        {job?.state === "failed" && (
          <p role="alert">Transcription could not complete: {job.stage}</p>
        )}
        {running && (
          <button
            className="editor-secondary"
            onClick={() =>
              void cancel().catch(() =>
                setMessage("Cancellation failed. Close the panel to release the job."),
              )
            }
          >
            Cancel transcription
          </button>
        )}
        {job && (
          <p role="status">
            {job.state}: {job.stage}
          </p>
        )}
        {(message || error) && <p role="alert">{message || error}</p>}
        <div className="space-y-2">
          <h3>Saved transcripts for this source</h3>
          {project.transcripts
            ?.filter((t) => t.assetId === assetId)
            .map((t) => (
              <button
                key={t.id}
                className="editor-secondary"
                disabled={running}
                onClick={() => {
                  setDraft(t);
                  setBaseline(project);
                }}
              >
                {t.result.model} · {t.result.segments.length} segments · Review saved transcript
              </button>
            ))}
        </div>
        {draft && (
          <section aria-label="Transcript review" className="space-y-3">
            <h3>Review transcript</h3>
            <p>
              {draft.result.language} · {draft.result.duration.toFixed(2)} seconds ·{" "}
              {draft.result.execution.actualDevice} / {draft.result.execution.actualComputeType}
            </p>
            {!draft.result.segments.length && (
              <p>
                No speech was detected. You can save this result; there are no captions to create.
              </p>
            )}
            {draft.result.segments.map((segment) => (
              <article key={segment.id}>
                <button
                  className="editor-secondary"
                  aria-label={`Seek transcript segment ${segment.id}`}
                  onClick={() => {
                    if (media.current) {
                      media.current.currentTime = segment.start;
                      media.current.pause();
                    }
                  }}
                >
                  {segment.start.toFixed(2)}–{segment.end.toFixed(2)} s
                </button>
                <textarea
                  aria-label={`Transcript text ${segment.id}`}
                  rows={2}
                  className="editor-input w-full"
                  value={segment.text}
                  maxLength={10000}
                  onChange={(e) => {
                    try {
                      setDraft(editTranscript(draft, segment.id, e.target.value));
                    } catch {
                      setMessage("Transcript text is invalid.");
                    }
                  }}
                />
              </article>
            ))}
            <label className="block">
              Caption offset (project frames)
              <input
                aria-label="Caption offset frames"
                className="editor-input"
                type="number"
                min={0}
                step={1}
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
            </label>
            <p className="text-xs">
              Place source media on the timeline separately. Captions start at source timestamps
              plus this offset. Existing captions are preserved. Generating twice from the same
              saved transcript is rejected while its clips remain.
            </p>
            <button className="editor-secondary" onClick={saved}>
              Save reviewed transcript
            </button>
            <button
              className="editor-primary"
              disabled={!draft.result.segments.length || running}
              onClick={() => {
                try {
                  if (onCaptions(transcriptSchema.parse(draft), baseline, offset)) onClose();
                  else
                    setMessage(
                      "Captions were not created. Check project errors, existing captions and track locks.",
                    );
                } catch {
                  setMessage(
                    "Correct invalid transcript fields and offset before generating captions.",
                  );
                }
              }}
            >
              Generate Captions
            </button>
          </section>
        )}
      </div>
    </dialog>
  );
}
