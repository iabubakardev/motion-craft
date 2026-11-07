// @ts-check
const { z } = require("zod");
const randomUUID = () => globalThis.crypto.randomUUID();
const { projectSchema } = require("../project/schema.cjs"),
  { rebuildProject } = require("../project/operations.cjs"),
  { assertLockedTracksUnchanged } = require("../timeline/locks.cjs");
const { audioSchema, defaultAudio } = require("./schema.cjs"),
  { duckingKeys } = require("./engine.cjs");
const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SetAudio"),
      clipId: z.uuid(),
      audio: audioSchema,
      legacyVolume: z.number().min(0).max(2).optional(),
      fadeIn: z.number().min(0).optional(),
      fadeOut: z.number().min(0).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SetTrackMix"),
      trackId: z.uuid(),
      gainDb: z.number().min(-60).max(12),
      solo: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("Crossfade"),
      leftId: z.uuid(),
      rightId: z.uuid(),
      duration: z.number().positive().max(30),
      curve: z.enum(["linear", "equal-power"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("Duck"),
      musicId: z.uuid(),
      regions: z.array(z.tuple([z.number().min(0), z.number().max(86400)])).max(20000),
      depthDb: z.number().min(-60).max(0),
      attack: z.number().min(0.01).max(10),
      release: z.number().min(0.01).max(30),
      preRoll: z.number().min(0).max(10),
      gap: z.number().min(0).max(30),
      replace: z.boolean(),
    })
    .strict(),
]);
/** @param {import('../project/types').Project} project @param {unknown} raw */
function executeAudioEdit(project, raw) {
  const p = projectSchema.parse(project),
    c = commandSchema.parse(raw),
    index = require("../timeline/commands.cjs").createTimelineIndex(p);
  let tracks = p.tracks;
  if (c.type === "SetTrackMix") {
    if (!tracks.some((t) => t.id === c.trackId))
      throw new Error("The selected track no longer exists.");
    tracks = tracks.map((t) => (t.id === c.trackId ? { ...t, gainDb: c.gainDb, solo: c.solo } : t));
  } else if (c.type === "SetAudio") {
    const r = index.clips.get(c.clipId);
    if (!r || (!r.clip.audioOnly && r.asset?.type !== "audio" && r.asset?.type !== "video"))
      throw new Error("Select a playable audio or video clip.");
    if (c.audio.keys.some((k) => k.frame >= Math.ceil(r.clip.duration * p.fps)))
      throw new Error("Volume keys must remain inside this clip.");
    if (
      (c.fadeIn ?? r.clip.fadeIn ?? 0) > r.clip.duration ||
      (c.fadeOut ?? r.clip.fadeOut ?? 0) > r.clip.duration
    )
      throw new Error("Fades must remain inside this clip.");
    tracks = tracks.map((t) => ({
      ...t,
      clips: t.clips.map((a) =>
        a.id === c.clipId
          ? {
              ...a,
              audio: c.audio,
              ...(c.legacyVolume !== undefined ? { volume: c.legacyVolume } : {}),
              ...(c.fadeIn !== undefined ? { fadeIn: c.fadeIn } : {}),
              ...(c.fadeOut !== undefined ? { fadeOut: c.fadeOut } : {}),
            }
          : a,
      ),
    }));
  } else if (c.type === "Crossfade") {
    const left = index.clips.get(c.leftId),
      right = index.clips.get(c.rightId);
    if (
      !left ||
      !right ||
      left.clip.id === right.clip.id ||
      left.track.id !== right.track.id ||
      left.track.type !== "audio"
    )
      throw new Error("Choose two clips on the same audio track.");
    if (left.clip.layerId || right.clip.layerId)
      throw new Error(
        "Crossfades require independent audio clips. Scene layers retain scene timing.",
      );
    if (c.duration >= Math.min(left.clip.duration, right.clip.duration))
      throw new Error("Crossfade must be shorter than both clips.");
    const at = left.clip.start + left.clip.duration - c.duration;
    if (at < 0) throw new Error("Crossfade starts before the timeline.");
    tracks = tracks.map((t) =>
      t.id !== left.track.id
        ? t
        : {
            ...t,
            audioOverlap: true,
            clips: t.clips.map((a) =>
              a.id === left.clip.id
                ? {
                    ...a,
                    fadeOut: c.duration,
                    audio: { ...(a.audio ?? defaultAudio()), fadeCurve: c.curve },
                  }
                : a.id === right.clip.id
                  ? {
                      ...a,
                      start: at,
                      fadeIn: c.duration,
                      audio: { ...(a.audio ?? defaultAudio()), fadeCurve: c.curve },
                    }
                  : a,
            ),
          },
    );
  } else {
    const t = tracks.find((t) => t.id === c.musicId && t.type === "audio");
    if (!t) throw new Error("Select a music audio track.");
    if (t.clips.some((a) => a.audio?.keys.length) && !c.replace)
      throw new Error("Confirm replacement of existing music automation first.");
    if (!c.regions.length) throw new Error("No speech activity was found.");
    tracks = tracks.map((a) =>
      a.id !== t.id
        ? a
        : {
            ...a,
            clips: a.clips.map((clip) => ({
              ...clip,
              audio: {
                ...(clip.audio ?? defaultAudio()),
                keys: duckingKeys(c.regions, c, clip.start, clip.duration, p.fps, randomUUID),
              },
            })),
          },
    );
  }
  if (JSON.stringify(tracks) === JSON.stringify(project.tracks)) return project;
  const next = projectSchema.parse(rebuildProject({ ...p, tracks }));
  assertLockedTracksUnchanged(p, next);
  return next;
}
/** Keep automation aligned after source trims/splits. @param {import('../project/types').Clip} old @param {import('../project/types').Clip} next @param {number} fps */
function cropAudio(old, next, fps) {
  const { automationDb } = require("./engine.cjs");
  const trimStart = Math.max(0, next.start - old.start),
    trimEnd = Math.max(0, old.duration - trimStart - next.duration);
  const fades = {
    ...(old.fadeIn !== undefined
      ? { fadeIn: Math.min(next.duration, Math.max(0, old.fadeIn - trimStart)) }
      : {}),
    ...(old.fadeOut !== undefined
      ? { fadeOut: Math.min(next.duration, Math.max(0, old.fadeOut - trimEnd)) }
      : {}),
  };
  if (!old.audio) return { ...next, ...fades };
  const delta = Math.round((next.start - old.start) * fps),
    end = Math.ceil(next.duration * fps) - 1,
    keys = old.audio.keys;
  const shifted = keys
    .filter((k) => k.frame >= delta && k.frame <= delta + end)
    .map((k) => ({ ...k, frame: k.frame - delta }));
  if (keys.length) {
    if ((!shifted.length || keys[0].frame < delta) && !shifted.some((k) => k.frame === 0))
      shifted.push({
        id: require("../animation/engine.cjs").stableId(
          `${old.id}:${next.id}:audio:${delta}:start`,
        ),
        frame: 0,
        db: automationDb(keys, delta),
        origin: "manual",
      });
    if (keys[keys.length - 1].frame > delta + end && !shifted.some((k) => k.frame === end))
      shifted.push({
        id: require("../animation/engine.cjs").stableId(
          `${old.id}:${next.id}:audio:${delta + end}:end`,
        ),
        frame: end,
        db: automationDb(keys, delta + end),
        origin: "manual",
      });
  }
  return {
    ...next,
    ...fades,
    audio: { ...old.audio, keys: shifted.sort((a, b) => a.frame - b.frame) },
  };
}
module.exports = { executeAudioEdit, cropAudio, commandSchema };
