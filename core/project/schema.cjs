const { z } = require("zod");

const SCHEMA_VERSION = 4;
const { motionSchema } = require("../animation/schema.cjs");
const { stableId } = require("../animation/engine.cjs");
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_TIME = 86400;
const idSchema = z.uuid();
const time = z.number().finite().min(0).max(MAX_TIME);
const duration = z.number().finite().positive().max(MAX_TIME);
const name = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => !!value.trim(), "Name cannot be blank");
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Use a hex color");
const styleSchema = z.enum(["default", "minimal", "cinematic", "bold"]);
const resolutionSchema = z
  .object({ width: z.number().int().min(64).max(8192), height: z.number().int().min(64).max(8192) })
  .strict();
const fpsSchema = z.union([
  z.literal(24),
  z.literal(25),
  z.literal(30),
  z.literal(50),
  z.literal(60),
]);
const aspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:3"]);
const projectAssetSchema = z
  .object({
    id: idSchema,
    filename: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\\/\x00-\x1f:]+$/, "Filename must not contain a path"),
    type: z.enum(["image", "video", "audio"]),
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "audio/mpeg",
      "audio/wav",
    ]),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    importedAt: z.iso.datetime(),
    duration: duration.optional(),
    width: z.number().int().positive().max(100000).optional(),
    height: z.number().int().positive().max(100000).optional(),
  })
  .strict()
  .refine(
    (asset) => asset.mimeType.startsWith(`${asset.type}/`),
    "Asset type and MIME type differ",
  );
const animationSchema = z
  .object({ preset: z.enum(["none", "fade-in", "slide-up"]), duration: time })
  .strict();
const transitionSchema = z
  .object({ type: z.enum(["none", "cut", "fade"]), duration: time })
  .strict()
  .refine(
    (value) => value.type === "fade" || value.duration === 0,
    "Only fade transitions can have a duration",
  );
const baseLayer = {
  id: idSchema,
  trackId: idSchema,
  start: time,
  duration,
  position: z
    .object({
      x: z.number().finite().min(-100000).max(100000),
      y: z.number().finite().min(-100000).max(100000),
    })
    .strict(),
  scale: z.number().finite().positive().max(100),
  rotation: z.number().finite().min(-36000).max(36000),
  opacity: z.number().finite().min(0).max(1),
  zIndex: z.number().int().min(-10000).max(10000),
  animation: animationSchema,
};
const textProperties = z
  .object({
    text: z.string().max(10000),
    fontSize: z.number().finite().min(4).max(500),
    fontFamily: z.enum(["system", "serif", "monospace"]),
    color,
  })
  .strict();
const playableProperties = z
  .object({ sourceStart: time, volume: z.number().finite().min(0).max(2), muted: z.boolean() })
  .strict();
const layerSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...baseLayer,
        type: z.literal("image"),
        assetId: idSchema,
        properties: z.object({ fit: z.enum(["contain", "cover"]) }).strict(),
      })
      .strict(),
    z
      .object({
        ...baseLayer,
        type: z.literal("video"),
        assetId: idSchema,
        properties: playableProperties,
      })
      .strict(),
    z
      .object({
        ...baseLayer,
        type: z.literal("audio"),
        assetId: idSchema,
        properties: playableProperties,
      })
      .strict(),
    z.object({ ...baseLayer, type: z.literal("text"), properties: textProperties }).strict(),
    z.object({ ...baseLayer, type: z.literal("caption"), properties: textProperties }).strict(),
    z
      .object({
        ...baseLayer,
        type: z.literal("shape"),
        properties: z
          .object({
            shape: z.enum(["rectangle", "ellipse"]),
            fill: color,
            stroke: color,
            strokeWidth: z.number().finite().min(0).max(100),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((layer, ctx) => {
    if (layer.animation.duration > layer.duration)
      ctx.addIssue({
        code: "custom",
        path: ["animation", "duration"],
        message: "Animation exceeds layer duration",
      });
  });
const sceneSchema = z
  .object({
    id: idSchema,
    name,
    start: time,
    duration,
    narration: z.string().max(50000),
    stylePreset: styleSchema,
    layers: z.array(layerSchema).max(1000),
    transitionIn: transitionSchema,
    transitionOut: transitionSchema,
    metadata: z
      .object({ notes: z.string().max(10000), tags: z.array(z.string().max(80)).max(30) })
      .strict(),
  })
  .strict()
  .superRefine((scene, ctx) => {
    scene.layers.forEach((layer, index) => {
      if (layer.start + layer.duration > scene.duration + 0.000001)
        ctx.addIssue({
          code: "custom",
          path: ["layers", index, "duration"],
          message: "Layer extends beyond its scene",
        });
    });
    if (scene.transitionIn.duration + scene.transitionOut.duration > scene.duration)
      ctx.addIssue({
        code: "custom",
        path: ["transitionOut"],
        message: "Transitions exceed scene duration",
      });
  });
const clipSchema = z
  .object({
    id: idSchema,
    assetId: idSchema.optional(),
    layerId: idSchema.optional(),
    trackId: idSchema,
    start: time,
    duration,
    sourceStart: time.nullable(),
    sourceEnd: time.nullable(),
  })
  .strict()
  .superRefine((clip, ctx) => {
    if (!!clip.assetId === !!clip.layerId)
      ctx.addIssue({
        code: "custom",
        message: "Clip must reference exactly one assetId or layerId",
      });
    if ((clip.sourceStart === null) !== (clip.sourceEnd === null))
      ctx.addIssue({
        code: "custom",
        message: "Source endpoints must both be null or both be numbers",
      });
    if (
      clip.sourceStart !== null &&
      clip.sourceEnd !== null &&
      Math.abs(clip.sourceEnd - clip.sourceStart - clip.duration) > 0.000001
    )
      ctx.addIssue({
        code: "custom",
        path: ["sourceEnd"],
        message: "Source range must equal clip duration (no speed changes)",
      });
  });
const trackSchema = z
  .object({
    id: idSchema,
    name,
    type: z.enum(["video", "audio"]),
    order: z.number().int().min(0).max(63),
    visible: z.boolean(),
    muted: z.boolean(),
    locked: z.boolean(),
    height: z.number().int().min(28).max(160),
    clips: z.array(clipSchema).max(10000),
  })
  .strict();
const projectV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: idSchema,
    name,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    resolution: resolutionSchema,
    fps: fpsSchema,
    aspectRatio: aspectRatioSchema,
    duration: time,
    stylePreset: styleSchema,
    assets: z.array(projectAssetSchema).max(5000),
    scenes: z.array(sceneSchema).max(1000),
    tracks: z.array(trackSchema).max(64),
    settings: z
      .object({
        backgroundColor: color,
        audioSampleRate: z.union([z.literal(44100), z.literal(48000)]),
        snapToFrames: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((project, ctx) => validateProjectRelations(project, ctx, 2));

const projectV3Schema = projectV2Schema
  .safeExtend({
    schemaVersion: z.literal(3),
    animations: z.record(idSchema, motionSchema),
  })
  .superRefine((project, ctx) => {
    const clips = new Map(
      project.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, { clip, track }])),
    );
    const ids = new Set();
    for (const [clipId, motion] of Object.entries(project.animations)) {
      const found = clips.get(clipId);
      const issue = (message) =>
        ctx.addIssue({ code: "custom", path: ["animations", clipId], message });
      if (!found) {
        issue("Animation references a missing clip");
        continue;
      }
      if (found.track.type === "audio") issue("Audio clips do not support visual animation");
      const count =
        Math.ceil((found.clip.start + found.clip.duration) * project.fps - 1e-8) -
        Math.ceil(found.clip.start * project.fps - 1e-8);
      const channels = new Set();
      for (const key of motion.keyframes) {
        if (ids.has(key.id)) issue("Keyframe IDs must be unique");
        ids.add(key.id);
        const location = `${key.property}:${key.frame}`;
        if (channels.has(location)) issue("Only one keyframe per property and frame is allowed");
        channels.add(location);
        if (key.frame >= count) issue("Keyframe exceeds the visible clip duration");
      }
      if (motion.preset && motion.preset.durationFrames > count)
        issue("Preset exceeds clip duration");
    }
  });
const projectSchema = projectV3Schema
  .safeExtend({
    schemaVersion: z.literal(4),
    transcripts: z.array(require("../transcription/schema.cjs").transcriptSchema).max(100),
  })
  .superRefine((project, ctx) => {
    const transcriptIds = new Set();
    const captionLayers = new Set(
      project.scenes.flatMap((scene) =>
        scene.layers.filter((layer) => layer.type === "caption").map((layer) => layer.id),
      ),
    );
    const captionClips = new Set(
      project.tracks.flatMap((track) =>
        track.clips
          .filter((clip) => clip.layerId && captionLayers.has(clip.layerId))
          .map((clip) => clip.id),
      ),
    );
    for (const transcript of project.transcripts || []) {
      if (
        transcriptIds.has(transcript.id) ||
        !project.assets.some((a) => a.id === transcript.assetId && a.type !== "image")
      )
        ctx.addIssue({
          code: "custom",
          path: ["transcripts"],
          message: "Transcripts must have unique IDs and reference audio/video assets",
        });
      transcriptIds.add(transcript.id);
      if (transcript.captionIds.some((id) => !captionClips.has(id)))
        ctx.addIssue({
          code: "custom",
          path: ["transcripts"],
          message: "Caption references must identify existing caption clips",
        });
    }
  });
/** @param {import("zod").infer<typeof projectV2Schema>} project @returns {import("zod").infer<typeof projectV3Schema>} */
function migrateV2(project) {
  const animations = {};
  for (const scene of project.scenes)
    for (const layer of scene.layers) {
      if (layer.type === "audio" || layer.animation.preset === "none") continue;
      const total =
        Math.ceil((scene.start + layer.start + layer.duration) * project.fps - 1e-8) -
        Math.ceil((scene.start + layer.start) * project.fps - 1e-8);
      if (total < 1) continue;
      const length = Math.max(1, Math.round(layer.animation.duration * project.fps));
      const end = Math.min(total - 1, length);
      const fade = layer.animation.preset === "fade-in";
      const property = fade ? "opacity" : "y";
      const base = fade ? layer.opacity : layer.position.y;
      animations[layer.id] = {
        keyframes: [...new Set([0, end])].map((frame, index) => ({
          id: stableId(`${layer.id}:legacy:${index}`),
          property,
          frame,
          value: fade
            ? (base * frame) / length
            : base + project.resolution.height * 0.1 * (1 - frame / length),
          easing: { type: "linear" },
        })),
      };
    }
  return { ...project, schemaVersion: 3, animations };
}

function validateProjectRelations(project, ctx, version) {
  const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
  const close = (a, b) => Math.abs(a - b) <= 0.000001;
  const unique = (items, path) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item.id)) issue([...path, index, "id"], "Duplicate ID");
      seen.add(item.id);
    });
  };
  unique(project.assets, ["assets"]);
  unique(project.scenes, ["scenes"]);
  unique(project.tracks, ["tracks"]);
  const ratio = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3 }[project.aspectRatio];
  if (Math.abs(project.resolution.width / project.resolution.height - ratio) > 0.002)
    issue(["aspectRatio"], "Aspect ratio must match resolution");
  if (project.updatedAt < project.createdAt)
    issue(["updatedAt"], "Updated timestamp precedes creation");
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const orders = new Set();
  const layers = new Map();
  let sceneEnd = 0;
  project.scenes.forEach((scene, sceneIndex) => {
    if (!close(scene.start, sceneEnd))
      issue(["scenes", sceneIndex, "start"], "Scenes must be contiguous in array order");
    sceneEnd += scene.duration;
    scene.layers.forEach((layer, layerIndex) => {
      const location = ["scenes", sceneIndex, "layers", layerIndex];
      if (layers.has(layer.id))
        issue([...location, "id"], "Layer IDs must be unique across scenes");
      layers.set(layer.id, { layer, scene });
      const track = tracks.get(layer.trackId);
      if (!track || track.type !== (layer.type === "audio" ? "audio" : "video"))
        issue([...location, "trackId"], "Layer requires a compatible project track");
      if ("assetId" in layer) {
        const asset = assets.get(layer.assetId);
        if (!asset) issue([...location, "assetId"], "Missing asset reference");
        else if (asset.type !== layer.type)
          issue([...location, "assetId"], "Asset type does not match layer");
        if (
          asset?.duration &&
          "sourceStart" in layer.properties &&
          layer.properties.sourceStart + layer.duration > asset.duration + 0.001
        )
          issue([...location, "duration"], "Layer exceeds source media duration");
      }
    });
  });
  const clipIds = new Set();
  const linked = new Set();
  let end = sceneEnd;
  project.tracks.forEach((track, trackIndex) => {
    if (orders.has(track.order))
      issue(["tracks", trackIndex, "order"], "Track order must be unique");
    orders.add(track.order);
    track.clips.forEach((clip, clipIndex) => {
      const location = ["tracks", trackIndex, "clips", clipIndex];
      if (clipIds.has(clip.id)) issue([...location, "id"], "Clip IDs must be unique");
      clipIds.add(clip.id);
      if (clip.trackId !== track.id)
        issue([...location, "trackId"], "Clip trackId must match its containing track");
      if (clip.layerId) {
        const found = layers.get(clip.layerId);
        if (!found) issue([...location, "layerId"], "Missing layer reference");
        else {
          const { layer, scene } = found;
          const sourceStart =
            "sourceStart" in layer.properties
              ? layer.properties.sourceStart
              : version === 1
                ? 0
                : null;
          if (linked.has(layer.id))
            issue([...location, "layerId"], "Layer must have exactly one derived clip");
          linked.add(layer.id);
          if (
            clip.id !== layer.id ||
            layer.trackId !== track.id ||
            !close(clip.start, scene.start + layer.start) ||
            !close(clip.duration, layer.duration) ||
            !(sourceStart === null
              ? clip.sourceStart === null && clip.sourceEnd === null
              : clip.sourceStart !== null && close(clip.sourceStart, sourceStart))
          )
            issue(location, "Derived clip conflicts with its scene layer");
        }
      } else if (clip.assetId) {
        const asset = assets.get(clip.assetId);
        if (!asset) issue([...location, "assetId"], "Missing asset reference");
        else {
          if (track.type !== (asset.type === "audio" ? "audio" : "video"))
            issue(location, "Asset requires a compatible track");
          if (
            version === 2 &&
            asset.type === "image" &&
            (clip.sourceStart !== null || clip.sourceEnd !== null)
          )
            issue(location, "Still images have null source ranges");
          if (asset.type !== "image" && (clip.sourceStart === null || clip.sourceEnd === null))
            issue(location, "Playable clips require numeric source ranges");
          if (asset.duration && clip.sourceEnd !== null && clip.sourceEnd > asset.duration + 0.001)
            issue([...location, "sourceEnd"], "Clip exceeds source media duration");
        }
      }
      end = Math.max(end, clip.start + clip.duration);
    });
  });
  for (const [id] of layers)
    if (!linked.has(id)) issue(["tracks"], `Layer ${id} is missing its derived clip`);
  if (!close(project.duration, end))
    issue(
      ["duration"],
      "Project duration must equal the scene sequence or longest standalone clip",
    );
}

