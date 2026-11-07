// @ts-check
const { z } = require("zod");
const { projectSchema, serializeProject } = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { assertLockedTracksUnchanged } = require("../timeline/locks.cjs");
const { stableId } = require("../animation/engine.cjs");
const { secondsToFrames, framesToSeconds } = require("../timeline/time.cjs");
const {
  captionSchema,
  styleSchema,
  boxSchema,
  presetSchema,
  wordSchema,
  groupingSchema,
} = require("./schema.cjs");
const { makeCaption, captionForLayer, cropWords } = require("./presets.cjs");
const { groupWords } = require("./engine.cjs");
const { cuesSchema } = require("./subtitles.cjs");
const ids = z
  .array(z.uuid())
  .min(1)
  .max(10000)
  .refine((a) => new Set(a).size === a.length);
const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("StyleCaptions"),
      ids,
      preset: presetSchema.optional(),
      patch: styleSchema.partial().optional(),
    })
    .strict(),
  z.object({ type: z.literal("PositionCaptions"), ids, patch: boxSchema.partial() }).strict(),
  z
    .object({
      type: z.literal("EditCaption"),
      id: z.uuid(),
      text: z.string().trim().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("StyleWord"),
      id: z.uuid(),
      index: z.number().int().min(0),
      patch: z
        .object({
          color: wordSchema.shape.color,
          bold: wordSchema.shape.bold,
          scale: wordSchema.shape.scale,
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("ImportCaptions"), cues: cuesSchema, batchId: z.uuid() }).strict(),
  z.object({ type: z.literal("MergeCaptions"), ids }).strict(),
  z
    .object({ type: z.literal("RegroupCaptions"), ids, options: groupingSchema, batchId: z.uuid() })
    .strict(),
]);
/** @param {import('../project/types').Project} project */
function captionRecords(project) {
  return project.scenes
    .flatMap((scene) =>
      scene.layers.flatMap((layer) =>
        layer.type === "caption"
          ? [
              {
                scene,
                layer,
                start: scene.start + layer.start,
                end: scene.start + layer.start + layer.duration,
              },
            ]
          : [],
      ),
    )
    .sort((a, b) => a.start - b.start);
}
/** @typedef {import('zod').infer<typeof cuesSchema>[number] & {words?:import('./presets.cjs').Caption['words'],caption?:import('./presets.cjs').Caption}} Cue */
/** Append scene-owned layers, splitting at canonical boundaries. @param {import('../project/types').Project} project @param {Cue[]} cues @param {string} batchId @param {string} [targetTrackId] */
function appendCues(project, cues, batchId, targetTrackId) {
  const trackId = targetTrackId || stableId(`${project.id}:captions`);
  const track = project.tracks.find((t) => t.id === trackId);
  if (track?.locked) throw new Error("Unlock the Captions track first.");
  const intervals = cues.map((cue, i) => {
    const start = secondsToFrames(cue.start, project.fps),
      end = Math.max(start + 1, secondsToFrames(cue.end, project.fps));
    return {
      cue,
      i,
      start: framesToSeconds(start, project.fps),
      end: framesToSeconds(end, project.fps),
    };
  });
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  for (let i = 0; i < ordered.length; i++) {
    if (i && ordered[i].start < ordered[i - 1].end - 1e-6)
      throw new Error("Captions on the same track cannot overlap.");
    if (
      track?.clips.some(
        (c) => ordered[i].start < c.start + c.duration - 1e-6 && ordered[i].end > c.start + 1e-6,
      )
    )
      throw new Error(
        "Imported captions overlap existing captions. Move them or choose an empty track.",
      );
  }
  const total = Math.max(...intervals.map((i) => i.end));
  if (total > 86400) throw new Error("Captions exceed 24 hours.");
  const scenes = project.scenes.map((s) => ({ ...s, layers: [...s.layers] }));
  const end = scenes.reduce((n, s) => n + s.duration, 0);
  if (total > end + 1e-6)
    scenes.push({
      id: stableId(`${batchId}:scene`),
      name: "Captions",
      start: end,
      duration: total - end,
      narration: "",
      stylePreset: project.stylePreset,
      layers: [],
      transitionIn: { type: "none", duration: 0 },
      transitionOut: { type: "none", duration: 0 },
      metadata: { notes: "", tags: [] },
    });
  for (const { cue, i, start, end } of intervals)
    for (const scene of scenes) {
      const a = Math.max(start, scene.start),
        b = Math.min(end, scene.start + scene.duration);
      if (b - a < 1e-8) continue;
      const base = cue.caption || makeCaption();
      const caption = captionSchema.parse({
        ...base,
        words: cropWords(cue.words || [], a - cue.start, b - a),
      });
      scene.layers.push({
        id: stableId(`${batchId}:${i}:${scene.id}`),
        trackId,
        type: "caption",
        start: a - scene.start,
        duration: b - a,
        position: { x: 0, y: 0 },
        scale: 1,
        rotation: 0,
        opacity: 1,
        zIndex: 100,
        animation: { preset: "none", duration: 0 },
        properties: {
          text: cue.text,
          fontSize: 48,
          fontFamily: "system",
          color: "#ffffff",
          caption,
        },
      });
    }
  /** @type {import('../project/types').Track[]} */ const tracks = track
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
  return rebuildProject({ ...project, scenes, tracks });
}
/** @param {import('../project/types').Project} project @param {unknown} raw */
function executeCaptionCommand(project, raw) {
  const command = commandSchema.parse(raw),
    parsed = projectSchema.parse(project);
  if (command.type === "ImportCaptions")
    return finish(appendCues(parsed, command.cues, command.batchId));
  const selected = new Set("ids" in command ? command.ids : [command.id]);
  const records = captionRecords(parsed).filter((r) => selected.has(r.layer.id));
  if (records.length !== selected.size) throw new Error("Select existing caption clips.");
  if (records.some((r) => parsed.tracks.find((t) => t.id === r.layer.trackId)?.locked))
    throw new Error("Unlock the caption track before editing.");
  if (command.type === "MergeCaptions" || command.type === "RegroupCaptions") {
    const first = records[0];
    if (records.some((r) => r.layer.trackId !== first.layer.trackId))
      throw new Error("Select captions from one track.");
    if (command.type === "MergeCaptions" && records.some((r) => r.scene.id !== first.scene.id))
      throw new Error("Merge captions inside one scene. Scene boundaries are preserved.");
    const words = records.flatMap((r) =>
      captionForLayer(r.layer, parsed.resolution).words.map((w) => ({
        ...w,
        start: w.start + r.start,
        end: w.end + r.start,
      })),
    );
    if (command.type === "RegroupCaptions" && !words.length)
      throw new Error(
        "These captions have no word alignment. Generate from an unedited Whisper segment first.",
      );
    const base = captionForLayer(first.layer, parsed.resolution);
    const next = {
      ...parsed,
      scenes: parsed.scenes.map((s) => ({
        ...s,
        layers: s.layers.filter((l) => !selected.has(l.id)),
      })),
      tracks: parsed.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !selected.has(c.id)),
      })),
    };
    if (command.type === "RegroupCaptions")
      return finish(
        appendCues(
          next,
          groupWords(words, command.options).map((c) => ({
            ...c,
            caption: base,
            words: c.words.map((w) => ({ ...w, start: w.start - c.start, end: w.end - c.start })),
          })),
          command.batchId,
          first.layer.trackId,
        ),
      );
    if (records.length < 2) throw new Error("Select at least two captions to merge.");
    const last = records[records.length - 1];
    if (
      captionRecords(parsed).some(
        (r) =>
          !selected.has(r.layer.id) &&
          r.layer.trackId === first.layer.trackId &&
          r.start < last.end &&
          r.end > first.start,
      )
    )
      throw new Error("Select consecutive captions to merge.");
    const layer = {
      ...first.layer,
      duration: last.end - first.start,
      properties: {
        ...first.layer.properties,
        text: records.map((r) => r.layer.properties.text).join(" "),
        caption: {
          ...base,
          words: words.map((w) => ({
            ...w,
            start: w.start - first.start,
            end: w.end - first.start,
          })),
        },
      },
    };
    return finish(
      rebuildProject({
        ...next,
        scenes: next.scenes.map((s) =>
          s.id === first.scene.id ? { ...s, layers: [...s.layers, layer] } : s,
        ),
      }),
    );
  }
  const scenes = parsed.scenes.map((scene) => ({
    ...scene,
    layers: scene.layers.map((layer) => {
      if (layer.type !== "caption" || !selected.has(layer.id)) return layer;
      let caption = captionForLayer(layer, parsed.resolution),
        text = layer.properties.text;
      switch (command.type) {
        case "StyleCaptions":
          caption = {
            ...caption,
            ...(command.preset
              ? { preset: command.preset, style: makeCaption(command.preset).style }
              : {}),
            style: {
              ...(command.preset ? makeCaption(command.preset).style : caption.style),
              ...(caption.style.displayMode ? { displayMode: caption.style.displayMode } : {}),
              ...command.patch,
            },
          };
          break;
        case "PositionCaptions":
          if (caption.box.locked && Object.keys(command.patch).some((k) => k !== "locked"))
            throw new Error("Unlock caption position first.");
          caption = { ...caption, box: { ...caption.box, ...command.patch } };
          break;
        case "EditCaption":
          text = command.text;
          if (text !== layer.properties.text) caption = { ...caption, words: [] };
          break;
        case "StyleWord":
          if (!caption.words[command.index]) throw new Error("Word no longer exists");
          caption = {
            ...caption,
            words: caption.words.map((w, i) =>
              i === command.index ? { ...w, ...command.patch } : w,
            ),
          };
          break;
      }
      return {
        ...layer,
        properties: { ...layer.properties, text, caption: captionSchema.parse(caption) },
      };
    }),
  }));
  return finish(rebuildProject({ ...parsed, scenes }));
  /** @param {import('../project/types').Project} next */
  function finish(next) {
    if (command.type === "RegroupCaptions" || command.type === "MergeCaptions") {
      const selected = new Set(command.ids),
        before = new Set(captionRecords(project).map((r) => r.layer.id));
      const current = captionRecords(next).map((r) => r.layer.id),
        existing = new Set(current);
      const replacements = current.filter((id) => !before.has(id) || selected.has(id));
      next = projectSchema.parse({
        ...next,
        transcripts: next.transcripts.map((t) => {
          const original = project.transcripts.find((p) => p.id === t.id);
          return original?.captionIds.some((id) => selected.has(id))
            ? {
                ...t,
                captionIds: [
                  ...new Set([
                    ...original.captionIds.filter((id) => existing.has(id)),
                    ...replacements,
                  ]),
                ],
              }
            : t;
        }),
      });
    }
    assertLockedTracksUnchanged(project, next);
    serializeProject(next);
    return next;
  }
}
module.exports = { commandSchema, captionRecords, appendCues, executeCaptionCommand };
