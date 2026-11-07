const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { createProject, rebuildProject } = require("../project/operations.cjs");
const { executeVisualCommand } = require("./visual.cjs"),
  { defaultVisual, visualSchema } = require("./visual-schema.cjs");
const { executeTimelineCommand } = require("./commands.cjs");
const { buildComposition } = require("../../rendering/input.cjs");
const { serializeProject, parseProjectJSON } = require("../project/schema.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
function fixture() {
  const p = createProject(),
    track = p.tracks.find((t) => t.type === "video"),
    id = randomUUID();
  p.assets = [
    {
      id: randomUUID(),
      filename: "test.mp4",
      type: "video",
      mimeType: "video/mp4",
      size: 1,
      duration: 12,
      importedAt: p.createdAt,
    },
  ];
  track.clips = [
    {
      id,
      assetId: p.assets[0].id,
      trackId: track.id,
      start: 3,
      duration: 6,
      sourceStart: 2,
      sourceEnd: 8,
    },
  ];
  return { p: rebuildProject(p), id, trackId: track.id };
}
test("visual editing is validated, immutable, locked, undoable and persists through save/reopen", () => {
  const { p, id, trackId } = fixture(),
    v = visualSchema.parse(defaultVisual());
  v.x = 100;
  v.scaleX = 1.2;
  v.flipX = true;
  v.crop.left = 0.1;
  v.entrance = "fade";
  const next = executeVisualCommand(p, { type: "UpdateVisual", clipId: id, visual: v });
  assert.equal(p.tracks[0].clips[0].visual, undefined);
  assert.deepEqual(next.tracks[0].clips[0].visual, v);
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  const h = commitProject(createHistory(p), next);
  assert.deepEqual(undoProject(h).present, p);
  assert.deepEqual(redoProject(undoProject(h)).present, next);
  const locked = { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: t.id === trackId })) };
  assert.throws(
    () => executeVisualCommand(locked, { type: "UpdateVisual", clipId: id, visual: v }),
    /Unlock/,
  );
  assert.throws(() =>
    executeVisualCommand(p, {
      type: "UpdateVisual",
      clipId: id,
      visual: { ...v, crop: { ...v.crop, right: 0.95 } },
    }),
  );
  const rendered = buildComposition({ project: next, sources: {} }).clips[0];
  assert.deepEqual(rendered.visual, v);
});
test("speed, trim and split retain source-time mapping away from zero", () => {
  const { p, id } = fixture(),
    fast = executeVisualCommand(p, { type: "SetPlaybackRate", clipId: id, rate: 2 });
  const get = (p) => p.tracks.flatMap((t) => t.clips);
  assert.equal(get(fast)[0].duration, 3);
  assert.equal(get(fast)[0].sourceStart, 2);
  assert.equal(get(fast)[0].sourceEnd, 8);
  const split = executeTimelineCommand(
    fast,
    { type: "SplitClip", clipId: id, frame: 120, newClipId: randomUUID() },
    new Date().toISOString(),
  );
  assert.equal(get(split)[0].sourceEnd, 4);
  assert.equal(get(split)[1].sourceStart, 4);
  const trim = executeTimelineCommand(
    fast,
    { type: "TrimClip", clipId: id, edge: "left", frame: 120 },
    new Date().toISOString(),
  );
  assert.equal(get(trim)[0].sourceStart, 4);
  assert.equal(get(trim)[0].duration, 2);
  assert.equal(buildComposition({ project: fast, sources: {} }).clips[0].playbackRate, 2);
  assert.throws(() => executeVisualCommand(p, { type: "SetPlaybackRate", clipId: id, rate: 0 }));
});
