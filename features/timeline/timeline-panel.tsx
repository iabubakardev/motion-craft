import type { Project } from "@/core/project/types";
import { EditorIcon } from "@/features/editor/editor-icon";
import { TimelineRuler } from "./timeline-ruler";
import { TrackHeader } from "./track-header";

export function TimelinePanel({ project, activeSceneId, selectedLayerId, onScene, onLayer, onAsset, zoom, playhead, onZoom, onSeek }: {
  project: Project; activeSceneId: string | null; selectedLayerId: string | null;
  onScene: (id: string) => void; onLayer: (sceneId: string, layerId: string) => void; onAsset: (id: string) => void;
  zoom: number; playhead: number; onZoom: (zoom: number) => void; onSeek: (time: number) => void;
}) {
  const extent = Math.max(120, Math.ceil(project.duration / 10) * 10);
  return <section id="timeline-panel" aria-label="Timeline workspace" className="editor-panel flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--editor-border)] px-3">
      <h2 className="text-[11px] font-medium">Timeline</h2><span className="text-[10px] text-[var(--editor-muted)]">{project.scenes.length ? `${project.scenes.length} scenes · ${project.duration.toFixed(1)} s` : 'No scenes'} · data view</span>
      <button type="button" className="editor-icon-button" aria-label="Reset timeline playhead" title="Reset timeline marker" onClick={() => onSeek(0)}><EditorIcon name="reset" className="h-3 w-3" /></button>
      <output aria-label="Timeline marker time" className="font-mono text-[10px] text-[var(--editor-accent)]">{playhead.toFixed(1)} s</output>
      <div className="ml-auto flex items-center gap-2"><button type="button" aria-label="Zoom timeline out" className="editor-icon-button" disabled={zoom <= 4} onClick={() => onZoom(zoom - 4)}>−</button><label className="flex items-center gap-2 text-[10px] text-[var(--editor-muted)]"><span>Zoom</span><input aria-label="Timeline zoom" type="range" min={4} max={80} step={1} value={zoom} onChange={(event) => onZoom(Number(event.target.value))} className="editor-range w-20" /></label><button type="button" aria-label="Zoom timeline in" className="editor-icon-button" disabled={zoom >= 80} onClick={() => onZoom(zoom + 4)}>+</button><output className="w-9 text-right font-mono text-[9px] text-[var(--editor-muted)]">{Math.round(zoom / 12 * 100)}%</output></div>
    </div>
    <div className="timeline-scroll min-h-0 flex-1 overflow-auto" aria-label="Scrollable timeline"><div className="relative min-h-full" style={{ width: 116 + extent * zoom }}>
      <div className="sticky top-0 z-20 flex h-6 bg-[var(--editor-panel)]"><div className="sticky left-0 z-30 flex w-[116px] shrink-0 items-center border-r border-[var(--editor-border)] bg-[var(--editor-panel)] px-3 text-[9px] text-[var(--editor-muted)]">TRACKS</div><TimelineRuler zoom={zoom} duration={extent} playhead={Math.min(playhead, extent)} onSeek={onSeek} /></div>
      <div className="flex h-7 border-b border-[var(--editor-border)]"><div className="timeline-track-header">Scenes</div><div className="relative flex-1">{project.scenes.map((scene) => <button key={scene.id} type="button" aria-label={`Timeline scene ${scene.name}`} aria-pressed={activeSceneId === scene.id} title={`${scene.name}: ${scene.start.toFixed(2)}–${(scene.start + scene.duration).toFixed(2)} s`} className={`absolute top-1 h-5 truncate rounded-sm border px-1 text-left text-[9px] ${activeSceneId === scene.id ? 'border-[var(--editor-accent)] bg-[#23505b]' : 'border-slate-600 bg-[var(--editor-elevated)]'}`} style={{ left: scene.start * zoom, width: Math.max(3, scene.duration * zoom - 2) }} onClick={() => { onScene(scene.id); onSeek(scene.start); }}>{scene.name}</button>)}</div></div>
      {[...project.tracks].sort((a, b) => a.order - b.order).map((track) => <div key={track.id} className="flex h-7 border-b border-[var(--editor-border)]"><TrackHeader id={track.name} type={track.type} /><div className="timeline-track relative flex-1" style={{ backgroundSize: `${zoom * 10}px 100%` }}>
        {track.clips.map((clip) => {
          const scene = clip.layerId ? project.scenes.find((item) => item.layers.some((layer) => layer.id === clip.layerId)) : null;
          const layer = scene?.layers.find((item) => item.id === clip.layerId);
          const asset = project.assets.find((item) => item.id === (clip.assetId || (layer && 'assetId' in layer ? layer.assetId : null)));
          const label = asset?.filename || (layer && 'text' in layer.properties ? layer.properties.text : layer?.type || 'Asset clip');
          return <button key={clip.id} type="button" aria-label={`Timeline layer ${label}`} aria-pressed={!!clip.layerId && clip.layerId === selectedLayerId} title={`${label}: ${clip.start.toFixed(2)} s + ${clip.duration.toFixed(2)} s`} className={`absolute top-1 h-5 truncate rounded-sm border px-1 text-left text-[9px] ${clip.layerId === selectedLayerId ? 'border-[var(--editor-accent)] bg-[#23505b]' : track.type === 'audio' ? 'border-[#466655] bg-[#243d33]' : 'border-[#44596f] bg-[#26384c]'}`} style={{ left: clip.start * zoom, width: Math.max(3, clip.duration * zoom - 2) }} onClick={() => { if (scene && clip.layerId) onLayer(scene.id, clip.layerId); else if (clip.assetId) onAsset(clip.assetId); onSeek(clip.start); }}>{label}</button>;
        })}
      </div></div>)}
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-6 z-10 w-px bg-[var(--editor-accent)]" style={{ left: 116 + Math.min(playhead, extent) * zoom }} />
      {!project.scenes.length && !project.tracks.some((track) => track.clips.length) && <p className="pointer-events-none absolute left-[140px] top-[80px] max-w-72 text-[10px] leading-5 text-[var(--editor-muted)]">No project content yet.<br /><span className="opacity-60">Add a scene, then add source or text layers. Timeline drag-and-drop and rendering are not available.</span></p>}
    </div></div>
  </section>;
}
