// @ts-check
const { captionSchema } = require("./schema.cjs");
/** @typedef {import('zod').infer<typeof captionSchema>} Caption */
/** @param {import('zod').infer<typeof import('./schema.cjs').presetSchema>} [preset] @returns {Caption} */
function makeCaption(preset = "documentary") {
  const style = {
    displayMode: "phrase",
    fontFamily: "Arial",
    fontSize: 0.045,
    fontWeight: 600,
    color: "#ffffff",
    align: "center",
    casing: "none",
    letterSpacing: 0,
    lineHeight: 1.2,
    maxLines: 3,
    outlineColor: "#000000",
    outlineWidth: 0,
    shadowColor: "#000000",
    shadowBlur: 0.004,
    shadowX: 0,
    shadowY: 0.002,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    padding: 0.008,
    radius: 0,
    opacity: 1,
    animation: "none",
    animationSeconds: 0.2,
    easing: "ease-out",
    activeColor: "#ffe600",
    inactiveColor: "#ffffff",
    activeScale: 1,
  };
  const patches = {
    documentary: {},
    "bold-impact": {
      fontFamily: "Impact",
      fontWeight: 900,
      casing: "uppercase",
      outlineWidth: 0.004,
      animation: "pop",
      shadowBlur: 0,
    },
    "karaoke-highlight": { animation: "karaoke", activeScale: 1.12, outlineWidth: 0.002 },
    "rounded-box": {
      backgroundColor: "#3155c6",
      backgroundOpacity: 0.9,
      radius: 0.015,
      padding: 0.018,
      animation: "slide",
    },
    cinematic: {
      fontFamily: "Georgia",
      fontWeight: 400,
      letterSpacing: 0.003,
      animation: "fade",
      animationSeconds: 0.5,
    },
    "word-pop": { fontWeight: 900, fontSize: 0.065, animation: "bounce", activeScale: 1.2 },
  };
  return captionSchema.parse({
    version: 1,
    preset,
    style: { ...style, ...patches[preset] },
    box: { x: 0.5, y: 0.85, width: 0.8, rotation: 0, locked: false },
    words: [],
  });
}
/** Legacy captions retain their existing visual base until explicitly styled.
 * @param {Extract<import('../project/types').Layer,{type:'caption'}>} layer @param {{width:number,height:number}} resolution @returns {Caption} */
function captionForLayer(layer, resolution) {
  if (layer.properties.caption) return layer.properties.caption;
  const c = makeCaption();
  return captionSchema.parse({
    ...c,
    box: {
      ...c.box,
      x: Math.max(0, Math.min(1, 0.5 + layer.position.x / resolution.width)),
      y: Math.max(0, Math.min(1, 0.5 + layer.position.y / resolution.height)),
      rotation: Math.max(-180, Math.min(180, layer.rotation)),
    },
    style: {
      ...c.style,
      fontSize: Math.max(0.005, Math.min(0.3, layer.properties.fontSize / resolution.height)),
      color: layer.properties.color,
      opacity: layer.opacity,
    },
  });
}
/** @param {Caption['words']} words @param {number} offset @param {number} duration */
function cropWords(words, offset, duration) {
  return words
    .filter((w) => w.end > offset && w.start < offset + duration)
    .map((w) => ({
      ...w,
      start: Math.max(0, w.start - offset),
      end: Math.min(duration, w.end - offset),
    }))
    .filter((w) => w.end > w.start);
}
module.exports = { makeCaption, captionForLayer, cropWords };
