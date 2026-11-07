const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
function load(name) {
  const filename = path.join(__dirname, name),
    m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(__dirname);
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return m.exports;
}
const { groupTranscript, defaultGrouping, exportTranscript, timestamp } = load("grouping.ts");
const { resolveTranscriptionSources } = load("source.ts");
const { fixture } = require("./fixture.cjs"),
  { createProject, rebuildProject } = require("../project/operations.cjs"),
  { executeTimelineCommand } = require("../timeline/commands.cjs"),
  { createHistory, commitProject, undoProject, redoProject } = require("../project/history.cjs"),
  { parseProjectJSON, serializeProject } = require("../project/schema.cjs"),
  { buildComposition } = require("../../rendering/input.cjs");
const { generateGroupedCaptions } = require("./grouped-captions.cjs");
function transcript() {
  const t = fixture().transcript;
  const words = ["This", "morning.", "Um,", "A", "new", "day."].map((text, i) => ({
    text,
    start: i,
    end: i + 0.8,
    probability: 1,
  }));
  t.result.duration = 6;
  t.result.segments = [
    { id: 0, start: 0, end: 5.8, text: words.map((w) => w.text).join(" "), words },
  ];
  t.originalSegments = structuredClone(t.result.segments);
  return t;
}
function video() {
  const p = createProject(),
    asset = {
      id: crypto.randomUUID(),
      filename: "video.mp4",
      type: "video",
      mimeType: "video/mp4",
      duration: 10,
      size: 1,
      importedAt: p.createdAt,
    };
  p.assets.push(asset);
  const t = p.tracks.find((t) => t.type === "video"),
    id = crypto.randomUUID();
  t.clips.push({
    id,
    assetId: asset.id,
    trackId: t.id,
    start: 3,
    duration: 4,
    sourceStart: 2,
    sourceEnd: 6,
  });
  return { p: rebuildProject(p), id, asset };
}
const now = () => new Date(Date.now() + 1000).toISOString();
test("non-destructive video audio detachment preserves trims, source identity, synchronization and history", () => {
  const { p, id, asset } = video(),
    audioId = crypto.randomUUID();
  const next = executeTimelineCommand(
    p,
    { type: "DetachAudio", clipId: id, audioClipId: audioId, trackId: crypto.randomUUID() },
    now(),
  );
  const clips = next.tracks.flatMap((t) => t.clips),
    original = clips.find((c) => c.id === id),
    audio = clips.find((c) => c.id === audioId);
  assert.equal(original.muted, true);
  assert.equal(audio.audioOnly, true);
  assert.equal(audio.assetId, asset.id);
  assert.equal(audio.start, 3);
  assert.equal(audio.sourceStart, 2);
  assert.equal(audio.sourceEnd, 6);
  const model = buildComposition({
    project: next,
    sources: { [asset.id]: `motioncraft-media://asset/${asset.id}` },
  });
  assert.equal(model.clips.find((c) => c.id === id).muted, true);
  assert.equal(model.clips.find((c) => c.id === audioId).type, "audio");
  const h = commitProject(createHistory(p), next);
  assert.deepEqual(undoProject(h).present, p);
  assert.deepEqual(redoProject(undoProject(h)).present, next);
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  assert.throws(
    () =>
      executeTimelineCommand(
        next,
        {
          type: "DetachAudio",
          clipId: id,
          audioClipId: crypto.randomUUID(),
          trackId: crypto.randomUUID(),
        },
        now(),
      ),
    /already/,
  );
  const trimmed = executeTimelineCommand(
    next,
    { type: "TrimClip", clipId: audioId, edge: "left", frame: 120 },
    now(),
  );
  const a = trimmed.tracks.flatMap((t) => t.clips).find((c) => c.id === audioId);
  assert.equal(a.sourceStart, 3);
  assert.equal(a.start, 4);
  const faded = executeTimelineCommand(
    trimmed,
    {
      type: "UpdateAudio",
      clipId: audioId,
      patch: { volume: 0.5, fadeIn: 0.2, fadeOut: 0.3, muted: true },
    },
    now(),
  );
  assert.equal(faded.tracks.flatMap((t) => t.clips).find((c) => c.id === audioId).fadeIn, 0.2);
  assert.equal(faded.tracks.flatMap((t) => t.clips).find((c) => c.id === id).start, 3);
});
test("source resolution handles audio, video, multiple selection, library fallback and empty selection", () => {
  const { p, id, asset } = video(),
    audioId = crypto.randomUUID(),
    next = executeTimelineCommand(
      p,
      { type: "DetachAudio", clipId: id, audioClipId: audioId, trackId: crypto.randomUUID() },
      now(),
    );
  assert.equal(resolveTranscriptionSources(next, [id])[0].clipId, id);
  assert.equal(resolveTranscriptionSources(next, [audioId])[0].clipId, audioId);
  assert.equal(resolveTranscriptionSources(next, [id, audioId]).length, 2);
  assert.equal(resolveTranscriptionSources(next, [id, audioId])[0].clipId, audioId);
  assert.deepEqual(resolveTranscriptionSources(next, []), []);
  assert.equal(resolveTranscriptionSources(next, [], asset.id)[0].assetId, asset.id);
});
test("word, sentence, two-second, count, character, paragraph, continuous and smart grouping are deterministic", () => {
  const t = transcript(),
    before = structuredClone(t);
  assert.equal(groupTranscript(t, { ...defaultGrouping, mode: "word" }).length, 6);
  assert.equal(
    groupTranscript(t, { ...defaultGrouping, mode: "duration", maxDuration: 2 }).length,
    3,
  );
  assert.equal(groupTranscript(t, { ...defaultGrouping, mode: "count", maxWords: 2 }).length, 3);
  for (const mode of ["sentence", "characters", "paragraph", "continuous", "smart"])
    assert.deepEqual(
      groupTranscript(t, { ...defaultGrouping, mode }),
      groupTranscript(t, { ...defaultGrouping, mode }),
    );
  assert.equal(groupTranscript(t, { ...defaultGrouping, mode: "continuous" }).length, 1);
  assert.equal(
    groupTranscript(t, { ...defaultGrouping, mode: "word", includeFillers: false }).length,
    5,
  );
  assert.deepEqual(t, before);
  t.result.segments[0].text = "Reviewed correction";
  t.result.segments[0].words = [];
  assert.equal(
    groupTranscript(t, { ...defaultGrouping, mode: "word" })[0].text,
    "Reviewed correction",
  );
});
test("inline timestamps and source/clip/timeline exports use reviewed text and valid subtitle intervals", () => {
  const t = transcript(),
    groups = groupTranscript(t, { ...defaultGrouping, mode: "duration", maxDuration: 2 });
  const o = {
    format: "inline",
    basis: "source",
    clock: "mmss",
    milliseconds: false,
    timestamps: true,
    onePerLine: false,
  };
  assert.equal(timestamp(0, "mmss", false), "0:00");
  assert.equal(timestamp(3661.125, "hhmmss", true), "01:01:01.125");
  assert.match(exportTranscript(t, groups, o), /^\(0:00\) This morning\./);
  const range = { sourceStart: 2, sourceEnd: 6, timelineStart: 8, rate: 1 };
  assert.match(exportTranscript(t, [groups[1]], { ...o, basis: "timeline" }, range), /^\(0:08\)/);
  assert.match(exportTranscript(t, [groups[1]], { ...o, basis: "clip" }, range), /^\(0:00\)/);
  for (const format of ["srt", "vtt"])
    assert.equal(
      require("../captions/subtitles.cjs").parseSubtitles(
        exportTranscript(t, groups, { ...o, format }),
      ).length,
      3,
    );
  assert.equal(JSON.parse(exportTranscript(t, groups, { ...o, format: "json" })).groups.length, 3);
  assert.match(exportTranscript(t, groups, { ...o, format: "csv" }), /^start,end,text/);
});
test("grouped captions preserve canonical originals and require explicit replacement", () => {
  const t = transcript(),
    p = createProject();
  p.assets.push({
    id: t.assetId,
    filename: t.source.filename,
    type: "audio",
    mimeType: "audio/mpeg",
    size: t.source.size,
    duration: 6,
    importedAt: p.createdAt,
  });
  const groups = groupTranscript(t, { ...defaultGrouping, mode: "duration", maxDuration: 2 }),
    next = generateGroupedCaptions(p, t, groups, undefined, 0, false);
  assert.equal(next.tracks.find((t) => t.name === "Captions").clips.length, 3);
  assert.deepEqual(next.transcripts[0].originalSegments, t.originalSegments);
  assert.throws(
    () => generateGroupedCaptions(next, next.transcripts[0], groups, undefined, 0, false),
    /Confirm/,
  );
  const replaced = generateGroupedCaptions(
    next,
    next.transcripts[0],
    groupTranscript(t, { ...defaultGrouping, mode: "word" }),
    undefined,
    0,
    true,
  );
  assert.equal(replaced.tracks.find((t) => t.name === "Captions").clips.length, 6);
  assert.deepEqual(undoProject(commitProject(createHistory(next), replaced)).present, next);
});

