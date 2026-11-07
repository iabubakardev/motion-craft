// @ts-check
const { z } = require("zod");
const { planSchema, inputSchema, settingsSchema } = require("./schema.cjs");
const { projectSchema, layerSchema } = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { stableId, presetKeys } = require("../animation/engine.cjs");
const { basePose, clipFrames } = require("../animation/commands.cjs");
const { secondsToFrames, framesToSeconds } = require("../timeline/time.cjs");
/** @typedef {import('zod').infer<typeof planSchema>} Plan */
/** Deterministic boundaries. The LLM describes these scenes; it never assigns their timing.
 * @param {unknown} rawInput @param {unknown} rawSettings @param {string} id */
function preparePlan(rawInput, rawSettings, id) {
  const input = inputSchema.parse(rawInput),
    settings = settingsSchema.parse(rawSettings);
  const transcript = input.kind === "transcript" ? input.transcript : null;
  const text =
    input.kind === "script" ? input.text.replace(/\s+/g, " ").trim() : input.transcript.text;
  const duration =
    transcript?.duration ||
    Math.max(settings.minSeconds, (text.split(/\s+/u).length * 60) / settings.wordsPerMinute);
  if (duration > 86400) throw new Error("Input exceeds the 24-hour limit.");
  const target = (settings.minSeconds + settings.maxSeconds) / 2;
  const count = Math.max(
    1,
    Math.min(Math.floor(duration / settings.minSeconds), Math.ceil(duration / target)),
  );
  if (count > 512) throw new Error("Split this narration into smaller plans (maximum 512 scenes).");
  const words = text.split(/\s+/u);
  const boundaries = [0];
  const candidates = transcript
    ? transcript.segments.map((segment) => segment.start)
    : words.flatMap((word, i) =>
        /[.!????]$/u.test(word) ? [((i + 1) / words.length) * duration] : [],
      );
  for (let i = 1; i < count; i++) {
    const low = Math.max(
      boundaries[i - 1] + settings.minSeconds,
      duration - (count - i) * settings.maxSeconds,
    );
    const high = Math.min(
      boundaries[i - 1] + settings.maxSeconds,
      duration - (count - i) * settings.minSeconds,
    );
    const target = Math.max(low, Math.min(high, (i * duration) / count));
    const nearby = candidates
      .filter(
        (time) => time >= low && time <= high && Math.abs(time - target) <= settings.minSeconds / 2,
      )
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    boundaries.push(nearby[0] ?? target);
  }
  boundaries.push(duration);
  const scenes = Array.from({ length: count }, (_, i) => {
    const start = boundaries[i],
      end = boundaries[i + 1];
    return {
      id: stableId(`${id}:scene:${i}`),
      start,
      end,
      narration: transcript
        ? narrationText(transcript, start, end)
        : words
            .slice(
              Math.round((start / duration) * words.length),
              Math.round((end / duration) * words.length),
            )
            .join(" "),
      visualDescription: "Awaiting visual plan",
      keywords: ["unmatched"],
      assetType: "image",
      assetId: null,
      animation: "none",
    };
  });
  return planSchema.parse({
    version: 1,
    id,
    name: "AI production",
    fps: settings.fps,
    aspectRatio: settings.aspectRatio,
    style: settings.style,
    timing: transcript ? "narration" : "estimated",
    duration,
    transcript,
    scenes,
  });
}
/** Assign every aligned word (or unaligned segment) exactly once by its canonical start.
 * @param {import('zod').infer<typeof import('./schema.cjs').transcriptSchema>} transcript
 * @param {number} start @param {number} end */
