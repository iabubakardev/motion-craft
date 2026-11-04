const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_PANELS, constrainPanels, parseLayout } = require("./layout.cjs");
const { editorReducer, initialEditorState, isEditingText } = require("./editor-state.cjs");

test("panels preserve usable source monitor and timeline bounds at desktop minimum", () => {
  const panels = constrainPanels({ left: 480, right: 420, bottom: 480 }, 1100, 624);
  assert.ok(panels.left >= 200 && panels.left <= 480);
  assert.ok(panels.right >= 220 && panels.right <= 420);
  assert.ok(1100 - panels.left - panels.right - 12 >= 320);
  assert.ok(624 - panels.bottom - 6 >= 240);
  assert.deepEqual(constrainPanels({ left: -5, right: 0, bottom: 9999 }, 1440, 800), { left: 200, right: 220, bottom: 480 });
});

test("local layout accepts only bounded versioned dimensions, never paths or session assets", () => {
  const valid = { version: 1, left: 310, right: 270, bottom: 220 };
  assert.deepEqual(parseLayout(JSON.stringify(valid)), { left: 310, right: 270, bottom: 220 });
  for (const raw of [null, "not json", "null", JSON.stringify({ ...valid, left: 1 }), JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, originalPath: "C:/private.mp4" })]) {
    assert.deepEqual(parseLayout(raw), DEFAULT_PANELS);
  }
});

test("transient editor changes do not mutate initial state or mix source and timeline clocks", () => {
  const preview = { assetId: "asset", currentTime: 15, duration: 60, playing: true, fullscreen: false };
  let state = editorReducer(initialEditorState, { type: "preview", preview });
  state = editorReducer(state, { type: "playhead", time: 999 });
  state = editorReducer(state, { type: "zoom", zoom: 1000 });
  state = editorReducer(state, { type: "tab", tab: "scenes" });
  assert.equal(state.playhead, 999);
  assert.equal(state.timelineZoom, 80);
  assert.equal(state.preview.currentTime, 15);
  assert.equal(state.sidebarTab, "scenes");
  assert.equal(initialEditorState.playhead, 0);
  assert.equal(initialEditorState.preview.assetId, null);
  assert.equal(editorReducer(state, { type: "playhead", time: -10 }).playhead, 0);
});

test("shortcut guard recognizes editing controls and tolerates non-element targets", () => {
  assert.equal(isEditingText(null), false);
  assert.equal(isEditingText({}), false);
  assert.equal(isEditingText({ closest: () => ({}) }), true);
  assert.equal(isEditingText({ closest: () => null }), false);
});
