"use client";
import { AudioInspector } from "@/features/audio/audio-inspector";
import { useState } from "react";
import { useTimeline } from "@/features/timeline/timeline-store";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { VisualProperties } from "./visual-properties";
import { CaptionInspector } from "@/features/captions/caption-inspector";
import { AnimationProperties } from "./animation-properties";
import { ClipProperties } from "@/features/timeline/clip-properties";
import type { MediaAsset } from "@/core/media/types";
import { formatDuration, formatSize } from "@/features/media/library.cjs";
import { MediaIcon } from "@/features/media/media-icon";
import type { ProjectPlaceholder } from "@/features/editor/types";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { SceneProperties } from "./scene-properties";
import { LayerProperties } from "./layer-properties";

export function PropertiesInspector({
  asset,
  project,
  document: doc,
  onGenerateCaptions,
  onSetBackground,
  requestedSection,
  onSection,
}: {
  requestedSection?: string;
  onSection: () => void;
  asset: MediaAsset | undefined;
  project: ProjectPlaceholder;
  document: ProjectDocumentController;
  onGenerateCaptions: (assetId?: string, clipId?: string) => void;
  onSetBackground: (assetId: string) => void;
}) {
  const ids = useTimeline((s) => s.selectedIds);
  const mixTrack = useTimeline((s) => s.activeTrackId);
  const record = createTimelineIndex(doc.project).clips.get(
    ids.length === 1 ? ids[0] : (doc.selectedLayerId ?? ""),
  );
  const audioFocused =
    record?.clip.audioOnly ||
    record?.asset?.type === "audio" ||
    record?.layer?.type === "audio" ||
    (!record && doc.project.tracks.some((t) => t.id === mixTrack && t.type === "audio"));
  const context = `${doc.project.id}:${ids.join(":")}:${doc.selectedLayerId ?? ""}:${asset?.id ?? ""}`;
  const [choice, setChoice] = useState<{ context: string; tab: string } | null>(null);
  const tab =
    requestedSection ??
    (choice?.context === context
      ? choice.tab
      : record?.layer?.type === "caption"
        ? "Captions"
        : record || asset || doc.project.tracks.some((t) => t.id === mixTrack && t.type === "audio")
          ? "Basic"
          : doc.project.transcripts.length ||
              doc.project.scenes.some((s) => s.layers.some((l) => l.type === "caption"))
            ? "Captions"
            : "Details");
  return (
    <aside
      id="properties-inspector"
      aria-label="Properties inspector"
      className="editor-panel h-full min-h-0 overflow-y-auto"
    >
      <div className="editor-panel-heading">
        <h2>Properties</h2>
        <span className="text-[10px] font-normal text-[var(--editor-muted)]">
          {doc.selectedLayer ? "Layer" : asset ? "Source" : doc.activeScene ? "Scene" : "Project"}
        </span>
      </div>
      <div
        role="tablist"
        aria-label="Inspector sections"
        className="sticky top-0 z-10 grid grid-cols-3 gap-1 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]"
      >
        {["Basic", "Animation", "Transitions", "Captions", "Details"].map((name) => (
          <button
            type="button"
            key={name}
            role="tab"
            aria-selected={tab === name}
            aria-controls={`inspector-${name}`}
            id={`inspector-tab-${name}`}
            className={`min-w-0 px-1 py-2 text-[11px] ${tab === name ? "border-b-2 border-cyan-300 text-cyan-300" : "text-[var(--editor-muted)]"}`}
            onClick={() => {
              onSection();
              setChoice({ context, tab: name });
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        id="inspector-Basic"
        role="tabpanel"
        aria-labelledby="inspector-tab-Basic"
        hidden={tab !== "Basic"}
      >
        {audioFocused && <AudioInspector document={doc} />}
        {tab !== "Transitions" && <VisualProperties document={doc} />}
        {!record && (
          <div className="p-4 text-xs space-y-3">
            <p>
              Select a timeline clip to edit its transform, crop and timing. Drag imported media
              onto the timeline to begin.
            </p>
            {asset && asset.type !== "audio" && (
              <button
                className="editor-primary w-full"
                disabled={doc.busy || asset.status === "error"}
                onClick={() => onSetBackground(asset.id)}
              >
                Use source as background
              </button>
            )}
          </div>
        )}
        {!audioFocused && <AudioInspector document={doc} />}
        <ClipProperties document={doc} />
        {!record && doc.selectedLayer?.type !== "caption" && <LayerProperties document={doc} />}
        {!record && <SceneProperties document={doc} />}
      </div>
      {tab === "Transitions" && (
        <div id="inspector-Transitions" role="tabpanel" aria-labelledby="inspector-tab-Transitions">
          <VisualProperties document={doc} transitionsOnly />
          {!record && (
            <p className="p-4 text-xs">Select a visual clip to add an entrance or exit.</p>
          )}
        </div>
      )}
      <div
        id="inspector-Animation"
        role="tabpanel"
        aria-labelledby="inspector-tab-Animation"
        hidden={tab !== "Animation"}
      >
        <AnimationProperties document={doc} />
        {!record && (
          <p className="p-4 text-xs">
            Select a visual timeline clip to edit keyframes and presets.
          </p>
        )}
      </div>
      <div
        id="inspector-Details"
        role="tabpanel"
        aria-labelledby="inspector-tab-Details"
        hidden={tab !== "Details"}
      >
        {asset && asset.type !== "audio" && (
          <div className="space-y-2 p-4">
            <button
              className="editor-primary w-full"
              disabled={doc.busy || asset.status === "error"}
              onClick={() => onSetBackground(asset.id)}
            >
              Set {asset.type} as background
            </button>
            <p className="text-[10px] text-[var(--editor-muted)]">
              Fills the canvas behind captions. Video uses its available duration and starts muted.
            </p>
          </div>
        )}
        <div className="p-4">
          {asset ? (
            <>
              <div className="mb-5 flex items-start gap-3">
                <span className="rounded bg-[var(--editor-elevated)] p-2 text-[var(--editor-accent)]">
                  <MediaIcon type={asset.type} className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="break-words text-xs font-medium" data-testid="inspector-filename">
                    {asset.filename}
                  </h3>
                  <p className="mt-1 text-[10px] capitalize text-[var(--editor-muted)]">
                    {asset.type} source
                  </p>
                </div>
              </div>
              <dl className="inspector-details">
                <dt>Type</dt>
                <dd>{asset.mimeType}</dd>
                <dt>File size</dt>
                <dd>{formatSize(asset.size)}</dd>
                <dt>Resolution</dt>
                <dd>
                  {asset.width && asset.height
                    ? `${asset.width} × ${asset.height}`
                    : "Not applicable / pending"}
                </dd>
                <dt>Duration</dt>
                <dd>{asset.type === "image" ? "Still image" : formatDuration(asset.duration)}</dd>
                <dt>Status</dt>
                <dd>
                  {asset.status === "imported"
                    ? "Reading metadata"
                    : asset.status === "error"
                      ? "Unavailable"
                      : "Ready"}
                </dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {doc.activeScene && (
                  <button
                    type="button"
                    className="editor-primary !px-2 !py-1.5"
                    disabled={doc.busy}
                    onClick={() => doc.addLayer(asset.type, asset.id)}
                  >
                    Add source to scene
                  </button>
                )}
                {asset.status === "error" && (
                  <button
                    type="button"
                    className="editor-secondary !px-2 !py-1.5"
                    disabled={!doc.desktop || doc.busy}
                    onClick={() => doc.relink(asset.id)}
                  >
                    Relink media
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <h3 className="text-xs font-medium">{doc.activeScene?.name || project.name}</h3>
              <p className="mt-2 text-[11px] leading-5 text-[var(--editor-muted)]">
                {doc.activeScene
                  ? "Edit the selected scene below."
                  : "Select media or a scene to inspect it."}
              </p>
              <dl className="inspector-details mt-5">
                <dt>Canvas</dt>
                <dd>
                  {project.width} × {project.height}
                </dd>
                <dt>Frame rate</dt>
                <dd>{project.fps} fps</dd>
                <dt>Project duration</dt>
                <dd>{doc.project.duration.toFixed(1)} s</dd>
                <dt>Saving</dt>
                <dd>{doc.dirty ? "Unsaved changes" : doc.filename ? "Saved" : "Not saved"}</dd>
              </dl>
            </>
          )}
          {!doc.selectedLayer && (
            <p className="mt-4 text-[10px] leading-5 text-[var(--editor-muted)]">
              Select a scene layer to edit position, scale, rotation, opacity and timing. Source
              files are never modified.
            </p>
          )}
        </div>
      </div>
      <div
        id="inspector-Captions"
        role="tabpanel"
        aria-labelledby="inspector-tab-Captions"
        hidden={tab !== "Captions"}
      >
        <CaptionInspector
          document={doc}
          onGenerateCaptions={onGenerateCaptions}
          sourceAssetId={asset?.type === "audio" ? asset.id : undefined}
        />
      </div>
    </aside>
  );
}
