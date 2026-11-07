const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRenderSample } = require("../../rendering/sample.cjs");
const {
  projectSchema,
  validateProject,
  serializeProject,
  parseProjectJSON,
} = require("../project/schema.cjs");
const { executeMotionCommand: motion, basePose, clipFrames } = require("./commands.cjs");
const { pose, easing, cropKeys } = require("./engine.cjs");
const { presetSchema } = require("./schema.cjs");
const { executeTimelineCommand: edit, copyClips } = require("../timeline/commands.cjs");
const {
  createHistory,
  commitProject,
  undoProject,
  redoProject,
} = require("../project/history.cjs");
const { duplicateScene, deleteScene } = require("../project/operations.cjs");
const now = "2026-11-05T10:00:00.000Z";
const id = "00000000-0000-4000-8000-000000000121";
function animated() {
  const project = createRenderSample();
  return motion(
    project,
    { type: "ApplyPreset", clipId: id, name: "slide-left", durationFrames: 60 },
    now,
  );
}
test("all transform channels and easing are deterministic at endpoints and intermediate frames", () => {
  const base = basePose(undefined),
    properties = Object.keys(base),
    keys = properties.flatMap((property, i) =>
      [0, 20].map((frame, j) => ({
        id: randomUUID(),
        property,
        frame,
        value:
          base[property] +
          ((property === "opacity" ? -1 : 1) * (j ? i + 1 : 0)) / (property === "opacity" ? 6 : 1),
        easing: { type: "linear" },
      })),
    );
  for (const key of keys.filter((k) => k.frame === 20))
    assert.equal(pose(keys, base, 20)[key.property], key.value);
  assert.equal(pose(keys, base, 10).x, 0.5);
  for (const type of ["linear", "ease-in", "ease-out", "ease-in-out", "bezier"]) {
    const ease = { type, ...(type === "bezier" ? { control: [0.42, 0, 0.58, 1] } : {}) };
    assert.equal(easing(0, ease), 0);
    assert.equal(easing(1, ease), 1);
    assert.ok(Number.isFinite(easing(0.37, ease)));
  }
  assert.ok(easing(0.25, { type: "ease-in" }) < 0.25);
  assert.ok(easing(0.25, { type: "ease-out" }) > 0.25);
});
test("strict animation references, IDs, frames, duplicate channels and values reject atomically", () => {
  const project = animated(),
    key = project.animations[id].keyframes[0],
    before = serializeProject(project);
  for (const keyframe of [
    { ...key, frame: 60 },
    { ...key, frame: 0.5 },
    { ...key, property: "opacity", value: 2 },
    { ...key, value: NaN },
    { ...key, easing: { type: "bezier" } },
  ])
    assert.throws(() => motion(project, { type: "SetKeyframe", clipId: id, keyframe }, now));
  assert.throws(() =>
    projectSchema.parse({
      ...project,
      animations: { ...project.animations, [randomUUID()]: project.animations[id] },
    }),
  );
  assert.throws(() =>
    motion(
      project,
      { type: "SetKeyframe", clipId: id, keyframe: { ...key, id: randomUUID() } },
      now,
    ),
  );
  const locked = {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, locked: t.clips.some((c) => c.id === id) })),
  };
  assert.throws(() => motion(locked, { type: "ClearAnimation", clipId: id }, now), /Unlock/);
  assert.equal(serializeProject(project), before);
});
test("every preset creates bounded editable keys; convert, clear and manual edits use one history snapshot", () => {
  const source = createRenderSample();
  for (const name of presetSchema.options) {
    const project = motion(
      source,
      { type: "ApplyPreset", clipId: id, name, durationFrames: 30 },
      now,
    );
    assert.ok(project.animations[id].keyframes.length >= 2);
    assert.equal(project.animations[id].preset.name, name);
    projectSchema.parse(project);
  }
  const project = animated(),
    converted = motion(project, { type: "ConvertPreset", clipId: id }, now);
  assert.equal(converted.animations[id].preset, undefined);
  assert.deepEqual(converted.animations[id].keyframes, project.animations[id].keyframes);
  const history = commitProject(createHistory(source), project);
  assert.equal(history.past.length, 1);
  assert.deepEqual(undoProject(history).present, source);
  assert.deepEqual(redoProject(undoProject(history)).present, project);
  assert.equal(
    motion(project, { type: "ClearAnimation", clipId: id }, now).animations[id],
    undefined,
  );
});
test("v1/v2 migrate with review and v3 save/open preserves manual animations and IDs", () => {
  const old = createRenderSample();
  delete old.animations;
  delete old.transcripts;
  old.schemaVersion = 2;
  old.scenes[0].layers[0].animation = { preset: "fade-in", duration: 0.5 };
  const migrated = validateProject(old);
  assert.equal(migrated.success, true);
  assert.equal(migrated.migratedFrom, 2);
  assert.equal(migrated.project.id, old.id);
  assert.equal(migrated.project.animations[id].keyframes[1].frame, 15);
  const project = animated();
  assert.deepEqual(parseProjectJSON(serializeProject(project)).project, project);
  assert.equal(validateProject({ ...old, animations: {} }).success, false);
});
test("nonlinear crops preserve every surviving sampled value and stable IDs", () => {
  const keys = [
    {
      id: randomUUID(),
      property: "x",
      frame: 0,
      value: 0,
      easing: { type: "bezier", control: [0.2, 0.1, 0.7, 0.8] },
    },
    { id: randomUUID(), property: "x", frame: 59, value: 150, easing: { type: "linear" } },
  ];
  const cropped = cropKeys(keys, 13, 47, "crop");
  for (let f = 0; f <= 34; f++)
    assert.ok(
      Math.abs(
        pose(cropped, basePose(undefined), f).x - pose(keys, basePose(undefined), f + 13).x,
      ) < 1e-7,
    );
  assert.deepEqual(cropKeys(keys, 13, 47, "crop"), cropped);
});

