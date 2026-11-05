const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const ops = require("../project/operations.cjs");
const { parseProjectJSON, serializeProject, projectSchema } = require("../project/schema.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
const {
  executeTimelineCommand: execute,
  planTimelineEdit,
  copyClips,
  createTimelineIndex,
} = require("./commands.cjs");
const time = require("./time.cjs");
const { snapEdges, snapTargets } = require("./snapping.cjs");
const { createTimelineStore } = require("../../features/timeline/interaction-store.cjs");
const stamp = "2026-11-04T12:00:00.000Z";
function fixture(type = "video") {
  let p = ops.createProject({ now: "2026-01-01T00:00:00.000Z" });
  p = ops.mergeProjectAssets(p, [
    {
      id: randomUUID(),
      filename: type === "image" ? "still.png" : type === "audio" ? "sound.wav" : "movie.mp4",
      type,
      mimeType: type === "image" ? "image/png" : type === "audio" ? "audio/wav" : "video/mp4",
      size: 100,
      importedAt: stamp,
      ...(type !== "image" ? { duration: 10 } : {}),
    },
  ]);
  const track = p.tracks.find((t) => t.type === (type === "audio" ? "audio" : "video"));
  return execute(
    p,
    {
      type: "InsertClip",
      assetId: p.assets[0].id,
      trackId: track.id,
      clipId: randomUUID(),
      startFrame: 0,
    },
    stamp,
  );
}
const clips = (p) => p.tracks.flatMap((t) => t.clips);
const edit = (p, c) => execute(p, c, stamp);
test("frame conversions and timecodes round trip at every supported FPS without cumulative drift", () => {
  for (const fps of [24, 25, 30, 50, 60])
    for (const frame of [0, 1, fps - 1, fps, 123456, 86400 * fps]) {
      assert.equal(time.secondsToFrames(time.framesToSeconds(frame, fps), fps), frame);
      assert.equal(time.parseTimecode(time.formatTimecode(frame, fps), fps), frame);
      assert.equal(time.pixelsToFrames(time.framesToPixels(frame, 13.5, fps), 13.5, fps), frame);
    }
  assert.equal(time.secondsToFrames(0.049, 30, "floor"), 1);
  assert.equal(time.secondsToFrames(0.049, 30, "ceil"), 2);
  assert.throws(() => time.parseTimecode("00:00:00:30", 30));
  assert.throws(() => time.parseTimecode("24:00:00:01", 30));
  assert.throws(() => time.secondsToFrames(Infinity, 30));
  assert.throws(() => time.framesToSeconds(1.5, 30));
  assert.throws(() => time.pixelsToFrames(3, 0, 30));
});
test("media insertion derives real source range, still images use null ranges and invalid targets are atomic", () => {
  for (const type of ["video", "audio", "image"]) {
    const p = fixture(type),
      c = clips(p)[0];
    assert.equal(c.duration, type === "image" ? 5 : 10);
    assert.equal(c.sourceStart, type === "image" ? null : 0);
    assert.equal(c.sourceEnd, type === "image" ? null : 10);
    assert.ok(projectSchema.safeParse(p).success);
  }
  const p = fixture(),
    before = serializeProject(p),
    c = clips(p)[0];
  assert.throws(
    () =>
      edit(p, {
        type: "InsertClip",
        assetId: p.assets[0].id,
        clipId: randomUUID(),
        trackId: p.tracks.find((t) => t.type === "audio").id,
        startFrame: 0,
      }),
    /compatible/,
  );
  assert.throws(
    () =>
      edit(p, {
        type: "InsertClip",
        assetId: p.assets[0].id,
        clipId: randomUUID(),
        trackId: c.trackId,
        startFrame: 1,
      }),
    /overlap/,
  );
  const unknown = structuredClone(p);
  delete unknown.assets[0].duration;
  assert.throws(
    () =>
      edit(unknown, {
        type: "InsertClip",
        assetId: p.assets[0].id,
        clipId: randomUUID(),
        trackId: c.trackId,
        startFrame: 600,
      }),
    /known media duration/,
  );
  assert.equal(serializeProject(p), before);
});
test("moving preserves identity and source ranges; track mismatch, negative starts and overlap reject", () => {
  const p = fixture(),
    c = clips(p)[0],
    target = p.tracks.find((t) => t.type === "video" && t.id !== c.trackId);
  const moved = edit(p, {
    type: "MoveClip",
    clipIds: [c.id],
    deltaFrames: p.fps,
    trackId: target.id,
  });
  assert.deepEqual(clips(moved)[0], { ...c, start: 1, trackId: target.id });
  assert.equal(p.duration, 10);
  assert.equal(moved.duration, 11);
  assert.throws(() => edit(p, { type: "MoveClip", clipIds: [c.id], deltaFrames: -1 }), /24-hour/);
  assert.throws(
    () =>
      edit(p, {
        type: "MoveClip",
        clipIds: [c.id],
        deltaFrames: 0,
        trackId: p.tracks.find((t) => t.type === "audio").id,
      }),
    /compatible/,
  );
});
test("left/right trims preserve playback offset and enforce source/minimum frame bounds", () => {
  let p = fixture(),
    c = clips(p)[0];
  p = edit(p, { type: "TrimClip", clipId: c.id, edge: "left", frame: 2 * p.fps });
  assert.deepEqual(clips(p)[0], { ...c, start: 2, duration: 8, sourceStart: 2 });
  p = edit(p, { type: "TrimClip", clipId: c.id, edge: "right", frame: 7 * p.fps });
  assert.equal(clips(p)[0].sourceEnd, 7);
  assert.equal(clips(p)[0].duration, 5);
  assert.throws(
    () => edit(p, { type: "TrimClip", clipId: c.id, edge: "right", frame: 11 * p.fps }),
    /source duration/,
  );
  assert.throws(
    () => edit(p, { type: "TrimClip", clipId: c.id, edge: "right", frame: 2 * p.fps }),
    /one frame/,
  );
  p = edit(p, {
    type: "UpdateClipProperties",
    clipId: c.id,
    startFrame: 4 * p.fps,
    durationFrames: 3 * p.fps,
  });
  assert.equal(clips(p)[0].sourceStart, 2);
  assert.equal(clips(p)[0].sourceEnd, 5);
  assert.equal(clips(p)[0].start, 4);
  assert.throws(() =>
    edit(p, { type: "UpdateClipProperties", clipId: c.id, startFrame: 0, durationFrames: 0 }),
  );
});
test("split creates adjacent clips with correct source ranges and preserves generated layer properties", () => {
  let p = fixture(),
    c = clips(p)[0],
    newId = randomUUID();
  p = edit(p, { type: "SplitClip", clipId: c.id, newClipId: newId, frame: 4 * p.fps });
  const [left, right] = clips(p).sort((a, b) => a.start - b.start);
  assert.equal(left.id, c.id);
  assert.equal(left.sourceEnd, 4);
  assert.equal(right.id, newId);
  assert.equal(right.sourceStart, 4);
  assert.equal(right.sourceEnd, 10);
  assert.throws(
    () => edit(p, { type: "SplitClip", clipId: left.id, newClipId: randomUUID(), frame: 0 }),
    /strictly inside/,
  );
  let graphic = ops.addScene(ops.createProject({ now: "2026-01-01T00:00:00.000Z" }));
  graphic = ops.addLayer(graphic, graphic.scenes[0].id, "text");
  const layer = graphic.scenes[0].layers[0];
  graphic = ops.updateLayer(graphic, graphic.scenes[0].id, layer.id, {
    text: "Manual title",
    opacity: 0.4,
  });
  graphic = edit(graphic, {
    type: "SplitClip",
    clipId: layer.id,
    newClipId: randomUUID(),
    frame: 2 * graphic.fps,
  });
  assert.equal(graphic.scenes[0].layers.length, 2);
  for (const l of graphic.scenes[0].layers) {
    assert.equal(l.properties.text, "Manual title");
    assert.equal(l.opacity, 0.4);
  }
  for (const c of clips(graphic)) assert.equal(c.sourceStart, null);
  assert.throws(
    () => edit(graphic, { type: "MoveClip", clipIds: [layer.id], deltaFrames: 6 * graphic.fps }),
    /within their scene/,
  );
});
test("locked source/target tracks reject edits while track controls persist and reorder", () => {
  let p = fixture(),
    c = clips(p)[0];
  p = edit(p, {
    type: "UpdateTrack",
    trackId: c.trackId,
    patch: { locked: true, muted: true, visible: false, height: 80, order: 3 },
  });
  const track = p.tracks.find((t) => t.id === c.trackId);
  assert.equal(track.order, 3);
  assert.equal(track.height, 80);
  assert.equal(track.visible, false);
  assert.equal(track.muted, true);
  for (const cmd of [
    { type: "MoveClip", clipIds: [c.id], deltaFrames: 30 },
    { type: "DeleteClips", clipIds: [c.id] },
    { type: "TrimClip", clipId: c.id, edge: "right", frame: 30 },
  ])
    assert.throws(() => edit(p, cmd), /Unlock/);
  assert.throws(
    () =>
      edit(p, {
        type: "InsertClip",
        assetId: p.assets[0].id,
        clipId: randomUUID(),
        trackId: c.trackId,
        startFrame: 600,
      }),
    /locked/,
  );
  assert.deepEqual(
    [...p.tracks.map((t) => t.order)].sort((a, b) => a - b),
    p.tracks.map((_, i) => i),
  );
});
test("group movement, copy/paste and duplicate preserve offsets and remain atomic on conflict", () => {
  let p = fixture(),
    first = clips(p)[0];
  p = edit(p, { type: "DuplicateClip", clipIds: [first.id], newIds: [randomUUID()] });
  const ids = clips(p).map((c) => c.id);
  p = edit(p, { type: "MoveClip", clipIds: ids, deltaFrames: p.fps });
  assert.deepEqual(
    clips(p)
      .map((c) => c.start)
      .sort((a, b) => a - b),
    [1, 11],
  );
  const snapshot = serializeProject(p),
    newIds = ids.map(() => randomUUID()),
    items = copyClips(p, ids);
  assert.throws(() => edit(p, { type: "PasteClips", items, newIds, frame: p.fps }), /overlap/);
  assert.equal(serializeProject(p), snapshot);
  p = edit(p, { type: "PasteClips", items, newIds, frame: 30 * p.fps });
  assert.equal(clips(p).length, 4);
  assert.deepEqual(
    clips(p)
      .filter((c) => newIds.includes(c.id))
      .map((c) => c.start),
    [30, 40],
  );
  p = edit(p, { type: "DeleteClips", clipIds: newIds });
  assert.equal(clips(p).length, 2);
  assert.throws(
    () => edit(p, { type: "MoveClip", clipIds: ids, deltaFrames: 30, trackId: first.trackId }),
    /preserve their existing tracks/,
  );
});
test("preview is immutable and one committed gesture produces one undo/redo snapshot", () => {
  const p = fixture(),
    id = clips(p)[0].id,
    before = serializeProject(p),
    index = createTimelineIndex(p);
  for (let frame = 1; frame <= 100; frame++)
    planTimelineEdit(p, { type: "MoveClip", clipIds: [id], deltaFrames: frame }, index);
  assert.equal(serializeProject(p), before);
  let history = createHistory(p);
  history = commitProject(history, edit(p, { type: "MoveClip", clipIds: [id], deltaFrames: 100 }));
  assert.equal(history.past.length, 1);
  const committed = history.present;
  history = undoProject(history);
  assert.deepEqual(history.present, p);
  history = redoProject(history);
  assert.deepEqual(history.present, committed);
  assert.deepEqual(parseProjectJSON(serializeProject(committed)).project, committed);
});
test("snapping uses screen-space tolerance, excludes selection, and deterministic nearest edges", () => {
  const p = fixture(),
    id = clips(p)[0].id,
    targets = snapTargets(p, 60, [id]);
  assert.deepEqual(targets, [0, 60]);
  assert.deepEqual(snapEdges([58], targets, 3), { delta: 2, guide: 60 });
  assert.equal(snapEdges([55], targets, 3).guide, null);
  assert.equal(snapEdges([15], [10, 20], 8).guide, 10);
  for (const zoom of [4, 12, 80]) {
    const threshold = (8 * p.fps) / zoom;
    assert.equal(snapEdges([100 + threshold * 0.9], [100], threshold).guide, 100);
    assert.equal(snapEdges([100 + threshold * 1.1], [100], threshold).guide, null);
  }
});
test("v1 migration preserves IDs, exact timing, manual properties and rejects unsupported fields", () => {
  const path = require("node:path");
  const sample = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../public/sample-project.motioncraft.json"), "utf8"),
  );
  const result = parseProjectJSON(JSON.stringify(sample));
  assert.equal(result.success, true);
  assert.equal(result.migratedFrom, 1);
  assert.equal(result.project.schemaVersion, 2);
  assert.deepEqual(result.project.scenes, sample.scenes);
  assert.deepEqual(result.project.assets, sample.assets);
  assert.equal(result.project.duration, sample.duration);
  for (let i = 0; i < sample.tracks.length; i++) {
    const old = sample.tracks[i],
      next = result.project.tracks[i];
    assert.equal(next.id, old.id);
    assert.equal(next.height, 36);
    assert.equal(next.locked, false);
    for (let j = 0; j < old.clips.length; j++) {
      assert.equal(next.clips[j].start, old.clips[j].start);
      assert.equal(next.clips[j].duration, old.clips[j].duration);
    }
  }
  assert.deepEqual(parseProjectJSON(serializeProject(result.project)).project, result.project);
  assert.equal(parseProjectJSON(JSON.stringify({ ...sample, runScript: "bad" })).success, false);
});
test("selection, clipboard and drag previews stay transient and reset on replacement", () => {
  const store = createTimelineStore(),
    s = () => store.getState();
  s().selectClip("one", false);
  s().selectClip("two", true);
  s().selectClip("one", true);
  assert.deepEqual(s().selectedIds, ["two"]);
  s().setPlayhead(10);
  s().setZoom(16);
  s().startAssetDrag("asset");
  s().setDrag({ changes: [], valid: true, guide: 10, error: "", trackId: "track" });
  s().cancelDrag();
  assert.equal(s().drag, null);
  assert.equal(s().playheadFrame, 10);
  assert.deepEqual(s().selectedIds, ["two"]);
  s().reset();
  assert.deepEqual(s().selectedIds, []);
  assert.deepEqual(s().clipboard, []);
  assert.equal(s().playheadFrame, 0);
});
const { assertLockedTracksUnchanged } = require("./locks.cjs");
test("scene/layer commits cannot bypass track locks, while metadata and unchanged content remain editable", () => {
  let p = ops.addScene(ops.createProject({ now: "2026-01-01T00:00:00.000Z" }));
  p = ops.addLayer(p, p.scenes[0].id, "text");
  const layer = p.scenes[0].layers[0];
  p = edit(p, { type: "UpdateTrack", trackId: layer.trackId, patch: { locked: true } });
  assert.throws(
    () =>
      assertLockedTracksUnchanged(
        p,
        ops.updateLayer(p, p.scenes[0].id, layer.id, { text: "Changed" }),
      ),
    /Unlock/,
  );
  assert.throws(() => assertLockedTracksUnchanged(p, ops.deleteScene(p, p.scenes[0].id)), /Unlock/);
  assert.doesNotThrow(() =>
    assertLockedTracksUnchanged(p, ops.updateScene(p, p.scenes[0].id, { name: "New scene name" })),
  );
  const added = ops.addLayer(p, p.scenes[0].id, "shape");
  assert.notEqual(added.scenes[0].layers[1].trackId, layer.trackId);
});
test("moving legacy off-grid clips preserves exact durations/source offsets rather than accumulating rounding", () => {
  let p = fixture();
  const c = clips(p)[0];
  p = ops.rebuildProject(
    {
      ...p,
      tracks: p.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((clip) => ({
          ...clip,
          start: 0.123,
          duration: 2.345,
          sourceStart: 0.456,
          sourceEnd: 2.801,
        })),
      })),
    },
    stamp,
  );
  const before = clips(p)[0];
  for (let i = 0; i < 100; i++) p = edit(p, { type: "MoveClip", clipIds: [c.id], deltaFrames: 1 });
  const after = clips(p)[0];
  assert.ok(Math.abs(after.start - (before.start + 100 / p.fps)) < 1e-10);
  assert.equal(after.duration, before.duration);
  assert.equal(after.sourceStart, before.sourceStart);
  assert.equal(after.sourceEnd, before.sourceEnd);
  p = edit(p, {
    type: "SplitClip",
    clipId: c.id,
    newClipId: randomUUID(),
    frame: time.secondsToFrames(after.start + 1, p.fps),
  });
  const split = clips(p).sort((a, b) => a.start - b.start);
  assert.ok(Math.abs(split[0].duration + split[1].duration - before.duration) < 1e-10);
  assert.equal(split[0].sourceEnd, split[1].sourceStart);
});

test("splitting a declared unknown-duration source uses the original approved range without extending it", () => {
  let p = fixture();
  delete p.assets[0].duration;
  const before = clips(p)[0];
  p = edit(p, { type: "SplitClip", clipId: before.id, newClipId: randomUUID(), frame: 4 * p.fps });
  const split = clips(p).sort((a, b) => a.start - b.start);
  assert.equal(split[1].sourceStart, 4);
  assert.equal(split[1].sourceEnd, 10);
  assert.throws(
    () => edit(p, { type: "TrimClip", clipId: split[1].id, edge: "right", frame: 11 * p.fps }),
    /source duration/,
  );
});

test("timeline view defaults and replacement reset keep source preview separate from project playback", () => {
  const store = createTimelineStore();
  assert.equal(store.getState().monitor, "timeline");
  store.getState().setMonitor("source");
  store.getState().setPlayhead(45);
  assert.equal(store.getState().monitor, "source");
  store.getState().setMonitor("timeline");
  store.getState().setPlaying(true);
  store.getState().reset();
  assert.equal(store.getState().monitor, "timeline");
  assert.equal(store.getState().playing, false);
  assert.equal(store.getState().playheadFrame, 0);
});
