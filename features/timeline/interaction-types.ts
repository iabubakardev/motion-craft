import type { ClipboardItem, ClipChange } from "@/core/timeline/types";
export interface DragPreview {
  changes: ClipChange[];
  guide: number | null;
  valid: boolean;
  error: string;
  trackId: string;
}
export interface TimelineState {
  monitor: "timeline" | "source";
  playing: boolean;
  setMonitor: (monitor: "timeline" | "source") => void;
  setPlaying: (playing: boolean) => void;
  selectedIds: string[];
  activeTrackId: string | null;
  playheadFrame: number;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  snapEnabled: boolean;
  dragAssetId: string | null;
  drag: DragPreview | null;
  clipboard: ClipboardItem[];
  message: string;
  setSelection: (ids: string[]) => void;
  selectClip: (id: string, additive: boolean) => void;
  setPlayhead: (frame: number) => void;
  setZoom: (zoom: number) => void;
  setView: (
    view: Partial<
      Pick<TimelineState, "scrollLeft" | "scrollTop" | "viewportWidth" | "viewportHeight">
    >,
  ) => void;
  selectTrack: (id: string) => void;
  toggleSnap: () => void;
  setDrag: (drag: DragPreview | null) => void;
  startAssetDrag: (id: string) => void;
  cancelDrag: () => void;
  setClipboard: (items: ClipboardItem[]) => void;
  setMessage: (text: string) => void;
  reset: () => void;
}
