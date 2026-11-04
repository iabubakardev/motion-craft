import MediaLibrary from "@/features/media/media-library";
import type { useMediaLibrary } from "@/features/media/use-media-library";
import { ScenePanel } from "@/features/scenes/scene-panel";
import type { SidebarTab } from "./types";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";

export function MediaSidebar({ library, document: projectDocument, tab, onTab }: { library: ReturnType<typeof useMediaLibrary>; document: ProjectDocumentController; tab: SidebarTab; onTab: (tab: SidebarTab) => void }) {
  return <aside id="media-sidebar" aria-label="Media and scenes" className="editor-panel flex h-full min-h-0 flex-col">
    <div role="tablist" aria-label="Sidebar" className="flex shrink-0 border-b border-[var(--editor-border)] px-2 pt-1">
      {(["media", "scenes", "audio"] as const).map((name) => <button key={name} type="button" role="tab" id={`tab-${name}`} aria-controls={name === "scenes" ? "scenes-panel" : "library-panel"} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
        onClick={() => onTab(name)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const tabs: SidebarTab[] = ["media", "scenes", "audio"];
          const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (tabs.indexOf(name) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
          onTab(tabs[index]);
          document.getElementById(`tab-${tabs[index]}`)?.focus();
        }} className={`border-b-2 px-3 py-2.5 text-xs capitalize ${tab === name ? "border-[var(--editor-accent)] text-[var(--editor-accent)]" : "border-transparent text-[var(--editor-muted)] hover:text-[var(--editor-text)]"}`}>{name}</button>)}
    </div>
    <div id="library-panel" role="tabpanel" aria-labelledby={`tab-${tab === "audio" ? "audio" : "media"}`} hidden={tab === "scenes"} className="min-h-0 flex-1"><MediaLibrary library={library} audioOnly={tab === "audio"} /></div>
    <div id="scenes-panel" role="tabpanel" aria-labelledby="tab-scenes" hidden={tab !== "scenes"} className="min-h-0 flex-1"><ScenePanel document={projectDocument} /></div>
  </aside>;
}
