const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { projectSchema, parseProjectJSON, serializeProject } = require("./schema.cjs");
const ops = require("./operations.cjs");
const { createHistory, commitProject, undoProject, redoProject } = require("./history.cjs");

function fixture() {
  let project = ops.createProject();
  project = ops.mergeProjectAssets(project, [
    {
      id: randomUUID(),
      filename: "opening.png",
      type: "image",
      mimeType: "image/png",
      size: 100,
      importedAt: new Date().toISOString(),
      width: 320,
      height: 180,
    },
  ]);
  project = ops.addScene(project);
  return ops.addLayer(project, project.scenes[0].id, "image", project.assets[0].id);
}

test("strict versioned project validation and JSON round trip", () => {
  const project = fixture();
  const result = parseProjectJSON(serializeProject(project));
  assert.equal(result.success, true);
  assert.deepEqual(result.project, project);
  for (const invalid of [
    "{",
    "null",
    "[]",
    JSON.stringify({ ...project, schemaVersion: 99 }),
    JSON.stringify({ ...project, executable: "alert(1)" }),
    JSON.stringify({ ...project, duration: -1 }),
    JSON.stringify({ ...project, fps: 0 }),
    JSON.stringify({ ...project, resolution: { width: 0, height: 1080 } }),
  ]) {
    const rejected = parseProjectJSON(invalid);
    assert.equal(rejected.success, false);
    assert.ok(rejected.errors[0].path);
  }
  assert.equal(
    parseProjectJSON(JSON.stringify({ ...project, schemaVersion: 5 })).errors[0].path,
    "schemaVersion",
  );
});

test("scene commands preserve IDs/manual content and recalculate derived timing", () => {
  let project = fixture();
  const originalId = project.scenes[0].id;
  project = ops.updateScene(project, originalId, {
    name: "Manually edited",
    narration: "Keep this narration",
  });
  project = ops.duplicateScene(project, originalId);
  assert.notEqual(project.scenes[0].id, project.scenes[1].id);
  assert.notEqual(project.scenes[0].layers[0].id, project.scenes[1].layers[0].id);
  assert.equal(project.scenes[1].narration, "Keep this narration");
  assert.equal(project.scenes[1].layers[0].assetId, project.scenes[0].layers[0].assetId);
  project = ops.reorderScene(project, project.scenes[1].id, 0);
  assert.equal(project.scenes[1].id, originalId);
  assert.equal(project.scenes[1].start, 5);
  assert.equal(
    project.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.layerId === project.scenes[1].layers[0].id).start,
    5,
  );
  assert.throws(() => ops.updateScene(project, originalId, { duration: 2 }), /cut off a layer/);
  project = ops.updateScene(project, originalId, { duration: 8 });
  assert.equal(project.duration, 13);
  project = ops.deleteScene(project, project.scenes[0].id);
  assert.equal(project.scenes[0].id, originalId);
  assert.equal(project.scenes[0].start, 0);
  assert.equal(project.tracks.flatMap((track) => track.clips).length, 1);
  assert.equal(projectSchema.safeParse(project).success, true);
});

