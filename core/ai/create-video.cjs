// @ts-check
const { z } = require("zod");
const {
  transcriptSchema: canonicalSchema,
  sourceRangeSchema,
} = require("../transcription/schema.cjs");
const { transcriptSchema, planSchema } = require("./schema.cjs");
const { stableId } = require("../animation/engine.cjs");
const { applyPlan, narrationText } = require("./planning.cjs");
const { projectSchema } = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { appendCues, captionRecords } = require("../captions/commands.cjs");
const { makeCaption } = require("../captions/presets.cjs");
const { saveTranscript } = require("../transcription/commands.cjs");
const optionsSchema = z
  .object({
    range: sourceRangeSchema,
    preset: require("../captions/schema.cjs").presetSchema,
    replace: z.boolean(),
  })
  .strict();
/** Clip-relative canonical speech, preserving reviewed text and valid words. No fabricated alignment.
 * @param {unknown} raw @param {unknown} rawRange */
function narrationTranscript(raw, rawRange) {
  const t = canonicalSchema.parse(raw),
    r = sourceRangeSchema.parse(rawRange);
  if (
    (t.context?.sourceStart ?? 0) > r.sourceStart + 1e-6 ||
    (t.context?.sourceEnd ?? t.result.duration) < r.sourceEnd - 0.1
  )
    throw new Error("Saved transcript does not cover the selected narration.");
  const segments = t.result.segments.flatMap((s) => {
    const start = Math.max(r.sourceStart, s.start),
      end = Math.min(r.sourceEnd, s.end);
    if (end <= start) return [];
    const trimmed = s.start < start - 1e-6 || s.end > end + 1e-6;
    const aligned = s.words.every((w) => w.end > w.start);
    const words = (aligned ? s.words : [])
      .filter((w) => w.end > w.start && w.end > start && w.start < end)
      .map((w) => ({
        ...w,
        start: (Math.max(w.start, start) - r.sourceStart) / r.rate,
        end: (Math.min(w.end, end) - r.sourceStart) / r.rate,
      }));
    if (!words.length && trimmed)
      throw new Error("Trimmed speech needs word alignment. Transcribe the selected range first.");
    return [
      {
        id: stableId(`${t.id}:${s.id}`),
        start: (start - r.sourceStart) / r.rate,
        end: (end - r.sourceStart) / r.rate,
        text:
          trimmed && words.length
            ? words
                .map((w) => w.text)
                .join(" ")
                .trim()
            : s.text,
        words,
      },
    ];
  });
  return transcriptSchema.parse({
    version: 1,
    id: t.id,
    sourceAssetId: t.assetId,
    language: t.result.language,
    duration: (r.sourceEnd - r.sourceStart) / r.rate,
    text: segments.map((s) => s.text).join(" "),
    model: { engine: "faster-whisper", name: t.result.model, device: "cpu", computeType: "int8" },
    segments,
  });
}
/** Only exact source fingerprints and covering source ranges are reusable. Model choice does not discard reviewed edits.
 * @param {import('../project/types').Project['transcripts']} transcripts @param {string} assetId
 * @param {{size:number,modifiedAt:number}} info @param {import('zod').infer<typeof sourceRangeSchema>} range */
function reusableTranscript(transcripts, assetId, info, range) {
  return [...transcripts].reverse().find(
    (t) =>
      t.assetId === assetId &&
      t.source.size === info.size &&
      t.source.modifiedAt === info.modifiedAt &&
      (t.context?.sourceStart ?? 0) <= range.sourceStart + 1e-6 &&
      (t.context?.sourceEnd ?? t.result.duration) >= range.sourceEnd - 0.1 &&
      (() => {
        try {
          narrationTranscript(t, range);
          return true;
        } catch {
          return false;
        }
      })(),
  );
}
/** Explainable lexical evidence. Type/aspect alone never qualify as a match.
 * @param {import('./planning.cjs').Plan['scenes'][number]} scene
 * @param {import('../project/types').ProjectAsset[]} assets
 * @param {Record<string,{description:string,tags:string[]}>} metadata */
