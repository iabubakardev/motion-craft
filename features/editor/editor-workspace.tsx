"use client";

import { TimelineProvider } from "@/features/timeline/timeline-store";
import { useRef } from "react";
import type { CSSProperties } from "react";
import { PanelResizeHandle } from "@/components/ui/panel-resize-handle";
import { PreviewMonitor } from "@/features/preview/preview-monitor";
import type { PreviewMonitorHandle } from "@/features/preview/preview-monitor";
import { PropertiesInspector } from "@/features/inspector/properties-inspector";
import { TimelinePanel } from "@/features/timeline/timeline-panel";
import { MediaSidebar } from "./media-sidebar";
import { EditorToolbar } from "./editor-toolbar";
import { ProjectSettings } from "./project-settings";
import { DEFAULT_PANELS } from "./layout.cjs";
import { useEditorState } from "./use-editor-state";
import { useEditorShortcuts } from "./use-editor-shortcuts";
import { ProjectActions } from "@/features/projects/project-actions";
import { JsonImportDialog } from "@/features/projects/json-import-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function EditorWorkspace() {
  return (
    <TimelineProvider>
      <Workspace />
    </TimelineProvider>
  );
}

function Workspace() {
  const {
    library,
    projectDocument: doc,
    projectSettings,
    state,
    dispatch,
    selected,
    panels,
    bounds,
    bodyRef,
    updatePreview,
    resizePanel,
    resetPanel,
  } = useEditorState();
  const previewRef = useRef<PreviewMonitorHandle>(null);
  const { clearSelection } = doc;
  useEditorShortcuts({
    previewRef,
    importMedia: library.importMedia,
    clearSelection,
    canImport: library.available && !library.loading && !library.importing,
    hasSelection: !!selected || !!doc.activeScene,
    canPlay: !!selected && selected.type !== "image" && selected.status !== "error",
    settingsOpen:
      state.settingsOpen || doc.importOpen || !!doc.candidate || !!doc.deleteSceneId || doc.busy,
    saveProject: () => doc.save(),
    undo: doc.undo,
    redo: doc.redo,
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
    canSave: doc.desktop,
  });
  const preview =
    state.preview.assetId === library.selectedId
      ? state.preview
      : {
          assetId: library.selectedId,
          currentTime: 0,
          duration: selected?.duration || 0,
          playing: false,
          fullscreen: false,
        };
  return (
    <div
      className="editor-workspace"
      style={
        {
          "--sidebar-width": `${panels.left}px`,
          "--inspector-width": `${panels.right}px`,
          "--timeline-height": `${panels.bottom}px`,
        } as CSSProperties
      }
    >
      <EditorToolbar
        project={projectSettings}
        dirty={doc.dirty}
        filename={doc.filename}
        busy={doc.busy}
        canUndo={doc.canUndo && !doc.busy}
        canRedo={doc.canRedo && !doc.busy}
        onUndo={doc.undo}
        onRedo={doc.redo}
        onSettings={() => dispatch({ type: "settings", open: true })}
        onResetLayout={() => dispatch({ type: "panels", panels: { ...DEFAULT_PANELS } })}
      />
      <ProjectActions document={doc} />
      {!!doc.issues.length && (
        <div role="alert" className="project-error-banner">
          <div className="flex justify-between gap-3">
            <strong>Project change could not be applied</strong>
            <button type="button" aria-label="Dismiss project errors" onClick={doc.dismissIssues}>
              ×
            </button>
          </div>
          <ul>
            {doc.issues.map((issue, index) => (
              <li key={index}>
                <strong>{issue.path}</strong>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div ref={bodyRef} className="editor-body">
        <div className="editor-top">
          <MediaSidebar
            library={{ ...library, setSelectedId: doc.selectMedia }}
            document={doc}
            tab={state.sidebarTab}
            onTab={(tab) => dispatch({ type: "tab", tab })}
          />
          <PanelResizeHandle
            label="Resize media sidebar"
            controls="media-sidebar"
            value={panels.left}
            min={200}
            max={Math.min(480, Math.max(200, bounds.width - 12 - 320 - panels.right))}
            onResize={(value) => resizePanel("left", value)}
            onReset={() => resetPanel("left")}
          />
          <div className="flex min-h-0 min-w-0 flex-col">
            <div
              aria-label="Active scene context"
              className="bg-[var(--editor-panel)] px-3 py-1 text-[9px] text-[var(--editor-muted)]"
            >
              {doc.activeScene
                ? `${doc.activeScene.name} · ${doc.activeScene.layers.length} layers · ${doc.activeScene.duration.toFixed(1)} s — source preview only`
                : "No active scene · Select a scene to edit project data"}
            </div>
            <PreviewMonitor
              key={selected?.id || "empty"}
              asset={selected}
              project={projectSettings}
              preview={preview}
              onChange={updatePreview}
              onError={library.markUnavailable}
              controlsRef={previewRef}
            />
          </div>
          <PanelResizeHandle
            label="Resize properties inspector"
            controls="properties-inspector"
            value={panels.right}
            min={220}
            max={Math.min(420, Math.max(220, bounds.width - 12 - 320 - panels.left))}
            reverse
            onResize={(value) => resizePanel("right", value)}
            onReset={() => resetPanel("right")}
          />
          <PropertiesInspector asset={selected} project={projectSettings} document={doc} />
        </div>
        <PanelResizeHandle
          label="Resize timeline"
          controls="timeline-panel"
          orientation="horizontal"
          value={panels.bottom}
          min={160}
          max={Math.max(160, Math.min(480, bounds.height - 246))}
          reverse
          onResize={(value) => resizePanel("bottom", value)}
          onReset={() => resetPanel("bottom")}
        />
        <TimelinePanel
          assets={library.assets}
          project={doc.project}
          activeSceneId={doc.activeSceneId}
          documentGeneration={doc.documentGeneration}
          busy={
            doc.busy ||
            state.settingsOpen ||
            doc.importOpen ||
            !!doc.candidate ||
            !!doc.deleteSceneId
          }
          execute={doc.executeTimeline}
          onScene={doc.selectScene}
          onLayer={doc.selectLayer}
          onAsset={doc.selectMedia}
        />
      </div>
      <footer className="editor-statusbar">
        <span>
          {doc.project.assets.length} assets · {doc.project.scenes.length} scenes ·{" "}
          {doc.project.duration.toFixed(1)} s
        </span>
        <span className="hidden sm:inline">Source preview · Composition rendering pending</span>
        <span>
          {projectSettings.width} × {projectSettings.height} · {projectSettings.fps} fps
        </span>
      </footer>
      {state.settingsOpen && (
        <ProjectSettings
          project={projectSettings}
          onApply={doc.updateSettings}
          onClose={() => dispatch({ type: "settings", open: false })}
        />
      )}
      {doc.importOpen && (
        <JsonImportDialog
          onClose={() => doc.setImportOpen(false)}
          onValidated={(project, migratedFrom) => {
            doc.setImportOpen(false);
            doc.setCandidate({
              project,
              candidateId: null,
              filename: null,
              mode: "import",
              migratedFrom,
            });
          }}
        />
      )}
      {doc.candidate && (
        <ConfirmDialog
          title={doc.candidate.mode === "new" ? "Create new project?" : "Review project import"}
          confirmLabel="Replace current project"
          busy={doc.busy}
          onConfirm={doc.confirmReplacement}
          onCancel={() => doc.setCandidate(null)}
        >
          <p>
            <strong>{doc.candidate.project.name}</strong> · schema v
            {doc.candidate.project.schemaVersion}
          </p>
          {doc.candidate.migratedFrom && (
            <p>
              Schema v1 has been migrated to v2. Saving writes v2 track controls and source ranges.
            </p>
          )}
          <p>
            {doc.candidate.project.scenes.length} scenes · {doc.candidate.project.assets.length}{" "}
            assets · {doc.candidate.project.duration.toFixed(1)} seconds ·{" "}
            {doc.candidate.project.resolution.width} × {doc.candidate.project.resolution.height} at{" "}
            {doc.candidate.project.fps} fps
          </p>
          <p className="mt-3 text-amber-200">
            This replaces the current project and clears undo history.
            {doc.dirty ? " Your unsaved changes will be discarded." : ""} Media files are never
            deleted.
          </p>
        </ConfirmDialog>
      )}
      {doc.deleteSceneId && (
        <ConfirmDialog
          title="Delete scene?"
          confirmLabel="Delete scene"
          onConfirm={doc.confirmDeleteScene}
          onCancel={() => doc.setDeleteSceneId(null)}
        >
          <p>
            This removes the scene and its layers. Other scenes and source files are preserved. Undo
            can restore the scene.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
