// @ts-check
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createProject, addScene } = require("../project/operations.cjs");
const { parseProjectJSON, serializeProject } = require("../project/schema.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
const { executeTimelineCommand } = require("../timeline/commands.cjs");
const { makeCaption } = require("./presets.cjs");
const { presetSchema, captionSchema } = require("./schema.cjs");
const { captionFrame, groupWords, pointerToCanvas } = require("./engine.cjs");
const { parseSubtitles, exportSubtitles } = require("./subtitles.cjs");
const { executeCaptionCommand, captionRecords, appendCues } = require("./commands.cjs");
const { generateCaptions } = require("../transcription/commands.cjs");
const { fixture } = require("../transcription/fixture.cjs");
const { buildComposition } = require("../../rendering/input.cjs");
const now = "2099-11-07T00:00:00.000Z";
const words = [
  { text: "One", start: 0, end: 0.4 },
  { text: "two.", start: 0.4, end: 0.8 },
  { text: "Three", start: 1, end: 1.4 },
  { text: "four", start: 1.4, end: 1.8 },
];
function sample() {
  return appendCues(
    addScene(createProject()),
    [{ start: 0, end: 2, text: "One two. Three four", words }],
    randomUUID(),
  );
}
for (const preset of presetSchema.options)
  test(`preset ${preset}: validated, immutable, shared preview/export data and overrides`, () => {
    const project = sample(),
      record = captionRecords(project)[0],
      before = structuredClone(project);
    const next = executeCaptionCommand(project, {
      type: "StyleCaptions",
      ids: [record.layer.id],
      preset,
    });
    const styled = captionRecords(next)[0].layer.properties.caption;
    assert.equal(styled.preset, preset);
    assert.deepEqual(styled.style, makeCaption(preset).style);
    const overridden = executeCaptionCommand(next, {
      type: "StyleCaptions",
      ids: [record.layer.id],
      patch: { color: "#ff0000" },
    });
    assert.equal(captionRecords(overridden)[0].layer.properties.caption.style.color, "#ff0000");
    assert.deepEqual(project, before);
    const model = buildComposition({ project: next, sources: {} });
    assert.deepEqual(
      model.clips.find((c) => c.id === record.layer.id).layer.properties.caption,
      styled,
    );
    const parsed = parseProjectJSON(serializeProject(next));
    assert.ok(parsed.success);
    assert.deepEqual(parsed.project, next);
  });
test("normalized position, locks, unrelated captions, history and atomic batch styling", () => {
  let p = executeCaptionCommand(createProject(), {
    type: "ImportCaptions",
    batchId: randomUUID(),
    cues: [
      { start: 0, end: 1, text: "A" },
      { start: 1, end: 2, text: "B" },
    ],
  });
  const records = captionRecords(p),
    ids = records.map((r) => r.layer.id);
  const history = createHistory(p),
    changed = executeCaptionCommand(p, {
      type: "PositionCaptions",
      ids: [ids[0]],
      patch: { x: 0.2, y: 0.3, width: 0.5, rotation: 25 },
    });
  assert.deepEqual(captionRecords(changed)[1].layer, records[1].layer);
  const committed = commitProject(history, changed);
  assert.equal(committed.past.length, 1);
  assert.deepEqual(undoProject(committed).present, p);
  assert.deepEqual(redoProject(undoProject(committed)).present, changed);
  p = executeCaptionCommand(changed, {
    type: "PositionCaptions",
    ids: [ids[0]],
    patch: { locked: true },
  });
  assert.throws(
    () => executeCaptionCommand(p, { type: "PositionCaptions", ids: [ids[0]], patch: { x: 0.4 } }),
    /Unlock/,
  );
  assert.throws(() =>
    executeCaptionCommand(p, { type: "PositionCaptions", ids: [ids[1]], patch: { width: 2 } }),
  );
  assert.throws(() =>
    captionSchema.parse({
      ...makeCaption(),
      style: { ...makeCaption().style, fontFamily: "url(x)" },
    }),
  );
  const locked = {
    ...p,
    tracks: p.tracks.map((t) => (t.id === records[0].layer.trackId ? { ...t, locked: true } : t)),
  };
  assert.throws(
    () => executeCaptionCommand(locked, { type: "StyleCaptions", ids, preset: "cinematic" }),
    /Unlock/,
  );
  assert.deepEqual(pointerToCanvas({ left: 100, top: 200, width: 500, height: 250 }, 350, 325), {
    x: 0.5,
    y: 0.5,
  });
  assert.deepEqual(pointerToCanvas({ left: 100, top: 200, width: 1000, height: 500 }, 600, 450), {
    x: 0.5,
    y: 0.5,
  });
  assert.throws(() => pointerToCanvas({ left: 0, top: 0, width: 0, height: 100 }, 0, 0));
});
test("word highlighting uses frame/fps, gaps, half-open endpoints and repeatable animation", () => {
  const c = { ...makeCaption("karaoke-highlight"), words };
  for (const fps of [24, 25, 30, 50, 60]) {
    assert.equal(captionFrame(c, 0, fps, 2 * fps).active, 0);
    assert.equal(captionFrame(c, fps, fps, 2 * fps).active, 2);
    assert.equal(captionFrame(c, 2 * fps, fps, 2 * fps).active, -1);
  }
  assert.equal(captionFrame(c, 12, 30, 60).active, 1);
  assert.equal(captionFrame(c, 27, 30, 60).active, -1);
  for (const preset of presetSchema.options) {
    const p = makeCaption(preset);
    assert.deepEqual(captionFrame(p, 7, 30, 60), captionFrame(p, 7, 30, 60));
  }
});
test("regrouping respects word, sentence, pause, duration and line/character budgets without mutating timestamps", () => {
  const settings = {
    mode: "sentence",
    maxWords: 3,
    maxLines: 2,
    maxCharacters: 12,
    maxSeconds: 2,
    pauseSeconds: 0.5,
  };
  const before = structuredClone(words),
    groups = groupWords(words, settings);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.flatMap((g) => g.words),
    words,
  );
  assert.deepEqual(words, before);
  assert.equal(groupWords(words, { ...settings, mode: "word" }).length, 4);
  assert.equal(groupWords(words, { ...settings, maxWords: 1 }).length, 4);
  const project = sample(),
    id = captionRecords(project)[0].layer.id;
  const regrouped = executeCaptionCommand(project, {
    type: "RegroupCaptions",
    ids: [id],
    options: { ...settings, mode: "word" },
    batchId: randomUUID(),
  });
  assert.equal(captionRecords(regrouped).length, 4);
  assert.equal(captionRecords(project).length, 1);
});
test("timeline move, trim, split and merge keep local word clocks aligned and text editing clears only visual alignment", () => {
  const p = sample(),
    id = captionRecords(p)[0].layer.id;
  const moved = executeTimelineCommand(
    p,
    { type: "MoveClip", clipIds: [id], deltaFrames: 30 },
    now,
  );
  assert.deepEqual(captionRecords(moved)[0].layer.properties.caption.words, words);
  const trimmed = executeTimelineCommand(
    p,
    { type: "TrimClip", clipId: id, edge: "left", frame: 12 },
    now,
  );
  assert.equal(captionRecords(trimmed)[0].layer.properties.caption.words[0].text, "two.");
  assert.equal(captionRecords(trimmed)[0].layer.properties.caption.words[0].start, 0);
  const split = executeTimelineCommand(
    p,
    { type: "SplitClip", clipId: id, frame: 30, newClipId: randomUUID() },
    now,
  );
  const halves = captionRecords(split);
  assert.equal(halves.length, 2);
  assert.equal(halves[1].layer.properties.caption.words[0].start, 0);
  const merged = executeCaptionCommand(split, {
    type: "MergeCaptions",
    ids: halves.map((r) => r.layer.id),
  });
  assert.equal(captionRecords(merged).length, 1);
  assert.deepEqual(captionRecords(merged)[0].layer.properties.caption.words, words);
  const edited = executeCaptionCommand(p, { type: "EditCaption", id, text: "Manual" });
  assert.equal(captionRecords(edited)[0].layer.properties.caption.words.length, 0);
  assert.equal(captionRecords(p)[0].layer.properties.caption.words.length, 4);
});
test("SRT/VTT Unicode round trips, invalid inputs, bounded parsing and escaping as plain text", () => {
  const cues = [
    { start: 0.125, end: 1.5, text: "Hello\n\u4e16\u754c <b>literal</b>" },
    { start: 2, end: 3, text: "\u0645\u0631\u062d\u0628\u0627" },
  ];
  for (const format of ["srt", "vtt"])
    assert.deepEqual(parseSubtitles(exportSubtitles(cues, format)), cues);
  assert.deepEqual(parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi\n"), [
    { start: 1, end: 2, text: "Hi" },
  ]);
  for (const text of [
    "garbage",
    "1\n00:00:02,000 --> 00:00:01,000\nBad",
    "1\n00:60:00,000 --> 00:61:00,000\nBad",
  ])
    assert.throws(() => parseSubtitles(text));
  assert.throws(() => parseSubtitles("a".repeat(5 * 1024 * 1024 + 1)));
});
test("import rejects overlap and malformed commands atomically; generation retains archived word timestamps", () => {
  const p = createProject(),
    before = structuredClone(p);
  assert.throws(
    () =>
      executeCaptionCommand(p, {
        type: "ImportCaptions",
        batchId: randomUUID(),
        cues: [
          { start: 0, end: 2, text: "A" },
          { start: 1, end: 3, text: "B" },
        ],
      }),
    /overlap/,
  );
  assert.deepEqual(p, before);
  const { transcript } = fixture();
  p.assets.push({
    id: transcript.assetId,
    filename: transcript.source.filename,
    type: "audio",
    mimeType: "audio/mpeg",
    size: transcript.source.size,
    importedAt: p.createdAt,
    duration: 1,
  });
  const generated = generateCaptions(p, transcript, 30),
    r = captionRecords(generated)[0];
  assert.deepEqual(generated.transcripts[0].originalSegments, transcript.originalSegments);
  assert.ok(
    Math.abs(
      r.start +
        r.layer.properties.caption.words[0].start -
        (1 + transcript.result.segments[0].words[0].start),
    ) < 1e-6,
  );
});

