# Phase 4 timeline editing

MotionCraft has a working multitrack editing slice. Phase 5 adds a separate Timeline monitor and MP4 export using the same composition; Source mode still previews originals. Track visibility/mute now affect composition playback/export. See [Rendering](RENDERING.md).

## Model and timing

The project/history controller remains the document owner. Scene layers own relative timing, transforms and properties; their track clips are derived atomically. Library drops create standalone asset clips with global timing. Moving/trimming/splitting a scene-owned clip updates its layer and derived clip together. Scene layers must stay inside their original scene. This preserves scene regeneration and existing manual edits without inventing a second document model.

`core/timeline/time.cjs` converts seconds, integer project frames, pixels and HH:MM:SS:FF timecode at 24/25/30/50/60 fps. Nearest rounding is floor(value + 0.5) with a small floating-point epsilon; floor/ceil conversions are explicit. This is integer-rate timecode, not drop-frame/SMPTE fractional rates. UI gestures and command inputs use integer frames; JSON v2 still uses seconds. Moves add frame deltas without rounding legacy source endpoints or durations. Trim/split edges and inspector start/duration are frame coordinates. Imported off-grid content remains exact until explicitly edited. Editing requires at least one frame and a maximum 24-hour timeline.

Playable clips have numeric source ranges: left trims change source in, right trims change source out, moves preserve both, and splits retain the left ID and create a new right ID with continuous source ranges. Unknown-duration audio/video cannot be inserted or extended. Images start at five seconds and use null source endpoints; text/shape/caption content also uses null endpoints and can be trimmed within scene limits.

Schema v2 requires track visibility/mute/lock/height and null non-playable source ranges. Version 1 is strictly validated first, migrated without changing IDs/timing/manual content, and presented for confirmation. Schema v3 adds clip-owned animation keyframes (see ANIMATION.md); migrated documents are dirty until saved as v3. The bundled sample remains a v1 migration fixture. Older applications cannot read v3 exports. See [Project format](PROJECT_FORMAT.md).

## Tracks and edits

The seven existing tracks retain stable IDs/names: V1 main video, V2 overlay, V3 graphics, V4 captions, A1 narration, A2 music, A3 SFX. Video tracks accept image/video/text/shape/caption content; audio tracks accept audio only. These roles are descriptions, not additional format restrictions.

Track selection, visibility, mute, lock, height and up/down ordering work. Heights are 28-160 pixels. Locks reject clip edits and scene/layer commits that change locked content; adding layers selects an unlocked compatible track. Undo/redo intentionally restores historical snapshots, including lock state.

- Drag an imported media card onto a compatible track to insert it. The drop preview uses the same validator as the final edit.
- Drag a clip body to move it; a single clip can change compatible tracks. Drag either edge to trim. Ctrl/Shift-click toggles multi-selection; group moves preserve tracks and offsets. Escape cancels without history.
- Select one clip and split at the playhead. The right-hand segment becomes the sole selection, ready for immediate Delete. Clicking a selected group without dragging selects just the clicked clip; dragging retains the group. Use the inspector to set its start/duration in frames. Source ranges and other layer properties are preserved.
- Delete, duplicate, copy and paste apply atomically. Duplicate places the group immediately after its current end; paste anchors the earliest copied start at the playhead while preserving offsets/tracks. The clipboard is internal and resets on document replacement. Scene-owned pastes retain their original scene ownership and reject placement outside it.
- New timeline edits reject same-track overlaps, while adjacent half-open intervals are allowed. There is no implicit overwrite or ripple. Existing/imported overlaps remain valid for compatibility; existing scene tools retain their composition semantics and can create overlaps.
- Snapping uses an eight-screen-pixel threshold against origin, playhead, scene boundaries and other clip edges, excluding the selected clips. A visible guide marks the chosen target. Toggle Snap to disable it.
- Ruler seeking, frame stepping, typed timecode, zoom buttons/range, Fit project, horizontal/vertical scrolling and horizontal gesture auto-scroll work. The timeline clock is independent of source playback.

