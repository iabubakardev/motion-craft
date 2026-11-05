// @ts-check
const { z } = require("zod");
const {
  idSchema,
  clipSchema,
  layerSchema,
  projectSchema,
  MAX_TIME,
} = require("../project/schema.cjs");
const { rebuildProject } = require("../project/operations.cjs");
const { secondsToFrames, framesToSeconds } = require("./time.cjs");

const { motionSchema } = require("../animation/schema.cjs");
const { cropKeys, stableId } = require("../animation/engine.cjs");
const { clipFrames } = require("../animation/commands.cjs");

const frame = z
  .number()
  .int()
  .min(0)
  .max(86400 * 60);
const ids = z
  .array(idSchema)
  .min(1)
  .max(1000)
  .refine((values) => new Set(values).size === values.length, "Selection IDs must be unique");
const clipboardItemSchema = z
  .object({
    clip: clipSchema,
    layer: layerSchema.optional(),
    sceneId: idSchema.optional(),
    motion: motionSchema.optional(),
  })
  .strict();
const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("InsertClip"),
      clipId: idSchema,
      assetId: idSchema,
      trackId: idSchema,
      startFrame: frame,
    })
    .strict(),
  z
    .object({
      type: z.literal("MoveClip"),
      clipIds: ids,
      deltaFrames: z
        .number()
        .int()
        .min(-86400 * 60)
        .max(86400 * 60),
      trackId: idSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("TrimClip"),
      clipId: idSchema,
      edge: z.enum(["left", "right"]),
      frame,
    })
    .strict(),
  z.object({ type: z.literal("SplitClip"), clipId: idSchema, frame, newClipId: idSchema }).strict(),
  z.object({ type: z.literal("DeleteClips"), clipIds: ids }).strict(),
  z.object({ type: z.literal("DuplicateClip"), clipIds: ids, newIds: ids }).strict(),
  z
    .object({
      type: z.literal("PasteClips"),
      items: z.array(clipboardItemSchema).min(1).max(1000),
      newIds: ids,
      frame,
    })
    .strict(),
  z
    .object({
      type: z.literal("UpdateClipProperties"),
      clipId: idSchema,
      startFrame: frame,
      durationFrames: frame.min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("UpdateTrack"),
      trackId: idSchema,
      patch: z
        .object({
          visible: z.boolean().optional(),
          muted: z.boolean().optional(),
          locked: z.boolean().optional(),
          height: z.number().int().min(28).max(160).optional(),
          order: z.number().int().min(0).max(63).optional(),
        })
        .strict(),
    })
    .strict(),
]);

/** @param {import('../project/types').Project} project @returns {import('./types').TimelineIndex} */
function createTimelineIndex(project) {
  const layers = new Map(
    project.scenes.flatMap((scene) => scene.layers.map((layer) => [layer.id, { scene, layer }])),
  );
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const clips = new Map();
  for (const track of project.tracks)
    for (const clip of track.clips) {
      const found = clip.layerId ? layers.get(clip.layerId) : undefined;
      const assetId =
        clip.assetId || (found && "assetId" in found.layer ? found.layer.assetId : undefined);
      clips.set(clip.id, {
        clip,
        track,
        ...found,
        asset: assetId ? assets.get(assetId) : undefined,
      });
    }
  return { clips, tracks };
}
/** @param {import('./types').TimelineIndex} index @param {string} id */
function requireClip(index, id) {
  const result = index.clips.get(id);
  if (!result) throw new Error("Clip no longer exists.");
  return result;
}
/** @param {import('./types').ClipRecord} item */
function clipType(item) {
  return item.layer?.type || item.asset?.type;
}
/** @param {number} a @param {number} durationA @param {number} b @param {number} durationB */
function overlaps(a, durationA, b, durationB) {
  return a < b + durationB - 1e-6 && b < a + durationA - 1e-6;
}

/** @param {import('./types').ClipRecord} item @param {import('../project/types').Clip} clip @returns {import('./types').ClipChange} */
function change(item, clip) {
  if (!item.layer || !item.scene) return { clip };
  let layer = {
    ...item.layer,
    start: clip.start - item.scene.start,
    duration: clip.duration,
    trackId: clip.trackId,
    animation: {
      ...item.layer.animation,
      duration: Math.min(item.layer.animation.duration, clip.duration),
    },
  };
  if ((layer.type === "video" || layer.type === "audio") && clip.sourceStart !== null)
    layer = { ...layer, properties: { ...layer.properties, sourceStart: clip.sourceStart } };
  return { clip, layer, sceneId: item.scene.id };
}

