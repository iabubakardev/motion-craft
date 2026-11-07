// @ts-check
const { z } = require("zod");
const { projectSchema } = require("../project/schema.cjs");
const { keyframeSchema, presetSchema } = require("./schema.cjs");
const { presetKeys } = require("./engine.cjs");
const { secondsToFrames } = require("../timeline/time.cjs");
const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("MoveKeyframes"),
      clipId: z.uuid(),
      keyframeIds: z.array(z.uuid()).min(1).max(2000),
      frame: z
        .number()
        .int()
        .min(0)
        .max(86400 * 60),
    })
    .strict(),
  z.object({ type: z.literal("SetKeyframe"), clipId: z.uuid(), keyframe: keyframeSchema }).strict(),
  z.object({ type: z.literal("DeleteKeyframe"), clipId: z.uuid(), keyframeId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal("ApplyPreset"),
      clipId: z.uuid(),
      name: presetSchema,
      durationFrames: z
        .number()
        .int()
        .min(2)
        .max(86400 * 60),
    })
    .strict(),
  z.object({ type: z.literal("ConvertPreset"), clipId: z.uuid() }).strict(),
  z.object({ type: z.literal("ClearAnimation"), clipId: z.uuid() }).strict(),
]);
/** @param {import('../project/types').Layer|undefined} layer @param {import('zod').infer<typeof import('../timeline/visual-schema.cjs').visualSchema>|undefined} [visual] */
function basePose(layer, visual) {
  if (visual)
    return {
      x: visual.x,
      y: visual.y,
      scaleX: visual.scaleX,
      scaleY: visual.scaleY,
      rotation: visual.rotation,
      opacity: visual.opacity,
    };
  return {
    x: layer?.position.x ?? 0,
    y: layer?.position.y ?? 0,
    scaleX: layer?.scale ?? 1,
    scaleY: layer?.scale ?? 1,
    rotation: layer?.rotation ?? 0,
    opacity: layer?.opacity ?? 1,
  };
}
/** @param {import('../project/types').Clip} clip @param {number} fps */
function clipFrames(clip, fps) {
  return (
    secondsToFrames(clip.start + clip.duration, fps, "ceil") -
    secondsToFrames(clip.start, fps, "ceil")
  );
}
/** @param {import('../project/types').Project} project @param {unknown} input @param {string} timestamp */
function executeMotionCommand(project, input, timestamp) {
  const command = commandSchema.parse(input);
  const parsed = projectSchema.parse(project);
  z.iso.datetime().parse(timestamp);
  const track = parsed.tracks.find((t) => t.clips.some((c) => c.id === command.clipId));
  const clip = track?.clips.find((c) => c.id === command.clipId);
  if (!track || !clip) throw new Error("The animated clip no longer exists.");
  if (track.locked) throw new Error("Unlock the track before editing animation.");
  if (track.type === "audio") throw new Error("Select a visual clip to animate.");
  const layer = parsed.scenes.flatMap((s) => s.layers).find((l) => l.id === clip.layerId);
  const old = parsed.animations[clip.id] || { keyframes: [] };
  let motion = { ...old };
  if (command.type === "MoveKeyframes") {
    if (command.keyframeIds.some((id) => !old.keyframes.some((key) => key.id === id)))
      throw new Error("Keyframe no longer exists.");
    motion = {
      keyframes: old.keyframes.map((key) =>
        command.keyframeIds.includes(key.id) ? { ...key, frame: command.frame } : key,
      ),
    };
  } else if (command.type === "SetKeyframe") {
    const collision = old.keyframes.find(
      (k) =>
        k.property === command.keyframe.property &&
        k.frame === command.keyframe.frame &&
        k.id !== command.keyframe.id,
    );
    if (collision) throw new Error("A keyframe already occupies that property and frame.");
    motion = {
      keyframes: [...old.keyframes.filter((k) => k.id !== command.keyframe.id), command.keyframe],
    };
  } else if (command.type === "DeleteKeyframe") {
    if (!old.keyframes.some((k) => k.id === command.keyframeId))
      throw new Error("Keyframe no longer exists.");
    motion = { keyframes: old.keyframes.filter((k) => k.id !== command.keyframeId) };
  } else if (command.type === "ApplyPreset") {
    const total = clipFrames(clip, parsed.fps);
    if (command.durationFrames > total) throw new Error("Preset duration exceeds the clip.");
    motion = {
      preset: { name: command.name, durationFrames: command.durationFrames },
      keyframes: presetKeys(
        command.name,
        command.durationFrames,
        total,
        basePose(layer, clip.visual),
        parsed.resolution.width,
        parsed.resolution.height,
        clip.id,
      ),
    };
  } else if (command.type === "ConvertPreset") motion = { keyframes: old.keyframes };
  else if (command.type === "ClearAnimation") motion = { keyframes: [] };
  else return assertNever(command);
  if (JSON.stringify(old) === JSON.stringify(motion)) return project;
  const animations = { ...parsed.animations };
  if (motion.keyframes.length) animations[clip.id] = motion;
  else delete animations[clip.id];
  // Legacy fields remain readable for Phase 3 API compatibility, but v3 renders only keys.
  return projectSchema.parse({ ...parsed, animations, updatedAt: timestamp });
}
/** @param {never} command @returns {never} */
function assertNever(command) {
  throw new Error(`Unsupported animation command: ${String(command)}`);
}
module.exports = { commandSchema, basePose, clipFrames, executeMotionCommand };
