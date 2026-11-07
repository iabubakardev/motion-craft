const { projectSchema, projectAssetSchema, serializeProject } = require("./schema.cjs");

const uuid = () => globalThis.crypto.randomUUID();
/** @returns {import('./types').Project} */
function createProject(options = {}) {
  const now = options.now || new Date().toISOString();
  return projectSchema.parse({
    schemaVersion: 4,
    transcripts: [],
    animations: {},
    id: options.id || uuid(),
    name: "Untitled project",
    createdAt: now,
    updatedAt: now,
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    aspectRatio: "16:9",
    duration: 0,
    stylePreset: "default",
    assets: [],
    scenes: [],
    tracks: [
      ...["V4", "V3", "V2", "V1"].map((name) => ({ name, type: "video" })),
      ...["A1", "A2", "A3"].map((name) => ({ name, type: "audio" })),
    ].map((track, order) => ({
      ...track,
      id: options.trackIds?.[order] || uuid(),
      order,
      visible: true,
      muted: false,
      locked: false,
      height: 36,
      clips: [],
    })),
    settings: { backgroundColor: "#11151c", audioSampleRate: 48000, snapToFrames: true },
  });
}

/** Recompute only derived timing. Scene/layer content and standalone asset clips remain canonical.
 * @param {import('./types').Project} project @param {string} [timestamp] @returns {import('./types').Project} */
function rebuildProject(project, timestamp = new Date().toISOString()) {
  let start = 0;
  const scenes = project.scenes.map((scene) => {
    const updated = { ...scene, start };
    start += scene.duration;
    return updated;
  });
  const tracks = project.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => !clip.layerId),
  }));
  for (const scene of scenes)
    for (const layer of scene.layers) {
      const track = tracks.find((item) => item.id === layer.trackId);
      if (!track) throw new Error("Layer track is missing.");
      const sourceStart = "sourceStart" in layer.properties ? layer.properties.sourceStart : null;
      track.clips.push({
        id: layer.id,
        layerId: layer.id,
        trackId: track.id,
        start: scene.start + layer.start,
        duration: layer.duration,
        sourceStart,
        sourceEnd: sourceStart === null ? null : sourceStart + layer.duration,
      });
    }
  const duration = tracks.reduce(
    (end, track) => Math.max(end, ...track.clips.map((clip) => clip.start + clip.duration)),
    start,
  );
  const clipIds = new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const animations = Object.fromEntries(
    Object.entries(project.animations).filter(([id]) => clipIds.has(id)),
  );
  return projectSchema.parse({
    ...project,
    transcripts: project.transcripts.map((transcript) => ({
      ...transcript,
      captionIds: transcript.captionIds.filter((id) => clipIds.has(id)),
    })),
    animations,
    scenes,
    tracks,
    duration,
    updatedAt: timestamp,
  });
}

/** @param {import('./types').Project} project @param {string} sceneId */
function requireScene(project, sceneId) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("Scene no longer exists.");
  return scene;
}

/** @param {import('./types').Project} project */
function addScene(project) {
  const scene = {
    id: uuid(),
    name: `Scene ${project.scenes.length + 1}`,
    start: 0,
    duration: 5,
    narration: "",
    stylePreset: project.stylePreset,
    layers: [],
    transitionIn: { type: "none", duration: 0 },
    transitionOut: { type: "none", duration: 0 },
    metadata: { notes: "", tags: [] },
  };
  return rebuildProject({ ...project, scenes: [...project.scenes, scene] });
}

/** @param {import('./types').Project} project @param {string} sceneId @param {{name?: string, duration?: number, narration?: string, stylePreset?: import('./types').Scene['stylePreset']}} patch */
function updateScene(project, sceneId, patch) {
  const scene = requireScene(project, sceneId);
  if (Object.entries(patch).every(([key, value]) => scene[key] === value)) return project;
  if (
    patch.duration !== undefined &&
    scene.layers.some((layer) => layer.start + layer.duration > patch.duration + 0.000001)
  )
    throw new Error(
      "This duration would cut off a layer. Shorten or remove the layer first; no edits were discarded.",
    );
  return rebuildProject({
    ...project,
    scenes: project.scenes.map((item) => (item.id === sceneId ? { ...item, ...patch } : item)),
  });
}

/** @param {import('./types').Project} project @param {string} sceneId */
function deleteScene(project, sceneId) {
  requireScene(project, sceneId);
  return rebuildProject({
    ...project,
    scenes: project.scenes.filter((scene) => scene.id !== sceneId),
  });
}

/** @param {import('./types').Project} project @param {string} sceneId */
function duplicateScene(project, sceneId) {
  const scene = structuredClone(requireScene(project, sceneId));
  scene.id = uuid();
  scene.name = `${scene.name.slice(0, 115)} copy`;
  const animations = { ...project.animations };
  scene.layers = scene.layers.map((layer) => {
    const id = uuid();
    if (animations[layer.id])
      animations[id] = {
        ...structuredClone(animations[layer.id]),
        keyframes: animations[layer.id].keyframes.map((key) => ({ ...key, id: uuid() })),
      };
    return { ...layer, id };
  });
  const scenes = [...project.scenes];
  scenes.splice(scenes.findIndex((item) => item.id === sceneId) + 1, 0, scene);
  return rebuildProject({ ...project, scenes, animations });
}

