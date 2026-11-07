// @ts-check
const { createProject } = require("../core/project/operations.cjs");
const { appendCues } = require("../core/captions/commands.cjs");
const { makeCaption } = require("../core/captions/presets.cjs");
const { presetSchema } = require("../core/captions/schema.cjs");
const { stableId } = require("../core/animation/engine.cjs");
function createCaptionSample() {
  const p = createProject({ id: stableId("caption-sample") });
  p.name = "Caption preset acceptance";
  p.resolution = { width: 640, height: 360 };
  p.settings.backgroundColor = "#000000";
  return appendCues(
    p,
    presetSchema.options.map((preset, i) => ({
      start: i * 2,
      end: i * 2 + 2,
      text: "MotionCraft caption test",
      caption: {
        ...makeCaption(preset),
        box: { x: 0.5, y: 0.72, width: 0.85, rotation: 0, locked: false },
      },
      words: [
        { text: "MotionCraft", start: 0, end: 0.6 },
        { text: "caption", start: 0.6, end: 1.2 },
        { text: "test", start: 1.2, end: 2 },
      ],
    })),
    stableId("caption-preset-cues"),
  );
}
module.exports = { createCaptionSample };
