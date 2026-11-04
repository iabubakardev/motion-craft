import type { ProjectDocumentController } from "./use-project-document";
import { serializeProject } from "@/core/project/schema.cjs";

export function ProjectActions({ document: doc }: { document: ProjectDocumentController }) {
  function exportJSON() {
    const url = URL.createObjectURL(new Blob([serializeProject(doc.project)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${doc.project.name.replace(/[^a-zA-Z0-9 _-]/g, "_")}.motioncraft.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div aria-label="Project file controls" className="project-actions flex flex-wrap items-center gap-1 border-b border-[var(--editor-border)] px-3 py-1.5 text-[10px]">
    <button type="button" className="editor-secondary !px-2 !py-1" disabled={!doc.ready || doc.busy} onClick={doc.requestNew}>New project</button>
    <button type="button" className="editor-secondary !px-2 !py-1" disabled={!doc.desktop || doc.busy} onClick={doc.open}>Open project</button>
    <button type="button" className="editor-secondary !px-2 !py-1" disabled={!doc.desktop || !doc.ready || doc.busy} onClick={() => doc.save()}>Save project</button>
    <button type="button" className="editor-secondary !px-2 !py-1" disabled={!doc.desktop || !doc.ready || doc.busy} onClick={() => doc.save(true)}>Save as</button>
    <span className="mx-1 h-3 border-l border-[var(--editor-border)]" />
    <button type="button" className="editor-secondary !px-2 !py-1" disabled={!doc.ready || doc.busy} onClick={() => doc.setImportOpen(true)}>Import JSON</button>
    <button type="button" className="editor-secondary !px-2 !py-1" disabled={!doc.ready || doc.busy} onClick={exportJSON}>Export JSON</button>
    <span role="status" className="ml-auto max-w-[45%] truncate text-[var(--editor-muted)]">{doc.busy ? "Working…" : doc.notice || doc.filename || (doc.desktop ? "Local project" : "Browser: JSON import/export available")}</span>
  </div>;
}
