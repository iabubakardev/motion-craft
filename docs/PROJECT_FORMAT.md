# Project JSON format and timing (schemaVersion 4; v1/v2/v3 migration supported)

The project document is the source of truth for editing data. React UI state, playback status, native file paths and runtime media URLs are separate. The same strict Zod schemas validate renderer imports and Electron file operations; TypeScript types are inferred from those schemas.

## Format

See the complete [sample project](../public/sample-project.motioncraft.json). It remains a v1 migration fixture. Its image is intentionally unavailable until relinked; media bytes are never embedded. New exports/save files use v4. See [Animation](ANIMATION.md) for the canonical animation map and migration semantics.

| Entity  | Fields                                                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project | `schemaVersion`, `id`, `name`, `createdAt`, `updatedAt`, `resolution`, `fps`, `aspectRatio`, `duration`, `stylePreset`, `assets`, `scenes`, `tracks`, `settings`, `animations`, `transcripts` |
| Scene   | `id`, `name`, `start`, `duration`, `narration`, `stylePreset`, `layers`, `transitionIn`, `transitionOut`, `metadata`                                                                          |
| Layer   | `id`, `type`, media-only `assetId`, `trackId`, `start`, `duration`, `position`, `scale`, `rotation`, `opacity`, `zIndex`, `animation`, typed `properties`                                     |
| Track   | `id`, `name`, `type`, `order`, `visible`, `muted`, `locked`, `height`, `clips`                                                                                                                |
| Clip    | `id`, exactly one of `assetId`/`layerId`, `trackId`, `start`, `duration`, `sourceStart`, `sourceEnd`                                                                                          |
| Asset   | `id`, basename `filename`, `type`, `mimeType`, `size`, `importedAt`, optional `duration`, `width`, `height`                                                                                   |

IDs are UUIDs. Scene/layer duplication creates new scene and layer IDs while retaining asset references and manual content. Asset/scene/track IDs are unique within their collection; layer IDs are unique across scenes. Derived clip IDs deliberately equal their layer IDs in a separate entity namespace.

Layer types are `image`, `video`, `audio`, `text`, `shape`, `caption`. Media layers require a compatible declared asset. Image properties contain `fit`; playable properties contain `sourceStart`, `volume`, `muted`; text/caption properties contain plain `text`, `fontSize`, `fontFamily`, `color`; shape properties contain `shape`, `fill`, `stroke`, `strokeWidth`. No arbitrary HTML, CSS, URLs, scripts or commands are accepted as property fields. Text is rendered by React as text, never executed.

Supported style identifiers are `default`, `minimal`, `cinematic`, `bold`. Legacy layer animation fields accept `none`, `fade-in`, `slide-up`; v3 motion uses `animations[clipId]` keyframes and preset provenance. Transitions are `none`, `cut`, `fade`, with bounded durations. These are validated project data; there is no Remotion/composition renderer yet. Settings contain `backgroundColor`, `audioSampleRate` (44100/48000), and `snapToFrames` (reserved preference, not an active editing tool). Scene metadata contains plain notes and tags.

## Timing and canonical ownership

All times are finite seconds. Duration is positive for scenes/layers/clips; an empty project has duration zero. Intervals are half-open `[start, start + duration)`. Comparisons use a one-microsecond tolerance; known media source bounds allow a one-millisecond decoder tolerance. Data may use fractional seconds; FPS does not silently round imported timing.

| Timing                                        | Meaning / owner                                                     |
| --------------------------------------------- | ------------------------------------------------------------------- |
| Scene `start`                                 | Timeline-global, derived from preceding scenes in array order       |
| Scene `duration`                              | Canonical scene length                                              |
| Layer `start`                                 | Relative to the containing scene                                    |
| Layer `duration`                              | Canonical layer length, contained within its scene                  |
| Layer playable `properties.sourceStart`       | Offset into the original source                                     |
| Layer-linked clip `start`                     | Derived as `scene.start + layer.start`                              |
| Layer-linked clip duration/track/source range | Derived from its layer; exactly one clip per layer                  |
| Standalone asset clip timing                  | Canonical global placement in its track, independent of scene order |
| Project `duration`                            | Maximum of scene-sequence length and standalone clip ends           |