const legacyClipSchema = z
  .object({ ...clipSchema.shape, sourceStart: time, sourceEnd: time })
  .strict()
  .superRefine((clip, ctx) => {
    if (!!clip.assetId === !!clip.layerId)
      ctx.addIssue({ code: "custom", message: "Clip requires exactly one reference" });
    if (Math.abs(clip.sourceEnd - clip.sourceStart - clip.duration) > 0.000001)
      ctx.addIssue({ code: "custom", path: ["sourceEnd"], message: "Invalid v1 source range" });
  });
const legacyTrackSchema = trackSchema
  .omit({ visible: true, muted: true, locked: true, height: true })
  .extend({ clips: z.array(legacyClipSchema).max(10000) })
  .strict();
const legacyProjectSchema = z
  .object({
    ...projectV2Schema.shape,
    schemaVersion: z.literal(1),
    tracks: z.array(legacyTrackSchema).max(64),
  })
  .strict()
  .superRefine((project, ctx) => validateProjectRelations(project, ctx, 1));

/** @param {unknown} value @returns {import('./types').ProjectValidation} */
function validateProject(value) {
  let migratedFrom;
  if (value && typeof value === "object" && value.schemaVersion === 1) {
    const legacy = legacyProjectSchema.safeParse(value);
    if (!legacy.success)
      return {
        success: false,
        errors: legacy.error.issues
          .slice(0, 100)
          .map((entry) => ({ path: entry.path.join(".") || "project", message: entry.message })),
      };
    const assets = new Map(legacy.data.assets.map((asset) => [asset.id, asset]));
    const layers = new Map(
      legacy.data.scenes.flatMap((scene) => scene.layers.map((layer) => [layer.id, layer])),
    );
    value = {
      ...legacy.data,
      schemaVersion: 2,
      tracks: legacy.data.tracks.map((track) => ({
        ...track,
        visible: true,
        muted: false,
        locked: false,
        height: 36,
        clips: track.clips.map((clip) => {
          const type = clip.layerId
            ? layers.get(clip.layerId)?.type
            : assets.get(clip.assetId)?.type;
          return type === "video" || type === "audio"
            ? clip
            : { ...clip, sourceStart: null, sourceEnd: null };
        }),
      })),
    };
    migratedFrom = 1;
  } else if (
    value &&
    typeof value === "object" &&
    value.schemaVersion !== SCHEMA_VERSION &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== 3
  ) {
    return {
      success: false,
      errors: [
        {
          path: "schemaVersion",
          message: "Supported schema versions are 1, 2, 3 (migrated with review), and 4.",
        },
      ],
    };
  }
  if (value && typeof value === "object" && value.schemaVersion === 2) {
    const legacy = projectV2Schema.safeParse(value);
    if (!legacy.success)
      return {
        success: false,
        errors: legacy.error.issues
          .slice(0, 100)
          .map((entry) => ({ path: entry.path.join(".") || "project", message: entry.message })),
      };
    value = migrateV2(legacy.data);
    migratedFrom = migratedFrom || 2;
  }
  if (value && typeof value === "object" && value.schemaVersion === 3) {
    const legacy = projectV3Schema.safeParse(value);
    if (!legacy.success)
      return {
        success: false,
        errors: legacy.error.issues
          .slice(0, 100)
          .map((entry) => ({ path: entry.path.join(".") || "project", message: entry.message })),
      };
    value = { ...legacy.data, schemaVersion: 4, transcripts: [] };
    migratedFrom = migratedFrom || 3;
  }
  const result = projectSchema.safeParse(value);
  if (result.success)
    return { success: true, project: result.data, ...(migratedFrom ? { migratedFrom } : {}) };
  return {
    success: false,
    errors: result.error.issues
      .slice(0, 100)
      .map((entry) => ({ path: entry.path.join(".") || "project", message: entry.message })),
  };
}

/** @param {string} text @returns {import('./types').ProjectValidation} */
function parseProjectJSON(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES)
    return {
      success: false,
      errors: [{ path: "project", message: "Project JSON exceeds the 5 MB limit." }],
    };
  try {
    return validateProject(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch {
    return {
      success: false,
      errors: [{ path: "project", message: "Invalid JSON. Check commas, quotes and brackets." }],
    };
  }
}

/** @param {import('./types').Project} project */
function serializeProject(project) {
  const text = JSON.stringify(projectSchema.parse(project), null, 2) + "\n";
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES)
    throw new Error("Project JSON exceeds the 5 MB document limit.");
  return text;
}

module.exports = {
  SCHEMA_VERSION,
  MAX_JSON_BYTES,
  MAX_TIME,
  idSchema,
  styleSchema,
  resolutionSchema,
  fpsSchema,
  aspectRatioSchema,
  projectAssetSchema,
  layerSchema,
  sceneSchema,
  clipSchema,
  trackSchema,
  projectSchema,
  legacyProjectSchema,
  projectV2Schema,
  projectV3Schema,
  validateProject,
  parseProjectJSON,
  serializeProject,
};
