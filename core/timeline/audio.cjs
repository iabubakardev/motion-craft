// @ts-check
const { rebuildProject } = require("../project/operations.cjs");
const { assertLockedTracksUnchanged } = require("./locks.cjs");
const { createTimelineIndex, overlaps } = require("./commands.cjs");
/** @param {import('../project/types').Project} p @param {Extract<import('./types').TimelineCommand,{type:'DetachAudio'|'UpdateAudio'}>} c @param {string} now */
function executeAudioCommand(p, c, now) {
  const index = createTimelineIndex(p),
    item = index.clips.get(c.clipId);
  if (!item) throw new Error("Clip no longer exists.");
  if (item.track.locked) throw new Error("Unlock the source track first.");
  let tracks = p.tracks,
    scenes = p.scenes;
  if (c.type === "DetachAudio") {
    if (item.asset?.type !== "video" || item.clip.audioOnly)
      throw new Error("Select a video clip to detach audio.");
    if (index.clips.has(c.audioClipId)) throw new Error("Audio clip ID already exists.");
    if (
      p.tracks.some((t) => t.clips.some((a) => a.detachedFrom === c.clipId)) ||
      (item.clip.detachedAudioId && index.clips.has(item.clip.detachedAudioId))
    )
      throw new Error("Audio is already detached from this video.");
    let target = tracks.find(
      (t) =>
        t.type === "audio" &&
        !t.locked &&
        !t.clips.some((a) => overlaps(a.start, a.duration, item.clip.start, item.clip.duration)),
    );
    if (!target) {
      if (tracks.length >= 64) throw new Error("The project has reached its track limit.");
      if (tracks.some((t) => t.id === c.trackId)) throw new Error("Track ID already exists.");
      target = {
        id: c.trackId,
        name: "Detached audio",
        type: "audio",
        order: tracks.length,
        visible: true,
        muted: false,
        locked: false,
        height: 48,
        clips: [],
      };
      tracks = [...tracks, target];
    }
    const sourceClip = { ...item.clip };
    delete sourceClip.layerId;
    delete sourceClip.detachedAudioId;
    const audio = {
      ...sourceClip,
      id: c.audioClipId,
      assetId: item.asset.id,
      trackId: target.id,
      audioOnly: true,
      detachedFrom: c.clipId,
      muted:
        item.clip.muted ??
        (item.layer && "muted" in item.layer.properties ? item.layer.properties.muted : false),
      volume:
        item.clip.volume ??
        (item.layer && "volume" in item.layer.properties ? item.layer.properties.volume : 1),
    };
    tracks = tracks.map((t) => ({
      ...t,
      clips: [
        ...t.clips.map((a) =>
          a.id === c.clipId ? { ...a, muted: true, detachedAudioId: audio.id } : a,
        ),
        ...(t.id === target.id ? [audio] : []),
      ],
    }));
    scenes = scenes.map((s) => ({
      ...s,
      layers: s.layers.map((l) =>
        l.id === item.layer?.id && l.type === "video"
          ? { ...l, properties: { ...l.properties, muted: true } }
          : l,
      ),
    }));
  } else {
    if (!item.clip.audioOnly && item.asset?.type !== "audio" && item.layer?.type !== "audio")
      throw new Error("Select an audio clip.");
    if ((c.patch.fadeIn ?? 0) > item.clip.duration || (c.patch.fadeOut ?? 0) > item.clip.duration)
      throw new Error("Fade duration exceeds the clip.");
    tracks = tracks.map((t) => ({
      ...t,
      clips: t.clips.map((a) => (a.id === c.clipId ? { ...a, ...c.patch } : a)),
    }));
    scenes = scenes.map((s) => ({
      ...s,
      layers: s.layers.map((l) =>
        l.id === item.layer?.id && l.type === "audio"
          ? {
              ...l,
              properties: {
                ...l.properties,
                ...(c.patch.volume !== undefined ? { volume: c.patch.volume } : {}),
                ...(c.patch.muted !== undefined ? { muted: c.patch.muted } : {}),
              },
            }
          : l,
      ),
    }));
  }
  const next = rebuildProject({ ...p, tracks, scenes }, now);
  assertLockedTracksUnchanged(p, next);
  return next;
}
module.exports = { executeAudioCommand };
