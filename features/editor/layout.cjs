const { z } = require("zod");

const DEFAULT_PANELS = Object.freeze({ left: 300, right: 260, bottom: 240 });
const LAYOUT_KEY = "motioncraft.workspace-layout.v1";
const layoutSchema = z.object({
  version: z.literal(1),
  left: z.number().finite().min(200).max(480),
  right: z.number().finite().min(220).max(420),
  bottom: z.number().finite().min(160).max(480),
}).strict();
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/** @param {import('./types').PanelSizes} desired @param {number} width @param {number} height */
function constrainPanels(desired, width, height) {
  // Keep at least 320px for the monitor and 240px above the timeline.
  const leftMax = Math.max(200, Math.min(480, width - 12 - 320 - 220));
  const left = clamp(desired.left, 200, leftMax);
  const rightMax = Math.max(220, Math.min(420, width - 12 - 320 - left));
  const right = clamp(desired.right, 220, rightMax);
  const bottomMax = Math.max(160, Math.min(480, height - 246));
  return { left, right, bottom: clamp(desired.bottom, 160, bottomMax) };
}

/** @param {string | null} raw */
function parseLayout(raw) {
  try {
    const parsed = layoutSchema.safeParse(JSON.parse(raw || "null"));
    if (parsed.success) return { left: parsed.data.left, right: parsed.data.right, bottom: parsed.data.bottom };
  } catch { /* Invalid local preferences must never prevent startup. */ }
  return { ...DEFAULT_PANELS };
}

module.exports = { DEFAULT_PANELS, LAYOUT_KEY, constrainPanels, parseLayout, clamp };