test("zero-duration Whisper words keep the segment intact without fabricated alignment", () => {
  const t = transcript();
  t.result.segments[0].words[5].start = t.result.segments[0].words[5].end;
  const groups = groupTranscript(t, { ...defaultGrouping, mode: "word" });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].words, []);
  assert.equal(groups[0].text, t.result.segments[0].text);
});
test("line budgets and hard duration limits take priority over minimum duration", () => {
  const t = transcript(),
    groups = groupTranscript(t, {
      ...defaultGrouping,
      mode: "smart",
      minDuration: 10,
      maxDuration: 2,
      maxCharacters: 12,
      maxLines: 1,
    });
  assert.ok(groups.every((g) => g.end - g.start <= 2));
  assert.ok(groups.every((g) => g.text.split("\n").length <= 1));
});

test("speed-aware transcript exports and generated captions map source time to timeline time", () => {
  const t = transcript(),
    { p, id } = video();
  t.assetId = p.assets[0].id;
  t.source.filename=p.assets[0].filename;
  t.source.size=p.assets[0].size;
  const fast = require("../timeline/visual.cjs").executeVisualCommand(p, {
    type: "SetPlaybackRate",
    clipId: id,
    rate: 2,
  });
  const range = { clipId: id, sourceStart: 2, sourceEnd: 6, timelineStart: 3, rate: 2 };
  const groups = groupTranscript(t, { ...defaultGrouping, mode: "word" }, range);
  const output = JSON.parse(
    exportTranscript(
      t,
      groups,
      {
        format: "json",
        basis: "timeline",
        clock: "mmss",
        milliseconds: true,
        timestamps: true,
        onePerLine: false,
      },
      range,
    ),
  );
  assert.equal(output.groups[0].start, 3);
  assert.equal(output.groups[0].words[0].start, 3);
  const generated = generateGroupedCaptions(fast, t, groups, id, 0, false),
    caption = generated.tracks.find((t) => t.name === "Captions").clips[0];
  assert.equal(caption.start, 3);
  assert.ok(caption.duration <= 0.5);
});
