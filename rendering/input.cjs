// @ts-check
const { z } = require("zod");
const { projectSchema, idSchema } = require("../core/project/schema.cjs");
const { secondsToFrames } = require("../core/timeline/time.cjs");
const sourceSchema = z
  .string()
  .max(512)
  .refine(
    (value) =>
      /^motioncraft-media:\/\/asset\/[0-9a-f-]+$/i.test(value) ||
      /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/[0-9a-f-]+$/i.test(value),
    "Media must use an approved asset resolver",
  );
const renderInputSchema = z
  .object({ project: projectSchema, sources: z.record(idSchema, sourceSchema) })
  .strict();
/** @param {unknown} value */
function buildComposition(value) {
  const input = renderInputSchema.parse(value),
    { project } = input;
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const layers = new Map(
    project.scenes.flatMap((scene) => scene.layers.map((layer) => [layer.id, layer])),
  );
  const clips = [...project.tracks]
    .sort((a, b) => b.order - a.order)
    .flatMap((track) => {
      if (!track.visible || (track.type === "audio" && track.muted)) return [];
      return [...track.clips]
        .sort(
          (a, b) =>
            (layers.get(a.layerId || "")?.zIndex || 0) -
              (layers.get(b.layerId || "")?.zIndex || 0) || a.id.localeCompare(b.id),
        )
        .flatMap((clip) => {
          const layer = layers.get(clip.layerId || ""),
            assetId = clip.assetId || (layer && "assetId" in layer ? layer.assetId : undefined);
          const asset = assetId ? assets.get(assetId) : undefined,
            type = layer?.type || asset?.type;
          const from = Math.max(0, secondsToFrames(clip.start, project.fps, "ceil")),
            end = Math.max(0, secondsToFrames(clip.start + clip.duration, project.fps, "ceil"));
          if (end <= from) return [];
          const sourceStart =
            clip.sourceStart === null
              ? 0
              : secondsToFrames(clip.sourceStart + from / project.fps - clip.start, project.fps);
          return [
            {
              id: clip.id,
              type,
              from,
              startSeconds: clip.start,
              durationInFrames: end - from,
              sourceStart,
              layer,
              captionPages:
                layer?.type === "caption"
                  ? require("../core/captions/engine.cjs").captionPages(
                      layer.properties.caption?.words || [],
                    )
                  : [],
              motion: project.animations[clip.id],
              assetId,
              src: assetId ? input.sources[assetId] || null : null,
              label: asset?.filename || type || "Clip",
              muted:
                track.muted || !!(layer && "muted" in layer.properties && layer.properties.muted),
              volume: layer && "volume" in layer.properties ? layer.properties.volume : 1,
            },
          ];
        });
    });
  return {
    input,
    clips,
    width: project.resolution.width,
    height: project.resolution.height,
    fps: project.fps,
    durationInFrames: Math.max(1, secondsToFrames(project.duration, project.fps, "ceil")),
    background: project.settings.backgroundColor,
  };
}
module.exports = { renderInputSchema, buildComposition };
