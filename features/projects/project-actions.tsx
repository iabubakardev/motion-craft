import { EditorIcon } from "@/features/editor/editor-icon";
import type { ProjectDocumentController } from "./use-project-document";
import { serializeProject } from "@/core/project/schema.cjs";

export function ProjectActions({ document: doc }: { document: ProjectDocumentController }) {
  function exportJSON() {
    const url = URL.createObjectURL(
      new Blob([serializeProject(doc.project)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.project.name.replace(/[^a-zA-Z0-9 _-]/g, "_")}.motioncraft.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div
      aria-label="Project file controls"
      className="project-actions flex items-center gap-1 text-[10px]"
    >
      <button
        type="button"
        className="editor-icon-button"
        disabled={!doc.ready || doc.busy}
        onClick={doc.requestNew}
        aria-label="New project"
        title="New project"
      >
        <EditorIcon name="file" />
        <span className="sr-only">New project</span>
      </button>
      <button
        type="button"
        className="editor-icon-button"
        disabled={!doc.desktop || doc.busy}
        onClick={doc.open}
        aria-label="Open project"
        title="Open project"
      >
        <EditorIcon name="folder" />
        <span className="sr-only">Open project</span>
      </button>
      <button
        type="button"
        className="editor-icon-button"
        disabled={!doc.desktop || !doc.ready || doc.busy}
        onClick={() => doc.save()}
        aria-label="Save project"
        title="Save project"
      >
        <EditorIcon name="save" />
        <span className="sr-only">Save project</span>
      </button>
      <button
        type="button"
        className="editor-icon-button"
        disabled={!doc.desktop || !doc.ready || doc.busy}
        onClick={() => doc.save(true)}
        aria-label="Save as"
        title="Save as"
      >
        <EditorIcon name="saveAs" />
        <span className="sr-only">Save as</span>
      </button>
      <span className="mx-1 h-3 border-l border-[var(--editor-border)]" />
      <button
        type="button"
        className="editor-icon-button"
        disabled={!doc.ready || doc.busy}
        onClick={() => doc.setImportOpen(true)}
        aria-label="Import JSON"
        title="Import JSON"
      >
        <EditorIcon name="import" />
        <span className="sr-only">Import JSON</span>
      </button>
      <button
        type="button"
        className="editor-icon-button"
        disabled={!doc.ready || doc.busy}
        onClick={exportJSON}
        aria-label="Export JSON"
        title="Export JSON"
      >
        <EditorIcon name="export" />
        <span className="sr-only">Export JSON</span>
      </button>
      <span
        role="status"
        className="project-file-notice max-w-28 truncate text-[var(--editor-muted)]"
      >
        {doc.busy
          ? "Working…"
          : doc.notice ||
            doc.filename ||
            (doc.desktop ? "Local project" : "Browser: JSON import/export available")}
      </span>
    </div>
  );
}