function narrationText(transcript, start, end) {
  return transcript.segments
    .flatMap((s) =>
      s.words?.length
        ? s.words.filter((w) => w.start >= start && w.start < end).map((w) => w.text)
        : s.start >= start && s.start < end
          ? [s.text]
          : [],
    )
    .join(" ");
}
const visualSchema = z
  .object({
    scenes: z
      .array(
        z
          .object({
            id: z.uuid(),
            visualDescription: z.string().trim().min(1).max(2000),
            keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
            assetType: z.enum(["image", "video"]),
            animation: z.enum(["none", "fade-in", "slide-up", "pan", "documentary-zoom"]),
            transition: z.enum(["cut", "fade-in"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
/** @param {Plan['scenes']} scenes @param {unknown} raw */
function validateVisuals(scenes, raw) {
  const result = visualSchema.parse(raw);
  if (
    result.scenes.length !== scenes.length ||
    new Set(result.scenes.map((s) => s.id)).size !== scenes.length ||
    scenes.some((s) => !result.scenes.some((v) => v.id === s.id))
  )
    throw new Error("The model changed scene identities. Retry with a JSON-capable local model.");
  return scenes.map((scene) => ({ ...scene, ...result.scenes.find((s) => s.id === scene.id) }));
}
/** Filename/metadata ranking is explainable, not visual semantic understanding.
 * @param {Plan['scenes'][number]} scene @param {import('../project/types').ProjectAsset[]} assets @param {Plan['aspectRatio']} aspect */
function rankAssets(scene, assets, aspect) {
  const tokens = new Set(
    scene.keywords
      .flatMap((k) => k.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
      .filter((k) => k.length > 2),
  );
  const [w, h] = aspect.split(":").map(Number);
  return assets
    .filter((a) => a.type !== "audio")
    .map((asset) => {
      const words = new Set(
        asset.filename
          .toLowerCase()
          .replace(/[_-]/g, " ")
          .match(/[\p{L}\p{N}]+/gu) || [],
      );
      const matched = [...tokens].filter((token) => words.has(token));
      const reasons = matched.map((t) => `Filename: ${t}`);
      let score = matched.length ? Math.min(0.75, 0.45 + matched.length * 0.1) : 0;
      if (asset.type === scene.assetType) {
        score += 0.08;
        reasons.push("Suggested media type");
      }
      if (asset.width && asset.height && Math.abs(asset.width / asset.height - w / h) < 0.15) {
        score += 0.07;
        reasons.push("Similar aspect ratio");
      }
      if (asset.type === "image" || (asset.duration && asset.duration >= scene.end - scene.start)) {
        score += 0.05;
        reasons.push("Covers scene duration");
      } else reasons.push("Shorter than scene; remaining time stays background");
      return { assetId: asset.id, score: Math.min(1, score), reasons, matched: matched.length > 0 };
    })
    .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId))
    .slice(0, 8);
}
/** @param {Plan} plan @param {import('../project/types').ProjectAsset[]} assets */
function suggestAssets(plan, assets) {
  return planSchema.parse({
    ...plan,
    scenes: plan.scenes.map((scene) => {
      const best = rankAssets(scene, assets, plan.aspectRatio)[0];
      return { ...scene, assetId: best && best.matched && best.score >= 0.6 ? best.assetId : null };
    }),
  });
}
/** Append only: preserve every existing edit, fill scene-order spacing without moving clips.
 * @param {import('../project/types').Project} project @param {unknown} raw @param {string} timestamp @returns {import('../project/types').Project} */
function applyPlan(
  project,
  raw,
  timestamp,
  narrationRange = /** @type {import("zod").infer<typeof import("../transcription/schema.cjs").sourceRangeSchema>|undefined} */ (
    undefined
  ),
) {
  const plan = planSchema.parse(raw),
    original = projectSchema.parse(project);
  z.iso.datetime().parse(timestamp);
  if (plan.fps !== original.fps || plan.aspectRatio !== original.aspectRatio)
    throw new Error("Match the plan FPS and aspect ratio to this project before applying.");
  const offset = Math.max(
    0,
    framesToSeconds(secondsToFrames(original.duration, original.fps, "ceil"), original.fps),
  );
  const v1 = original.tracks.find((t) => t.name === "V1" && t.type === "video"),
    v4 = original.tracks.find((t) => t.name === "V4" && t.type === "video"),
    a1 = original.tracks.find((t) => t.name === "A1" && t.type === "audio");
  if (!v1 || v1.locked || (plan.transcript && (!v4 || v4.locked || !a1 || a1.locked)))
    throw new Error("Unlock the required V1, V4 and A1 tracks before applying.");
  const assets = new Map(original.assets.map((a) => [a.id, a]));
  const base = {
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    animation: { preset: "none", duration: 0 },
  };
  /** @type {import('../project/types').Scene[]} */
  const additions = [];
  const sceneEnd = original.scenes.reduce((sum, s) => sum + s.duration, 0);
  const gapId = stableId(`${plan.id}:spacing`);
  /** @returns {import("../project/types").Scene} */
  const makeScene = (
    /** @type {string} */ id,
    /** @type {number} */ duration,
    /** @type {string} */ name,
  ) => ({
    id,
    name,
    start: 0,
    duration,
    narration: "",
    stylePreset: plan.style,
    layers: [],
    transitionIn: { type: "none", duration: 0 },
    transitionOut: { type: "none", duration: 0 },
    metadata: { notes: "", tags: [] },
  });
  if (offset - sceneEnd > 1e-6)
    additions.push(makeScene(gapId, offset - sceneEnd, "Existing timeline spacing"));
  for (const [i, scene] of plan.scenes.entries()) {
    if (original.scenes.some((s) => s.id === scene.id))
      throw new Error("This plan was already applied. Existing scenes were kept.");
    const next = makeScene(scene.id, scene.end - scene.start, `AI scene ${i + 1}`);
    next.narration = scene.narration;
    next.metadata.notes = `${scene.visualDescription}\nKeywords: ${scene.keywords.join(", ")}\nPlan: ${plan.id}; timing: ${plan.timing}`;
    if (scene.assetId) {
      const asset = assets.get(scene.assetId);
      if (!asset || asset.type === "audio")
        throw new Error("Choose an imported visual asset or leave the scene unmatched.");
      if (asset.type === "video" && !asset.duration)
        throw new Error("Video duration is required before using it in a plan.");
      next.layers.push(
        layerSchema.parse({
          ...base,
          id: stableId(`${scene.id}:visual`),
          trackId: v1.id,
          start: 0,
          duration:
            asset.type === "video" ? Math.min(next.duration, asset.duration || 0) : next.duration,
          type: asset.type,
          assetId: asset.id,
          properties:
            asset.type === "image"
              ? { fit: "contain" }
              : { sourceStart: 0, volume: 1, muted: true },
        }),
      );
    }
    // Caption intervals retain original source times; split at scene boundaries only for ownership.
    if (plan.transcript && v4)
      for (const segment of plan.transcript.segments) {
        const start = Math.max(scene.start, segment.start),
          end = Math.min(scene.end, segment.end);
        if (end <= start) continue;
        next.layers.push(
          layerSchema.parse({
            ...base,
            id: stableId(`${scene.id}:caption:${segment.id}`),
            trackId: v4.id,
            type: "caption",
            start: start - scene.start,
            duration: end - start,
            position: { x: 0, y: original.resolution.height * 0.35 },
            zIndex: 1,
            properties: {
              text: segment.text,
              fontSize: Math.max(12, Math.min(96, original.resolution.height * 0.055)),
              fontFamily: "system",
              color: "#ffffff",
            },
          }),
        );
      }
    additions.push(next);
  }
  let tracks = original.tracks;
  if (plan.transcript && a1) {
    const source = assets.get(plan.transcript.sourceAssetId);
    if (
      !source ||
      source.type !== "audio" ||
      (source.duration && source.duration + 1e-6 < (narrationRange?.sourceEnd ?? plan.duration))
    )
      throw new Error("Relink the original narration and verify its duration before applying.");
    tracks = tracks.map((t) =>
      t.id === a1.id
        ? {
            ...t,
            clips: [
              ...t.clips,
              {
                id: stableId(`${plan.id}:narration`),
                assetId: source.id,
                trackId: a1.id,
                start: offset,
                duration: plan.duration,
                sourceStart: narrationRange?.sourceStart ?? 0,
                sourceEnd: narrationRange?.sourceEnd ?? plan.duration,
                ...(narrationRange ? { playbackRate: narrationRange.rate } : {}),
              },
            ],
          }
        : t,
    );
  }
  let next = rebuildProject(
    { ...original, scenes: [...original.scenes, ...additions], tracks },
    timestamp,
  );
  for (const scene of plan.scenes) {
    if (scene.animation === "none") continue;
    const clip = next.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === stableId(`${scene.id}:visual`));
    const layer = next.scenes.flatMap((s) => s.layers).find((l) => l.id === clip?.layerId);
    if (!clip || !layer) continue;
    const total = clipFrames(clip, next.fps),
      durationFrames = ["pan", "documentary-zoom"].includes(scene.animation)
        ? total
        : Math.min(total, Math.max(2, next.fps));
    if (total < 2) continue;
    next = {
      ...next,
      animations: {
        ...next.animations,
        [clip.id]: {
          keyframes: presetKeys(
            scene.animation,
            durationFrames,
            total,
            basePose(layer),
            next.resolution.width,
            next.resolution.height,
            clip.id,
          ),
          preset: { name: scene.animation, durationFrames },
        },
      },
    };
  }
  return projectSchema.parse(next);
}
module.exports = {
  preparePlan,
  narrationText,
  visualSchema,
  validateVisuals,
  rankAssets,
  suggestAssets,
  applyPlan,
};