/** @param {import('../project/types').Project} project @param {import('./types').EditPlan} plan @param {import('./types').TimelineIndex} index */
function validatePlan(project, plan, index) {
  const removed = new Set(plan.removed);
  for (const id of removed)
    if (requireClip(index, id).track.locked)
      throw new Error("Unlock the source track before editing its clips.");
  for (const changed of plan.changes) {
    const { clip, layer, sceneId } = changed;
    const track = index.tracks.get(clip.trackId);
    const asset = project.assets.find(
      (asset) =>
        asset.id === (clip.assetId || (layer && "assetId" in layer ? layer.assetId : undefined)),
    );
    const type = layer?.type || asset?.type;
    if (!type || !track || track.type !== (type === "audio" ? "audio" : "video"))
      throw new Error("Choose a compatible video or audio track.");
    if (track.locked) throw new Error("The target track is locked.");
    if (
      clip.start < -1e-6 ||
      clip.duration < 1 / project.fps - 1e-6 ||
      clip.start + clip.duration > MAX_TIME + 1e-6
    )
      throw new Error("A clip must be at least one frame and remain within the 24-hour timeline.");
    if (sceneId) {
      const scene = project.scenes.find((scene) => scene.id === sceneId);
      if (
        !scene ||
        clip.start < scene.start - 1e-6 ||
        clip.start + clip.duration > scene.start + scene.duration + 1e-6
      )
        throw new Error(
          "Scene-owned layers must stay within their scene. Extend the scene or use a standalone media clip.",
        );
    }
    if (type === "audio" || type === "video") {
      if (clip.sourceStart === null || clip.sourceEnd === null || clip.sourceStart < 0)
        throw new Error("Playable clips need a valid source range.");
      const previous =
        index.clips.get(clip.id)?.clip ||
        plan.removed
          .map((id) => index.clips.get(id))
          .find((record) => record?.asset?.id === asset?.id)?.clip;
      const max = asset?.duration ?? previous?.sourceEnd;
      if (max === null || max === undefined || clip.sourceEnd > max + 0.001)
        throw new Error(
          "The edit exceeds the known source duration. Unknown-duration sources cannot be extended.",
        );
    } else if (clip.sourceStart !== null || clip.sourceEnd !== null)
      throw new Error("Still images and graphics do not have media source ranges.");
    for (const other of track.clips)
      if (
        !removed.has(other.id) &&
        overlaps(clip.start, clip.duration, other.start, other.duration)
      )
        throw new Error(
          "Same-track overlap is prevented. Choose free space or another compatible track.",
        );
  }
  for (let a = 0; a < plan.changes.length; a++)
    for (let b = a + 1; b < plan.changes.length; b++) {
      const first = plan.changes[a].clip,
        second = plan.changes[b].clip;
      if (
        first.trackId === second.trackId &&
        overlaps(first.start, first.duration, second.start, second.duration)
      )
        throw new Error("The selected clips would overlap on the same track.");
    }
}