For example, a scene starting at 5 seconds with a layer at scene-relative 1 second produces a clip at global 6 seconds. If its duration is 3 and sourceStart is 2, sourceEnd is 5. No playback speed changes are supported, so `sourceEnd - sourceStart === duration`.

Scenes are contiguous and ordered by their array. Reorder/delete/duration operations recompute scene starts, derived clips and project duration atomically. Standalone asset clips imported in JSON retain their own global positions. They can be placed, moved, trimmed, split and copied in the timeline. The schema continues to accept existing/imported overlaps to preserve legacy documents; new timeline commands reject same-track overlaps (adjacency is allowed). Existing scene-layer operations retain their composition semantics and can create overlaps. New layers prefer unused unlocked compatible tracks within their scene. Track locks also guard scene/layer commits that would change locked content.

Derived clips are serialized for interchange, but cannot disagree with their canonical layer. Conflicting global/relative timing, duplicate clips or missing derived clips cause validation errors rather than normalization. Shortening a scene that would cut off a layer is rejected, preserving the original document. Transitions do not overlap or alter sequence timing in v1.

## Validation and import

Schema versions 1, 2, 3 and 4 are accepted. Versions 1, 2 and 3 first pass their original strict structural and relational validation, then migrate to v4 for explicit review. IDs, exact seconds, source references and manual properties are preserved. Migration adds visible=true, muted=false, locked=false and height=36 to tracks, and changes non-playable clip source endpoints to null. A migrated open/import is dirty until saved as v4. Unknown fields/versions are rejected. Version 4 exports require an application that supports persisted transcripts and the animation map. Every object is strict, so unsupported fields are reported rather than dropped. Validation checks references, media/track compatibility, unique IDs/orders, durations, source ranges, scene containment and derived timing. Resolution is 64-8192 pixels per axis; FPS supports 24/25/30/50/60; aspect ratios are 16:9, 9:16, 1:1 and 4:3 and must match the resolution. Timing is limited to 24 hours. Project JSON is limited to 5 MB, including exported formatted JSON.

The UI accepts pasted JSON or an uploaded file, displays path-specific errors, and presents a summary before replacement. Open uses the same validation and review step. Cancel keeps the current project and save destination. Confirmation explicitly warns about unsaved changes and resets history. Browser JSON import/export works without Electron; declared local media is unavailable there.

## Desktop persistence and media authorization

Save/Save as use native dialogs to write `.motioncraft.json`. Renderer code cannot supply arbitrary read/write paths. Project JSON contains only the safe document above, not local paths, media bytes, executable data or session URLs.

Electron stores approved bindings separately in:

```text
app.getPath('userData')/project-media/<projectId>.media.json
```

This trusted, per-user catalog records native-selected canonical paths and file identity. It is never imported from a project file or exposed to React. Opening resolves only already-approved bindings or media currently approved in the running session. It does not scan directories or interpret imported filenames as paths. Copying a project to another machine, clearing app data, or moving/modifying originals may require relinking.

Missing media stays declared with its stable ID and an unavailable preview. Select it in Media, then use **Relink media** in Properties. A native dialog authorizes a compatible replacement; asset IDs and layer references remain stable. If replacement metadata conflicts with an existing source range, validation reports it rather than trimming manual edits. Undeclared asset references are schema errors; a declared asset without a local binding is a valid missing-media case.

Writes use a sibling temporary file, file sync and rename. The trusted catalog is updated before the project file and retains previous approved bindings, so a failed write does not invalidate an older saved project. The catalog and project are not a cross-file filesystem transaction. Save errors leave the active document dirty. An existing unreadable/corrupt local media catalog blocks saving and is preserved; opening the portable project can still proceed with unavailable media. No autosave, crash recovery, project bundling or media copying is implemented.

Native open stages an opaque candidate; only confirmed activation changes the current save target. Input/output schemas and owning-window/main-frame/origin checks protect all project IPC. Reload invalidates staged operations and clears the previous save destination. Dirty documents install a beforeunload handler; Electron asks whether to keep editing or discard before reload/close. OS termination or a crash cannot be protected by this prompt.

