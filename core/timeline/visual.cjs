// @ts-check
const { z } = require("zod");
const { projectSchema } = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { visualSchema } = require("./visual-schema.cjs");
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("UpdateVisual"), clipId: z.uuid(), visual: visualSchema }).strict(),
  z
    .object({
      type: z.literal("SetPlaybackRate"),
      clipId: z.uuid(),
      rate: z.number().min(0.25).max(4),
    })
    .strict(),
]);
/** @param {import('../project/types').Project} project @param {unknown} raw */
function executeVisualCommand(project, raw) {
  const p = projectSchema.parse(project),
    c = commandSchema.parse(raw),
    index = require("./commands.cjs").createTimelineIndex(p),
    item = index.clips.get(c.clipId);
  if (!item) throw new Error("Select a timeline clip first.");
  if (item.track.locked) throw new Error("Unlock this track first.");
  if (c.type === "SetPlaybackRate") {
    if (p.animations[c.clipId]?.keyframes.length)
      throw new Error("Clear this clip?s animation before changing speed.");
    if (item.clip.layerId)
      throw new Error(
        "Speed currently applies to independent media clips. Scene layers retain their scene timing.",
      );
    if (item.clip.sourceStart === null || item.clip.sourceEnd === null)
      throw new Error("Speed requires video or audio.");
    const durationFrames = Math.max(
      1,
      Math.floor(((item.clip.sourceEnd - item.clip.sourceStart) / c.rate) * p.fps + 1e-8),
    );
    const updated = rebuildProject({
      ...p,
      tracks: p.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((a) =>
          a.id === c.clipId
            ? {
                ...a,
                playbackRate: c.rate,
                duration: durationFrames / p.fps,
                sourceEnd:
                  a.sourceStart === null ? null : a.sourceStart + (durationFrames / p.fps) * c.rate,
              }
            : a,
        ),
      })),
    });
    // Validate the final plan atomically; no intermediate document is installed.
    return require("./commands.cjs").executeTimelineCommand(
      updated,
      {
        type: "UpdateClipProperties",
        clipId: c.clipId,
        startFrame: Math.round(item.clip.start * p.fps),
        durationFrames,
      },
      new Date().toISOString(),
    );
  }
  if (item.clip.audioOnly || item.asset?.type === "audio" || item.layer?.type === "caption")
    throw new Error("Select an image, video, text or shape clip.");
  return projectSchema.parse(
    rebuildProject({
      ...p,
      tracks: p.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((a) => (a.id === c.clipId ? { ...a, visual: c.visual } : a)),
      })),
    }),
  );
}
module.exports = { executeVisualCommand, commandSchema };
