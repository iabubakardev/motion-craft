// @ts-check
const { transcriptSchema } = require("./schema.cjs");
const { projectSchema, serializeProject } = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { secondsToFrames, framesToSeconds } = require("../timeline/time.cjs");
const { stableId } = require("../animation/engine.cjs");
/** @param {import('zod').infer<typeof transcriptSchema>} transcript @param {number} id @param {string} text */
function editTranscript(transcript, id, text) {
  return transcriptSchema.parse({
    ...transcript,
    result: {
      ...transcript.result,
      segments: transcript.result.segments.map((segment) =>
        segment.id === id ? { ...segment, text, words: [] } : segment,
      ),
    },
  });
}
/** Preserve originals and manual edits; saving a reviewed transcript is independent from caption generation.
 * @param {import('../project/types').Project} project @param {unknown} raw */
function saveTranscript(project, raw) {
  const parsed = transcriptSchema.parse(raw);
  const clipIds = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const transcript = { ...parsed, captionIds: parsed.captionIds.filter((id) => clipIds.has(id)) };
  if (
    !project.assets.some(
      (a) =>
        a.id === transcript.assetId &&
        a.type !== "image" &&
        a.size === transcript.source.size &&
        a.filename === transcript.source.filename,
    )
  )
    throw new Error("The transcript source is no longer in this project.");
  const next = projectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString(),
    transcripts: [...(project.transcripts || []).filter((t) => t.id !== transcript.id), transcript],
  });
  serializeProject(next);
  return next;
}
/** Creates ordinary caption layers/clips; one atomic project operation. Existing captions are never replaced.
 * @param {import('../project/types').Project} rawProject @param {unknown} raw @param {number} [offsetFrames] */
function generateCaptions(rawProject, raw, offsetFrames = 0) {
  const project = projectSchema.parse(rawProject),
    transcript = transcriptSchema.parse(raw);
  if (!Number.isSafeInteger(offsetFrames) || offsetFrames < 0)
    throw new Error("Caption offset must be nonnegative integer frames.");
  if (!transcript.result.segments.length)
    throw new Error("No speech segments were returned. No captions were created.");
  if (
    transcript.captionIds.some((id) => project.tracks.some((t) => t.clips.some((c) => c.id === id)))
  )
    throw new Error("This transcript already has captions. Existing captions were preserved.");
  const trackId = stableId(`${project.id}:captions`);
  const track = project.tracks.find((t) => t.id === trackId);
  if (track?.locked) throw new Error("Unlock the Captions track first.");
  const intervals = transcript.result.segments.map((s) => ({
    segment: s,
    start: offsetFrames + secondsToFrames(s.start, project.fps),
    end:
      offsetFrames +
      Math.max(secondsToFrames(s.start, project.fps) + 1, secondsToFrames(s.end, project.fps)),
  }));
  const total = framesToSeconds(Math.max(...intervals.map((s) => s.end)), project.fps);
  if (total > 86400) throw new Error("Captions exceed 24 hours.");
  let scenes = project.scenes.map((s) => ({ ...s, layers: [...s.layers] }));
  const sceneEnd = scenes.reduce((sum, s) => sum + s.duration, 0);
  if (total > sceneEnd + 1e-6)
    scenes.push({
      id: stableId(`${transcript.id}:caption-scene`),
      name: "Transcription captions",
      start: sceneEnd,
      duration: total - sceneEnd,
      narration: "",
      stylePreset: project.stylePreset,
      layers: [],
      transitionIn: { type: "none", duration: 0 },
      transitionOut: { type: "none", duration: 0 },
      metadata: { notes: "", tags: [] },
    });
  const captionIds = [];
  for (const { segment, start, end } of intervals) {
    if (!segment.text.trim()) throw new Error("Caption text cannot be blank.");
    for (const scene of scenes) {
      const sceneStart = secondsToFrames(scene.start, project.fps, "ceil"),
        sceneEnd = secondsToFrames(scene.start + scene.duration, project.fps, "ceil");
      const a = Math.max(start, sceneStart),
        b = Math.min(end, sceneEnd);
      if (b <= a) continue;
      const id = stableId(`${transcript.id}:${segment.id}:${scene.id}`);
      captionIds.push(id);
      scene.layers.push({
        id,
        trackId,
        type: "caption",
        start: framesToSeconds(a, project.fps) - scene.start,
        duration:
          Math.min(framesToSeconds(b, project.fps), scene.start + scene.duration) -
          framesToSeconds(a, project.fps),
        position: { x: 0, y: project.resolution.height * 0.35 },
        scale: 1,
        rotation: 0,
        opacity: 1,
        zIndex: 100,
        animation: { preset: "none", duration: 0 },
        properties: { text: segment.text, fontSize: 48, fontFamily: "system", color: "#ffffff" },
      });
    }
  }
  /** @type {import('../project/types').Track[]} */
  const tracks = track
    ? project.tracks
    : [
        ...project.tracks.map((t) => ({ ...t, order: t.order + 1 })),
        {
          id: trackId,
          name: "Captions",
          type: "video",
          order: 0,
          visible: true,
          muted: false,
          locked: false,
          height: 48,
          clips: [],
        },
      ];
  const next = rebuildProject({ ...project, scenes, tracks });
  return saveTranscript(next, { ...transcript, captionIds });
}
module.exports = { editTranscript, saveTranscript, generateCaptions };
