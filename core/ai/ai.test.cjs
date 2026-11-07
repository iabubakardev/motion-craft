const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { transcriptSchema, planSchema } = require("./schema.cjs");
const {
  preparePlan,
  validateVisuals,
  rankAssets,
  suggestAssets,
  applyPlan,
} = require("./planning.cjs");
const ops = require("../project/operations.cjs");
const { serializeProject, parseProjectJSON } = require("../project/schema.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
const now = "2026-11-05T12:00:00.000Z";
const settings = {
  fps: 30,
  aspectRatio: "16:9",
  style: "default",
  minSeconds: 2,
  maxSeconds: 12,
  wordsPerMinute: 150,
  instructions: "",
  temperature: 0.2,
};
function transcript() {
  return {
    version: 1,
    id: randomUUID(),
    sourceAssetId: randomUUID(),
    language: "en",
    text: "A forest grows. Water flows.",
    duration: 10,
    model: { engine: "faster-whisper", name: "tiny-en", device: "cpu", computeType: "int8" },
    segments: [
      {
        id: randomUUID(),
        start: 0.25,
        end: 4.125,
        text: "A forest grows.",
        words: [
          { text: "A", start: 0.25, end: 0.4, probability: 0.9 },
          { text: "forest grows.", start: 0.4, end: 4.125 },
        ],
      },
      { id: randomUUID(), start: 6.2, end: 9.75, text: "Water flows." },
    ],
  };
}
function visual(plan) {
  return {
    ...plan,
    scenes: plan.scenes.map((s, i) => ({
      ...s,
      visualDescription: i ? "River running over rocks" : "Sunlight through a forest",
      keywords: i ? ["river", "water"] : ["forest"],
      assetType: "image",
      animation: "fade-in",
    })),
  };
}
function project(t) {
  return ops.mergeProjectAssets(ops.createProject({ now }), [
    {
      id: t.sourceAssetId,
      filename: "narration.wav",
      type: "audio",
      mimeType: "audio/wav",
      size: 100,
      importedAt: now,
      duration: t.duration,
    },
    {
      id: randomUUID(),
      filename: "forest-sunlight.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      importedAt: now,
      width: 1920,
      height: 1080,
    },
    {
      id: randomUUID(),
      filename: "unrelated.png",
      type: "image",
      mimeType: "image/png",
      size: 10,
      importedAt: now,
    },
  ]);
}
test("transcript contracts retain exact source timestamps and reject overlaps, bad words and invented aggregate text", () => {
  const t = transcript();
  assert.deepEqual(transcriptSchema.parse(t), t);
  for (const mutate of [
    (x) => (x.segments[1].start = 1),
    (x) => (x.segments[0].words[0].start = -1),
    (x) => (x.segments[0].end = 11),
    (x) => (x.text = "changed"),
    (x) => (x.segments[1].id = x.segments[0].id),
  ]) {
    const invalid = structuredClone(t);
    mutate(invalid);
    assert.equal(transcriptSchema.safeParse(invalid).success, false);
  }
});
test("scene grouping is bounded, deterministic and leaves source timing unchanged", () => {
  const t = transcript(),
    id = randomUUID(),
    before = JSON.stringify(t);
  const plan = preparePlan({ kind: "transcript", transcript: t }, settings, id);
  assert.deepEqual(plan, preparePlan({ kind: "transcript", transcript: t }, settings, id));
  assert.equal(plan.duration, t.duration);
  assert.equal(JSON.stringify(t), before);
  assert.equal(plan.scenes[0].start, 0);
  assert.equal(plan.scenes.at(-1).end, t.duration);
  for (const s of plan.scenes)
    assert.ok(s.end - s.start >= settings.minSeconds && s.end - s.start <= settings.maxSeconds);
  for (let seconds = 0.5; seconds < 60; seconds += 0.31) {
    const timing = transcript();
    timing.segments = [{ id: randomUUID(), start: 0, end: seconds, text: "Narration" }];
    timing.text = "Narration";
    timing.duration = seconds;
    const p = preparePlan(
      { kind: "transcript", transcript: timing },
      { ...settings, minSeconds: 2, maxSeconds: 4 },
      randomUUID(),
    );
    for (const scene of p.scenes)
      assert.ok(
        scene.end - scene.start <= 4 + 1e-6 && (seconds < 2 || scene.end - scene.start >= 2 - 1e-6),
      );
  }
});
test("script plans explicitly estimate timing; model output cannot change timing or scene identities", () => {
  const p = preparePlan(
    { kind: "script", text: "A forest grows. Water flows." },
    settings,
    randomUUID(),
  );
  assert.equal(p.timing, "estimated");
  assert.equal(p.transcript, null);
  const raw = {
    scenes: p.scenes.map((s) => ({
      id: s.id,
      visualDescription: "Forest trees",
      keywords: ["forest"],
      assetType: "image",
      animation: "none",
    })),
  };
  assert.equal(validateVisuals(p.scenes, raw)[0].start, p.scenes[0].start);
  assert.throws(() => validateVisuals(p.scenes, { scenes: [] }));
  assert.throws(() =>
    validateVisuals(p.scenes, { scenes: raw.scenes.map((s) => ({ ...s, id: randomUUID() })) }),
  );
  assert.throws(() =>
    validateVisuals(p.scenes, { scenes: raw.scenes.map((s) => ({ ...s, run: "alert(1)" })) }),
  );
  assert.throws(() => planSchema.parse({ ...p, scenes: [{ ...p.scenes[0], start: 1 }] }));
});
test("metadata matching explains rankings, excludes audio and never auto-picks unrelated assets", () => {
  const t = transcript(),
    p = project(t),
    plan = visual(preparePlan({ kind: "transcript", transcript: t }, settings, randomUUID()));
  const ranked = rankAssets(plan.scenes[0], p.assets, plan.aspectRatio);
  assert.equal(ranked[0].assetId, p.assets[1].id);
  assert.ok(ranked[0].reasons.some((r) => r.includes("forest")));
  assert.equal(suggestAssets(plan, p.assets).scenes[0].assetId, p.assets[1].id);
  assert.equal(
    suggestAssets(
      { ...plan, scenes: plan.scenes.map((s) => ({ ...s, keywords: ["volcano"] })) },
      p.assets,
    ).scenes[0].assetId,
    null,
  );
});
test("approved plans create real clips/captions/narration atomically and survive history and save/open", () => {
  const t = transcript(),
    p = project(t),
    plan = suggestAssets(
      visual(preparePlan({ kind: "transcript", transcript: t }, settings, randomUUID())),
      p.assets,
    );
  const next = applyPlan(p, plan, now),
    clips = next.tracks.flatMap((t) => t.clips);
  assert.ok(clips.some((c) => c.assetId === t.sourceAssetId));
  assert.ok(next.scenes.flatMap((s) => s.layers).some((l) => l.type === "caption"));
  assert.ok(Object.keys(next.animations).length);
  const caps = next.scenes.flatMap((s) =>
    s.layers
      .filter((l) => l.type === "caption")
      .map((l) => ({ start: s.start + l.start, end: s.start + l.start + l.duration })),
  );
  assert.ok(caps.some((c) => c.start === 0.25));
  assert.ok(caps.some((c) => Math.abs(c.end - 9.75) < 1e-8));
  const h = commitProject(createHistory(p), next);
  assert.equal(h.past.length, 1);
  assert.deepEqual(undoProject(h).present, p);
  assert.deepEqual(redoProject(undoProject(h)).present, next);
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  assert.throws(() => applyPlan(next, plan, now), /already applied/);
  assert.equal(p.scenes.length, 0);
});
test("append preserves existing scene/manual content and standalone clip placement; lock and bad references reject", () => {
  const t = transcript();
  let p = project(t);
  p = ops.addScene(p);
  p = ops.updateScene(p, p.scenes[0].id, { narration: "Manual edit" });
  const track = p.tracks.find((t) => t.name === "V1");
  track.clips.push({
    id: randomUUID(),
    assetId: p.assets[1].id,
    trackId: track.id,
    start: 12,
    duration: 2,
    sourceStart: null,
    sourceEnd: null,
  });
  p = ops.rebuildProject(p);
  const before = serializeProject(p),
    plan = visual(preparePlan({ kind: "script", text: "Forest sunlight" }, settings, randomUUID()));
  const next = applyPlan(p, plan, now);
  assert.deepEqual(next.scenes[0], p.scenes[0]);
  assert.deepEqual(next.tracks.find((t) => t.id === track.id).clips, track.clips);
  assert.equal(next.scenes.at(-1).start, 14);
  assert.throws(() =>
    applyPlan(
      { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: t.name === "V1" })) },
      plan,
      now,
    ),
  );
  assert.throws(() =>
    applyPlan(
      p,
      { ...plan, scenes: plan.scenes.map((s) => ({ ...s, assetId: randomUUID() })) },
      now,
    ),
  );
  assert.equal(serializeProject(p), before);
});
test("external plan JSON is strict and cannot contain paths, code, overlapping scenes or foreign keys", () => {
  const plan = visual(
    preparePlan({ kind: "script", text: "Forest sunlight" }, settings, randomUUID()),
  );
  assert.deepEqual(planSchema.parse(JSON.parse(JSON.stringify(plan))), plan);
  for (const invalid of [
    { ...plan, path: "C:/secret" },
    { ...plan, scenes: plan.scenes.map((s) => ({ ...s, assetId: "https://example.com/a.mp4" })) },
    { ...plan, version: 2 },
  ])
    assert.equal(planSchema.safeParse(invalid).success, false);
});

