const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { createProject, rebuildProject } = require("../project/operations.cjs"),
  { serializeProject, parseProjectJSON } = require("../project/schema.cjs"),
  { createHistory, commitProject, undoProject } = require("../project/history.cjs");
const { defaultAudio, audioSchema } = require("./schema.cjs"),
  {
    dbToGain,
    automationDb,
    fadeGain,
    clipGain,
    audibleTrack,
    peakIndex,
    duckingKeys,
  } = require("./engine.cjs"),
  { executeAudioEdit } = require("./commands.cjs"),
  { executeTimelineCommand } = require("../timeline/commands.cjs"),
  { createProcessor } = require("./dsp.cjs");
function fixture() {
  const p = createProject(),
    track = p.tracks.find((t) => t.type === "audio"),
    asset = {
      id: randomUUID(),
      filename: "tone.wav",
      type: "audio",
      mimeType: "audio/wav",
      size: 100,
      duration: 10,
      importedAt: p.createdAt,
    },
    id = randomUUID();
  p.assets = [asset];
  track.clips = [
    {
      id,
      assetId: asset.id,
      trackId: track.id,
      start: 2,
      duration: 6,
      sourceStart: 1,
      sourceEnd: 7,
    },
  ];
  return { p: rebuildProject(p), id, trackId: track.id, asset };
}
test("dB, fades, interpolation, pan-independent gain and waveform source mapping", () => {
  assert.ok(Math.abs(dbToGain(-6) - 0.501187) < 1e-6);
  assert.equal(dbToGain(0), 1);
  const keys = [
    { id: randomUUID(), frame: 0, db: 0, origin: "manual" },
    { id: randomUUID(), frame: 30, db: -12, origin: "manual" },
  ];
  assert.equal(automationDb(keys, 15), -6);
  assert.equal(automationDb(keys, 60), -12);
  assert.equal(fadeGain(0.5, "linear"), 0.5);
  assert.ok(Math.abs(fadeGain(0.5, "equal-power") - Math.SQRT1_2) < 1e-8);
  const { p, id } = fixture(),
    c = p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  assert.equal(peakIndex({ ...c, playbackRate: 2 }, 1, 0.05), 60);
  assert.equal(clipGain({ ...c, fadeIn: 2, audio: { ...defaultAudio(), gainDb: -6 } }, 0, 30), 0);
});
test("mute, solo and hidden-track policy is shared by mix planning", () => {
  const { p, trackId } = fixture(),
    t = p.tracks.find((t) => t.id === trackId);
  assert.equal(audibleTrack(p, t), true);
  assert.equal(audibleTrack(p, { ...t, muted: true }), false);
  p.tracks[0].solo = true;
  assert.equal(audibleTrack(p, t), false);
  assert.equal(audibleTrack(p, { ...t, solo: true }), true);
});
test("audio edits, persistence, locks, trim/split automation and history", () => {
  const { p, id, trackId } = fixture(),
    a = {
      ...defaultAudio(),
      gainDb: -9,
      keys: [
        { id: randomUUID(), frame: 0, db: 0, origin: "manual" },
        { id: randomUUID(), frame: 150, db: -15, origin: "manual" },
      ],
    },
    next = executeAudioEdit(p, { type: "SetAudio", clipId: id, audio: a, fadeIn: 1, fadeOut: 1 });
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  assert.deepEqual(undoProject(commitProject(createHistory(p), next)).present, p);
  const trimmed = executeTimelineCommand(
      next,
      { type: "TrimClip", clipId: id, edge: "left", frame: 90 },
      new Date().toISOString(),
    ),
    clip = trimmed.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  assert.equal(clip.audio.keys[0].frame, 0);
  assert.equal(clip.audio.keys[0].db, -3);
  const split = executeTimelineCommand(
      next,
      { type: "SplitClip", clipId: id, newClipId: randomUUID(), frame: 120 },
      new Date().toISOString(),
    ),
    parts = split.tracks.flatMap((t) => t.clips);
  assert.equal(parts.find((c) => c.id !== id).audio.keys[0].db, -6);
  const fast = require("../timeline/visual.cjs").executeVisualCommand(next, {
    type: "SetPlaybackRate",
    clipId: id,
    rate: 2,
  });
  const fastClip = fast.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  assert.equal(fastClip.audio.keys[1].frame, 75);
  assert.equal(fastClip.fadeIn, 0.5);
  assert.equal(fastClip.fadeOut, 0.5);
  const locked = {
    ...p,
    tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, locked: true } : t)),
  };
  assert.throws(
    () => executeAudioEdit(locked, { type: "SetAudio", clipId: id, audio: a }),
    /locked|Unlock/i,
  );
  assert.throws(() => audioSchema.parse({ ...a, keys: [...a.keys].reverse() }));
});
test("ducking creates editable deterministic ramps and protects manual keys", () => {
  const keys = duckingKeys(
    [
      [2, 3],
      [3.1, 4],
    ],
    { depthDb: -18, attack: 0.2, release: 0.5, preRoll: 0.1, gap: 0.2 },
    0,
    6,
    30,
    randomUUID,
  );
  assert.equal(automationDb(keys, 90), -18);
  assert.ok(automationDb(keys, 132) > -18);
  const { p, id, trackId } = fixture(),
    a = { ...defaultAudio(), keys: [{ id: randomUUID(), frame: 0, db: 0, origin: "manual" }] },
    manual = executeAudioEdit(p, { type: "SetAudio", clipId: id, audio: a });
  const command = {
    type: "Duck",
    musicId: trackId,
    regions: [[3, 4]],
    depthDb: -18,
    attack: 0.1,
    release: 0.5,
    preRoll: 0.1,
    gap: 0.2,
    replace: false,
  };
  assert.throws(() => executeAudioEdit(manual, command), /Confirm/);
  const next = executeAudioEdit(manual, { ...command, replace: true });
  assert.ok(next.tracks.flatMap((t) => t.clips)[0].audio.keys.every((k) => k.origin === "ducking"));
});
test("crossfades permit explicit same-track audio overlap, preserve sources and undo", () => {
  const { p, id, trackId } = fixture(),
    rightId = randomUUID();
  p.tracks
    .find((t) => t.id === trackId)
    .clips.push({ ...p.tracks.find((t) => t.id === trackId).clips[0], id: rightId, start: 8 });
  const base = rebuildProject(p),
    next = executeAudioEdit(base, {
      type: "Crossfade",
      leftId: id,
      rightId,
      duration: 1,
      curve: "equal-power",
    }),
    track = next.tracks.find((t) => t.id === trackId);
  assert.equal(track.audioOverlap, true);
  assert.equal(track.clips.find((c) => c.id === rightId).start, 7);
  assert.equal(track.clips[0].sourceStart, 1);
  assert.deepEqual(undoProject(commitProject(createHistory(base), next)).present, base);
});
test("streaming filters attenuate DC, bypass exactly and enforce sample ceiling", () => {
  const a = defaultAudio(),
    filter = createProcessor({ ...a.effects, highpass: 80, limiter: false }, 48000);
  let last;
  for (let i = 0; i < 48000; i++) last = filter(0.5, 0.5);
  assert.ok(Math.abs(last[0]) < 1e-5);
  const bypass = createProcessor({ ...a.effects, bypass: true }, 48000);
  assert.deepEqual(bypass(0.3, -0.2), [0.3, -0.2]);
  const limit = createProcessor(a.effects, 48000);
  assert.ok(limit(4, 4)[0] <= dbToGain(-1));
});
test("real WAV analysis caches fingerprinted peaks and processed mix follows gain/fades", async () => {
  const directory = await fs.mkdtemp(path.join(__dirname, "../../.next/audio-processing-test-"));
  const { header, analyze, mix, verify } = require("../../workers/audio-processing.cjs"),
    filename = path.join(directory, "tone.wav"),
    rate = 48000,
    samples = rate * 2,
    raw = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const x = Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 0.2 * 32767);
    raw.writeInt16LE(x, i * 4);
    raw.writeInt16LE(x, i * 4 + 2);
  }
  await fs.writeFile(filename, Buffer.concat([header(samples), raw]));
  const stat = await fs.stat(filename),
    id = randomUUID(),
    binding = {
      id,
      originalPath: await fs.realpath(filename),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      ino: stat.ino,
      type: "audio",
      mimeType: "audio/wav",
    },
    cache = path.join(directory, "cache");
  const analysis = await analyze(binding, cache);
  assert.ok(analysis.peaks.length >= 39);
  assert.ok(Math.abs(analysis.peakDb + 13.98) < 0.1);
  assert.ok(analysis.lufs !== null);
  assert.deepEqual(await analyze(binding, cache), analysis);
  const p = createProject(),
    track = p.tracks.find((t) => t.type === "audio");
  p.assets = [
    {
      id,
      filename: "tone.wav",
      type: "audio",
      mimeType: "audio/wav",
      size: stat.size,
      duration: 2,
      importedAt: p.createdAt,
    },
  ];
  track.gainDb = -6;
  track.clips = [
    {
      id: randomUUID(),
      assetId: id,
      trackId: track.id,
      start: 0,
      duration: 2,
      sourceStart: 0,
      sourceEnd: 2,
      audio: { ...defaultAudio(), gainDb: -6 },
      fadeIn: 0.5,
      fadeOut: 0.5,
    },
  ];
  const project = rebuildProject(p),
    out = await mix(project, [binding], cache),
    data = await fs.readFile(out);
  assert.equal(data.length, 44 + samples * 4);
  const rms = (start, end) => {
    let n = 0,
      count = 0;
    for (let i = Math.round(start * rate); i < Math.round(end * rate); i++) {
      n += (data.readInt16LE(44 + i * 4) / 32768) ** 2;
      count++;
    }
    return Math.sqrt(n / count);
  };
  assert.ok(Math.abs(rms(0.7, 1.2) - (0.2 / Math.sqrt(2)) * dbToGain(-12)) < 0.002);
  assert.ok(rms(0, 0.1) < rms(0.7, 1.2) * 0.3);
  assert.equal(await mix(project, [binding], cache), out);
  const firstClip = { ...track.clips[0], duration: 1, sourceEnd: 1, fadeIn: 0, fadeOut: 0 };
  const staggered = rebuildProject({
    ...p,
    tracks: p.tracks.map((t) =>
      t.id === track.id
        ? {
            ...t,
            clips: [
              firstClip,
              { ...firstClip, id: randomUUID(), start: 1, audio: { ...defaultAudio(), gainDb: 0 } },
            ],
          }
        : t,
    ),
  });
  const joined = await fs.readFile(await mix(staggered, [binding], cache));
  const segmentRms = (data, start, end) => {
    let sum = 0,
      n = 0;
    for (let i = Math.round(start * rate); i < Math.round(end * rate); i++) {
      sum += (data.readInt16LE(44 + i * 4) / 32768) ** 2;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  assert.ok(
    Math.abs(segmentRms(joined, 1.2, 1.6) / segmentRms(joined, 0.2, 0.6) - dbToGain(6)) < 0.03,
    `Inputs ending must not renormalize the remaining music: ${segmentRms(joined, 1.2, 1.6)} vs ${segmentRms(joined, 0.2, 0.6)}`,
  );
  const delayed = rebuildProject({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: [{ ...firstClip, start: 1 }] } : t,
      ),
    }),
    later = await fs.readFile(await mix(delayed, [binding], cache));
  assert.ok(segmentRms(later, 0, 0.9) < 0.0001);
  assert.ok(segmentRms(later, 1.2, 1.6) > 0.03);
  const normalized = await analyze(binding, cache, { start: 0.5, end: 1 });
  assert.ok(Math.abs(normalized.duration - 0.5) < 0.01);
  const service = require("../../electron/audio-service.cjs").createAudioService(cache);
  assert.deepEqual(await service.analyze(7, binding), analysis);
  const canceled = service.analyze(7, binding);
  service.release(7);
  await assert.rejects(canceled, /superseded|canceled/);
  const serviceMix = await service.mix(8, project, [binding]);
  assert.equal(serviceMix.originalPath, out);
  const [coalescedA, coalescedB] = await Promise.all([
    service.mix(9, project, [binding]),
    service.mix(9, { ...project, updatedAt: new Date(Date.now() + 1000).toISOString() }, [binding]),
  ]);
  assert.equal(coalescedA.originalPath, coalescedB.originalPath);
  await fs.writeFile(filename, Buffer.from("changed"));
  await assert.rejects(verify(binding), /changed/);
});