test("resize conversion accounts for artboard scaling and rotated local axes", () => {
  const { resizeCaptionWidth } = require("./engine.cjs");
  for (const rect of [
    { width: 800, height: 400 },
    { width: 400, height: 200 },
  ])
    assert.ok(
      Math.abs(resizeCaptionWidth({ width: 0.4, rotation: 0 }, rect, 0.1, 0) - 0.6) < 1e-10,
    );
  assert.ok(
    Math.abs(
      resizeCaptionWidth({ width: 0.4, rotation: 90 }, { width: 800, height: 400 }, 0, 0.2) - 0.6,
    ) < 1e-10,
  );
  assert.equal(
    resizeCaptionWidth({ width: 0.1, rotation: 0 }, { width: 800, height: 400 }, -0.5, 0),
    0.05,
  );
});
test("1200 captions fit the bounded project model and edits preserve unrelated records", () => {
  const p = executeCaptionCommand(createProject(), {
    type: "ImportCaptions",
    batchId: randomUUID(),
    cues: Array.from({ length: 1200 }, (_, i) => ({
      start: i,
      end: i + 0.8,
      text: `Caption ${i}`,
    })),
  });
  assert.equal(captionRecords(p).length, 1200);
  assert.equal(buildComposition({ project: p, sources: {} }).clips.length, 1200);
  assert.ok(serializeProject(p).length < 5 * 1024 * 1024);
  const id = captionRecords(p)[600].layer.id;
  const edited = executeCaptionCommand(p, { type: "EditCaption", id, text: "Only this caption" });
  assert.equal(captionRecords(edited)[601].layer.properties.text, "Caption 601");
});
test("regrouping retains transcript caption references and strict line budgets", () => {
  const { transcript } = fixture(),
    p = createProject();
  p.assets.push({
    id: transcript.assetId,
    filename: transcript.source.filename,
    type: "audio",
    mimeType: "audio/mpeg",
    size: transcript.source.size,
    importedAt: p.createdAt,
    duration: 1,
  });
  const generated = generateCaptions(p, transcript),
    ids = generated.transcripts[0].captionIds;
  const regrouped = executeCaptionCommand(generated, {
    type: "RegroupCaptions",
    ids,
    options: {
      mode: "word",
      maxWords: 2,
      maxLines: 2,
      maxCharacters: 40,
      maxSeconds: 4,
      pauseSeconds: 0.5,
    },
    batchId: randomUUID(),
  });
  assert.ok(regrouped.transcripts[0].captionIds.length);
  assert.ok(!regrouped.transcripts[0].captionIds.includes(ids[0]));
  assert.throws(() => generateCaptions(regrouped, regrouped.transcripts[0]), /already/);
  const settings = {
    mode: "sentence",
    maxWords: 10,
    maxLines: 1,
    maxCharacters: 7,
    maxSeconds: 5,
    pauseSeconds: 1,
  };
  assert.ok(groupWords(words, settings).every((g) => !g.text.includes("\n") && g.text.length <= 7));
  assert.throws(
    () => groupWords([{ text: "unbreakable", start: 0, end: 1 }], settings),
    /character/,
  );
});