/** @param {import('../project/types').Project} project @param {unknown} input @param {import('./types').TimelineIndex} [index] @returns {import('./types').EditPlan} */
function planTimelineEdit(project, input, index = createTimelineIndex(project)) {
  const command = commandSchema.parse(input);
  /** @type {import('./types').EditPlan} */
  let plan = { changes: [], removed: [] };
  switch (command.type) {
    case "InsertClip": {
      if (index.clips.has(command.clipId)) throw new Error("Clip ID already exists.");
      const asset = project.assets.find((asset) => asset.id === command.assetId);
      if (!asset) throw new Error("Import this asset into the current project first.");
      const playable = asset.type !== "image";
      if (playable && !asset.duration)
        throw new Error("A known media duration is required before placing video/audio.");
      const frames = playable
        ? secondsToFrames(asset.duration || 0, project.fps, "floor")
        : 5 * project.fps;
      const duration = framesToSeconds(frames, project.fps);
      plan.changes = [
        {
          clip: {
            id: command.clipId,
            assetId: asset.id,
            trackId: command.trackId,
            start: framesToSeconds(command.startFrame, project.fps),
            duration,
            sourceStart: playable ? 0 : null,
            sourceEnd: playable ? duration : null,
          },
        },
      ];
      break;
    }
    case "MoveClip": {
      if (command.trackId && command.clipIds.length > 1)
        throw new Error(
          "Multi-clip moves preserve their existing tracks. Move one clip to change tracks.",
        );
      plan.removed = command.clipIds;
      plan.changes = command.clipIds.map((id) => {
        const item = requireClip(index, id);
        return change(item, {
          ...item.clip,
          start: item.clip.start + framesToSeconds(command.deltaFrames, project.fps),
          trackId: command.trackId || item.track.id,
        });
      });
      break;
    }
    case "TrimClip": {
      const item = requireClip(index, command.clipId),
        old = item.clip;
      const start =
        command.edge === "left" ? framesToSeconds(command.frame, project.fps) : old.start;
      const end =
        command.edge === "right"
          ? framesToSeconds(command.frame, project.fps)
          : old.start + old.duration;
      const clip = {
        ...old,
        start,
        duration: end - start,
        sourceStart: old.sourceStart === null ? null : old.sourceStart + start - old.start,
        sourceEnd: old.sourceEnd === null ? null : old.sourceEnd + end - old.start - old.duration,
      };
      plan = { removed: [old.id], changes: [change(item, clip)] };
      break;
    }
    case "UpdateClipProperties": {
      const item = requireClip(index, command.clipId),
        old = item.clip;
      const duration = framesToSeconds(command.durationFrames, project.fps);
      plan = {
        removed: [old.id],
        changes: [
          change(item, {
            ...old,
            start: framesToSeconds(command.startFrame, project.fps),
            duration,
            sourceEnd: old.sourceStart === null ? null : old.sourceStart + duration,
          }),
        ],
      };
      break;
    }
    case "SplitClip": {
      const item = requireClip(index, command.clipId),
        old = item.clip,
        at = framesToSeconds(command.frame, project.fps);
      if (at <= old.start + 1e-6 || at >= old.start + old.duration - 1e-6)
        throw new Error("Split strictly inside the selected clip.");
      if (
        index.clips.has(command.newClipId) ||
        project.scenes.some((scene) => scene.layers.some((layer) => layer.id === command.newClipId))
      )
        throw new Error("New clip ID already exists.");
      const left = change(item, {
        ...old,
        duration: at - old.start,
        sourceEnd: old.sourceStart === null ? null : old.sourceStart + at - old.start,
      });
      const right = change(item, {
        ...old,
        id: command.newClipId,
        ...(old.layerId ? { layerId: command.newClipId } : {}),
        start: at,
        duration: old.start + old.duration - at,
        sourceStart: old.sourceStart === null ? null : old.sourceStart + at - old.start,
      });
      if (right.layer) right.layer = { ...right.layer, id: command.newClipId };
      plan = { removed: [old.id], changes: [left, right] };
      break;
    }
    case "DeleteClips":
      plan.removed = command.clipIds;
      break;
    case "DuplicateClip":
    case "PasteClips": {
      const items =
        command.type === "DuplicateClip"
          ? copyClips(project, command.clipIds, index)
          : command.items;
      if (command.newIds.length !== items.length)
        throw new Error("Each pasted clip needs one new ID.");
      const origin = Math.min(...items.map((item) => item.clip.start));
      const at =
        command.type === "DuplicateClip"
          ? Math.max(...items.map((item) => item.clip.start + item.clip.duration))
          : framesToSeconds(command.frame, project.fps);
      plan.changes = items.map((item, i) => {
        const id = command.newIds[i];
        if (
          index.clips.has(id) ||
          project.scenes.some((scene) => scene.layers.some((layer) => layer.id === id))
        )
          throw new Error("New clip ID already exists.");
        const clip = {
          ...item.clip,
          id,
          start: item.clip.start + at - origin,
          ...(item.clip.layerId ? { layerId: id } : {}),
        };
        if (item.layer && item.sceneId) {
          if (item.clip.layerId !== item.layer.id)
            throw new Error("Clipboard layer reference is inconsistent.");
          const scene = project.scenes.find((scene) => scene.id === item.sceneId);
          if (!scene) throw new Error("The clipboard's owning scene no longer exists.");
          return {
            clip,
            sceneId: scene.id,
            layer: { ...structuredClone(item.layer), id, start: clip.start - scene.start },
          };
        }
        if (clip.layerId) throw new Error("Clipboard layer data is missing.");
        return { clip };
      });
      break;
    }
    case "UpdateTrack":
      return plan;
    default:
      return assertNever(command);
  }
  validatePlan(project, plan, index);
  return plan;
}

/** @param {never} value @returns {never} */
function assertNever(value) {
  throw new Error(`Unsupported timeline command: ${String(value)}`);
}

