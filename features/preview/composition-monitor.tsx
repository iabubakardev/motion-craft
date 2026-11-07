"use client";
import type { Caption } from "@/core/captions/presets.cjs";
import { CaptionCanvas } from "@/features/captions/caption-canvas";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { Player } from "@remotion/player";
import { useMemo, useRef, useImperativeHandle, useState } from "react";
import type { Ref, CSSProperties } from "react";
import type { Project } from "@/core/project/types";
import type { MediaAsset } from "@/core/media/types";
import type { PreviewMonitorHandle } from "./preview-monitor";
import { ProjectComposition } from "@/rendering/project-composition";
import { buildComposition } from "@/rendering/input.cjs";
import { useTimeline, useTimelineStoreApi } from "@/features/timeline/timeline-store";
import { useTimelinePlayer } from "./use-timeline-player";
import { CompositionTransport } from "./composition-transport";

export function CompositionMonitor({
  project,
  assets,
  controlsRef,
  document: doc,
}: {
  project: Project;
  assets: MediaAsset[];
  controlsRef: Ref<PreviewMonitorHandle>;
  document: ProjectDocumentController;
}) {
  const [captionPreview, setCaptionPreview] = useState<{ id: string; box: Caption["box"] } | null>(
    null,
  );
  const root = useRef<HTMLElement>(null),
    store = useTimelineStoreApi();
  const input = useMemo(
    () => ({
      project,
      sources: Object.fromEntries(
        assets
          .filter(
            (asset) =>
              asset.status !== "error" && project.assets.some((item) => item.id === asset.id),
          )
          .map((asset) => [asset.id, asset.url]),
      ),
    }),
    [project, assets],
  );
  const model = useMemo(() => buildComposition(input), [input]);
  const { player, connect, toggle } = useTimelinePlayer(model.durationInFrames);
  useImperativeHandle(controlsRef, () => ({ togglePlayback: toggle }), [toggle]);
  if (!project.duration)
    return (
      <section
        aria-label="Timeline preview"
        className="editor-panel flex min-h-0 flex-1 items-center justify-center text-xs text-[var(--editor-muted)]"
      >
        Add clips or a scene to preview the timeline.
      </section>
    );
  return (
    <section
      ref={root}
      aria-label="Timeline preview"
      className="editor-panel canvas-monitor flex min-h-0 flex-1 flex-col"
    >
      <h2 className="sr-only">Timeline monitor</h2>
      {model.clips.some((clip) => clip.assetId && !clip.src) && (
        <p role="status" className="px-3 text-[10px] text-amber-200">
          Missing media is shown as placeholders or silent audio. Relink before export.
        </p>
      )}
      <div
        className="composition-stage"
        style={{ "--canvas-ratio": model.width / model.height } as CSSProperties}
      >
        <span className="composition-meta">
          {model.width} x {model.height} / {model.fps} fps
        </span>
        <div className="composition-artboard">
          <Player
            ref={connect}
            component={ProjectComposition}
            inputProps={{ input, captionPreview }}
            durationInFrames={model.durationInFrames}
            compositionWidth={model.width}
            compositionHeight={model.height}
            fps={model.fps}
            controls={false}
            style={{ width: "100%", height: "100%" }}
            errorFallback={() => (
              <p role="alert">
                Composition playback failed. Check media availability and codec support, then switch
                Source/Timeline to retry.
              </p>
            )}
          />
          <CaptionCanvas
            project={project}
            document={doc}
            onPreview={setCaptionPreview}
            onBegin={() => player.current?.pause()}
          />
          <CanvasRangeOverlay duration={model.durationInFrames} background={model.background} />
        </div>
      </div>
      <CompositionTransport
        player={player}
        duration={model.durationInFrames}
        fps={model.fps}
        onToggle={toggle}
        onFullscreen={() => {
          const action = document.fullscreenElement
            ? document.exitFullscreen()
            : root.current?.requestFullscreen();
          void action?.catch(() =>
            store.getState().setMessage("Fullscreen is unavailable in this window."),
          );
        }}
      />
    </section>
  );
}

function CanvasRangeOverlay({ duration, background }: { duration: number; background: string }) {
  const outside = useTimeline((state) => state.playheadFrame >= duration);
  return outside ? (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-white/50"
      style={{ background: `linear-gradient(${background},${background}), #000000` }}
    >
      Outside project duration
    </div>
  ) : null;
}
