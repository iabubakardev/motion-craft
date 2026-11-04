"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import type { MediaAsset } from "@/core/media/types";
import { MediaPreview } from "@/features/media/media-preview";
import { formatDuration } from "@/features/media/library.cjs";
import { EditorIcon } from "@/features/editor/editor-icon";
import type { PreviewState, ProjectPlaceholder } from "@/features/editor/types";

export interface PreviewMonitorHandle { togglePlayback: () => void }

export function PreviewMonitor({ asset, project, preview, onChange, onError, controlsRef }: {
  asset: MediaAsset | undefined; project: ProjectPlaceholder; preview: PreviewState;
  onChange: (state: PreviewState) => void; onError: (id: string) => void;
  controlsRef: Ref<PreviewMonitorHandle>;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLMediaElement>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const playable = !!asset && asset.type !== "image" && asset.status !== "error";
  const sourceURL = asset?.url;
  const report = useCallback(() => {
    const media = mediaRef.current;
    onChange({
      assetId: asset?.id ?? null,
      currentTime: media?.currentTime || 0,
      duration: media && Number.isFinite(media.duration) ? media.duration : asset?.duration || 0,
      playing: !!media && !media.paused && !media.ended,
      fullscreen: document.fullscreenElement === rootRef.current,
    });
  }, [asset?.id, asset?.duration, onChange]);

  const togglePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!playable || !media) return;
    setError("");
    if (media.paused) void media.play().catch(() => setError("Playback could not start. Try the play button or reimport this source."));
    else media.pause();
  }, [playable]);
  useImperativeHandle(controlsRef, () => ({ togglePlayback }), [togglePlayback]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", report);
    return () => document.removeEventListener("fullscreenchange", report);
  }, [report]);

  useEffect(() => {
    const media = mediaRef.current;
    if (media && sourceURL && !media.getAttribute("src")) media.src = sourceURL;
    return () => {
      // Selection changes must stop playback and release the previous source.
      if (media) { media.pause(); media.removeAttribute("src"); media.load(); }
    };
  }, [sourceURL]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { setError("Fullscreen is unavailable in this window."); }
  }

  return (
    <section ref={rootRef} aria-label="Media preview" className="preview-monitor editor-panel flex h-full min-h-0 min-w-0 flex-col">
      <div className="editor-panel-heading"><h2>Source monitor</h2><span className="truncate text-[10px] font-normal text-[var(--editor-muted)]">{asset?.filename || "No source selected"}</span></div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[10px] text-[var(--editor-muted)]"><span>Source preview · Fit</span><span data-testid="preview-resolution">{asset?.width && asset.height ? `${asset.width} × ${asset.height}` : `${project.width} × ${project.height}`} <span className="ml-2 opacity-60">16:9 viewport</span></span></div>
      <div className="preview-fit-area"><div className="preview-viewport"><MediaPreview asset={asset} mediaRef={mediaRef} onError={onError} onMediaState={report} onVolumeChange={setMuted} /></div></div>
      {error && <p role="status" className="px-3 py-1 text-[10px] text-amber-200">{error}</p>}
      <div className="shrink-0 border-t border-[var(--editor-border)] px-3 py-2">
        <input aria-label="Source playback position" className="editor-range mb-2 block w-full" type="range" min={0} max={preview.duration || 1} step={0.01} value={Math.min(preview.currentTime, preview.duration || 1)} disabled={!playable || !preview.duration}
          onChange={(event) => { if (mediaRef.current) { mediaRef.current.currentTime = Number(event.target.value); report(); } }} />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] tabular-nums text-[var(--editor-muted)]" data-testid="source-time">{formatDuration(preview.currentTime)} <span className="mx-1 opacity-40">/</span> {formatDuration(preview.duration || asset?.duration)}</span>
          <button type="button" className="editor-icon-button !text-[var(--editor-text)]" aria-label={preview.playing ? "Pause preview" : "Play preview"} aria-keyshortcuts="Space" title="Play / pause source (Space)" disabled={!playable} onClick={togglePlayback}><EditorIcon name={preview.playing ? "pause" : "play"} /></button>
          <div className="flex gap-1"><button type="button" className="editor-icon-button" aria-label={muted ? "Unmute preview" : "Mute preview"} disabled={!playable} onClick={() => { if (mediaRef.current) mediaRef.current.muted = !mediaRef.current.muted; }}><EditorIcon name={muted ? "mute" : "volume"} /></button><button type="button" className="editor-icon-button" aria-label={preview.fullscreen ? "Exit fullscreen preview" : "Fullscreen preview"} title="Fullscreen preview (Escape to exit)" onClick={toggleFullscreen}><EditorIcon name="fullscreen" /></button></div>
        </div>
      </div>
    </section>
  );
}
