# Phase 6 animation working slice

Phase 6 is **in progress**, not accepted as a complete milestone. This slice implements keyframes and presets. Transitions, expanded typography and animated captions remain follow-up work. It adds no dependency, backend, AI service or native capability.

## Use

Select a visual timeline clip or scene layer. The inspector's Animation section adds a keyframe for the selected property at the playhead. Frames are zero-based and local to the clip. Each key has editable frame, value, outgoing easing and optional cubic Bezier controls. Before the first key and after the last, the endpoint value holds; properties without keys use the layer's base transform (standalone media defaults to identity). Animated properties override their corresponding base transform.

Selected timeline clips show diamond markers grouped by local frame. Click to seek; drag to move the group, or focus it and use Left/Right. Marker movement commits once on release; Escape, pointer cancellation and loss of capture discard the draft. Inspector buttons jump to previous/next key. Track locks prevent animation changes. Conflicting keys on the same property/frame reject atomically.

Presets are fade-in/out, slide-left/right/up/down, zoom-in/out, pan, pop-in and documentary-zoom. Set their duration in frames. Applying a preset explicitly replaces that clip's keys; Undo restores the previous keys. Presets create normal editable keys. Convert removes preset provenance without changing the motion. Manual key edits also remove provenance. Clear removes animation and returns to base transforms.

## Data and rendering

Schema v3 adds `animations`, keyed by existing clip ID. Both standalone and scene-derived clips use the same representation. Each entry has `keyframes` and optional preset provenance. Keyframes have a UUID, property (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`), integer local frame, bounded numeric value and outgoing easing (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `bezier`). Bezier controls are bounded to 0–1; overshoot curves are not supported. IDs are unique across animation keys. Dangling references, out-of-range frames, visual animation on audio tracks and duplicate property/frame pairs are rejected by the shared document schema.

Strict v1/v2 inputs migrate to v3 before reviewed replacement and become dirty until saved. IDs, timing and manual properties remain intact. Legacy fade-in/slide-up fields become deterministic linear keyframes, including the previously visible last-frame value. The old layer `animation` field remains for Phase 3 data compatibility; v3 rendering consumes the canonical map only. Do not edit legacy fields to author v3 motion. Legacy scene transition fields remain reserved and do not render transitions.

`core/animation/engine.cjs` evaluates curves without React, DOM, Electron or Remotion. The shared composition calls it using the clip-local Remotion frame. Preview and export have one animation path, with no CSS transitions, timers or random render state. Audio timing is unchanged. Standalone Remotion imports use relative paths because its bundle does not inherit Next.js aliases.

Timeline moves preserve local keys; trims and splits crop/rebase curves, using subdivided cubic curves to preserve surviving samples. Duplication/paste and scene duplication create new key IDs. Clipboard snapshots retain motion; deleting clips/layers/scenes removes owned motion. Direct layer duration edits that would strand a key reject instead of silently discarding keys; use timeline trim for curve cropping. FPS edits retain local frame indices and reject if they would invalidate the document. Existing same-track overlap prevention remains unchanged.

## Verification and acceptance

`npm run check` includes animation evaluation, strict validation, migration, nonlinear cropping, preset generation, timeline ownership, lock, history and JSON round-trip tests. `npm run test:animation` runs a real Electron Player, keyframe editing with injected keyboard/pointer events, one-step undo/redo native animation save/open, and local H.264 export. Four frames (0, 15, 30, 59) compare preview screenshot pixels against decoded MP4 pixels with codec tolerance. Native output selection is substituted. Import [the sample](../public/animation-sample.motioncraft.json) for manual review.

| Acceptance item                              | Status                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Position, scale, rotation, opacity keyframes | Verified in core and real preview                                                   |
| Easing in preview                            | Verified; deterministic linear/named/Bezier evaluation                              |
| Timeline keyframe editing                    | Implemented and handler/undo tested; physical capture/high-DPI manual check pending |
| Fade, slide, zoom, pan presets               | Verified generated keys; all use the shared evaluator                               |
| Compatible clip transitions                  | Not implemented                                                                     |
| Expanded text styling                        | Not implemented; existing basic text remains                                        |
| Manual caption workflow                      | Existing caption layers remain; dedicated timed-caption workflow not completed      |
| Animated caption presets                     | Not implemented                                                                     |
| Animation undo/redo and save/open            | Verified history, strict JSON round trip and native animation save/open             |
| MP4 matches preview                          | Verified for the animation sample; transitions/captions have no parity claim        |

Five items have their implemented animation behavior verified; full ten-item acceptance remains open. Physical mouse capture and high-DPI behavior need manual testing: the automated drag sequence substitutes capture to avoid interference from the user's physical mouse. The parity fixture is generated graphics, not a broad codec/font/media suite. Large-key-count performance, production packaging and existing release/security gates remain open.

Recommended next slice: explicit compatible-clip transition semantics and shared preview/export transition tests, followed by typography and manual/animated captions. Preserve canonical saved clip timing and overlap protections.

Final checks: lint, Next route type generation, TypeScript, 66 unit tests, production build and native project/timeline/render/animation suites passed. The latest animation MP4 and pixel report were generated under `.next/animation-smoke-70aRTv/` (ignored test artifacts). The project integration test was made independent of native focus by dispatching its blur event explicitly and waiting for dirty state before saving.
