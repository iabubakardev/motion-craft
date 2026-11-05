import type { ReactNode } from "react";
import type { ProjectPlaceholder } from "./types";
import { EditorIcon } from "./editor-icon";

export function EditorToolbar({
  fileActions,
  project,
  dirty,
  filename,
  busy,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSettings,
  onResetLayout,
  onExport,
}: {
  fileActions: ReactNode;
  project: ProjectPlaceholder;
  dirty: boolean;
  filename: string | null;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSettings: () => void;
  onResetLayout: () => void;
  onExport: () => void;
}) {
  return (
    <header className="editor-toolbar flex shrink-0 items-center gap-4 border-b border-[var(--editor-border)] px-4">
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded bg-[var(--editor-accent)] text-xs font-black text-[#11151c]"
        >
          M
        </span>
        <span className="text-xs font-semibold tracking-wide">MotionCraft</span>
      </div>
      <div className="flex items-center gap-1 border-l border-[var(--editor-border)] pl-3">
        <button
          type="button"
          disabled={!canUndo}
          className="editor-icon-button"
          aria-label="Undo"
          title="Undo project edit (Ctrl+Z)"
          onClick={onUndo}
        >
          <EditorIcon name="undo" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          className="editor-icon-button"
          aria-label="Redo"
          title="Redo project edit (Ctrl+Shift+Z)"
          onClick={onRedo}
        >
          <EditorIcon name="redo" />
        </button>
      </div>
      {fileActions}
      <div className="min-w-0 flex-1 text-center">
        <h1 className="truncate text-xs font-medium" data-testid="project-name">
          {project.name}
        </h1>
        <p data-testid="save-indicator" className="mt-0.5 text-[9px] text-[var(--editor-muted)]">
          {dirty ? "Unsaved changes" : filename ? "Saved" : "Not saved"}
        </p>
      </div>
      <button
        type="button"
        className="editor-icon-button"
        onClick={onResetLayout}
        aria-label="Reset workspace layout"
        title="Reset workspace layout"
      >
        <EditorIcon name="reset" />
      </button>
      <button
        type="button"
        className="editor-secondary flex items-center gap-2"
        disabled={busy}
        onClick={onSettings}
      >
        <EditorIcon name="settings" />
        <span className="toolbar-label">Project settings</span>
      </button>
      <button
        type="button"
        className="editor-primary flex items-center gap-2"
        disabled={busy}
        onClick={onExport}
        title="Export local MP4"
      >
        <EditorIcon name="export" />
        <span>Export</span>
      </button>
    </header>
  );
}
