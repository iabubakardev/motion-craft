// @ts-check
const { z } = require("zod");
const { presetSchema } = require("../animation/schema.cjs");
const stylePackSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(80),
    visualPreferences: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    animationDefault: presetSchema,
    captionPreset: z.literal("none"),
    planningGuidance: z.string().trim().min(1).max(1500),
  })
  .strict();
const builtIns = [
  [
    "documentary",
    "Documentary",
    ["Natural footage", "Contextual locations"],
    "documentary-zoom",
    "Use evidence-led visuals and restrained movement.",
  ],
  [
    "finance-explainer",
    "Finance explainer",
    ["Readable graphics", "Relevant business contexts"],
    "fade-in",
    "Use clear explanatory visuals; never invent financial figures.",
  ],
  [
    "flat-2d",
    "Flat 2D illustration",
    ["Flat illustrated assets", "Consistent palette"],
    "slide-up",
    "Prefer existing flat illustrations with clear silhouettes.",
  ],
  [
    "whiteboard",
    "Whiteboard",
    ["Simple diagrams", "High contrast backgrounds"],
    "fade-in",
    "Prefer existing diagram assets; do not claim a drawing effect is available.",
  ],
  [
    "kinetic-typography",
    "Kinetic typography",
    ["Strong text hierarchy", "Simple backgrounds"],
    "pop-in",
    "Plan concise text-led beats using existing text and keyframe tools.",
  ],
].map(([id, name, visualPreferences, animationDefault, planningGuidance]) =>
  stylePackSchema.parse({
    version: 1,
    id,
    name,
    visualPreferences,
    animationDefault,
    planningGuidance,
    captionPreset: "none",
  }),
);
module.exports = { stylePackSchema, builtIns };
