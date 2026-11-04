/* eslint-disable @next/next/no-img-element -- Imported image URLs use the desktop protocol, not the Next.js image optimizer. */
import type { MediaAsset } from "@/core/media/types";
import { formatDuration, formatSize } from "./library.cjs";
import { MediaIcon } from "./media-icon";
import { useOptionalTimelineStore } from "@/features/timeline/timeline-store";

export function MediaItems({
  assets,
  view,
  selectedId,
  onSelect,
  onError,
}: {
  assets: MediaAsset[];
  view: "grid" | "list";
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (id: string) => void;
}) {
  const timeline = useOptionalTimelineStore();
  return (
    <ul
      aria-label="Imported media"
      className={view === "grid" ? "grid grid-cols-2 gap-2" : "space-y-2"}
    >
      {assets.map((asset) => (
        <li key={asset.id}>
          <button
            type="button"
            aria-pressed={selectedId === asset.id}
            onClick={() => onSelect(asset.id)}
            draggable={!!timeline && asset.status !== "error"}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-motioncraft-asset", asset.id);
              event.dataTransfer.effectAllowed = "copy";
              timeline?.getState().startAssetDrag(asset.id);
            }}
            onDragEnd={() => timeline?.getState().cancelDrag()}
            className={`group w-full overflow-hidden rounded border text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--editor-accent)] ${selectedId === asset.id ? "border-[var(--editor-accent)] bg-[var(--editor-accent)]/10" : "border-[var(--editor-border)] bg-[var(--editor-panel)] hover:border-slate-500"} ${view === "list" ? "flex items-center gap-2 p-2" : ""}`}
          >
            <div
              className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-zinc-950/60 ${view === "grid" ? "aspect-video w-full" : "h-14 w-20 rounded-md"}`}
            >
              {asset.type === "image" && asset.status !== "error" ? (
                <img
                  src={asset.thumbnailUrl || asset.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={() => onError(asset.id)}
                />
              ) : (
                <MediaIcon
                  type={asset.type}
                  className={`h-6 w-6 ${asset.type === "audio" ? "text-[var(--editor-accent)]" : "text-[var(--editor-muted)]"}`}
                />
              )}
              {asset.type !== "image" && (
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  {formatDuration(asset.duration)}
                </span>
              )}
            </div>
            <div className={`min-w-0 flex-1 ${view === "grid" ? "p-2" : ""}`}>
              <p
                className="truncate text-[11px] font-medium text-[var(--editor-text)]"
                title={asset.filename}
              >
                {asset.filename}
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[9px] text-[var(--editor-muted)]">
                <span className="uppercase">
                  {asset.filename.split(".").pop()} · {formatSize(asset.size)}
                </span>
                <span className={asset.status === "error" ? "text-amber-300" : "text-zinc-400"}>
                  {asset.status === "error"
                    ? "Unavailable"
                    : asset.status === "imported"
                      ? "Processing"
                      : "Ready"}
                </span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
