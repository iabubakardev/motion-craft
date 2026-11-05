// @ts-check
const { createProject, rebuildProject } = require("../core/project/operations.cjs");
/** Deterministic, path-free 2 second project used by preview/export integration tests. */
function createRenderSample() {
  const project = createProject({
    id: "00000000-0000-4000-8000-000000000100",
    now: "2026-01-01T00:00:00.000Z",
    trackIds: Array.from(
      { length: 7 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 110).padStart(12, "0")}`,
    ),
  });
  /** @type {Pick<import("../core/project/types").Layer,"start"|"duration"|"position"|"scale"|"rotation"|"opacity"|"zIndex"|"animation">} */
  const base = {
    start: 0,
    duration: 2,
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    animation: { preset: "none", duration: 0 },
  };
  return rebuildProject(
    {
      ...project,
      name: "Render sample",
      resolution: { width: 320, height: 180 },
      scenes: [
        {
          id: "00000000-0000-4000-8000-000000000120",
          name: "Sample scene",
          start: 0,
          duration: 2,
          narration: "",
          stylePreset: "default",
          transitionIn: { type: "none", duration: 0 },
          transitionOut: { type: "none", duration: 0 },
          metadata: { notes: "Deterministic render fixture", tags: [] },
          layers: [
            {
              ...base,
              id: "00000000-0000-4000-8000-000000000121",
              trackId: project.tracks[2].id,
              type: "shape",
              properties: {
                shape: "rectangle",
                fill: "#20c080",
                stroke: "#000000",
                strokeWidth: 0,
              },
            },
            {
              ...base,
              id: "00000000-0000-4000-8000-000000000122",
              trackId: project.tracks[1].id,
              type: "text",
              start: 0.5,
              duration: 1.5,
              position: { x: 0, y: 10 },
              properties: {
                text: "MotionCraft",
                fontSize: 24,
                fontFamily: "system",
                color: "#ffffff",
              },
            },
          ],
        },
      ],
    },
    "2026-01-01T00:00:00.000Z",
  );
}
module.exports = { createRenderSample };