## Commands, state and performance

`core/timeline/commands.cjs` defines strict discriminated InsertClip, MoveClip, TrimClip, SplitClip, DeleteClips, DuplicateClip, PasteClips, UpdateClipProperties and UpdateTrack commands. IDs and commit timestamps are supplied at the application boundary. Pure planning is shared by preview and commit. Errors reject the whole command and preserve the previous project.

`useProjectDocument.executeTimeline` checks that the gesture baseline is still current, executes/validates once on completion and appends one existing bounded snapshot-history entry. Pointer updates never write project JSON/history. Save checkpoints and existing undo/redo remain authoritative. Scene/layer commits also check locked content.

A per-workspace vanilla Zustand store owns selected clip IDs, active track, playhead frame, zoom, viewport, clipboard, snap preference, drag preview and local feedback. No document or history is duplicated there. Library, timeline and inspector use focused selectors. Clip selection is independent of source/scene context. Escape, pointer cancellation, project replacement and unmount clean up gestures/listeners; obsolete project edits are rejected.

Pointer work is animation-frame throttled. Drag ghosts/readouts subscribe separately from the static timeline. Indexes are memoized; clips/scenes outside the horizontal viewport are omitted. There are seven tracks, so row virtualization and TanStack Virtual add no demonstrated value yet. Full-project validation and bounded snapshots happen at commit, not on each movement. This is a foundation for larger projects, not a claim of measured thousands-of-clips performance; profiling and possible interval indexing/workers/history deltas remain future work.

Zustand 5.0.16 is the only added runtime dependency (MIT, compatible with installed React 19, no native capability). Native media drag-and-drop and pointer events cover this scope without dnd-kit. Small native forms and the existing Node test runner remain sufficient.

## Keyboard

Timeline editing shortcuts apply while focus is inside the timeline. Text inputs, text areas, selects and editable content retain their normal keys. Modal interactions disable edits. The ruler owns its own seek keys.

| Key                      | Behavior                                                  |
| ------------------------ | --------------------------------------------------------- |
| Delete / Backspace       | Delete selected clips                                     |
| Ctrl+C / Ctrl+V / Ctrl+D | Internal copy / paste at playhead / duplicate             |
| S                        | Split the single selected clip at playhead                |
| Left / Right             | Step one project frame; Shift steps one second            |
| + / -                    | Zoom timeline                                             |
| Escape                   | Cancel active gesture, otherwise clear timeline selection |
| Ctrl+Z                   | Project undo                                              |
| Ctrl+Shift+Z / Ctrl+Y    | Project redo                                              |

Existing Ctrl+O media import, Ctrl+S save, source Space playback and fullscreen Escape remain available with their existing input/focus guards.

## Verification and limits

Run `npm run check` and `npm run build`. With `npm run dev` active, clear inherited ELECTRON_RUN_AS_NODE and run `npm run test:desktop`, `npm run test:media`, `npm run test:projects`, `npm run test:timeline`.

Domain tests cover frame math/timecodes, insertion, media compatibility, move/trim/split/source bounds, group operations, overlaps/locks, immutable preview, history, snapping, migration and JSON round trips. The Electron timeline suite uses the real React renderer, preload, IPC and project files with an isolated temporary profile. It dispatches media drag events, sends native clip pointer input, checks history, inspector edits, split/copy/paste/delete and track flags, then saves, creates a new document and reopens the exact saved project. Windows pickers are substituted. The existing project suite covers missing-media placeholders/relinking and canceled/corrupt open/save workflows.

Remaining: composition playback/render/export; waveform generation; ripple/slip/speed changes; cross-scene layer transfer; multi-track group transfer; adding/removing tracks; system clipboard interchange; measured long-project scaling; high-DPI/multi-monitor gesture testing; representative real-world codecs and native picker interaction; autosave/crash recovery; packaged Electron loading and production CSP/runtime security release gates. Video thumbnails display only when available from the existing media layer; no fake waveform or thumbnail processing is introduced.

