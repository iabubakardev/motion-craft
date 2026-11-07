// @ts-check
const { z } = require("zod");
const { transcriptSchema } = require("./schema.cjs");
const { projectSchema } = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { appendCues, captionRecords } = require("../captions/commands.cjs");
const { captionForLayer, cropWords } = require("../captions/presets.cjs");
const { stableId } = require("../animation/engine.cjs");
const { saveTranscript } = require("./commands.cjs");
const { assertLockedTracksUnchanged } = require("../timeline/locks.cjs");
const groupsSchema = z
  .array(
    require("../captions/subtitles.cjs").cueSchema.safeExtend({
      words: z.array(require("../captions/schema.cjs").wordSchema).max(20000),
    }),
  )
  .min(1)
  .max(20000);
/** @param {import('../project/types').Project} project @param {unknown} raw @param {unknown} rawGroups @param {string|undefined} clipId @param {number} offset @param {boolean} replace */
function generateGroupedCaptions(project, raw, rawGroups, clipId, offset, replace) {
  const transcript = transcriptSchema.parse(raw),
    groups = groupsSchema.parse(rawGroups),
    stored = project.transcripts.find((t) => t.id === transcript.id);
  const oldIds = new Set([...transcript.captionIds, ...(stored?.captionIds || [])]),
    old = captionRecords(project).filter((r) => oldIds.has(r.layer.id));
  if (old.length && !replace)
    throw new Error("Confirm replacement of previously generated captions first.");
  const index = require("../timeline/commands.cjs").createTimelineIndex(project),
    item = clipId ? index.clips.get(clipId) : undefined;
  if (clipId && (!item || item.asset?.id !== transcript.assetId))
    throw new Error("The selected source clip changed.");
  const sourceStart = item?.clip.sourceStart ?? 0,
    sourceEnd = item?.clip.sourceEnd ?? transcript.result.duration,
    timelineStart = item?.clip.start ?? offset / project.fps;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid caption offset.");
  const style = old[0] ? captionForLayer(old[0].layer, project.resolution) : undefined;
  const cues = groups.flatMap((g) => {
    const a = Math.max(sourceStart, g.start),
      b = Math.min(sourceEnd, g.end);
    if (b <= a) return [];
    return [
      {
        start: timelineStart + (a - sourceStart) / (item?.clip.playbackRate ?? 1),
        end: timelineStart + (b - sourceStart) / (item?.clip.playbackRate ?? 1),
        text: g.text,
        words: cropWords(g.words, a, b - a).map((w) => ({
          ...w,
          start: w.start / (item?.clip.playbackRate ?? 1),
          end: w.end / (item?.clip.playbackRate ?? 1),
        })),
        ...(style ? { caption: style } : {}),
      },
    ];
  });
  if (!cues.length) throw new Error("No grouped speech overlaps this clip.");
  const clean = rebuildProject({
    ...project,
    scenes: project.scenes.map((s) => ({
      ...s,
      layers: s.layers.filter((l) => !oldIds.has(l.id)),
    })),
    tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !oldIds.has(c.id)) })),
  });
  const before = new Set(captionRecords(clean).map((r) => r.layer.id));
  const next = appendCues(clean, cues, stableId(`${transcript.id}:grouped:${clipId || "source"}`));
  const saved = saveTranscript(next, {
    ...transcript,
    captionIds: captionRecords(next)
      .filter((r) => !before.has(r.layer.id))
      .map((r) => r.layer.id),
  });
  assertLockedTracksUnchanged(project, saved);
  return projectSchema.parse(saved);
}
module.exports = { generateGroupedCaptions, groupsSchema };
