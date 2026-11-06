// @ts-check
const { z } = require("zod");
const { fpsSchema } = require("../project/schema.cjs");
const { secondsToFrames } = require("../timeline/time.cjs");
const { presetSchema } = require("../animation/schema.cjs");
const scenePlanSchema = z
  .object({
    planId: z.uuid(),
    schemaVersion: z.literal(1),
    sourceText: z.string().min(1).max(100000),
    modelId: z.string().min(1).max(120),
    fps: fpsSchema,
    timing: z.enum(["estimated", "narration"]),
    scenes: z
      .array(
        z
          .object({
            sceneId: z.uuid(),
            order: z.number().int().nonnegative(),
            narration: z.string().max(20000),
            visualPrompt: z.string().trim().min(1).max(2000),
            searchKeywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
            suggestedAssetType: z.enum(["image", "video"]),
            estimatedDurationFrames: z
              .number()
              .int()
              .positive()
              .max(86400 * 60),
            animationPreset: presetSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(512),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const ids = new Set();
    plan.scenes.forEach((scene, index) => {
      if (ids.has(scene.sceneId) || scene.order !== index)
        ctx.addIssue({
          code: "custom",
          message: "Scene IDs must be unique and order must match array order",
        });
      ids.add(scene.sceneId);
    });
    if (
      plan.scenes.reduce((sum, scene) => sum + scene.estimatedDurationFrames, 0) >
      86400 * plan.fps
    )
      ctx.addIssue({ code: "custom", message: "Scene plan exceeds 24 hours" });
  });
/** Versioned planning sidecar, separate from the established review/apply format.
 * IDs and frame boundaries come only from the application plan, never model timing.
 * @param {import('./planning.cjs').Plan} plan */
function toScenePlan(plan) {
  return scenePlanSchema.parse({
    planId: plan.id,
    schemaVersion: 1,
    sourceText:
      plan.sourceText || plan.transcript?.text || plan.scenes.map((s) => s.narration).join(" "),
    modelId: plan.modelId || "external",
    fps: plan.fps,
    timing: plan.timing,
    scenes: plan.scenes.map((scene, order) => ({
      sceneId: scene.id,
      order,
      narration: scene.narration,
      visualPrompt: scene.visualDescription,
      searchKeywords: scene.keywords,
      suggestedAssetType: scene.assetType,
      estimatedDurationFrames:
        secondsToFrames(scene.end, plan.fps) - secondsToFrames(scene.start, plan.fps),
      ...(scene.animation !== "none" ? { animationPreset: scene.animation } : {}),
    })),
  });
}
module.exports = { scenePlanSchema, toScenePlan };