## Changed files

- `(root)`: [README.md](../README.md), [package-lock.json](../package-lock.json), [package.json](../package.json).
- `core/project`: [ipc.cjs](../core/project/ipc.cjs), [operations.cjs](../core/project/operations.cjs), [project.test.cjs](../core/project/project.test.cjs), [schema.cjs](../core/project/schema.cjs), [types.ts](../core/project/types.ts).
- `core/timeline`: [commands.cjs](../core/timeline/commands.cjs) (new), [locks.cjs](../core/timeline/locks.cjs) (new), [snapping.cjs](../core/timeline/snapping.cjs) (new), [time.cjs](../core/timeline/time.cjs) (new), [timeline.test.cjs](../core/timeline/timeline.test.cjs) (new), [types.ts](../core/timeline/types.ts) (new).
- `docs`: [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md), [EDITOR_WORKSPACE.md](EDITOR_WORKSPACE.md), [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md), [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md), [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), [PROJECT_FORMAT.md](PROJECT_FORMAT.md), [ROADMAP.md](ROADMAP.md), [TIMELINE.md](TIMELINE.md) (new).
- `electron`: [media-smoke.cjs](../electron/media-smoke.cjs), [project-smoke.cjs](../electron/project-smoke.cjs), [timeline-smoke.cjs](../electron/timeline-smoke.cjs) (new).
- `electron/ipc`: [projects.cjs](../electron/ipc/projects.cjs), [projects.test.cjs](../electron/ipc/projects.test.cjs).
- `features/editor`: [editor-state.cjs](../features/editor/editor-state.cjs), [editor-state.test.cjs](../features/editor/editor-state.test.cjs), [editor-workspace.tsx](../features/editor/editor-workspace.tsx), [types.ts](../features/editor/types.ts), [use-editor-shortcuts.ts](../features/editor/use-editor-shortcuts.ts).
- `features/inspector`: [properties-inspector.tsx](../features/inspector/properties-inspector.tsx).
- `features/media`: [media-items.tsx](../features/media/media-items.tsx).
- `features/projects`: [json-import-dialog.tsx](../features/projects/json-import-dialog.tsx), [use-project-document.ts](../features/projects/use-project-document.ts).
- `features/timeline`: [clip-properties.tsx](../features/timeline/clip-properties.tsx) (new), [interaction-store.cjs](../features/timeline/interaction-store.cjs) (new), [interaction-types.ts](../features/timeline/interaction-types.ts) (new), [timeline-controls.tsx](../features/timeline/timeline-controls.tsx) (new), [timeline-panel.tsx](../features/timeline/timeline-panel.tsx), [timeline-ruler.tsx](../features/timeline/timeline-ruler.tsx), [timeline-store.tsx](../features/timeline/timeline-store.tsx) (new), [use-clip-gesture.ts](../features/timeline/use-clip-gesture.ts) (new).

The workspace cleanup makes Timeline the default canvas, restores it on timeline interactions, auto-fits new content and follows off-screen playheads. Timeline timecode editing uses a stable draft rather than replacing the input every frame. See [Workspace review](WORKSPACE_REVIEW.md).

## Right-click editing menu

Right-click a clip for Split at playhead, Copy, Duplicate, Delete, Paste at playhead and Deselect. An unselected target becomes selected; right-clicking an existing group member retains the group. Right-click empty track space for paste at the current playhead. The menu uses the existing validated commands/history and disables destructive operations on locked tracks. It supports arrow/Home/End navigation, Escape, outside-click/scroll dismissal and viewport clamping. The portaled menu has opaque theme-color fallbacks, wraps labels/shortcuts on narrow screens and scrolls internally on short screens. It refits on window/visual-viewport resize; all six actions remain reachable. No document schema or dependency changed.

The Electron timeline regression covers split then immediate Delete, single-segment selection, context-menu deletion, lock-aware options, bounds and Escape. Selection/context events are injected for deterministic UI checks; existing captured move/trim gestures still use Electron input events.
