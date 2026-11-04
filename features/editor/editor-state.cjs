const { DEFAULT_PANELS, clamp } = require("./layout.cjs");

/** @type {import('./types').EditorState} */
const initialEditorState = {
  sidebarTab: "media",
  panels: { ...DEFAULT_PANELS },
  preview: { assetId: null, currentTime: 0, duration: 0, playing: false, fullscreen: false },
  settingsOpen: false,
  timelineZoom: 12,
  playhead: 0,
};

/** @param {import('./types').EditorState} state @param {import('./types').EditorAction} action @returns {import('./types').EditorState} */
function editorReducer(state, action) {
  switch (action.type) {
    case "tab": return { ...state, sidebarTab: action.tab };
    case "panels": return { ...state, panels: action.panels };
    case "preview": return { ...state, preview: action.preview };
    case "settings": return { ...state, settingsOpen: action.open };
    case "zoom": return { ...state, timelineZoom: clamp(action.zoom, 4, 80) };
    case "playhead": return { ...state, playhead: clamp(action.time, 0, 86400) };
    default: return state;
  }
}

/** @param {EventTarget | null} target */
function isEditingText(target) {
  return !!(target && typeof target.closest === "function" && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
}

module.exports = { initialEditorState, editorReducer, isEditingText };
