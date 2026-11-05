const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const ops = require("../core/project/operations.cjs");
const { executeTimelineCommand } = require("../core/timeline/commands.cjs");
const { buildComposition, renderInputSchema } = require("./input.cjs");
const { startArgsSchema, workerEventSchema, jobSchema } = require("./contracts.cjs");
const { verifyRender } = require("../electron/verify-render.cjs");
function sample() {
  let p = ops.addScene(ops.createProject({ now: "2026-01-01T00:00:00.000Z" }));
  p = ops.addLayer(p, p.scenes[0].id, "text");
  p = ops.addLayer(p, p.scenes[0].id, "shape");
  return p;
}
test("composition adapter preserves the validated project and applies frame half-open intervals", () => {
  const p = sample(),
    before = JSON.stringify(p),
    model = buildComposition({ project: p, sources: {} });
  assert.equal(model.fps, 30);
  assert.equal(model.durationInFrames, 150);
  assert.equal(model.clips.length, 2);
  assert.equal(model.clips[0].from, 0);
  assert.equal(model.clips[0].durationInFrames, 150);
  assert.equal(JSON.stringify(p), before);
  const moved = ops.updateLayer(p, p.scenes[0].id, p.scenes[0].layers[0].id, {
    start: 0.123,
    duration: 1.234,
  });
  const c = buildComposition({ project: moved, sources: {} }).clips.find(
    (c) => c.id === p.scenes[0].layers[0].id,
  );
  assert.equal(c.from, 4);
  assert.equal(c.durationInFrames, 37);
});
test("render order is bottom tracks first and preserves layer transforms and properties", () => {
  let p = sample();
  const first = p.scenes[0].layers[0];
  p = ops.updateLayer(p, p.scenes[0].id, first.id, {
    position: { x: 12, y: 30 },
    opacity: 0.4,
    rotation: 45,
    scale: 2,
    text: "Manual title",
  });
  const model = buildComposition({ project: p, sources: {} }),
    clip = model.clips.find((c) => c.id === first.id);
  assert.equal(clip.layer.position.x, 12);
  assert.equal(clip.layer.opacity, 0.4);
  assert.equal(clip.layer.rotation, 45);
  assert.equal(clip.layer.scale, 2);
  assert.equal(clip.layer.properties.text, "Manual title");
  const orders = model.clips.map(
    (c) => p.tracks.find((t) => t.clips.some((item) => item.id === c.id)).order,
  );
  assert.ok(orders.every((n, i) => i === 0 || orders[i - 1] >= n));
});
test("track visibility and audio mute remove clips while video mute keeps its picture", () => {
  let p = sample();
  const track = p.tracks.find((t) => t.clips.length);
  p = { ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, visible: false } : t)) };
  assert.equal(buildComposition({ project: p, sources: {} }).clips.length, 1);
  p = { ...p, tracks: p.tracks.map((t) => ({ ...t, visible: true, muted: true })) };
  assert.ok(buildComposition({ project: p, sources: {} }).clips.every((c) => c.muted));
});
test("playable source offsets, simultaneous tracks and missing sources remain explicit", () => {
  let p = ops.createProject({ now: "2026-01-01T00:00:00.000Z" });
  const id = randomUUID(),
    stamp = "2026-11-05T00:00:00.000Z";
  p = ops.mergeProjectAssets(p, [
    {
      id,
      filename: "audio.wav",
      type: "audio",
      mimeType: "audio/wav",
      size: 100,
      duration: 10,
      importedAt: stamp,
    },
  ]);
  const track = p.tracks.find((t) => t.type === "audio");
  p = executeTimelineCommand(
    p,
    { type: "InsertClip", assetId: id, clipId: randomUUID(), trackId: track.id, startFrame: 30 },
    stamp,
  );
  const clip = p.tracks.flatMap((t) => t.clips)[0];
  p = executeTimelineCommand(
    p,
    { type: "TrimClip", clipId: clip.id, edge: "left", frame: 60 },
    stamp,
  );
  let model = buildComposition({ project: p, sources: {} });
  assert.equal(model.clips[0].src, null);
  assert.equal(model.clips[0].from, 60);
  assert.equal(model.clips[0].sourceStart, 30);
  model = buildComposition({ project: p, sources: { [id]: `motioncraft-media://asset/${id}` } });
  assert.equal(model.clips[0].src, `motioncraft-media://asset/${id}`);
  p = { ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, muted: true } : t)) };
  assert.equal(buildComposition({ project: p, sources: {} }).clips.length, 0);
});
test("external render inputs reject paths, arbitrary URLs, invalid projects and unsupported fields", () => {
  const p = sample(),
    id = randomUUID();
  for (const url of [
    "file:///C:/private.mp4",
    "http://evil.test/media",
    "http://127.0.0.1:9000/private.mp4",
    "javascript:alert(1)",
  ])
    assert.equal(
      renderInputSchema.safeParse({ project: p, sources: { [id]: url } }).success,
      false,
    );
  assert.equal(startArgsSchema.safeParse([p, "C:/output.mp4"]).success, false);
  assert.equal(startArgsSchema.safeParse([{ ...p, runScript: "evil" }]).success, false);
  assert.equal(
    workerEventSchema.safeParse({ type: "progress", state: "rendering", progress: 2 }).success,
    false,
  );
  assert.equal(
    jobSchema.safeParse({
      id,
      state: "completed",
      progress: 1,
      filename: "C:/private.mp4",
      message: "",
    }).success,
    false,
  );
});
test("empty and gap-only compositions have explicit background and bounded duration", () => {
  const empty = buildComposition({
    project: ops.createProject({ now: "2026-01-01T00:00:00.000Z" }),
    sources: {},
  });
  assert.equal(empty.durationInFrames, 1);
  assert.equal(empty.clips.length, 0);
  const p = ops.addScene(ops.createProject({ now: "2026-01-01T00:00:00.000Z" })),
    gap = buildComposition({ project: p, sources: {} });
  assert.equal(gap.durationInFrames, 150);
  assert.equal(gap.background, p.settings.backgroundColor);
});
test("output verification checks real codec, frame rate, resolution, duration and required AAC audio", () => {
  const model = { width: 320, height: 180, fps: 30, durationInFrames: 60 },
    probe = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 320,
          height: 180,
          avg_frame_rate: "30/1",
          duration: "2",
        },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: { duration: "2" },
    };
  assert.equal(verifyRender(probe, model, true).audioCodec, "aac");
  assert.throws(() => verifyRender({ ...probe, streams: probe.streams.slice(0, 1) }, model, true));
  assert.throws(() => verifyRender(probe, { ...model, width: 640 }, true));
  assert.throws(() => verifyRender(probe, { ...model, fps: 25 }, true));
  assert.throws(() => verifyRender(probe, { ...model, durationInFrames: 90 }, true));
});

test("native source inspection rejects a trim beyond actual media even if project metadata claims a longer duration", () => {
  const { sourceDuration, verifySourceRange } = require("../electron/verify-render.cjs");
  const duration = sourceDuration(
    {
      streams: [{ codec_type: "video", codec_name: "h264", duration: "2" }],
      format: { duration: "2" },
    },
    "video",
  );
  assert.equal(duration, 2);
  assert.doesNotThrow(() => verifySourceRange(30, 30, 30, duration));
  assert.throws(() => verifySourceRange(30, 60, 30, duration), /actual media duration/);
  assert.throws(() => sourceDuration({ streams: [], format: { duration: "2" } }, "audio"));
});
