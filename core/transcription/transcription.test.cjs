const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./fixture.cjs");
const { generateCaptions, editTranscript, saveTranscript } = require("./commands.cjs");
const { createProject, addScene, updateScene } = require("../project/operations.cjs");
const { serializeProject, parseProjectJSON, projectSchema } = require("../project/schema.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
const { buildComposition } = require("../../rendering/input.cjs");
function setup() {
  const { transcript } = fixture();
  const project = createProject();
  project.assets.push({
    id: transcript.assetId,
    filename: "test.mp3",
    type: "audio",
    mimeType: "audio/mpeg",
    size: 1,
    importedAt: project.createdAt,
    duration: 1,
  });
  return { project, transcript };
}
test("review edits retain original text, seconds and metadata; invalid timings/paths reject", () => {
  const { project, transcript } = setup(),
    edited = editTranscript(transcript, 0, "Edited text");
  assert.equal(edited.originalSegments[0].text, "Hello world");
  assert.equal(edited.result.segments[0].start, 0.111);
  assert.deepEqual(edited.result.segments[0].words, []);
  const saved = saveTranscript(project, edited);
  assert.deepEqual(parseProjectJSON(serializeProject(saved)).project, saved);
  assert.equal(
    projectSchema.safeParse({
      ...saved,
      transcripts: [{ ...edited, result: { ...edited.result, audioPath: "secret" } }],
    }).success,
    false,
  );
  assert.equal(
    projectSchema.safeParse({
      ...saved,
      transcripts: [
        {
          ...edited,
          result: { ...edited.result, segments: [{ ...edited.result.segments[0], end: NaN }] },
        },
      ],
    }).success,
    false,
  );
});
test("captions use project frames, normal inspector layers, top track, atomic history and save/reload", () => {
  const { project, transcript } = setup(),
    next = generateCaptions(project, transcript, 3);
  const track = next.tracks.find((t) => t.name === "Captions"),
    clip = track.clips[0],
    layer = next.scenes[0].layers[0];
  assert.equal(clip.start, 6 / 30);
  assert.ok(Math.abs(clip.duration - 22 / 30) < 1e-10);
  assert.equal(track.order, 0);
  assert.equal(layer.type, "caption");
  assert.equal(layer.properties.text, "Hello world");
  const h = commitProject(createHistory(project), next);
  assert.deepEqual(undoProject(h).present, project);
  assert.deepEqual(redoProject(undoProject(h)).present, next);
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  assert.throws(() => generateCaptions(next, next.transcripts[0]), /already has captions/);
  const composition = buildComposition({ project: next, sources: {} });
  assert.ok(composition.clips.some((c) => c.layer?.type === "caption" || c.type === "caption"));
});
test("caption generation preserves unrelated content, splits at fractional scene boundaries, rejects locks and zero speech", () => {
  const { project, transcript } = setup();
  let p = addScene(project);
  p = updateScene(p, p.scenes[0].id, { duration: 0.5, narration: "Manual scene" });
  const next = generateCaptions(p, transcript);
  assert.equal(next.scenes[0].narration, "Manual scene");
  assert.equal(next.transcripts[0].captionIds.length, 2);
  const locked = {
    ...next,
    tracks: next.tracks.map((t) => ({ ...t, locked: t.name === "Captions" })),
  };
  const fresh = {
    ...transcript,
    id: crypto.randomUUID(),
    result: { ...transcript.result, jobId: "" },
  };
  fresh.result.jobId = fresh.id;
  assert.throws(() => generateCaptions(locked, fresh), /Unlock/);
  assert.throws(
    () =>
      generateCaptions(project, {
        ...transcript,
        result: { ...transcript.result, segments: [] },
        originalSegments: [],
      }),
    /No speech/,
  );
  const tiny = {
    ...transcript,
    result: {
      ...transcript.result,
      segments: [{ id: 0, start: 0.001, end: 0.002, text: "Tiny", words: [] }],
    },
    originalSegments: [{ id: 0, start: 0.001, end: 0.002, text: "Tiny", words: [] }],
  };
  assert.equal(
    generateCaptions(project, tiny).tracks.find((t) => t.name === "Captions").clips[0].duration,
    1 / 30,
  );
});

test("v3 migrates to v4 with reviewed empty transcripts and preserves strict legacy validation", () => {
  const { project } = setup();
  const { transcripts, ...v3 } = project;
  void transcripts;
  v3.schemaVersion = 3;
  const result = parseProjectJSON(JSON.stringify(v3));
  assert.equal(result.success, true);
  assert.equal(result.migratedFrom, 3);
  assert.equal(result.project.schemaVersion, 4);
  assert.deepEqual(result.project.transcripts, []);
  assert.equal(parseProjectJSON(JSON.stringify({ ...v3, transcripts: [] })).success, false);
});

test("caption deletion prunes persisted references and oversized reviews reject before document installation", () => {
  const { project, transcript } = setup();
  const next = generateCaptions(project, transcript);
  const { deleteLayer } = require("../project/operations.cjs");
  const pruned = deleteLayer(next, next.scenes[0].id, next.transcripts[0].captionIds[0]);
  assert.deepEqual(pruned.transcripts[0].captionIds, []);
  const segments = Array.from({ length: 280 }, (_, id) => ({
    id,
    start: id / 100,
    end: id / 100 + 0.009,
    text: "a".repeat(10000),
    words: [],
  }));
  const huge = {
    ...transcript,
    originalSegments: segments,
    result: { ...transcript.result, duration: 3, segments },
  };
  assert.throws(() => saveTranscript(project, huge), /5 MB/);
  assert.equal(project.transcripts.length, 0);
});

test("audio clip caption generation maps trimmed source time to its timeline placement", () => {
  const { generateCaptionsForClip } = require("./commands.cjs"),
    { rebuildProject } = require("../project/operations.cjs");
  const { project, transcript } = setup(),
    track = project.tracks.find((t) => t.type === "audio"),
    id = globalThis.crypto.randomUUID();
  track.clips.push({
    id,
    assetId: transcript.assetId,
    trackId: track.id,
    start: 2,
    duration: 0.5,
    sourceStart: 0.4,
    sourceEnd: 0.9,
  });
  const p = rebuildProject(project),
    before = structuredClone(p),
    next = generateCaptionsForClip(p, transcript, id);
  const clips = next.tracks.find((t) => t.name === "Captions").clips;
  assert.ok(clips.length);
  assert.ok(clips.every((c) => c.start >= 2 && c.start + c.duration <= 2.5));
  const layer = next.scenes.flatMap((s) => s.layers).find((l) => l.id === clips[0].id);
  assert.equal(layer.properties.caption.words[0].start, 0);
  assert.deepEqual(next.transcripts[0].originalSegments, transcript.originalSegments);
  assert.deepEqual(p, before);
  assert.throws(() => generateCaptionsForClip(next, next.transcripts[0], id), /already/);
  assert.throws(
    () => generateCaptionsForClip(p, transcript, globalThis.crypto.randomUUID()),
    /changed/,
  );
});
