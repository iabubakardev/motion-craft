// @ts-check
const { DEFAULT_PANELS } = require("./layout.cjs");

/** @param {never} action @returns {never} */
function assertNever(action) {
  throw new Error(`Unsupported editor action: ${JSON.stringify(action)}`);
}

/** @type {import('./types').EditorState} */
const initialEditorState = {
  sidebarTab: "media",
  panels: { ...DEFAULT_PANELS },
  preview: { assetId: null, currentTime: 0, duration: 0, playing: false, fullscreen: false },
  settingsOpen: false,
};

/** @param {import('./types').EditorState} state @param {import('./types').EditorAction} action @returns {import('./types').EditorState} */
function editorReducer(state, action) {
  switch (action.type) {
    case "tab":
      return { ...state, sidebarTab: action.tab };
    case "panels":
      return { ...state, panels: action.panels };
    case "preview":
      return { ...state, preview: action.preview };
    case "settings":
      return { ...state, settingsOpen: action.open };
    default:
      return assertNever(action);
  }
}

/** @param {EventTarget | null} target */
function isEditingText(target) {
  return !!(
    target &&
    "closest" in target &&
    typeof target.closest === "function" &&
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    )
  );
}

module.exports = { initialEditorState, editorReducer, isEditingText };
