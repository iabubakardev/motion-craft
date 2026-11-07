# Caption editor (Phase 7.4)

## Audit and reuse

Reviewed transcription, strict project JSON, original Whisper words, generated Captions tracks, timeline frame commands, track flags, snapshot history, Player synchronization, native save/open and the shared Remotion/MP4 composition already existed. This phase extends those paths. It introduces no second timeline store, Python changes, paid service or dependency. Checked CommonJS contracts/domain helpers are shared with the existing Electron acceptance tests and Node test runner; React/editor controls use strict TypeScript.

## Workflow

1. Use Transcribe, Choose audio file, Start transcription, and Generate Captions after review. Corrected transcript segments intentionally have no word alignment; original words remain archived. Alternatively use Properties > Captions > Import SRT / VTT. Imported markup remains literal text and cannot execute HTML.
2. Select captions in the timeline (Ctrl/Shift for multiple) or click/tab to a caption in the preview. Captions are ordinary scene-owned layers with derived clips on the existing timeline.
3. In Captions choose Documentary, Bold Impact, Karaoke Highlight, Rounded Box, Cinematic or Word Pop. Apply to this caption, selected captions or the entire caption track. Presets replace visual style while retaining geometry, text and word timing. Later individual changes override only the requested fields and targets.
4. Drag to position; use the corner handle for width and the top handle for rotation. Arrow keys nudge by .001 of the canvas; Shift+arrow uses .01. Snapping follows the existing timeline Snap toggle, with center and 5%/95% guide positions. Safe-area/alignment guides can be hidden. Numeric geometry uses normalized center X/Y and width (0-1), with rotation in degrees. Reset, position locking and horizontal/vertical alignment are available. Each completed gesture is one history entry; Escape, pointer cancel and lost capture discard its preview.
5. Typography/appearance includes local font family, normalized font size, weight, color, alignment, case, letter spacing, line height, maximum lines, outline, shadow, background opacity/padding/radius, and overall opacity. Font/outline/padding/spacing measures are stored as fractions of composition height so they follow resolution changes; inspector inputs show pixels at the current resolution.
6. Select none/fade/pop/slide/bounce/reveal/karaoke animation, duration and easing. Aligned words support active/inactive colors, active scale, individual color/bold/scale overrides and timestamp seeking. The active word uses the current composition frame, including a fractional-start correction; gaps have no active word.
7. Edit caption text and start/end seconds in the inspector, or use existing frame-based timeline move/trim/split controls. Split at playhead and Merge selected are available. Splits crop local word alignment and divide aligned text; manual captions without alignment retain their text on both halves for explicit editing. Merging preserves the first caption's style and identity. Regroup uses remaining aligned words and configurable word count, lines, characters per line, duration and pause limits. One-word mode creates one clip per word; use short word groups with Word Pop. Impossible individual-word limits report an error rather than inventing alignment. Selected captions are replaced atomically; unrelated captions/manual layers remain intact.
8. Save/reopen normally. Export MP4 uses exactly the same caption component as Player. Export SRT/VTT uses current caption clip timing/text, independently of visual style. Imported cues are quantized to the existing project frame grid.

## Data and architecture

Project schema v4 accepts an optional, strict, version-1 `caption` extension on caption-layer properties. Existing v1-v4 documents retain their established migration/validation path and old captions remain editable. Older application builds reject the new extension rather than silently removing it; open/save styled projects with this build. `properties.text` remains the editable caption text. The extension owns normalized geometry, resolved style, preset identity and clip-local word alignment. Legacy font/transform fields remain for compatibility; they are not a second editable caption style.

`core/captions/schema.cjs` validates every persisted field; unknown keys, URLs as fonts, invalid ranges and unordered words reject. `presets.cjs` resolves six reusable styles and old captions. `engine.cjs` owns grouping, frame evaluation and artboard/resize coordinate math. `commands.cjs` implements immutable, bounded import/style/position/text/word/merge/regroup operations through existing document history and track locks. Regroup/merge retain affected transcript caption references. Original transcript timing/text are never rewritten by visual edits.

`core/transcription/commands.cjs` copies reviewed word alignment into generated captions. Timeline moves retain local clocks, while trims and splits crop/rebase their visible word ranges. Split text follows aligned words; the archived original transcript is preserved. `rendering/caption-content.tsx` handles wrapping, maximum-line clamping, Unicode text, local font fallback and deterministic animation. `ProjectComposition` waits for browser font readiness. Font choices use installed Arial/Georgia/Impact/monospace with generic fallback; no network font download is required.

`features/captions` provides inspector and a canvas overlay inside the actual artboard. Its bounding client rectangle includes preview scale, letterboxing and browser layout. Live gesture preview is transient Player input, rendered through the same caption component. Pointer release executes one domain command guarded by the starting project reference. Existing timeline selection and a guides flag in the existing Zustand store remain the selection/interaction owners. Preview controls and guides are absent from encoded output.

