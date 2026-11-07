"use client";
import { useEffect, useRef } from "react";
import type { TranscriptionSource } from "@/core/transcription/source";
export function TranscriptionSourceChoice({
  sources,
  onChoose,
  onClose,
}: {
  sources: TranscriptionSource[];
  onChoose: (source: TranscriptionSource) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Choose transcription source"
      className="project-settings-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2>Choose transcription source</h2>
      <p className="my-3 text-xs">
        Multiple compatible clips are selected. Choose the clip to transcribe.
      </p>
      <div className="space-y-2">
        {sources.map((s) => (
          <button
            key={s.clipId || s.assetId}
            className="editor-secondary block w-full text-left"
            onClick={() => onChoose(s)}
          >
            {s.name}
          </button>
        ))}
      </div>
      <button className="editor-secondary mt-3" onClick={onClose}>
        Cancel
      </button>
    </dialog>
  );
}