test("structured sidecar retains trusted IDs, source and model with normalized frame durations", () => {
  const { toScenePlan, scenePlanSchema } = require("./scene-plan.cjs");
  const plan = preparePlan(
    { kind: "script", text: "A forest grows. Water flows." },
    settings,
    randomUUID(),
  );
  const result = toScenePlan({
    ...plan,
    sourceText: "A forest grows. Water flows.",
    modelId: "qwen3:8b",
  });
  assert.equal(result.modelId, "qwen3:8b");
  assert.equal(result.planId, plan.id);
  assert.equal(result.timing, "estimated");
  assert.equal(result.scenes[0].sceneId, plan.scenes[0].id);
  assert.equal(result.scenes[0].estimatedDurationFrames, Math.round(plan.duration * plan.fps));
  for (const frames of [0, -1, 1.5, Infinity])
    assert.equal(
      scenePlanSchema.safeParse({
        ...result,
        scenes: [{ ...result.scenes[0], estimatedDurationFrames: frames }],
      }).success,
      false,
    );
  assert.equal(
    scenePlanSchema.safeParse({ ...result, scenes: [{ ...result.scenes[0], order: 2 }] }).success,
    false,
  );
  assert.equal(
    scenePlanSchema.safeParse({
      ...result,
      scenes: [{ ...result.scenes[0], animationPreset: "run-shell" }],
    }).success,
    false,
  );
});

test("external transcription converts to stable planning timestamps without mutating review", () => {
  const { fixture } = require("../transcription/fixture.cjs");
  const { toPlanningTranscript } = require("./transcription.cjs");
  const { transcript } = fixture();
  const before = structuredClone(transcript);
  const converted = toPlanningTranscript(transcript);
  assert.deepEqual(converted, toPlanningTranscript(transcript));
  assert.equal(converted.sourceAssetId, transcript.assetId);
  assert.equal(converted.segments[0].start, transcript.result.segments[0].start);
  assert.equal(converted.text, "Hello world");
  assert.deepEqual(transcript, before);
  transcript.result.segments = [];
  assert.throws(() => toPlanningTranscript(transcript));
});
