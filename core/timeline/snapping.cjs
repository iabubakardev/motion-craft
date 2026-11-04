// @ts-check
const { secondsToFrames } = require("./time.cjs");
/** @param {import('../project/types').Project} project @param {number} playhead @param {string[]} excluded */
function snapTargets(project, playhead, excluded = []) {
  const ignore = new Set(excluded),
    frames = new Set([0, playhead]);
  for (const scene of project.scenes) {
    frames.add(secondsToFrames(scene.start, project.fps));
    frames.add(secondsToFrames(scene.start + scene.duration, project.fps));
  }
  for (const track of project.tracks)
    for (const clip of track.clips)
      if (!ignore.has(clip.id)) {
        frames.add(secondsToFrames(clip.start, project.fps));
        frames.add(secondsToFrames(clip.start + clip.duration, project.fps));
      }
  return [...frames].sort((a, b) => a - b);
}
/** @param {number[]} edges @param {number[]} targets @param {number} tolerance */
function snapEdges(edges, targets, tolerance) {
  let delta = 0;
  /** @type {number|null} */ let guide = null;
  let distance = Infinity;
  for (const edge of edges) {
    let low = 0,
      high = targets.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (targets[mid] < edge) low = mid + 1;
      else high = mid;
    }
    for (const index of [low - 1, low]) {
      const target = targets[index];
      if (target === undefined) continue;
      const gap = Math.abs(target - edge);
      if (
        gap <= tolerance &&
        (gap < distance || (gap === distance && target < (guide ?? Infinity)))
      ) {
        delta = target - edge;
        guide = target;
        distance = gap;
      }
    }
  }
  return { delta, guide };
}
module.exports = { snapTargets, snapEdges };