/** @param {import('./types').Project} project @param {string} sceneId @param {number} toIndex */
function reorderScene(project, sceneId, toIndex) {
  requireScene(project, sceneId);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= project.scenes.length)
    throw new Error("Invalid scene position.");
  if (project.scenes.findIndex((item) => item.id === sceneId) === toIndex) return project;
  const scenes = [...project.scenes];
  const [scene] = scenes.splice(
    scenes.findIndex((item) => item.id === sceneId),
    1,
  );
  scenes.splice(toIndex, 0, scene);
  return rebuildProject({ ...project, scenes });
}

/** @param {import('./types').Project} project @param {string} sceneId @param {import('./types').Layer['type']} type @param {string | undefined} assetId */
function addLayer(project, sceneId, type, assetId) {
  const scene = requireScene(project, sceneId);
  const asset = assetId ? project.assets.find((item) => item.id === assetId) : null;
  if (["image", "video", "audio"].includes(type) && (!asset || asset.type !== type))
    throw new Error("Choose a compatible imported asset first.");
  const compatible = project.tracks
    .filter((item) => !item.locked && item.type === (type === "audio" ? "audio" : "video"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const track =
    compatible.find((item) => !scene.layers.some((layer) => layer.trackId === item.id)) ||
    compatible[0];
  if (!track) throw new Error("No compatible track exists.");
  const base = {
    id: uuid(),
    trackId: track.id,
    type,
    start: 0,
    duration: Math.min(scene.duration, asset?.duration || scene.duration),
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    opacity: 1,
    zIndex: scene.layers.length,
    animation: { preset: "none", duration: 0 },
  };
  const properties =
    type === "image"
      ? { fit: "contain" }
      : type === "video" || type === "audio"
        ? { sourceStart: 0, volume: 1, muted: false }
        : type === "shape"
          ? { shape: "rectangle", fill: "#42c8dd", stroke: "#42c8dd", strokeWidth: 0 }
          : {
              text: type === "caption" ? "New caption" : "New text",
              fontSize: 48,
              fontFamily: "system",
              color: "#ffffff",
            };
  const layer = { ...base, ...(asset ? { assetId: asset.id } : {}), properties };
  return rebuildProject({
    ...project,
    scenes: project.scenes.map((item) =>
      item.id === sceneId ? { ...item, layers: [...item.layers, layer] } : item,
    ),
  });
}

/** @param {import('./types').Project} project @param {string} sceneId @param {string} layerId @param {Partial<Pick<import('./types').Layer, 'start'|'duration'|'position'|'scale'|'rotation'|'opacity'|'zIndex'>> & {text?: string}} patch */
function updateLayer(project, sceneId, layerId, patch) {
  const scene = requireScene(project, sceneId);
  const layer = scene.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error("Layer no longer exists.");
  const { text, ...common } = patch;
  const updated = {
    ...layer,
    ...common,
    ...(text !== undefined && (layer.type === "text" || layer.type === "caption")
      ? {
          properties: {
            ...layer.properties,
            text,
            ...(layer.type === "caption" &&
            layer.properties.caption &&
            text !== layer.properties.text
              ? { caption: { ...layer.properties.caption, words: [] } }
              : {}),
          },
        }
      : {}),
  };
  if (JSON.stringify(updated) === JSON.stringify(layer)) return project;
  return rebuildProject({
    ...project,
    scenes: project.scenes.map((item) =>
      item.id === sceneId
        ? { ...item, layers: item.layers.map((entry) => (entry.id === layerId ? updated : entry)) }
        : item,
    ),
  });
}

/** @param {import('./types').Project} project @param {string} sceneId @param {string} layerId */
function deleteLayer(project, sceneId, layerId) {
  const scene = requireScene(project, sceneId);
  return rebuildProject({
    ...project,
    scenes: project.scenes.map((item) =>
      item.id === sceneId
        ? { ...scene, layers: scene.layers.filter((layer) => layer.id !== layerId) }
        : item,
    ),
  });
}

/** @param {import('../media/types').MediaAsset} asset @returns {import('./types').ProjectAsset} */
function toProjectAsset(asset) {
  return projectAssetSchema.parse({
    id: asset.id,
    filename: asset.filename,
    type: asset.type,
    mimeType: asset.mimeType,
    size: asset.size,
    importedAt: asset.importedAt,
    ...(asset.duration && Number.isFinite(asset.duration) ? { duration: asset.duration } : {}),
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
  });
}

/** @param {import('./types').Project} project @param {import('./types').ProjectAsset[]} incoming */
function mergeProjectAssets(project, incoming) {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const asset of incoming) assets.set(asset.id, asset);
  if (JSON.stringify(project.assets) === JSON.stringify([...assets.values()])) return project;
  return projectSchema.parse({
    ...project,
    assets: [...assets.values()],
    updatedAt: new Date().toISOString(),
  });
}

module.exports = {
  createProject,
  rebuildProject,
  addScene,
  updateScene,
  deleteScene,
  duplicateScene,
  reorderScene,
  addLayer,
  updateLayer,
  deleteLayer,
  toProjectAsset,
  mergeProjectAssets,
  serializeProject,
};