Frame subscriptions are limited to the canvas overlay/Player. The inspector does not subscribe to playback frames. Caption intervals are indexed on document changes with per-track binary search and prefix end bounds; only active overlays are drawn at a frame. No complete transcript grouping occurs during playback. Existing timeline viewport culling remains in use. Projects retain the 5 MB document cap, 10,000 clips per track, and now 10,000 layers per scene to accommodate large caption sets; excessive imports fail atomically.

## Verification and limits

Run `npm run check`, scoped Prettier, `npm run test:captions` and the existing optional real-worker `npm run test:transcription`. The caption domain suite covers six presets, overrides, normalized geometry, locks, gesture history, word/frame timing, regrouping, source preservation, move/trim/split/merge, subtitle parsing/round trips, persistence, resize axes/scaling and a 1,200-caption document. The native caption acceptance exercises keyboard focus/nudges, live drag, one-step undo/redo, preset changes, karaoke, UI subtitle import/export, native save/reopen, and representative preview/decoded MP4 frames for all six presets. Test PNGs/MP4 are isolated under ignored `.next/captions-smoke-*`.

Manual acceptance: import audio, generate/review captions, select each preset, physically drag/resize/rotate at different window sizes and display scaling, change appearance and word emphasis, regroup selected clips, trim/split/merge, toggle track visibility/locks, save/reopen, then compare playback with exported MP4 and SRT/VTT in another player. Verify long Unicode recordings and portrait canvases with representative fonts.

Remaining boundaries:

- Native dialogs and pointer capture are substituted in automation; real high-DPI/touch/multi-monitor gestures require manual verification. No claim of full CapCut/Descript feature parity.
- Merge requires captions in one canonical scene and one track. Imports/generation/regroup split at scene boundaries; caption moves must respect existing scene ownership. Adjacent scene fragments export as separate subtitle cues.
- Existing generic transform keyframes render, but canvas dragging asks users to remove those keys first; this editor changes normalized caption geometry, not animation curves. Use the Animation inspector for keyed transforms.
- Text corrections clear only the visual word alignment; regroup/karaoke cannot invent new timings. Trimmed-away visual word ranges are recoverable by undo or the archived transcript, not by extending a trimmed clip.
- SRT/VTT cue text/timing is supported; VTT regions/styles/position settings and SRT HTML formatting are not preserved as rich styling. Same-track overlaps reject. Subtitle export includes caption tracks regardless of preview visibility.
- Font fallback can vary across computers. Custom font file bundling, fractional project FPS, project-wide ripple edits, packaged offline runtime and thousands-of-clips interactive profiling remain separate work. Current project FPS remains 24/25/30/50/60.
- Maximum lines deliberately clamp displayed text. Use regrouping/splitting or increase line count/width/font settings for long captions. Word-level layout uses the reviewed words; no forced alignment is performed.

Recommended next editor phase: packaged local font/runtime support and measured long-form editing/performance, followed by controlled cross-scene/ripple workflows.

## Changed files

- `core/captions/{schema,presets,engine,commands,subtitles,captions.test}.cjs`
- `core/project/{schema,operations}.cjs`, `core/transcription/commands.cjs`, `core/timeline/commands.cjs`
- `features/captions/{caption-canvas,caption-inspector}.tsx`
- `features/projects/use-project-document.ts`, `features/inspector/properties-inspector.tsx`
- `features/preview/composition-monitor.tsx`, `features/editor/editor-workspace.tsx`
- `features/timeline/{interaction-types.ts,interaction-store.cjs}`
- `rendering/{caption-content.tsx,caption-sample.cjs,project-composition.tsx,input.cjs}`
- `electron/captions-smoke.cjs`, `package.json`
- `README.md`, `docs/{CAPTIONS,PROJECT_FORMAT,ARCHITECTURE,ROADMAP,PROJECT_CONTEXT,DECISIONS,ENGINEERING_AUDIT}.md`

## Executed verification (2026-11-07)

- `npm run check`: lint and strict generated-route TypeScript pass; all 122 unit/security/lifecycle tests pass. One pre-existing unused-variable warning remains in workers/asset-index.cjs.
- Scoped `npm run format:check` passes; `git diff --check` passes.
- `npm run build` passed production compilation, TypeScript and static prerendering.
- Real external tiny/CPU/int8 transcription acceptance passed review, seeking, caption generation/history, native persistence and cancellation.
- Existing native project, timeline and animation suites passed, including encoded animation pixels and saved-project migration.
- `npm run test:captions` passed live drag/resize/rotation, position lock/cancel, nudge, atomic undo/redo, inspector presets, frame-based karaoke, SRT/VTT UI export, SRT import/undo, native save/reopen and representative decoded MP4/preview glyph-position and pixel checks for all six presets. Representative rendered images were visually inspected.
- No physical Windows picker/high-DPI gesture, packaged-build, custom-font distribution or long-project playback benchmark is claimed. The 1,200-caption test verifies bounded model/edit/render mapping, not interactive playback performance.

