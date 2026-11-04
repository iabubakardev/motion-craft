// @ts-check
const { createStore } = require("zustand/vanilla");
/** @param {string[]} ids @param {string} id @param {boolean} additive */
function selectIds(ids, id, additive) {
  return additive ? (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]) : [id];
}
/** @returns {import('zustand/vanilla').StoreApi<import('./interaction-types').TimelineState>} */
function createTimelineStore() {
  return createStore((set, get) => ({
    selectedIds: [],
    activeTrackId: null,
    playheadFrame: 0,
    zoom: 12,
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 900,
    viewportHeight: 180,
    snapEnabled: true,
    dragAssetId: null,
    drag: null,
    clipboard: [],
    message: "",
    setSelection: (ids) => set({ selectedIds: [...new Set(ids)] }),
    selectClip: (id, additive) =>
      set((state) => ({ selectedIds: selectIds(state.selectedIds, id, additive) })),
    setPlayhead: (frame) => {
      if (Number.isFinite(frame)) set({ playheadFrame: Math.max(0, Math.round(frame)) });
    },
    setZoom: (zoom) => {
      if (Number.isFinite(zoom)) set({ zoom: Math.max(0.01, Math.min(600, zoom)) });
    },
    setView: (view) => set(view),
    selectTrack: (id) => set({ activeTrackId: id }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    setDrag: (drag) => set({ drag }),
    startAssetDrag: (id) => set({ dragAssetId: id }),
    cancelDrag: () => set({ drag: null, dragAssetId: null }),
    setClipboard: (items) => set({ clipboard: structuredClone(items) }),
    setMessage: (message) => set({ message }),
    reset: () => {
      get().cancelDrag();
      set({
        selectedIds: [],
        activeTrackId: null,
        playheadFrame: 0,
        clipboard: [],
        message: "",
        scrollLeft: 0,
        scrollTop: 0,
      });
    },
  }));
}
module.exports = { createTimelineStore, selectIds };