/** @param {import('../project/types').Project} project @param {string[]} ids @param {import('./types').TimelineIndex} [index] @returns {import('./types').ClipboardItem[]} */
function copyClips(project, ids, index = createTimelineIndex(project)) {
  return ids.map((id) => {
    const item = requireClip(index, id);
    return structuredClone({
      clip: item.clip,
      ...(project.animations[id] ? { motion: project.animations[id] } : {}),
      ...(item.layer ? { layer: item.layer, sceneId: item.scene?.id } : {}),
    });
  });
}

/** @param {import('../project/types').Project} project @param {unknown} input @param {string} timestamp @returns {import('../project/types').Project} */
function executeTimelineCommand(project, input, timestamp) {
  const command = commandSchema.parse(input);
  const parsed = projectSchema.parse(project);
  z.iso.datetime().parse(timestamp);
  if (command.type === "UpdateTrack") {
    const track = parsed.tracks.find((track) => track.id === command.trackId);
    if (!track) throw new Error("Track no longer exists.");
    const ordered = [...parsed.tracks].sort((a, b) => a.order - b.order);
    if (command.patch.order !== undefined) {
      if (command.patch.order >= ordered.length) throw new Error("Invalid track position.");
      ordered.splice(
        ordered.findIndex((track) => track.id === command.trackId),
        1,
      );
      ordered.splice(command.patch.order, 0, track);
    }
    const tracks = ordered.map((item, order) => ({
      ...item,
      ...(item.id === track.id ? command.patch : {}),
      order,
    }));
    if (
      JSON.stringify(tracks) ===
      JSON.stringify([...parsed.tracks].sort((a, b) => a.order - b.order))
    )
      return project;
    return projectSchema.parse({ ...parsed, tracks, updatedAt: timestamp });
  }
  const index = createTimelineIndex(parsed);
  const plan = planTimelineEdit(parsed, command, index);
  if (
    command.type === "MoveClip" &&
    command.deltaFrames === 0 &&
    (!command.trackId ||
      command.clipIds.every((id) => index.clips.get(id)?.track.id === command.trackId))
  )
    return project;
  const removed = new Set(plan.removed);
  const scenes = parsed.scenes.map((scene) => ({
    ...scene,
    layers: [
      ...scene.layers.filter((layer) => !removed.has(layer.id)),
      ...plan.changes
        .filter((change) => change.sceneId === scene.id && change.layer)
        .flatMap((change) => (change.layer ? [change.layer] : [])),
    ],
  }));
  const tracks = parsed.tracks.map((track) => ({
    ...track,
    clips: [
      ...track.clips.filter((clip) => !removed.has(clip.id)),
      ...plan.changes
        .filter((change) => !change.layer && change.clip.trackId === track.id)
        .map((change) => change.clip),
    ],
  }));
  const animations = { ...parsed.animations };
  for (const id of plan.removed) delete animations[id];
  if (command.type === "DuplicateClip" || command.type === "PasteClips") {
    const items =
      command.type === "DuplicateClip" ? copyClips(parsed, command.clipIds, index) : command.items;
    items.forEach((item, i) => {
      if (item.motion)
        animations[command.newIds[i]] = {
          ...item.motion,
          keyframes: item.motion.keyframes.map((key) => ({
            ...key,
            id: stableId(`${command.newIds[i]}:${key.id}`),
          })),
        };
    });
  } else
    for (const change of plan.changes) {
      const oldId = command.type === "SplitClip" ? command.clipId : change.clip.id;
      const old = index.clips.get(oldId)?.clip;
      const motion = parsed.animations[oldId];
      if (!old || !motion) continue;
      if (command.type === "MoveClip") animations[change.clip.id] = motion;
      else {
        const offset =
          command.type === "UpdateClipProperties"
            ? 0
            : secondsToFrames(change.clip.start, parsed.fps, "ceil") -
              secondsToFrames(old.start, parsed.fps, "ceil");
        animations[change.clip.id] = {
          keyframes: cropKeys(
            motion.keyframes,
            offset,
            offset + clipFrames(change.clip, parsed.fps) - 1,
            change.clip.id,
          ),
        };
      }
    }
  const next = rebuildProject({ ...parsed, animations, scenes, tracks }, timestamp);
  return projectSchema.parse({ ...next, updatedAt: timestamp });
}

module.exports = {
  commandSchema,
  clipboardItemSchema,
  createTimelineIndex,
  clipType,
  overlaps,
  planTimelineEdit,
  copyClips,
  executeTimelineCommand,
};
