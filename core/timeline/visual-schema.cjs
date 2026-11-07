// @ts-check
const { z } = require("zod");
const visualSchema = z
  .object({
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000),
    scaleX: z.number().min(0.01).max(100),
    scaleY: z.number().min(0.01).max(100),
    rotation: z.number().min(-36000).max(36000),
    opacity: z.number().min(0).max(1),
    fit: z.enum(["contain", "cover"]),
    flipX: z.boolean(),
    flipY: z.boolean(),
    crop: z
      .object({
        top: z.number().min(0).max(0.95),
        right: z.number().min(0).max(0.95),
        bottom: z.number().min(0).max(0.95),
        left: z.number().min(0).max(0.95),
      })
      .strict()
      .refine(
        (c) => c.top + c.bottom < 0.99 && c.left + c.right < 0.99,
        "Crop must leave a visible area",
      ),
    entrance: z.enum(["none", "fade", "slide-left", "slide-right", "zoom"]),
    exit: z.enum(["none", "fade", "slide-left", "slide-right", "zoom"]),
    transitionSeconds: z.number().min(0).max(10),
  })
  .strict();
/** @param {import('../project/types').Layer|undefined} layer */
function defaultVisual(layer) {
  return {
    x: layer?.position.x ?? 0,
    y: layer?.position.y ?? 0,
    scaleX: layer?.scale ?? 1,
    scaleY: layer?.scale ?? 1,
    rotation: layer?.rotation ?? 0,
    opacity: layer?.opacity ?? 1,
    fit:
      layer && (layer.type === "image" || layer.type === "video")
        ? layer.properties.fit || "contain"
        : "contain",
    flipX: false,
    flipY: false,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    entrance: "none",
    exit: "none",
    transitionSeconds: 0.3,
  };
}
module.exports = { visualSchema, defaultVisual };
