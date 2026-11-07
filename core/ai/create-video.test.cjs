const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { fixture } = require("../transcription/fixture.cjs");
const { createProject } = require("../project/operations.cjs");
const { serializeProject, parseProjectJSON } = require("../project/schema.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
const { preparePlan, validateVisuals } = require("./planning.cjs");
const {
  narrationTranscript,
  reusableTranscript,
  matchMedia,
  assembleVideo,
} = require("./create-video.cjs");
const settings = {
  fps: 30,
  aspectRatio: "16:9",
  style: "default",
  minSeconds: 1,
  maxSeconds: 2,
  wordsPerMinute: 150,
  instructions: "",
  temperature: 0.2,
};
function setup() {
  const { transcript } = fixture(),
    project = createProject();
  project.assets = [
    {
      id: transcript.assetId,
      filename: "test.mp3",
      size: 1,
      type: "audio",
      mimeType: "audio/mpeg",
      importedAt: project.createdAt,
      duration: 1,
    },
    {
      id: randomUUID(),
      filename: "world.png",
      size: 1,
      type: "image",
      mimeType: "image/png",
      importedAt: project.createdAt,
      width: 1920,
      height: 1080,
    },
  ];
  const range = { sourceStart: 0, sourceEnd: 1, timelineStart: 0, rate: 1 };
  const t = narrationTranscript(transcript, range);
  const plan = preparePlan({ kind: "transcript", transcript: t }, settings, randomUUID());
  plan.scenes = plan.scenes.map((s) => ({
    ...s,
    assetId: project.assets[1].id,
    keywords: ["world"],
    animation: "documentary-zoom",
  }));
  return {
    project,
    transcript,
    range,
    plan,
    options: { range, preset: "karaoke-highlight", replace: false },
  };
}
test("canonical transcript mapping reuses reviewed words and respects trimmed source/rate", () => {
  const { transcript, range } = setup();
  const t = narrationTranscript(transcript, {
    ...range,
    sourceStart: 0.1,
    sourceEnd: 0.9,
    rate: 2,
  });
  assert.equal(t.duration, 0.4);
  assert.equal(t.segments[0].words[0].start, (0.111 - 0.1) / 2);
  assert.equal(t.segments[0].text, "Hello world");
  assert.equal(
    reusableTranscript([transcript], transcript.assetId, { size: 1, modifiedAt: 1 }, range),
    transcript,
  );
  assert.equal(
    reusableTranscript([transcript], transcript.assetId, { size: 2, modifiedAt: 1 }, range),
    undefined,
  );
  const wordless = structuredClone(transcript);
  wordless.result.segments[0].words = [];
  assert.throws(
    () => narrationTranscript(wordless, { ...range, sourceStart: 0.5 }),
    /word alignment/,
  );
});
test("scene boundaries cover narration once, including split segments and pauses; model cannot change IDs/timing", () => {
  const { transcript } = setup();
  const t = narrationTranscript(transcript, {
    sourceStart: 0,
    sourceEnd: 1,
    timelineStart: 0,
    rate: 1,
  });
  t.duration = 8;
  t.segments = [
    {
      id: randomUUID(),
      start: 0,
      end: 8,
      text: "One two three four",
      words: [0, 2, 4, 6].map((start, i) => ({
        text: ["One", "two", "three", "four"][i],
        start,
        end: start + 1,
      })),
    },
  ];
  t.text = "One two three four";
  const plan = preparePlan({ kind: "transcript", transcript: t }, settings, randomUUID());
  assert.equal(
    plan.scenes
      .map((s) => s.narration)
      .filter(Boolean)
      .join(" "),
    t.text,
  );
  assert.equal(plan.scenes.at(-1).end, 8);
  const response = {
    scenes: [
      {
        id: plan.scenes[0].id,
        visualDescription: "World",
        keywords: ["world"],
        assetType: "image",
        animation: "none",
      },
    ],
  };
  assert.equal(validateVisuals([plan.scenes[0]], response)[0].start, 0);
  for (const patch of [
    { id: randomUUID() },
    { assetId: randomUUID() },
    { start: -1 },
    { path: "C:/secret.mp4" },
  ])
    assert.throws(() =>
      validateVisuals([plan.scenes[0]], { scenes: [{ ...response.scenes[0], ...patch }] }),
    );
});
test("matching explains descriptions/tags, leaves irrelevant and too-short media unresolved", () => {
  const { project, plan } = setup(),
    s = { ...plan.scenes[0], keywords: ["forest"] };
  assert.equal(matchMedia(s, project.assets)[0].suitable, false);
  const matches = matchMedia(s, project.assets, {
    [project.assets[1].id]: { description: "Forest at sunrise", tags: ["trees"] },
  });
  assert.equal(matches[0].suitable, true);
  assert.ok(matches[0].reasons.some((r) => r.includes("forest")));
  const short = { ...project.assets[1], type: "video", duration: 0.2 };
  assert.equal(
    matchMedia(s, [short], { [short.id]: { description: "forest", tags: [] } })[0].suitable,
    false,
  );
});
test("atomic assembly persists captions, narration, full visual coverage, style, portrait and undo/redo", () => {
  const { project, transcript, plan, options } = setup();
  plan.aspectRatio = "9:16";
  const before = serializeProject(project),
    next = assembleVideo(project, plan, transcript, options);
  assert.equal(serializeProject(project), before);
  assert.deepEqual(next.resolution, { width: 1080, height: 1920 });
  const clips = next.tracks.flatMap((t) => t.clips);
  assert.equal(clips.filter((c) => c.assetId === transcript.assetId).length, 1);
  const captions = next.scenes.flatMap((s) => s.layers).filter((l) => l.type === "caption");
  assert.ok(captions.length);
  assert.ok(captions.every((l) => l.properties.caption.preset === "karaoke-highlight"));
  assert.ok(
    Math.abs(captions[0].start + captions[0].properties.caption.words[0].start - 0.111) < 1e-6,
  );
  assert.ok(Math.abs(captions[0].start - 0.1) <= 1 / 30);
  assert.ok(next.animations[plan.scenes[0].id] === undefined);
  assert.equal(next.transcripts[0].originalSegments[0].text, "Hello world");
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  const history = commitProject(createHistory(project), next);
  assert.equal(history.past.length, 1);
  assert.deepEqual(undoProject(history).present, project);
  assert.deepEqual(redoProject(undoProject(history)).present, next);
  assert.throws(() => assembleVideo(next, plan, transcript, options), /Confirm/);
  assert.ok(assembleVideo(next, plan, transcript, { ...options, replace: true }));
});
test("assembly rejects missing, short, stale transcript and locked destructive changes", () => {
  const { project, transcript, plan, options } = setup();
  assert.throws(
    () =>
      assembleVideo(
        project,
        { ...plan, scenes: plan.scenes.map((s) => ({ ...s, assetId: null })) },
        transcript,
        options,
      ),
    /Resolve/,
  );
  const changed = structuredClone(plan);
  changed.transcript.segments[0].text = "Other";
  changed.transcript.text = "Other";
  assert.throws(() => assembleVideo(project, changed, transcript, options), /canonical/);
  project.assets[1] = { ...project.assets[1], type: "video", duration: 0.1 };
  assert.throws(() => assembleVideo(project, plan, transcript, options), /shorter/);
});

test("zero-duration word alignment preserves complete segment text without invented word times", () => {
  const { transcript, range } = setup();
  transcript.result.segments[0].words[0].end = transcript.result.segments[0].words[0].start;
  const t = narrationTranscript(transcript, range);
  assert.equal(t.text, "Hello world");
  assert.deepEqual(t.segments[0].words, []);
});
test("slower narration uses source bounds rather than output duration and preserves audible generated tracks", () => {
  const { project, transcript, range, options } = setup();
  const slow = { ...range, rate: 0.5 };
  project.tracks = project.tracks.map((t) => ({ ...t, muted: true, gainDb: -30, solo: true }));
  const plan = preparePlan(
    { kind: "transcript", transcript: narrationTranscript(transcript, slow) },
    settings,
    randomUUID(),
  );
  plan.scenes.forEach((s) => {
    s.assetId = project.assets[1].id;
  });
  const next = assembleVideo(project, plan, transcript, { ...options, range: slow });
  const c = next.tracks.flatMap((t) => t.clips).find((c) => c.assetId === transcript.assetId);
  assert.equal(c.duration, 2);
  assert.equal(c.sourceEnd, 1);
  assert.equal(c.playbackRate, 0.5);
  assert.ok(next.tracks.every((t) => !t.muted && !t.solo && (t.gainDb ?? 0) === 0));
  const invalid = structuredClone(plan);
  invalid.scenes[0].narration = "Invented narration";
  assert.throws(
    () => assembleVideo(project, invalid, transcript, { ...options, range: slow }),
    /canonical speech/,
  );
});