## History and UI

History keeps up to 50 immutable past document snapshots. Scene/layer/project-settings commands are undoable; a new edit clears redo. Tab selection, active layer, resizing, playback and timeline marker changes do not enter document history. Imported/opened projects start with empty history; imported JSON is unsaved, while native-opened files start clean. Dirty status compares the current serialized document with the saved snapshot, including correct undo/redo behavior around a save checkpoint.

Media imports/metadata enrich the document and all history snapshots without creating scene-history entries. Metadata completion can make a saved snapshot dirty; save again to persist it. Replacing a document aborts pending metadata probes and ignores stale generations. Neither probe results nor pending native operations may overwrite a replacement document.

Scenes and layer controls edit real data, and the timeline displays its validated projection. The source monitor still plays original files. The Phase 5 Timeline monitor and MP4 worker composite basic transforms, text/shapes/captions, images/video/audio and simple entrance presets. Scene transitions and style presets remain deferred. Source mode still plays originals. Timeline editing is documented in [Timeline](TIMELINE.md).

## Verification and files

```bash
npm run lint
npm run typecheck
npm test
# With npm run dev running and ELECTRON_RUN_AS_NODE cleared:
npm run test:desktop
npm run test:media
npm run test:projects
```

Unit tests cover schema failures, unsafe fields, invalid JSON/versions, references, scene/layer operations, timing, JSON round trips, snapshot history, save/open, missing bindings, relinking, failed writes, staged activation and save-target protection. The project integration script uses real React, IPC and filesystem operations, with substituted native dialog responses and an isolated `.next` profile. It covers JSON paste and file upload, review/cancel/replace, actual scene/layer editing, save/open, relinking, dirty tracking and canceled reload. Actual Windows dialog interaction and broader codec coverage remain manual checks. No packaged build is claimed.

Added modules:

- `core/project/{schema.cjs, types.ts, operations.cjs, history.cjs, ipc.cjs, project.test.cjs}`.
- `electron/{project-store.cjs, project-store.test.cjs, project-smoke.cjs}` and `electron/ipc/{projects.cjs, projects.test.cjs}`.
- `platform/projects.ts`, `features/projects/{use-project-document.ts, project-actions.tsx, json-import-dialog.tsx}`.
- `components/ui/confirm-dialog.tsx`, `features/inspector/{scene-properties.tsx, layer-properties.tsx}`.
- `public/sample-project.motioncraft.json` and this document.

Updated editor state/toolbar/settings/workspace/sidebar/shortcuts, scene manager, inspector, timeline/ruler, media hook/metadata probes, Electron main/preload/media registry/smoke tests, bridge types, test scripts and project documentation. No dependencies were added.

Next milestone: composition preview driven by this validated scene/layer model, then dedicated timeline editing operations and persistence recovery work.

## Phase 4 timing boundary

Seconds remain the serialized unit in v2. Video/audio source endpoints are numeric and differ by clip duration; image, text, shape and caption source endpoints are both null. Track height is an integer from 28 to 160 pixels. Track order is unique, visibility/mute/lock are required booleans. Clip command inputs are integer project frames; edits have at least one frame. Imported fractional-second placement is preserved until explicitly edited. Moves add an exact frame delta without quantizing legacy durations/source ranges; trim/split edges and inspector start/duration use project frames. See [conversion and ownership rules](TIMELINE.md).

## Schema v4 transcription persistence

V4 adds required `transcripts: []`. Strict v3 validates animation/scene/clip invariants before migration, preserves all existing data and IDs, and initializes the array empty. V1/v2 follow their existing validated migrations first; all migrated documents require review and an explicit v4 save. Each transcript is a separate version-1 record with asset association, safe source fingerprint, original segments, reviewed result/model/execution metadata and caption clip references. Paths and media bytes are excluded. Caption references must resolve to existing caption clips and are pruned on rebuild after deletion. Reviewed text and caption clip text remain independently editable; see [Transcription](TRANSCRIPTION.md).
