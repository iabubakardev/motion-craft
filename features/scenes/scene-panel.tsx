import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { EditorIcon } from "@/features/editor/editor-icon";
import { formatDuration } from "@/features/media/library.cjs";

export function ScenePanel({ document: doc }: { document: ProjectDocumentController }) {
  return <section aria-label="Scenes" className="flex h-full min-h-0 flex-col">
    <div className="editor-panel-heading"><h2>Scenes</h2><button type="button" className="editor-primary !px-2 !py-1" disabled={!doc.ready || doc.busy} onClick={doc.addScene}>+ Add scene</button></div>
    {doc.project.scenes.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center p-6 text-center"><EditorIcon name="scene" className="mb-4 h-8 w-8 text-[var(--editor-muted)]" /><h3 className="text-xs">No scenes yet</h3><p className="mt-3 text-[11px] leading-5 text-[var(--editor-muted)]">Add a scene, then edit its duration, narration and layers in Properties. Your media stays in the library.</p></div> : <ol aria-label="Project scenes" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      {doc.project.scenes.map((scene, index) => <li key={scene.id} data-scene-id={scene.id} className={`rounded border ${doc.activeSceneId === scene.id ? 'border-[var(--editor-accent)]' : 'border-[var(--editor-border)]'}`}>
        <button type="button" aria-pressed={doc.activeSceneId === scene.id} aria-label={`Select scene ${scene.name}`} onClick={() => doc.selectScene(scene.id)} className="block w-full p-3 text-left"><span className="block truncate text-xs font-medium">{index + 1}. {scene.name}</span><span className="mt-2 block text-[10px] text-[var(--editor-muted)]">{formatDuration(scene.start)} · {scene.duration.toFixed(1)} s · {scene.layers.length} layers</span></button>
        <div className="flex items-center gap-1 border-t border-[var(--editor-border)] px-2 py-1"><button type="button" className="editor-icon-button text-xs" aria-label={`Move ${scene.name} up`} disabled={index === 0 || doc.busy} onClick={() => doc.reorderScene(scene.id, index - 1)}>↑</button><button type="button" className="editor-icon-button text-xs" aria-label={`Move ${scene.name} down`} disabled={index === doc.project.scenes.length - 1 || doc.busy} onClick={() => doc.reorderScene(scene.id, index + 1)}>↓</button><button type="button" className="editor-secondary !border-0 !px-2 !py-1 text-[10px]" disabled={doc.busy} onClick={() => doc.duplicateScene(scene.id)}>Duplicate</button><button type="button" className="editor-secondary ml-auto !border-0 !px-2 !py-1 text-[10px] !text-red-300" disabled={doc.busy} onClick={() => doc.setDeleteSceneId(scene.id)}>Delete</button></div>
      </li>)}
    </ol>}
    <p className="border-t border-[var(--editor-border)] px-3 py-2 text-[9px] text-[var(--editor-muted)]">{doc.project.scenes.length} scenes · {doc.project.duration.toFixed(1)} s project</p>
  </section>;
}
