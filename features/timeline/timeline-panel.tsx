"use client";
import { useBoxSelection } from "./use-box-selection";
import { KeyframeMarkers } from "./keyframe-markers";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { EditorIcon } from "@/features/editor/editor-icon";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { TimelineContextMenu } from "./timeline-context-menu";
import { useShallow } from "zustand/react/shallow";
import type { DragEvent } from "react";
import type { MediaAsset } from "@/core/media/types";
import type { Project } from "@/core/project/types";
import type { TimelineCommand } from "@/core/timeline/types";
import { copyClips, createTimelineIndex, planTimelineEdit } from "@/core/timeline/commands.cjs";
import { pixelsToFrames, secondsToFrames } from "@/core/timeline/time.cjs";
import { snapEdges, snapTargets } from "@/core/timeline/snapping.cjs";
import {
  ClipBlock,
  TrackGhost,
  Playhead,
  FrameRuler,
  SnapButton,
  TimelineMessage,
  TimelineReadout,
} from "./timeline-controls";
import { useTimeline, useTimelineStoreApi } from "./timeline-store";
import { useClipGesture } from "./use-clip-gesture";
interface Props {
  assets: MediaAsset[];
  project: Project;
  activeSceneId: string | null;
  documentGeneration: number;
  busy: boolean;
  executeMotion: ProjectDocumentController["executeMotion"];
  execute: (command: TimelineCommand, expected?: Project) => boolean;
  onScene: (id: string) => void;
  onLayer: (sceneId: string, layerId: string) => void;
  onAsset: (id: string) => void;
  onGenerateCaptions: (assetId: string, clipId: string) => void;
  onSetBackground: (assetId: string) => void;
  onDetachAudio: (clipId: string) => Promise<boolean>;
}
const HEADER = 196;
export const TimelinePanel = memo(function TimelinePanel({
  assets,
  project,
  activeSceneId,
  documentGeneration,
  busy,
  execute,
  executeMotion,
  onScene,
  onLayer,
  onAsset,
  onGenerateCaptions,
  onSetBackground,
  onDetachAudio,
}: Props) {
  const store = useTimelineStoreApi(),
    viewport = useRef<HTMLDivElement>(null);
  const { zoom, scrollLeft, viewportWidth } = useTimeline(
    useShallow((s) => ({ zoom: s.zoom, scrollLeft: s.scrollLeft, viewportWidth: s.viewportWidth })),
  );
  const activeTrackId = useTimeline((s) => s.activeTrackId);
  const selectedCount = useTimeline((s) => s.selectedIds.length),
    clipboardCount = useTimeline((s) => s.clipboard.length);
  const viewIdentity = useRef({ key: "", hadContent: false });
  const index = useMemo(() => createTimelineIndex(project), [project]);
  const thumbnails = useMemo(
    () =>
      new Map(
        assets.map((asset) => [
          asset.id,
          asset.status !== "error"
            ? asset.thumbnailUrl || (asset.type === "image" ? asset.url : undefined)
            : undefined,
        ]),
      ),
    [assets],
  );
  const [showEmptyTracks, setShowEmptyTracks] = useState(false);
  const tracks = useMemo(
    () => [...project.tracks].sort((a, b) => a.order - b.order),
    [project.tracks],
  );
  const visibleTracks = useMemo(() => {
    if (showEmptyTracks) return tracks;
    const spareVideo = tracks.find((t) => t.type === "video" && !t.clips.length && !t.locked),
      spareAudio = tracks.find((t) => t.type === "audio" && !t.clips.length && !t.locked);
    return tracks.filter(
      (t) =>
        t.clips.length ||
        t.id === activeTrackId ||
        t.id === spareVideo?.id ||
        t.id === spareAudio?.id,
    );
  }, [tracks, showEmptyTracks, activeTrackId]);
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.playheadFrame === previous.playheadFrame) return;
        const view = viewport.current;
        if (!view) return;
        const x = (state.playheadFrame / project.fps) * state.zoom;
        const available = view.clientWidth - HEADER;
        if (x < view.scrollLeft || x > view.scrollLeft + available - 24)
          view.scrollLeft = Math.max(0, x - available / 4);
      }),
    [store, project.fps],
  );
  const gesture = useClipGesture(project, execute, viewport, busy);
  const [boxSelect, setBoxSelect] = useState(false);
  const marquee = useBoxSelection(project, viewport, busy, boxSelect);
  const captionIds = useMemo(
    () =>
      [...index.clips.values()]
        .filter((item) => item.layer?.type === "caption")
        .map((item) => item.clip.id),
    [index],
  );
  const selectedLocked = useTimeline((s) =>
    s.selectedIds.some((id) => index.clips.get(id)?.track.locked),
  );
  const [context, setContext] = useState<{
    x: number;
    y: number;
    project: Project;
    generation: number;
    target: HTMLElement;
  } | null>(null);
  const extent = Math.min(
    86400,
    Math.max(
      project.duration + 80 / zoom,
      (viewportWidth - HEADER) / zoom,
      project.duration ? 0 : 120,
    ),
  );
  const maxZoom = Math.max(0.01, Math.min(600, 16000000 / Math.max(1, project.duration)));
  useEffect(() => {
    const key = `${project.id}:${documentGeneration}`,
      state = store.getState();
    const changed = viewIdentity.current.key !== key;
    if (changed) state.reset();
    if (project.duration > 0 && (changed || !viewIdentity.current.hadContent))
      state.setZoom(
        Math.min(
          600,
          16000000 / project.duration,
          Math.max(0.01, (state.viewportWidth - HEADER - 32) / project.duration),
        ),
      );
    viewIdentity.current = { key, hadContent: project.duration > 0 };
  }, [project.id, project.duration, documentGeneration, store]);
  useEffect(() => {
    const state = store.getState();
    const ids = state.selectedIds.filter((id) => index.clips.has(id));
    if (ids.length !== state.selectedIds.length) state.setSelection(ids);
    state.cancelDrag();
  }, [index, store]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      store
        .getState()
        .setView({ viewportWidth: element.clientWidth, viewportHeight: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);
  const run = (command: TimelineCommand) => {
    if (busy) return false;
    const ok = execute(command, project);
    if (ok) store.getState().setMessage("");
    return ok;
  };
  const action = (name: "delete" | "duplicate" | "copy" | "paste" | "split") => {
    const state = store.getState(),
      ids = state.selectedIds.filter((id) => index.clips.has(id));
    if (name === "copy") {
      state.setClipboard(copyClips(project, ids, index));
      state.setMessage(`Copied ${ids.length} clips`);
      return;
    }
    if (name === "paste") {
      if (state.clipboard.length) {
        const newIds = state.clipboard.map(() => crypto.randomUUID());
        if (run({ type: "PasteClips", items: state.clipboard, newIds, frame: state.playheadFrame }))
          state.setSelection(newIds);
      }
      return;
    }
    if (!ids.length) return;
    if (name === "delete") {
      if (run({ type: "DeleteClips", clipIds: ids })) state.setSelection([]);
    }
    if (name === "duplicate") {
      const newIds = ids.map(() => crypto.randomUUID());
      if (run({ type: "DuplicateClip", clipIds: ids, newIds })) state.setSelection(newIds);
    }
    if (name === "split") {
      if (ids.length !== 1) {
        state.setMessage("Select one clip to split.");
        return;
      }
      const newClipId = crypto.randomUUID();
      if (run({ type: "SplitClip", clipId: ids[0], newClipId, frame: state.playheadFrame })) {
        state.setSelection([newClipId]);
        const item = index.clips.get(ids[0]);
        if (item?.scene && item.layer) onLayer(item.scene.id, newClipId);
      }
    }
  };
  const dropCommand = (event: DragEvent, trackId: string): TimelineCommand | null => {
    const state = store.getState(),
      assetId = state.dragAssetId || event.dataTransfer.getData("application/x-motioncraft-asset");
    const view = viewport.current;
    if (!assetId || !view) return null;
    let frame = Math.max(
      0,
      pixelsToFrames(
        event.clientX - view.getBoundingClientRect().left + view.scrollLeft - HEADER,
        zoom,
        project.fps,
      ),
    );
    if (state.snapEnabled)
      frame += snapEdges(
        [frame],
        snapTargets(project, state.playheadFrame),
        (8 * project.fps) / zoom,
      ).delta;
    return {
      type: "InsertClip",
      clipId: "00000000-0000-4000-8000-000000000001",
      assetId,
      trackId,
      startFrame: frame,
    };
  };
  return (
    <section
      id="timeline-panel"
      aria-label="Timeline workspace"
      className="editor-panel flex h-full min-h-0 flex-col"
      tabIndex={-1}
      onPointerDownCapture={() => store.getState().setMonitor("timeline")}
      onDragOverCapture={() => store.getState().setMonitor("timeline")}
      onFocusCapture={() => store.getState().setMonitor("timeline")}
      onContextMenu={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest(".timeline-track")) return;
        event.preventDefault();
        if (busy) return;
        const clip = event.target.closest<HTMLElement>("[data-clip-id]");
        const state = store.getState();
        state.cancelDrag();
        state.setMonitor("timeline");
        if (clip?.dataset.clipId) {
          if (!state.selectedIds.includes(clip.dataset.clipId))
            state.setSelection([clip.dataset.clipId]);
          clip.focus({ preventScroll: true });
        } else state.setSelection([]);
        const target =
            clip || event.target.closest<HTMLElement>(".timeline-track") || event.currentTarget,
          rect = target.getBoundingClientRect();
        setContext({
          x: event.clientX || rect.left + 12,
          y: event.clientY || rect.top + 12,
          project,
          generation: documentGeneration,
          target,
        });
      }}
      onKeyDown={(event) => {
        if (
          busy ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          (event.target instanceof Element &&
            event.target.closest("input,textarea,select,[contenteditable='true'],[role='slider']"))
        )
          return;
        const key = event.key.toLowerCase(),
          ctrl = event.ctrlKey || event.metaKey;
        if (key === "escape" && document.fullscreenElement) return;
        if (key === "escape") {
          event.preventDefault();
          store.getState().cancelDrag();
          store.getState().setSelection([]);
        } else if (key === "delete" || key === "backspace") {
          event.preventDefault();
          action("delete");
        } else if (ctrl && ["c", "v", "d"].includes(key)) {
          event.preventDefault();
          action(key === "c" ? "copy" : key === "v" ? "paste" : "duplicate");
        } else if (!ctrl && key === "s") {
          event.preventDefault();
          action("split");
        } else if (!ctrl && ["arrowleft", "arrowright"].includes(key)) {
          event.preventDefault();
          store
            .getState()
            .setPlayhead(
              Math.min(
                86400 * project.fps,
                Math.max(
                  0,
                  store.getState().playheadFrame +
                    (key === "arrowright" ? 1 : -1) * (event.shiftKey ? project.fps : 1),
                ),
              ),
            );
        } else if (["+", "=", "-"].includes(key)) {
          event.preventDefault();
          store.getState().setZoom(Math.min(maxZoom, zoom * (key === "-" ? 0.8 : 1.25)));
        }
      }}
    >
      {context && (
        <TimelineContextMenu
          valid={context.project === project && context.generation === documentGeneration && !busy}
          x={context.x}
          y={context.y}
          onClose={(restore) => {
            setContext(null);
            if (restore)
              requestAnimationFrame(() => {
                const id = store.getState().selectedIds[0];
                const target = id
                  ? viewport.current?.querySelector<HTMLElement>(`[data-clip-id="${id}"]`)
                  : context.target.closest<HTMLElement>("#timeline-panel");
                if (target?.isConnected) target.focus();
              });
          }}
          items={(() => {
            const selected = store
              .getState()
              .selectedIds.map((id) => index.clips.get(id))
              .filter((item) => !!item);
            const locked = selected.some((item) => item.track.locked);
            const one = selected.length === 1 ? selected[0] : undefined;
            const frame = store.getState().playheadFrame;
            const canSplit =
              one &&
              !locked &&
              frame / project.fps > one.clip.start + 1e-6 &&
              frame / project.fps < one.clip.start + one.clip.duration - 1e-6;
            const targetId = context.target.dataset.clipId;
            const target = targetId ? index.clips.get(targetId) : undefined;
            const audio = target?.asset && target.asset.type !== "image" ? target : undefined;
            return [
              ...(target?.asset?.type === "video" && !target.clip.audioOnly
                ? [
                    {
                      label: "Transcribe Video Audio",
                      run: () => {
                        if (target.asset) onGenerateCaptions(target.asset.id, target.clip.id);
                      },
                    },
                    {
                      label: "Detach Audio",
                      disabled: locked,
                      run: () => {
                        void onDetachAudio(target.clip.id);
                      },
                    },
                  ]
                : []),
              ...(audio?.asset
                ? [
                    {
                      label: "Export Transcript",
                      run: () => {
                        if (audio.asset) onGenerateCaptions(audio.asset.id, audio.clip.id);
                      },
                    },
                  ]
                : []),
              ...(target?.asset && target.asset.type !== "audio" && !target.clip.audioOnly
                ? [
                    {
                      label: "Set as background",
                      disabled: !assets.some(
                        (a) => a.id === target.asset?.id && a.status !== "error",
                      ),
                      run: () => {
                        if (target.asset) onSetBackground(target.asset.id);
                      },
                    },
                  ]
                : []),
              ...(audio?.asset
                ? [
                    {
                      label: "Generate captions",
                      disabled: !assets.some(
                        (a) => a.id === audio.asset?.id && a.status !== "error",
                      ),
                      run: () => {
                        if (audio.asset) onGenerateCaptions(audio.asset.id, audio.clip.id);
                      },
                    },
                  ]
                : []),
              {
                label: "Split at playhead",
                icon: "split",
                shortcut: "S",
                disabled: !canSplit,
                run: () => action("split"),
              },
              {
                label: "Copy",
                icon: "copy",
                shortcut: "Ctrl+C",
                disabled: !selected.length,
                run: () => action("copy"),
              },
              {
                label: "Duplicate",
                icon: "duplicate",
                shortcut: "Ctrl+D",
                disabled: !selected.length || locked,
                run: () => action("duplicate"),
              },
              {
                label: "Delete",
                icon: "delete",
                shortcut: "Delete",
                disabled: !selected.length || locked,
                run: () => action("delete"),
              },
              {
                label: "Paste at playhead",
                icon: "paste",
                shortcut: "Ctrl+V",
                disabled: !clipboardCount,
                run: () => action("paste"),
              },
              {
                label: "Deselect",
                disabled: !selected.length,
                run: () => store.getState().setSelection([]),
              },
            ];
          })()}
        />
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--editor-border)] px-2 py-1 text-[10px]">
        <h2>Timeline</h2>
        <TimelineReadout fps={project.fps} />
        {(["split", "duplicate", "copy", "paste"] as const).map((name) => (
          <button
            key={name}
            type="button"
            disabled={
              busy ||
              (name === "paste"
                ? clipboardCount === 0
                : name === "split"
                  ? selectedCount !== 1
                  : selectedCount === 0)
            }
            className="editor-icon-button"
            title={`${name[0].toUpperCase() + name.slice(1)} clips`}
            aria-label={`${name} timeline clips`}
            onClick={() => action(name)}
          >
            <EditorIcon name={name} />
            <span className="sr-only">{name}</span>
          </button>
        ))}
        <button
          className="editor-secondary !px-2 !py-1"
          aria-label="Detach selected video audio"
          disabled={
            busy ||
            selectedCount !== 1 ||
            ![...index.clips.values()].some(
              (r) =>
                store.getState().selectedIds.includes(r.clip.id) &&
                r.asset?.type === "video" &&
                !r.clip.audioOnly &&
                !r.track.locked,
            )
          }
          onClick={() => {
            const id = store.getState().selectedIds[0];
            if (id) void onDetachAudio(id);
          }}
        >
          Detach Audio
        </button>
        <button
          className="editor-secondary !px-2 !py-1"
          aria-label="Box select clips"
          aria-pressed={boxSelect}
          disabled={busy}
          onClick={() => setBoxSelect(!boxSelect)}
        >
          Box select
        </button>
        <button
          className="editor-secondary !px-2 !py-1"
          aria-label="Select all captions"
          disabled={busy || !captionIds.length}
          onClick={() => store.getState().setSelection(captionIds)}
        >
          Select captions
        </button>
        <button
          className="editor-secondary !px-2 !py-1"
          aria-label="delete timeline clips"
          disabled={busy || !selectedCount || selectedLocked}
          title={
            selectedLocked
              ? "Unlock selected tracks before deleting"
              : "Delete selection (Delete key)"
          }
          onClick={() => action("delete")}
        >
          Delete selected{selectedCount ? ` (${selectedCount})` : ""}
        </button>
        <span className="text-[var(--editor-muted)]">
          Drag empty space to select; Box select also starts over clips
        </span>
        {(["video", "audio"] as const).map((kind) => (
          <button
            key={kind}
            className="editor-secondary !px-2 !py-1"
            aria-label={`Add ${kind === "video" ? "visual" : "audio"} track`}
            disabled={busy || tracks.length >= 64}
            onClick={() => {
              const trackId = crypto.randomUUID();
              if (execute({ type: "AddTrack", trackId, kind }, project))
                store.getState().selectTrack(trackId);
            }}
          >
            + {kind === "video" ? "Visual" : "Audio"}
          </button>
        ))}
        <button
          className="editor-secondary !px-2 !py-1"
          aria-label="Show all timeline tracks"
          aria-pressed={showEmptyTracks}
          onClick={() => setShowEmptyTracks(!showEmptyTracks)}
        >
          {showEmptyTracks ? "Compact tracks" : "Show all tracks"}
        </button>
        <span className="text-[var(--editor-muted)]">
          Visual rows accept images, video, text and captions
        </span>
        <SnapButton />
        <button
          type="button"
          className="editor-icon-button"
          onClick={() => store.getState().setPlayhead(0)}
          aria-label="Reset timeline playhead"
          title="Reset playhead"
        >
          <EditorIcon name="start" />
          <span className="sr-only">Start</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button aria-label="Zoom timeline out" onClick={() => store.getState().setZoom(zoom - 4)}>
            -
          </button>
          <input
            aria-label="Timeline zoom"
            type="range"
            min={0.01}
            max={maxZoom}
            step={0.01}
            value={Math.min(zoom, maxZoom)}
            onChange={(e) => store.getState().setZoom(Number(e.target.value))}
            className="editor-range w-20"
          />
          <button
            aria-label="Zoom timeline in"
            onClick={() => store.getState().setZoom(Math.min(maxZoom, zoom + 4))}
          >
            +
          </button>
          <button
            className="editor-icon-button"
            title="Fit project to timeline"
            aria-label="Fit project"
            onClick={() =>
              store
                .getState()
                .setZoom(
                  Math.max(
                    0.01,
                    Math.min(
                      maxZoom,
                      (viewportWidth - HEADER - 32) / Math.max(1, project.duration),
                    ),
                  ),
                )
            }
          >
            <EditorIcon name="fit" />
            <span className="sr-only">Fit project</span>
          </button>
        </div>
      </div>
      <TimelineMessage />
      <div
        ref={viewport}
        className="timeline-scroll min-h-0 flex-1 overflow-auto"
        aria-label="Scrollable timeline"
        tabIndex={-1}
        onPointerDownCapture={marquee.begin}
        onScroll={(e) =>
          store.getState().setView({
            scrollLeft: e.currentTarget.scrollLeft,
            scrollTop: e.currentTarget.scrollTop,
          })
        }
      >
        <div className="relative min-h-full" style={{ width: HEADER + extent * zoom }}>
          <div className="sticky top-0 z-20 flex h-6 bg-[var(--editor-panel)]">
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-[var(--editor-border)] bg-[var(--editor-panel)] px-2 text-[9px]"
              style={{ width: HEADER }}
            >
              TRACKS
            </div>
            <FrameRuler zoom={zoom} extent={extent} fps={project.fps} />
          </div>
          <div className="flex h-7 border-b border-[var(--editor-border)]">
            <div
              className="sticky left-0 z-10 shrink-0 bg-[var(--editor-panel)] px-2 text-[10px]"
              style={{ width: HEADER }}
            >
              Scenes
            </div>
            <div className="relative flex-1">
              {project.scenes
                .filter(
                  (scene) =>
                    (scene.start + scene.duration) * zoom >= scrollLeft - HEADER &&
                    scene.start * zoom < scrollLeft + viewportWidth,
                )
                .map((scene) => (
                  <button
                    key={scene.id}
                    className="absolute top-1 h-5 truncate rounded border border-slate-600 bg-slate-800 px-1 text-[9px]"
                    aria-label={`Timeline scene ${scene.name}`}
                    aria-pressed={scene.id === activeSceneId}
                    style={{
                      left: scene.start * zoom,
                      width: Math.max(3, scene.duration * zoom - 2),
                    }}
                    onClick={() => {
                      onScene(scene.id);
                      store.getState().setSelection([]);
                      store.getState().setPlayhead(secondsToFrames(scene.start, project.fps));
                    }}
                  >
                    {scene.name}
                  </button>
                ))}
            </div>
          </div>
          {!index.clips.size && (
            <p className="pointer-events-none absolute left-[216px] top-16 z-10 max-w-72 text-[10px] text-slate-400">
              Drag imported media onto a compatible track. Select clips to move, trim, split or edit
              timing. Audio needs an audio track.
            </p>
          )}
          {visibleTracks.map((track) => (
            <div
              key={track.id}
              data-track-id={track.id}
              className="flex border-b border-[var(--editor-border)]"
              style={{ height: track.height }}
              onDragOver={(event) => {
                const command = dropCommand(event, track.id);
                if (!command || busy) return;
                event.preventDefault();
                try {
                  const plan = planTimelineEdit(project, command, index);
                  store.getState().setDrag({
                    changes: plan.changes,
                    guide: null,
                    valid: true,
                    error: "",
                    trackId: track.id,
                  });
                  event.dataTransfer.dropEffect = "copy";
                } catch (error) {
                  store.getState().setDrag({
                    changes: [],
                    guide: null,
                    valid: false,
                    error: error instanceof Error ? error.message : "Invalid drop",
                    trackId: track.id,
                  });
                  event.dataTransfer.dropEffect = "none";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const command = dropCommand(event, track.id);
                store.getState().cancelDrag();
                if (command?.type === "InsertClip") {
                  const clipId = crypto.randomUUID();
                  if (run({ ...command, clipId })) store.getState().setSelection([clipId]);
                }
              }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-[var(--editor-border)] bg-[var(--editor-panel)] px-1 text-[9px]"
                style={{ width: HEADER }}
              >
                <button
                  aria-pressed={activeTrackId === track.id}
                  title={`${track.name}: ${track.type === "video" ? "Visual track: image, video, text or captions" : "Audio track"}`}
                  className={`w-8 shrink-0 ${activeTrackId === track.id ? "text-cyan-300 ring-1 ring-cyan-300" : ""}`}
                  onClick={() => store.getState().selectTrack(track.id)}
                >
                  {track.name}
                </button>
                <button
                  className="track-icon-button"
                  disabled={busy}
                  aria-label={`Toggle visibility ${track.name}`}
                  aria-pressed={track.visible}
                  title="Show/hide this track in Timeline preview and export"
                  onClick={() =>
                    run({
                      type: "UpdateTrack",
                      trackId: track.id,
                      patch: { visible: !track.visible },
                    })
                  }
                >
                  <EditorIcon name={track.visible ? "eye" : "hidden"} className="h-3 w-3" />
                </button>
                <button
                  className="track-icon-button"
                  disabled={busy}
                  aria-label={`Toggle mute ${track.name}`}
                  aria-pressed={track.muted}
                  title="Composition mute (source preview unaffected)"
                  onClick={() =>
                    run({ type: "UpdateTrack", trackId: track.id, patch: { muted: !track.muted } })
                  }
                >
                  <EditorIcon name={track.muted ? "mute" : "volume"} className="h-3 w-3" />
                </button>
                <button
                  className="track-icon-button"
                  disabled={busy}
                  title={track.locked ? "Unlock track" : "Lock track"}
                  aria-label={`Toggle lock ${track.name}`}
                  aria-pressed={track.locked}
                  onClick={() =>
                    run({
                      type: "UpdateTrack",
                      trackId: track.id,
                      patch: { locked: !track.locked },
                    })
                  }
                >
                  <EditorIcon name={track.locked ? "lock" : "unlock"} className="h-3 w-3" />
                </button>
                <button
                  className="track-icon-button"
                  disabled={busy || track.order === 0}
                  title="Move track up"
                  aria-label={`Move track ${track.name} up`}
                  onClick={() =>
                    run({
                      type: "UpdateTrack",
                      trackId: track.id,
                      patch: { order: track.order - 1 },
                    })
                  }
                >
                  <EditorIcon name="up" className="h-3 w-3" />
                </button>
                <button
                  className="track-icon-button"
                  disabled={busy || track.order === tracks.length - 1}
                  title="Move track down"
                  aria-label={`Move track ${track.name} down`}
                  onClick={() =>
                    run({
                      type: "UpdateTrack",
                      trackId: track.id,
                      patch: { order: track.order + 1 },
                    })
                  }
                >
                  <EditorIcon name="down" className="h-3 w-3" />
                </button>
                <select
                  disabled={busy}
                  aria-label={`Track height ${track.name}`}
                  value={track.height}
                  className="w-10 bg-[var(--editor-panel)]"
                  onChange={(e) =>
                    run({
                      type: "UpdateTrack",
                      trackId: track.id,
                      patch: { height: Number(e.target.value) },
                    })
                  }
                >
                  {[...new Set([28, 36, 56, 80, 120, track.height])]
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </div>
              <div
                className={`timeline-track relative flex-1 ${track.locked ? "opacity-50" : ""}`}
                onPointerDown={(e) => {
                  if (e.button === 0 && e.target === e.currentTarget) {
                    store.getState().setSelection([]);
                    store.getState().selectTrack(track.id);
                  }
                }}
              >
                {track.clips
                  .filter(
                    (clip) =>
                      (clip.start + clip.duration) * zoom >= scrollLeft - HEADER - 100 &&
                      clip.start * zoom < scrollLeft + viewportWidth + 100,
                  )
                  .map((clip) => {
                    const item = index.clips.get(clip.id)!;
                    const label =
                      item.asset?.filename ||
                      (item.layer && "text" in item.layer.properties
                        ? item.layer.properties.text
                        : item.layer?.type) ||
                      "Clip";
                    return (
                      <ClipBlock
                        key={clip.id}
                        id={clip.id}
                        label={label}
                        thumbnail={item.asset ? thumbnails.get(item.asset.id) : undefined}
                        audio={track.type === "audio"}
                        start={clip.start * zoom}
                        width={Math.max(4, clip.duration * zoom - 2)}
                        onPointerDown={(e) => {
                          e.currentTarget.focus();
                          gesture(e, clip.id);
                        }}
                        onTrim={(e, edge) => gesture(e, clip.id, edge)}
                        onFocus={() => {
                          if (item.scene && item.layer) onLayer(item.scene.id, item.layer.id);
                          else if (item.asset) onAsset(item.asset.id);
                        }}
                      >
                        <KeyframeMarkers
                          project={project}
                          clip={clip}
                          zoom={zoom}
                          busy={busy}
                          execute={executeMotion}
                        />
                      </ClipBlock>
                    );
                  })}
                <TrackGhost trackId={track.id} zoom={zoom} />
              </div>
            </div>
          ))}
          {marquee.box && (
            <div
              aria-label="Timeline selection rectangle"
              className="pointer-events-none absolute z-40 border border-cyan-300 bg-cyan-300/15"
              style={{
                left: marquee.box.left,
                top: marquee.box.top,
                width: marquee.box.width,
                height: marquee.box.height,
              }}
            />
          )}
          <Playhead zoom={zoom} fps={project.fps} />
        </div>
      </div>
    </section>
  );
});
