"use client";

import { resolveTranscriptionSources } from "@/core/transcription/source";
import type { TranscriptionSource } from "@/core/transcription/source";
import { TranscriptionSourceChoice } from "@/features/ai/transcription-source-choice";
import { AIProduction } from "@/features/ai/ai-production";
import { TranscriptionPanel } from "@/features/ai/transcription-panel";
import { secondsToFrames } from "@/core/timeline/time.cjs";
import { EditorIcon } from "./editor-icon";
import {
  useTimeline,
  useTimelineStoreApi,
  TimelineProvider,
} from "@/features/timeline/timeline-store";
import { CompositionMonitor } from "@/features/preview/composition-monitor";
import { ExportDialog } from "@/features/rendering/export-dialog";
import { useRef, useState } from "react";
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
  const timeline = useTimelineStoreApi();
  const selectionKey = useTimeline((s) => s.selectedIds.join(":"));
  const [inspectorTool, setInspectorTool] = useState<{ key: string; section: string } | null>(null);
  const monitor = useTimeline((s) => s.monitor);
  const setMonitor = timeline.getState().setMonitor;
  const [canvasFocus, setCanvasFocus] = useState(false);
  const importSource = () => {
    setMonitor("source");
    return library.importMedia();
  };
  const selectSource: typeof doc.selectMedia = (id) => {
    setMonitor("source");
    doc.selectMedia(id);
  };
  const [aiOpen, setAIOpen] = useState(false);
  const [transcriptionOpen, setTranscriptionOpen] = useState(false);
  const [captionSource, setCaptionSource] = useState<{ assetId: string; clipId?: string } | null>(
    null,
  );
  const applyBackground = (assetId: string) => {
    if (doc.setBackground(assetId)) setMonitor("timeline");
  };
  const [sourceChoices, setSourceChoices] = useState<TranscriptionSource[]>([]);
  const openCaptions = (assetId?: string, clipId?: string) => {
    if (assetId) {
      setCaptionSource({ assetId, clipId });
      setTranscriptionOpen(true);
      return;
    }
    const sources = resolveTranscriptionSources(
      doc.project,
      timeline.getState().selectedIds,
      library.selectedId,
    );
    if (sources.length > 1) {
      setSourceChoices(sources);
      return;
    }
    setCaptionSource(sources[0] || null);
    setTranscriptionOpen(true);
  };
  const [exportOpen, setExportOpen] = useState(false);
  const previewRef = useRef<PreviewMonitorHandle>(null);
  const { clearSelection } = doc;
  useEditorShortcuts({
    previewRef,
    importMedia: importSource,
    clearSelection,
    canImport: library.available && !library.loading && !library.importing,
    hasSelection: !!selected || !!doc.activeScene,
    canPlay:
      monitor === "timeline"
        ? doc.project.duration > 0
        : !!selected && selected.type !== "image" && selected.status !== "error",
    settingsOpen:
      transcriptionOpen ||
      aiOpen ||
      state.settingsOpen ||
      exportOpen ||
      doc.importOpen ||
      !!doc.candidate ||
      !!doc.deleteSceneId ||
      doc.busy,
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
      className={`editor-workspace ${canvasFocus ? "is-canvas-focused" : ""}`}
      style={
        {
          "--sidebar-width": `${panels.left}px`,
          "--inspector-width": `${panels.right}px`,
          "--timeline-height": `${canvasFocus ? 160 : panels.bottom}px`,
        } as CSSProperties
      }
    >
      <EditorToolbar
        fileActions={
          <>
            <ProjectActions document={doc} />
            <button
              className="editor-secondary !px-2"
              aria-label="Transcribe"
              disabled={!doc.ready || doc.busy}
              onClick={() => openCaptions()}
            >
              Transcribe
            </button>
            <button
              className="editor-secondary !px-2"
              disabled={!doc.ready || doc.busy}
              onClick={() => setAIOpen(true)}
              aria-label="AI Production"
            >
              AI
            </button>
          </>
        }
        project={projectSettings}
        dirty={doc.dirty}
        filename={doc.filename}
        busy={doc.busy}
        canUndo={doc.canUndo && !doc.busy}
        canRedo={doc.canRedo && !doc.busy}
        onUndo={doc.undo}
        onRedo={doc.redo}
        onExport={() => setExportOpen(true)}
        onSettings={() => dispatch({ type: "settings", open: true })}
        onResetLayout={() => dispatch({ type: "panels", panels: { ...DEFAULT_PANELS } })}
      />
      {aiOpen && (
        <AIProduction
          key={`${doc.project.id}:${doc.documentGeneration}`}
          project={doc.project}
          availableAssets={doc.project.assets.filter((asset) =>
            library.assets.some((item) => item.id === asset.id && item.status !== "error"),
          )}
          onClose={() => setAIOpen(false)}
          onApply={(plan, expected) => {
            const applied = doc.applyAIPlan(plan, expected);
            if (applied) {
              setMonitor("timeline");
              timeline
                .getState()
                .setPlayhead(secondsToFrames(expected.duration, expected.fps, "ceil"));
            }
            return applied;
          }}
        />
      )}
      {!!sourceChoices.length && (
        <TranscriptionSourceChoice
          sources={sourceChoices}
          onClose={() => setSourceChoices([])}
          onChoose={(source) => {
            setSourceChoices([]);
            setCaptionSource(source);
            setTranscriptionOpen(true);
          }}
        />
      )}
      {transcriptionOpen && (
        <TranscriptionPanel
          key={`${doc.project.id}:${doc.documentGeneration}`}
          project={doc.project}
          assets={library.assets}
          initialAssetId={captionSource?.assetId}
          sourceClipId={captionSource?.clipId}
          onGrouped={(transcript, expected, groups, offset, replace) => {
            const applied = doc.generateGrouped(
              transcript,
              expected,
              groups,
              offset,
              captionSource?.clipId,
              replace,
            );
            if (applied) {
              setMonitor("timeline");
              const clip = expected.tracks
                .flatMap((t) => t.clips)
                .find((c) => c.id === captionSource?.clipId);
              timeline
                .getState()
                .setPlayhead(clip ? secondsToFrames(clip.start, expected.fps) : offset);
            }
            return applied;
          }}
          onImport={library.importMedia}
          importing={library.importing}
          onClose={() => setTranscriptionOpen(false)}
          onSave={doc.saveTranscript}
          onCaptions={(transcript, expected, offset) => {
            const applied = doc.generateCaptions(
              transcript,
              expected,
              offset,
              captionSource?.clipId,
            );
            if (applied) {
              setMonitor("timeline");
              const clip = expected.tracks
                .flatMap((t) => t.clips)
                .find((c) => c.id === captionSource?.clipId);
              timeline
                .getState()
                .setPlayhead(clip ? secondsToFrames(clip.start, expected.fps) : offset);
            }
            return applied;
          }}
        />
      )}
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
      <nav aria-label="Editing tools" className="editor-tool-categories">
        <button onClick={() => dispatch({ type: "tab", tab: "media" })}>Media</button>
        <button onClick={() => dispatch({ type: "tab", tab: "audio" })}>Audio</button>
        <button
          disabled={doc.busy}
          onClick={() => {
            const title = doc.addTitle();
            if (title) {
              timeline.getState().setSelection([title.id]);
              timeline.getState().setPlayhead(secondsToFrames(title.start, doc.project.fps));
            }
            setMonitor("timeline");
          }}
        >
          Add text
        </button>
        <button onClick={() => setInspectorTool({ key: selectionKey, section: "Captions" })}>
          Captions
        </button>
        <button onClick={() => setInspectorTool({ key: selectionKey, section: "Animation" })}>
          Animation
        </button>
        <button onClick={() => setInspectorTool({ key: selectionKey, section: "Basic" })}>
          Transform / Crop
        </button>
        <button onClick={() => setInspectorTool({ key: selectionKey, section: "Transitions" })}>
          Transitions
        </button>
        <span className="ml-auto text-[10px] text-[var(--editor-muted)]">
          Select a clip to edit it
        </span>
      </nav>
      <div ref={bodyRef} className="editor-body">
        <div className="editor-top">
          <MediaSidebar
            library={{ ...library, importMedia: importSource, setSelectedId: selectSource }}
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
          <div className="monitor-column flex min-h-0 min-w-0 flex-col">
            <div className="monitor-toolbar">
              <div className="monitor-modes" aria-label="Preview mode">
                <button
                  aria-pressed={monitor === "timeline"}
                  title="Project canvas linked to the timeline"
                  onClick={() => setMonitor("timeline")}
                >
                  <EditorIcon name="scene" className="h-3.5 w-3.5" />
                  Timeline
                </button>
                <button
                  aria-pressed={monitor === "source"}
                  title="Inspect the original source independently"
                  onClick={() => setMonitor("source")}
                >
                  Source
                </button>
              </div>
              <span className="ml-auto truncate text-[10px] text-[var(--editor-muted)]">
                {monitor === "timeline"
                  ? doc.activeScene?.name || "Project canvas"
                  : "Source only (unlinked)"}
              </span>
              <button
                className={`editor-icon-button ${canvasFocus ? "is-active" : ""}`}
                aria-label="Focus canvas"
                aria-pressed={canvasFocus}
                title="Focus canvas / restore workspace"
                onClick={() => setCanvasFocus((value) => !value)}
              >
                <EditorIcon name="focus" />
              </button>
            </div>
            {monitor === "timeline" ? (
              <CompositionMonitor
                document={doc}
                key={`${doc.project.id}:${doc.documentGeneration}`}
                project={doc.project}
                assets={library.assets}
                controlsRef={previewRef}
              />
            ) : (
              <PreviewMonitor
                key={selected?.id || "empty"}
                asset={selected}
                project={projectSettings}
                preview={preview}
                onChange={updatePreview}
                onError={library.markUnavailable}
                controlsRef={previewRef}
              />
            )}
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
          <PropertiesInspector
            requestedSection={
              inspectorTool?.key === selectionKey ? inspectorTool.section : undefined
            }
            onSection={() => setInspectorTool(null)}
            asset={selected}
            project={projectSettings}
            document={doc}
            onGenerateCaptions={openCaptions}
            onSetBackground={applyBackground}
          />
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
            aiOpen ||
            transcriptionOpen ||
            doc.busy ||
            exportOpen ||
            state.settingsOpen ||
            doc.importOpen ||
            !!doc.candidate ||
            !!doc.deleteSceneId
          }
          execute={doc.executeTimeline}
          executeMotion={doc.executeMotion}
          executeAudio={doc.executeAudio}
          onScene={doc.selectScene}
          onLayer={doc.selectLayer}
          onAsset={doc.selectMedia}
          onGenerateCaptions={openCaptions}
          onSetBackground={applyBackground}
          onDetachAudio={doc.detachAudio}
        />
      </div>
      <footer className="editor-statusbar">
        <span>
          {doc.project.assets.length} assets · {doc.project.scenes.length} scenes ·{" "}
          {doc.project.duration.toFixed(1)} s
        </span>
        <span className="hidden sm:inline">Local composition preview / MP4 export</span>
        <span>
          {projectSettings.width} × {projectSettings.height} · {projectSettings.fps} fps
        </span>
      </footer>
      {exportOpen && <ExportDialog project={doc.project} onClose={() => setExportOpen(false)} />}
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
              Schema v{doc.candidate.migratedFrom} has been migrated to v3. Saving preserves
              validated animation keyframes.
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
