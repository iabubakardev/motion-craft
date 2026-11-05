import { Composition, registerRoot } from "remotion";
import { ProjectComposition } from "./project-composition";
import { buildComposition } from "./input.cjs";
import { createProject } from "../core/project/operations.cjs";
const empty = createProject({
  id: "00000000-0000-4000-8000-000000000001",
  now: "2026-01-01T00:00:00.000Z",
  trackIds: Array.from(
    { length: 7 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
  ),
});
function Root() {
  return (
    <Composition
      id="MotionCraft"
      component={ProjectComposition}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={1}
      defaultProps={{ input: { project: empty, sources: {} } }}
      calculateMetadata={({ props }) => {
        const model = buildComposition(props.input);
        return {
          width: model.width,
          height: model.height,
          fps: model.fps,
          durationInFrames: model.durationInFrames,
        };
      }}
    />
  );
}
registerRoot(Root);