test("legacy layer text edits invalidate only visual alignment", () => {
  const { updateLayer } = require("../project/operations.cjs"),
    p = sample(),
    record = captionRecords(p)[0];
  const edited = updateLayer(p, record.scene.id, record.layer.id, {
    text: "Corrected with existing layer API",
  });
  assert.deepEqual(captionRecords(edited)[0].layer.properties.caption.words, []);
  assert.equal(captionRecords(p)[0].layer.properties.caption.words.length, 4);
});

test("wordless subtitle typewriter reveal is deterministic and preserves Unicode code points", () => {
  const { revealText } = require("./engine.cjs");
  const text = "A\u{1F642}BC";
  assert.equal(revealText(text, 0, 30, 1), "");
  assert.equal(revealText(text, 15, 30, 1), "A\u{1F642}");
  assert.equal(revealText(text, 30, 30, 1), text);
  assert.equal(revealText(text, 0, 30, 0), text);
});

test("spoken phrase pages and word-only playback follow exact aligned words without future pages", () => {
  const { captionPages, captionWordWindow } = require("./engine.cjs");
  const words = Array.from({ length: 12 }, (_, i) => ({
      text: `Word${i}`,
      start: i * 0.2,
      end: i * 0.2 + 0.2,
    })),
    pages = captionPages(words);
  assert.deepEqual(pages, [
    { start: 0, end: 5 },
    { start: 5, end: 10 },
    { start: 10, end: 12 },
  ]);
  assert.deepEqual(captionWordWindow("phrase", 7, pages, 12), { start: 5, end: 10 });
  assert.deepEqual(captionWordWindow("word", 7, pages, 12), { start: 7, end: 8 });
  assert.deepEqual(captionWordWindow("phrase", -1, pages, 12), { start: 0, end: 0 });
  assert.deepEqual(captionWordWindow("full", 7, pages, 12), { start: 0, end: 12 });
});

test("changing a preset retains an explicitly chosen spoken-word display mode", () => {
  const p = sample(),
    id = captionRecords(p)[0].layer.id;
  const word = executeCaptionCommand(p, {
    type: "StyleCaptions",
    ids: [id],
    patch: { displayMode: "word" },
  });
  const styled = executeCaptionCommand(word, {
    type: "StyleCaptions",
    ids: [id],
    preset: "cinematic",
  });
  assert.equal(captionRecords(styled)[0].layer.properties.caption.style.displayMode, "word");
});

test("deleting a large caption selection is one undoable command", () => {
  const p = executeCaptionCommand(createProject(), {
    type: "ImportCaptions",
    batchId: randomUUID(),
    cues: Array.from({ length: 1100 }, (_, i) => ({
      start: i,
      end: i + 0.8,
      text: `Caption ${i}`,
    })),
  });
  const ids = captionRecords(p).map((r) => r.layer.id);
  const next = executeTimelineCommand(
    p,
    { type: "DeleteClips", clipIds: ids },
    new Date(Date.now() + 1000).toISOString(),
  );
  assert.equal(captionRecords(next).length, 0);
  assert.deepEqual(undoProject(commitProject(createHistory(p), next)).present, p);
});