## Caption workflow discovery follow-up

Audio timeline clips now expose Generate captions on right-click. The review panel opens with that audio selected; generation maps reviewed speech only from the clip's trimmed source range to its project placement, preserving original transcript timing. The existing toolbar remains a full-source flow. Missing sources remain disabled and project/clip changes during review are rejected.

Properties now starts with Caption editing, an always-visible six-card Caption templates gallery, and the Generate/import > template > select/edit flow. Cards are disabled before captions exist. With no selection, the visible hint explains that a template applies to all captions; applying it selects the first caption and opens its editing controls. Existing single/selection/track styling scope is retained.

Verification: full checks pass 123 tests, including a trimmed-source placement regression. Native transcription acceptance verifies the audio context action and selected source; caption acceptance uses the visible template gallery and verifies MP4/preview parity; the timeline context-menu suite remains passing. Native pickers/pointer limitations above still apply.

Templates and Edit captions buttons keep the two caption workflows visible at the top of Properties. Applying a template switches directly to the editor so the gallery does not push text/timing controls out of view.

## Spoken captions, global templates and backgrounds

New caption styles default to short spoken phrases (at most five aligned words, split at punctuation and long pauses), selected from the current composition frame. Playback text in Edit captions also offers Only the spoken word and Full caption text. Pauses show no aligned words in spoken modes; unaligned/edited subtitle text retains the full-text fallback. Page boundaries are precomputed by composition mapping rather than regrouping the transcript every frame. Optional style.displayMode preserves older project compatibility; changing presets retains an explicitly chosen display mode.

Template scope defaults to all generated captions, using persisted transcript caption references; with imported subtitles only, it targets all captions. The selected/one/track options remain available for overrides. Unrelated manual captions are excluded from the generated set when that set exists.

The timeline starts in compact mode: occupied tracks, the active track and a spare visual/audio row remain available. Show all tracks restores all rows; this is a view choice and does not delete tracks or content. + Visual and + Audio add undoable tracks up to the existing 64-track limit. Every visual track accepts images, video, text and captions; audio remains on audio tracks for its existing playback controls and validation. Same-track overlap and canonical scene ownership remain enforced.

Select an image/video in the media library and use Set image/video as background in Properties, or right-click a visual clip and choose Set as background. One atomic command replaces the dedicated bottom Background track, preserves other layers/captions/narration, uses cover fit, and mutes video by default. Images cover the project duration (five seconds for an empty project); videos stop at their available source duration instead of looping. Replacing a background clears that background's old transform keys. Locked background tracks reject replacement. Native MP4 export and JSON save/reopen use the same fit and source timing.

Added core/project/background.cjs and electron/background-smoke.cjs (`npm run test:background`). Regression coverage includes background stacking, duration/fit/mute, history/round trips, new tracks, spoken-word windows, global preset application and rendered background pixels. No new dependency, service, Python change or unrestricted filesystem capability was introduced.

Spoken/background follow-up verification: `npm run check` passes all 127 tests, lint (one pre-existing unused-variable warning) and strict TypeScript. Scoped formatting and diff checks pass. Native caption acceptance verifies all-caption template application and current-word rendering, with six-preset preview/MP4 comparisons. Timeline acceptance passes compact-row/menu regressions. Native background acceptance passes actual image/video UI placement, muted cover fit, visual/audio track creation, undo/redo, encoded video/tail pixels, and project save/reopen. Native input remains substituted as described above; no new long-form performance or packaged-runtime claim is made.

## Caption selection and deletion

Timeline clips remain individually selectable. Drag empty track space to draw a selection rectangle; enable Box select to begin the rectangle directly over clips. Shift/Ctrl/Meta-drag adds to the current selection. The rectangle intersects clip geometry across rows, accounts for timeline scrolling/zoom and includes virtualized clip intervals; edge dragging scrolls the viewport. Escape, pointer cancel and capture loss restore the previous selection. Turn Box select off to return to dragging clips for movement.

Select captions selects all caption clips. Delete selected shows the selected count, uses the existing atomic DeleteClips command, and is disabled when a selected track is locked. Delete/Backspace and right-click Delete remain available. Deleting captions also prunes transcript caption references through the existing document rebuild; Undo restores the full edit. Selection gestures are transient and do not create history entries. The validated command ID limit is now 10,000 so large caption deletions fit the existing per-track bound; clipboard item limits are unchanged.

Changed selection files: features/timeline/{use-box-selection.ts,selection.cjs,selection.test.cjs,timeline-panel.tsx}, core/timeline/commands.cjs, core/captions/captions.test.cjs, electron/captions-smoke.cjs and package.json. Full checks pass 130 tests (one pre-existing unused-variable lint warning). Native caption acceptance covers Select captions, a three-caption pointer rectangle, delete/undo and Escape restore; the existing timeline gesture/context-menu suite passes. Pointer capture is substituted in the injected rectangle test; physical high-DPI drag testing remains a manual check.