test("legacy fade/slide migration preserves all visible samples, including one-frame and full-duration animations", () => {
  for (const preset of ["fade-in", "slide-up"]) {
    for (const frames of [1, 60]) {
      const old = createRenderSample();
      delete old.animations;
      delete old.transcripts;
      old.schemaVersion = 2;
      const layer = old.scenes[0].layers[0];
      layer.duration = frames / 30;
      layer.animation = { preset, duration: frames / 30 };
      const clip = old.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);
      clip.duration = frames / 30;
      const result = validateProject(old);
      assert.equal(result.success, true);
      for (let frame = 0; frame < frames; frame++) {
        const current = pose(result.project.animations[id].keyframes, basePose(layer), frame);
        const expected =
          preset === "fade-in"
            ? (layer.opacity * frame) / frames
            : layer.position.y + old.resolution.height * 0.1 * (1 - frame / frames);
        assert.ok(Math.abs(current[preset === "fade-in" ? "opacity" : "y"] - expected) < 1e-8);
      }
    }
  }
});
test("trim, split, move, duplicate, clipboard, scene duplication and deletion preserve animation ownership", () => {
  const project = animated(),
    base = basePose(project.scenes[0].layers[0]);
  const trimmed = edit(project, { type: "TrimClip", clipId: id, edge: "left", frame: 10 }, now);
  for (let f = 0; f < 50; f++)
    assert.ok(
      Math.abs(
        pose(trimmed.animations[id].keyframes, base, f).x -
          pose(project.animations[id].keyframes, base, f + 10).x,
      ) < 1e-7,
    );
  const newId = randomUUID(),
    split = edit(project, { type: "SplitClip", clipId: id, frame: 30, newClipId: newId }, now);
  for (let f = 0; f < 30; f++)
    assert.ok(
      Math.abs(
        pose(split.animations[newId].keyframes, base, f).x -
          pose(project.animations[id].keyframes, base, f + 30).x,
      ) < 1e-7,
    );
  const moved = edit(trimmed, { type: "MoveClip", clipIds: [id], deltaFrames: -5 }, now);
  assert.deepEqual(moved.animations[id], trimmed.animations[id]);
  const space = edit(split, { type: "DeleteClips", clipIds: [newId] }, now);
  const pastedId = randomUUID(),
    pasted = edit(
      space,
      { type: "PasteClips", items: copyClips(space, [id]), newIds: [pastedId], frame: 30 },
      now,
    );
  // Same-track conflict is still rejected, with no mutation.
  assert.equal(pasted.animations[pastedId].keyframes.length, split.animations[id].keyframes.length);
  const duplicated = duplicateScene(project, project.scenes[0].id);
  assert.equal(Object.keys(duplicated.animations).length, 2);
  assert.equal(Object.keys(deleteScene(project, project.scenes[0].id).animations).length, 0);
  assert.equal(
    clipFrames(
      trimmed.tracks.flatMap((t) => t.clips).find((c) => c.id === id),
      30,
    ),
    50,
  );
});
test("moving a marker group validates collisions and commits atomically", () => {
  let project = animated();
  const keys = project.animations[id].keyframes;
  project = motion(
    project,
    { type: "MoveKeyframes", clipId: id, keyframeIds: [keys[0].id], frame: 5 },
    now,
  );
  assert.equal(project.animations[id].keyframes[0].frame, 5);
  assert.throws(() =>
    motion(
      project,
      { type: "MoveKeyframes", clipId: id, keyframeIds: [keys[0].id], frame: 59 },
      now,
    ),
  );
});
