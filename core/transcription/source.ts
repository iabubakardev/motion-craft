import type { Project } from "../project/types";
import { createTimelineIndex } from "../timeline/commands.cjs";
export type TranscriptionSource = { assetId: string; clipId?: string; name: string };
export function resolveTranscriptionSources(
  project: Project,
  selectedIds: string[],
  libraryId?: string | null,
): TranscriptionSource[] {
  const index = createTimelineIndex(project);
  const clips = selectedIds
    .flatMap((id) => {
      const item = index.clips.get(id);
      return item?.asset && item.asset.type !== "image"
        ? [
            {
              assetId: item.asset.id,
              clipId: id,
              name: `${item.asset.filename} (${item.clip.duration.toFixed(2)} s)`,
              audio: item.clip.audioOnly || item.asset.type === "audio",
            },
          ]
        : [];
    })
    .sort((a, b) => Number(b.audio) - Number(a.audio));
  if (clips.length) return clips;
  const asset = project.assets.find((a) => a.id === libraryId && a.type !== "image");
  return asset ? [{ assetId: asset.id, name: asset.filename }] : [];
}