function matchMedia(scene, assets, metadata = {}) {
  const tokens = new Set(
    scene.keywords
      .flatMap((k) => k.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
      .filter((k) => k.length > 2),
  );
  return assets
    .filter((a) => a.type !== "audio")
    .map((a) => {
      const m = metadata[a.id];
      const text = [a.filename, m?.description, ...(m?.tags || [])].join(" ").toLowerCase();
      const words = new Set(text.match(/[\p{L}\p{N}]+/gu) || []);
      const hits = [...tokens].filter((k) => words.has(k));
      const covers = a.type === "image" || (a.duration ?? 0) >= scene.end - scene.start - 1e-6;
      return {
        assetId: a.id,
        score: hits.length ? Math.min(0.95, 0.5 + hits.length * 0.1) : 0,
        suitable: hits.length > 0 && covers,
        reasons: [
          ...hits.map((k) => `Filename, description or tag: ${k}`),
          covers ? "Covers full scene" : "Too short; choose a longer clip or image",
        ],
      };
    })
    .sort(
      (a, b) =>
        Number(b.suitable) - Number(a.suitable) ||
        b.score - a.score ||
        a.assetId.localeCompare(b.assetId),
    );
}
/** A single immutable document edit. Reuse established assembly, caption and persistence commands.
 * @param {import('../project/types').Project} project @param {unknown} rawPlan
 * @param {unknown} rawTranscript @param {unknown} rawOptions */
function assembleVideo(project, rawPlan, rawTranscript, rawOptions) {
  const plan = planSchema.parse(rawPlan),
    transcript = canonicalSchema.parse(rawTranscript),
    options = optionsSchema.parse(rawOptions);
  if (!["16:9", "9:16"].includes(plan.aspectRatio))
    throw new Error("Choose a 16:9 or 9:16 video canvas.");
  if (project.duration > 0 && !options.replace)
    throw new Error("Confirm replacing the existing timeline first.");
  if (project.tracks.some((t) => t.locked && t.clips.length))
    throw new Error("Unlock existing tracks before replacing the timeline.");
  const canonical = narrationTranscript(transcript, options.range);
  if (JSON.stringify(plan.transcript) !== JSON.stringify(canonical))
    throw new Error("The plan no longer matches the canonical narration.");
  for (const s of plan.scenes) {
    if (s.narration !== narrationText(canonical, s.start, s.end))
      throw new Error("Scene narration differs from its canonical speech interval.");
    const a = project.assets.find((a) => a.id === s.assetId);
    if (!a || a.type === "audio") throw new Error("Resolve every visual scene before assembling.");
    if (a.type === "video" && (a.duration ?? 0) < s.end - s.start - 1e-6)
      throw new Error("A visual is shorter than its scene.");
  }
  const source = project.assets.find((a) => a.id === transcript.assetId);
  if (!source || source.type !== "audio")
    throw new Error("Choose an imported narration audio asset.");
  const clean = projectSchema.parse({
    ...project,
    scenes: [],
    duration: 0,
    animations: {},
    resolution:
      plan.aspectRatio === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
    aspectRatio: plan.aspectRatio,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: [],
      muted: false,
      visible: true,
      solo: false,
      gainDb: 0,
    })),
    transcripts: project.transcripts.map((t) => ({ ...t, captionIds: [] })),
  });
  let next = applyPlan(
    clean,
    {
      ...plan,
      scenes: plan.scenes.map((s) => ({
        ...s,
        animation: s.transition === "fade-in" && s.animation === "none" ? "fade-in" : s.animation,
      })),
    },
    new Date().toISOString(),
    options.range,
  );
  next = rebuildProject({
    ...next,
    scenes: next.scenes.map((s) => ({
      ...s,
      layers: s.layers.filter((l) => l.type !== "caption"),
    })),
    tracks: next.tracks.map((t) => ({
      ...t,
      clips: t.clips
        .filter((c) => !c.layerId)
        .map((c) =>
          c.id === stableId(`${plan.id}:narration`)
            ? {
                ...c,
                sourceStart: options.range.sourceStart,
                sourceEnd: options.range.sourceEnd,
                playbackRate: options.range.rate,
              }
            : c,
        ),
    })),
  });
  const caption = makeCaption(options.preset);
  const cues = canonical.segments.flatMap((s) => {
    if (!s.words?.length) return [{ start: s.start, end: s.end, text: s.text, words: [], caption }];
    const groups = [];
    for (let i = 0; i < s.words.length; i += 6) {
      const words = s.words.slice(i, i + 6),
        start = words[0].start,
        end = words[words.length - 1].end;
      groups.push({
        start,
        end,
        text: words.map((w) => w.text).join(" "),
        caption,
        words: words.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start })),
      });
    }
    return groups;
  });
  next = appendCues(next, cues, stableId(`${plan.id}:captions`));
  next = saveTranscript(next, {
    ...transcript,
    captionIds: captionRecords(next).map((r) => r.layer.id),
  });
  return projectSchema.parse(next);
}
module.exports = {
  narrationTranscript,
  reusableTranscript,
  matchMedia,
  assembleVideo,
  optionsSchema,
};
