// @ts-check
const { projectSchema, layerSchema } = require("./schema.cjs");
const { rebuildProject } = require("./operations.cjs");
const { stableId } = require("../animation/engine.cjs");
const { assertLockedTracksUnchanged } = require("../timeline/locks.cjs");
/** One undoable project-background replacement, preserving all other tracks/layers.
 * @param {import('./types').Project} raw @param {string} assetId */
function setProjectBackground(raw, assetId) {
  const project = projectSchema.parse(raw),
    asset = project.assets.find((a) => a.id === assetId);
  if (!asset || asset.type === "audio")
    throw new Error("Select an imported image or video for the background.");
  if (asset.type === "video" && !asset.duration)
    throw new Error("Wait for the video's duration before placing it.");
  const trackId = stableId(`${project.id}:background`),
    existing = project.tracks.find((t) => t.id === trackId);
  if (existing?.locked) throw new Error("Unlock the Background track before replacing it.");
  if (!existing && project.tracks.length >= 64)
    throw new Error("The project has reached its track limit.");
  const total = project.duration || asset.duration || 5;
  const visible = asset.type === "video" ? Math.min(total, asset.duration || 0) : total;
  const scenes = project.scenes.map((s) => ({
    ...s,
    layers: s.layers.filter((l) => l.trackId !== trackId),
  }));
  const sceneEnd = scenes.reduce((sum, s) => sum + s.duration, 0);
  if (sceneEnd < total)
    scenes.push({
      id: stableId(`${project.id}:background-tail:${sceneEnd}`),
      name: "Background",
      start: sceneEnd,
      duration: total - sceneEnd,
      narration: "",
      stylePreset: project.stylePreset,
      layers: [],
      transitionIn: { type: "none", duration: 0 },
      transitionOut: { type: "none", duration: 0 },
      metadata: { notes: "", tags: [] },
    });
  for (const scene of scenes) {
    const end = Math.min(scene.start + scene.duration, visible);
    if (end <= scene.start) continue;
    scene.layers.push(
      layerSchema.parse({
        id: stableId(`${trackId}:${scene.id}`),
        trackId,
        type: asset.type,
        assetId: asset.id,
        start: 0,
        duration: end - scene.start,
        position: { x: 0, y: 0 },
        scale: 1,
        rotation: 0,
        opacity: 1,
        zIndex: -10000,
        animation: { preset: "none", duration: 0 },
        properties:
          asset.type === "image"
            ? { fit: "cover" }
            : { sourceStart: scene.start, volume: 1, muted: true, fit: "cover" },
      }),
    );
  }
  const order = Math.max(...project.tracks.map((t) => t.order));
  /** @type {import("./types").Track[]} */
  const tracks = existing
    ? project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [], visible: true } : t))
    : [
        ...project.tracks,
        {
          id: trackId,
          name: "Background",
          type: "video",
          order: order + 1,
          visible: true,
          muted: true,
          locked: false,
          height: 48,
          clips: [],
        },
      ];
  // If tracks were subsequently reordered, explicitly send the background to the bottom.
  const sorted = [
    ...tracks.filter((t) => t.id !== trackId).sort((a, b) => a.order - b.order),
    ...tracks.filter((t) => t.id === trackId),
  ].map((t, order) => ({ ...t, order }));
  const oldBackgroundIds = new Set(
    project.tracks.find((t) => t.id === trackId)?.clips.map((c) => c.id) || [],
  );
  const animations = Object.fromEntries(
    Object.entries(project.animations).filter(([id]) => !oldBackgroundIds.has(id)),
  );
  const next = rebuildProject({ ...project, scenes, tracks: sorted, animations });
  assertLockedTracksUnchanged(project, next);
  return next;
}
module.exports = { setProjectBackground };
