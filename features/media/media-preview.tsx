/* eslint-disable @next/next/no-img-element -- Approved desktop media URLs must be decoded locally, never by the Next.js image optimizer. */
import type { Ref } from "react";
import type { MediaAsset } from "@/core/media/types";
import { MediaIcon } from "./media-icon";

export function MediaPreview({ asset, onError, mediaRef, onMediaState, onVolumeChange }: {
  asset: MediaAsset | undefined;
  onError: (id: string) => void;
  mediaRef?: Ref<HTMLMediaElement>;
  onMediaState?: () => void;
  onVolumeChange?: (muted: boolean) => void;
}) {
  if (!asset) return <div className="preview-placeholder"><MediaIcon type="video" className="mb-3 h-9 w-9" /><p className="text-xs">Select media to preview</p><p className="mt-2 text-[10px] opacity-60">Your source monitor is ready.</p></div>;
  if (asset.status === "error") return <div className="preview-placeholder"><p role="alert" className="max-w-xs px-5 text-xs leading-6 text-amber-200">Preview unavailable. This file may be missing, changed, corrupted, or use an unsupported codec. Reimport it to retry.</p></div>;
  if (asset.type === "image") return <img src={asset.url} alt={asset.filename} className="h-full w-full object-contain" onError={() => onError(asset.id)} />;
  const events = {
    onTimeUpdate: onMediaState, onLoadedMetadata: onMediaState,
    onPlay: onMediaState, onPause: onMediaState, onEnded: onMediaState,
    onError: () => onError(asset.id),
    onVolumeChange: (event: React.SyntheticEvent<HTMLMediaElement>) => onVolumeChange?.(event.currentTarget.muted),
  };
  if (asset.type === "video") return <video ref={mediaRef as Ref<HTMLVideoElement>} src={asset.url} aria-label={`Preview ${asset.filename}`} preload="metadata" playsInline className="h-full w-full object-contain" {...events} />;
  return <div className="preview-placeholder"><MediaIcon type="audio" className="mb-4 h-12 w-12 text-[var(--editor-accent)]" /><p className="max-w-full truncate px-5 text-xs">{asset.filename}</p><p className="mt-2 text-[10px] opacity-60">Audio source</p><audio ref={mediaRef as Ref<HTMLAudioElement>} src={asset.url} aria-label={`Preview ${asset.filename}`} preload="metadata" {...events} /></div>;
}
