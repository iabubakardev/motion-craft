"use client";
import { useEffect, useState, useRef } from "react";
import type { Project } from "@/core/project/types";
import { cancelRender, renderStatus, startRender, renderAvailable } from "@/platform/render";
import type { RenderJob } from "@/platform/render";
const terminal = new Set(["completed", "failed", "cancelled"]);
export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    [job, setJob] = useState<RenderJob | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const available = renderAvailable(),
    active = !!job && !terminal.has(job.state);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!available) return;
    let disposed = false,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const status = await renderStatus();
        if (!disposed) setJob(status);
      } catch {
        if (!disposed) setError("Could not read rendering status.");
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 300);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [available]);
  async function start() {
    setError("");
    setPending(true);
    try {
      setJob(await startRender(project));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Export could not start.");
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-label="Export video"
      onCancel={(event) => {
        if (active || pending) event.preventDefault();
        else onClose();
      }}
      className="m-auto w-[460px] max-w-[95vw] rounded border border-slate-600 bg-[var(--editor-panel)] p-5 text-[var(--editor-text)] backdrop:bg-black/60"
    >
      <h2 className="mb-4 text-sm font-medium">Export video</h2>
      <p className="text-xs">
        MP4 / H.264 / AAC audio
        <br />
        {project.resolution.width} x {project.resolution.height} at {project.fps} fps
        <br />
        {project.duration.toFixed(2)} seconds
      </p>
      <p className="my-3 text-[11px] text-[var(--editor-muted)]">
        Choose the output destination in the Windows Save dialog. Export uses a snapshot of the
        project when started; subsequent edits do not change that job.
      </p>
      <p className="my-2 text-[10px] text-[var(--editor-muted)]">
        Scene transitions and style presets are not applied in this milestone.
      </p>
      {!available && <p role="status">Open the Electron desktop app to export.</p>}
      {job && (
        <div className="my-3 text-xs" role="status">
          <p>Output: {job.filename}</p>
          <p data-testid="render-state">{job.state}</p>
          <progress
            aria-label="Rendering progress"
            className="my-2 w-full"
            max={1}
            value={job.progress}
          />
          <p>
            {Math.round(job.progress * 100)}% - {job.message}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="my-3 text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="editor-secondary" disabled={pending} onClick={onClose}>
          {active ? "Hide" : "Close"}
        </button>
        {active ? (
          <button
            className="editor-secondary"
            disabled={job.state === "cancelling"}
            onClick={() => {
              void cancelRender(job.id)
                .then(setJob)
                .catch(() => setError("Cancellation failed. Try again."));
            }}
          >
            Cancel export
          </button>
        ) : (
          <button
            className="editor-primary"
            disabled={!available || pending || !project.duration}
            onClick={() => void start()}
          >
            {pending ? "Choosing destination..." : "Export MP4"}
          </button>
        )}
      </div>
    </dialog>
  );
}
