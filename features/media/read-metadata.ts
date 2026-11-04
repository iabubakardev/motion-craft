import type { MediaAsset, MediaMetadata } from "@/core/media/types";

// Chromium decodes only the approved asset URL. No filesystem path enters React.
export function readMediaMetadata(asset: MediaAsset, signal?: AbortSignal): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const element = asset.type === "image" ? new window.Image() : document.createElement(asset.type);
    let finished = false;
    const finish = (metadata: MediaMetadata) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      element.onload = null;
      element.onerror = null;
      if (element instanceof HTMLMediaElement) {
        element.onloadedmetadata = null;
        element.removeAttribute("src");
        element.load();
      } else {
        element.removeAttribute("src");
      }
      resolve(metadata);
    };
    const abort = () => finish({ status: "error" });
    const timeout = setTimeout(() => finish({ status: "error" }), 15000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    element.onerror = () => finish({ status: "error" });
    if (element instanceof HTMLImageElement) {
      element.onload = () => finish({ status: "ready", width: element.naturalWidth, height: element.naturalHeight });
    } else {
      element.preload = "metadata";
      element.onloadedmetadata = () => finish({
        status: "ready",
        ...(Number.isFinite(element.duration) ? { duration: element.duration } : {}),
        ...(element instanceof HTMLVideoElement && element.videoWidth > 0 ? { width: element.videoWidth, height: element.videoHeight } : {}),
      });
    }
    element.src = asset.url;
  });
}
