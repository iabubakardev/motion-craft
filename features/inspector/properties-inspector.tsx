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
}: {
  asset: MediaAsset | undefined;
  project: ProjectPlaceholder;
  document: ProjectDocumentController;
  onGenerateCaptions: (assetId?: string, clipId?: string) => void;
  onSetBackground: (assetId: string) => void;
}) {
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
      <CaptionInspector
        document={doc}
        onGenerateCaptions={onGenerateCaptions}
        sourceAssetId={asset?.type === "audio" ? asset.id : undefined}
      />
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
            Select a scene layer to edit position, scale, rotation, opacity and timing. Source files
            are never modified.
          </p>
        )}
      </div>
      <ClipProperties document={doc} />
      {doc.selectedLayer?.type !== "caption" && <LayerProperties document={doc} />}
      <AnimationProperties document={doc} />
      <SceneProperties document={doc} />
    </aside>
  );
}
