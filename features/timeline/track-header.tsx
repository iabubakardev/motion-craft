import { MediaIcon } from "@/features/media/media-icon";

export function TrackHeader({ id, type }: { id: string; type: "video" | "audio" }) {
  return <div className="timeline-track-header"><MediaIcon type={type} className={`h-3 w-3 ${type === "audio" ? "text-[#89b99b]" : "text-[var(--editor-muted)]"}`} /><span>{id}</span><span className="ml-auto text-[9px] opacity-50">{type === "audio" ? "Audio" : "Video"}</span></div>;
}
