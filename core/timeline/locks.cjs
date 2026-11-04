// @ts-check
/** Preserve locked track content across scene/layer operations as well as clip commands.
 * Undo/redo intentionally restores complete historical snapshots, including lock state.
 * @param {import('../project/types').Project} previous
 * @param {import('../project/types').Project} next
 */
function assertLockedTracksUnchanged(previous, next) {
  const oldLayers = new Map(
    previous.scenes.flatMap((scene) => scene.layers.map((layer) => [layer.id, layer])),
  );
  const newLayers = new Map(
    next.scenes.flatMap((scene) => scene.layers.map((layer) => [layer.id, layer])),
  );
  for (const track of previous.tracks) {
    if (!track.locked) continue;
    const updated = next.tracks.find((item) => item.id === track.id);
    const before = [...track.clips].sort((a, b) => a.id.localeCompare(b.id));
    const after = [...(updated?.clips || [])].sort((a, b) => a.id.localeCompare(b.id));
    if (
      JSON.stringify(before) !== JSON.stringify(after) ||
      before.some(
        (clip) =>
          clip.layerId &&
          JSON.stringify(oldLayers.get(clip.layerId)) !==
            JSON.stringify(newLayers.get(clip.layerId)),
      )
    ) {
      throw new Error("Unlock the track before changing its clips or scene layers.");
    }
  }
}
module.exports = { assertLockedTracksUnchanged };
