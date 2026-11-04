"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_JSON_BYTES, parseProjectJSON } from "@/core/project/schema.cjs";
import type { Project, ValidationIssue } from "@/core/project/types";

export function JsonImportDialog({
  onValidated,
  onClose,
}: {
  onValidated: (project: Project, migratedFrom?: 1) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  function validate() {
    const result = parseProjectJSON(text);
    if (result.success) onValidated(result.project, result.migratedFrom);
    else setIssues(result.errors);
  }
  return (
    <dialog
      ref={ref}
      aria-label="Import project JSON"
      className="project-settings-dialog !w-[min(640px,calc(100vw-32px))]"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="text-sm font-semibold">Import project JSON</h2>
      <p className="mt-2 text-xs leading-5 text-[var(--editor-muted)]">
        Paste or upload project JSON (maximum 5 MB). Version 1 is validated and migrated to v2 for
        review; saved documents use v2.
      </p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="text-xs">
          Upload JSON
          <input
            aria-label="Upload project JSON"
            type="file"
            accept=".json,application/json"
            className="mt-2 block max-w-full text-[11px]"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > MAX_JSON_BYTES) {
                setIssues([{ path: "file", message: "File exceeds 5 MB." }]);
                return;
              }
              try {
                setText(await file.text());
                setIssues([]);
              } catch {
                setIssues([{ path: "file", message: "Could not read this file." }]);
              }
            }}
          />
        </label>
        <a
          className="shrink-0 text-[11px] text-[var(--editor-accent)] underline"
          href="/sample-project.motioncraft.json"
          download
        >
          Download sample
        </a>
      </div>
      <label className="mt-4 block text-xs">
        Project JSON
        <textarea
          aria-label="Project JSON"
          rows={12}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_JSON_BYTES + 1))}
          spellCheck={false}
          className="editor-input mt-2 w-full font-mono"
        />
      </label>
      {!!issues.length && (
        <ul role="alert" className="mt-3 max-h-32 overflow-auto text-[11px] text-red-300">
          {issues.map((issue, index) => (
            <li key={index}>
              <strong>{issue.path}</strong>: {issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="editor-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="editor-primary" disabled={!text.trim()} onClick={validate}>
          Validate and review
        </button>
      </div>
    </dialog>
  );
}