test("dangling references, duplicate IDs, unsafe fields and conflicting timing are rejected", () => {
  const project = fixture();
  const mutations = [
    (p) => {
      p.assets = [];
    },
    (p) => {
      p.scenes.push(structuredClone(p.scenes[0]));
    },
    (p) => {
      p.scenes[0].layers[0].assetId = randomUUID();
    },
    (p) => {
      p.scenes[0].layers[0].trackId = randomUUID();
    },
    (p) => {
      p.scenes[0].start = 2;
    },
    (p) => {
      p.tracks.find((track) => track.clips.length).clips[0].start = 99;
    },
    (p) => {
      p.tracks.forEach((track) => {
        track.clips = [];
      });
    },
    (p) => {
      p.scenes[0].layers[0].properties.script = "process.exit()";
    },
    (p) => {
      p.assets[0].filename = "C:/private.png";
    },
    (p) => {
      p.assets[0].originalPath = "C:/private.png";
    },
    (p) => {
      p.stylePreset = "https://untrusted/script.js";
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(project);
    mutate(copy);
    assert.equal(projectSchema.safeParse(copy).success, false);
  }
});

test("all layer types validate and layer edits preserve independent scene content", () => {
  let project = fixture();
  for (const type of ["text", "shape", "caption"])
    project = ops.addLayer(project, project.scenes[0].id, type);
  for (const type of ["audio", "video"]) {
    const asset = {
      id: randomUUID(),
      filename: `sample.${type === "audio" ? "wav" : "mp4"}`,
      type,
      mimeType: type === "audio" ? "audio/wav" : "video/mp4",
      size: 100,
      importedAt: new Date().toISOString(),
      duration: 3,
    };
    project = ops.mergeProjectAssets(project, [asset]);
    project = ops.addLayer(project, project.scenes[0].id, type, asset.id);
  }
  assert.equal(project.scenes[0].layers.length, 6);
  const text = project.scenes[0].layers.find((layer) => layer.type === "text");
  project = ops.updateLayer(project, project.scenes[0].id, text.id, {
    text: "Manual text",
    position: { x: 12, y: 34 },
    opacity: 0.5,
  });
  assert.equal(
    project.scenes[0].layers.find((layer) => layer.id === text.id).properties.text,
    "Manual text",
  );
  assert.equal(projectSchema.safeParse(project).success, true);
});

test("undo/redo snapshots, clean checkpoint and replacement history", () => {
  const initial = ops.createProject();
  let history = createHistory(initial);
  history = commitProject(history, ops.addScene(history.present));
  assert.equal(history.past.length, 1);
  const addedId = history.present.scenes[0].id;
  history = undoProject(history);
  assert.deepEqual(history.present, initial);
  assert.equal(serializeProject(history.present), history.savedJSON);
  history = redoProject(history);
  assert.equal(history.present.scenes[0].id, addedId);
  history = commitProject(undoProject(history), ops.addScene(initial));
  assert.equal(history.future.length, 0);
  history = createHistory(history.present);
  assert.equal(history.past.length, 0);
  assert.equal(history.future.length, 0);
});

test("project backgrounds fill behind captions, replace atomically, remain undoable and round-trip", () => {
  const { setProjectBackground } = require("./background.cjs"),
    { appendCues } = require("../captions/commands.cjs");
  const p = appendCues(
    ops.createProject(),
    [{ start: 0, end: 10, text: "Caption on top" }],
    randomUUID(),
  );
  const image = {
    id: randomUUID(),
    filename: "background.png",
    type: "image",
    mimeType: "image/png",
    size: 1,
    importedAt: p.createdAt,
  };
  const video = {
    id: randomUUID(),
    filename: "background.mp4",
    type: "video",
    mimeType: "video/mp4",
    size: 1,
    importedAt: p.createdAt,
    duration: 2.5,
  };
  p.assets.push(image, video);
  const original = structuredClone(p),
    next = setProjectBackground(p, image.id);
  const background = next.tracks.find((t) => t.name === "Background"),
    layer = next.scenes[0].layers.find((l) => l.trackId === background.id);
  assert.equal(background.order, next.tracks.length - 1);
  assert.equal(layer.properties.fit, "cover");
  assert.equal(layer.duration, 10);
  assert.deepEqual(
    next.scenes[0].layers.filter((l) => l.type === "caption"),
    p.scenes[0].layers,
  );
  const h = commitProject(createHistory(p), next);
  assert.deepEqual(undoProject(h).present, p);
  assert.deepEqual(redoProject(undoProject(h)).present, next);
  assert.deepEqual(parseProjectJSON(serializeProject(next)).project, next);
  assert.deepEqual(p, original);
  const replaced = setProjectBackground(next, video.id),
    v = replaced.scenes[0].layers.find((l) => l.trackId === background.id);
  assert.equal(v.type, "video");
  assert.equal(v.duration, 2.5);
  assert.equal(v.properties.muted, true);
  assert.equal(v.properties.fit, "cover");
  assert.equal(replaced.duration, 10);
  const locked = {
    ...next,
    tracks: next.tracks.map((t) => (t.id === background.id ? { ...t, locked: true } : t)),
  };
  assert.throws(() => setProjectBackground(locked, video.id), /Unlock/);
  const empty = ops.createProject();
  empty.assets.push(image);
  assert.equal(setProjectBackground(empty, image.id).duration, 5);
});

test("adding visual/audio tracks is bounded, undoable and keeps backgrounds behind new content", () => {
  const { executeTimelineCommand } = require("../timeline/commands.cjs"),
    { setProjectBackground } = require("./background.cjs");
  const p = ops.createProject(),
    image = {
      id: randomUUID(),
      filename: "image.png",
      type: "image",
      mimeType: "image/png",
      size: 1,
      importedAt: p.createdAt,
    };
  p.assets.push(image);
  const base = setProjectBackground(p, image.id),
    id = randomUUID(),
    now = new Date(Date.now() + 1000).toISOString();
  const next = executeTimelineCommand(base, { type: "AddTrack", trackId: id, kind: "video" }, now);
  assert.equal(next.tracks.length, base.tracks.length + 1);
  assert.equal(next.tracks.find((t) => t.name === "Background").order, next.tracks.length - 1);
  assert.ok(
    next.tracks.find((t) => t.id === id).order <
      next.tracks.find((t) => t.name === "Background").order,
  );
  assert.deepEqual(undoProject(commitProject(createHistory(base), next)).present, base);
  assert.throws(
    () => executeTimelineCommand(next, { type: "AddTrack", trackId: id, kind: "audio" }, now),
    /exists/,
  );
});
