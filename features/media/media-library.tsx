"use client";

import { AssetSearch } from "./asset-search";
import { useState } from "react";
import type { MediaType } from "@/core/media/types";
import type { useMediaLibrary } from "./use-media-library";
import { filterAssets } from "./library.cjs";
import { MediaIcon } from "./media-icon";
import { MediaItems } from "./media-items";

const filters: { type: MediaType | "all"; label: string }[] = [
  { type: "all", label: "All media" },
  { type: "video", label: "Videos" },
  { type: "image", label: "Images" },
  { type: "audio", label: "Audio" },
];

export default function MediaLibrary({
  library,
  audioOnly = false,
}: {
  library: ReturnType<typeof useMediaLibrary>;
  audioOnly?: boolean;
}) {
  const [indexOpen, setIndexOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MediaType | "all">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const visible = filterAssets(library.assets, search, audioOnly ? "audio" : filter);

  return (
    <section
      aria-label={audioOnly ? "Audio library" : "Media library"}
      className="media-library-panel flex h-full min-h-0 flex-col"
    >
      {indexOpen && (
        <AssetSearch
          assets={library.assets}
          selectedId={library.selectedId}
          onSelect={library.setSelectedId}
          onClose={() => setIndexOpen(false)}
        />
      )}
      <div className="shrink-0 space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium">{audioOnly ? "Audio library" : "Media library"}</h2>
          <button
            type="button"
            onClick={library.importMedia}
            disabled={!library.available || library.loading || library.importing}
            title="Import media (Ctrl+O)"
            aria-keyshortcuts="Control+O"
            className="editor-primary !px-2.5 !py-1.5 text-[11px]"
          >
            <span aria-hidden="true">+</span> {library.importing ? "Importing…" : "Import media"}
          </button>
        </div>
        {!audioOnly && (
          <button className="editor-secondary w-full" onClick={() => setIndexOpen(true)}>
            Smart asset search
          </button>
        )}
        {!library.loading && !library.available && (
          <p role="status" className="text-[11px] leading-5 text-amber-200">
            Local media import is available in the desktop app.
          </p>
        )}
        <label className="block">
          <span className="sr-only">Search media by filename</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search media…"
            className="editor-input w-full"
          />
        </label>
        <div className="flex items-center justify-between gap-1">
          <nav aria-label="Media filters" className="flex gap-0.5">
            {!audioOnly &&
              filters.map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={filter === type}
                  onClick={() => setFilter(type)}
                  className={`editor-icon-button ${filter === type ? "is-active" : ""}`}
                >
                  <MediaIcon type={type} className="h-3.5 w-3.5" />
                </button>
              ))}
            {audioOnly && (
              <span className="text-[10px] text-[var(--editor-muted)]">Session audio</span>
            )}
          </nav>
          <div aria-label="Media view" className="flex gap-0.5">
            {(["grid", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-label={`${mode === "grid" ? "Grid" : "List"} view`}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={`editor-icon-button !px-1.5 text-[10px] capitalize ${view === mode ? "is-active" : ""}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        role="status"
        aria-live="polite"
        className="shrink-0 border-y border-[var(--editor-border)] px-3 py-2 text-[10px] text-[var(--editor-muted)]"
      >
        {library.importing
          ? "Choose files in the native dialog…"
          : library.notice ||
            `${visible.length} ${visible.length === 1 ? "asset" : "assets"} in session`}
      </div>
      {library.errors.length > 0 && (
        <div
          role="alert"
          className="max-h-24 shrink-0 overflow-auto border-b border-red-400/20 bg-red-400/5 p-3 text-[10px] text-red-300"
        >
          <p>Some media could not be imported</p>
          <ul className="mt-1 space-y-1">
            {library.errors.map((error, index) => (
              <li key={`${index}-${error}`}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {library.loading ? (
          <p role="status" className="py-10 text-center text-xs text-[var(--editor-muted)]">
            Loading media session…
          </p>
        ) : library.assets.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center border border-dashed border-[var(--editor-border)] px-3 py-6 text-center">
            <MediaIcon type="all" className="mb-4 h-7 w-7 text-[var(--editor-muted)]" />
            <h3 className="text-xs font-medium">Your media starts here</h3>
            <p className="mt-2 text-[11px] leading-5 text-[var(--editor-muted)]">
              Import video, audio, or images.
              <br />
              Original files stay on your device.
            </p>
            <p className="mt-4 text-[9px] text-[var(--editor-muted)]">
              MP4 · MOV · WebM · MP3 · WAV
              <br />
              PNG · JPG · JPEG · WebP
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-xs text-[var(--editor-muted)]">No matching media.</p>
            <button
              type="button"
              className="mt-3 text-[11px] text-[var(--editor-accent)]"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear search and filter
            </button>
          </div>
        ) : (
          <MediaItems
            assets={visible}
            view={view}
            selectedId={library.selectedId}
            onSelect={library.setSelectedId}
            onError={library.markUnavailable}
          />
        )}
      </div>
    </section>
  );
}
