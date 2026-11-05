// @ts-check
const { createRenderSample } = require("./sample.cjs");
const { stableId } = require("../core/animation/engine.cjs");
const { projectSchema } = require("../core/project/schema.cjs");
/** Media-free fixture for deterministic preview/MP4 animation comparisons. */
function createAnimationSample() {
  const project = createRenderSample(),
    layer = project.scenes[0].layers[0];
  project.scenes[0].layers = [layer];
  project.tracks = project.tracks.map((track) => ({
    ...track,
    clips: track.clips.filter((clip) => clip.id === layer.id),
  }));
  project.name = "Animation sample";
  /** @type {import('../core/animation/engine.cjs').Key[]} */
  const keys = [];
  /** @type {[import('../core/animation/engine.cjs').Key['property'],number,number][]} */
  const channels = [
    ["x", -60, 60],
    ["y", -10, 10],
    ["scaleX", 0.8, 1.2],
    ["scaleY", 1.2, 0.8],
    ["rotation", 0, 90],
    ["opacity", 0.3, 1],
  ];
  for (const [property, from, to] of channels)
    for (const frame of [0, 59])
      keys.push({
        id: stableId(`${layer.id}:${property}:${frame}`),
        property,
        frame,
        value: frame === 0 ? from : to,
        easing: { type: "ease-in-out" },
      });
  project.animations[layer.id] = { keyframes: keys };
  return projectSchema.parse(project);
}
module.exports = { createAnimationSample };
