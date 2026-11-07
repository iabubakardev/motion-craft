# Workspace usability review - 2026-11-05

Scope: fix the reported preview/timeline disconnect and improve the existing editor before starting another feature milestone. No project-schema, IPC, render-worker or dependency changes were needed in this cleanup.

## Quick research

- [Canva: Create and edit videos](https://www.canva.com/help/creating-and-editing-videos/) describes the timeline as the editing workspace below the canvas, with playback above it. Applied here: a primary project canvas with adjacent transport, and a fitted timeline that makes short clips usable immediately.
- [Adobe: Source and Program monitors](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/about-source-monitor-and-program-monitor.html) distinguishes original-clip inspection from sequence playback. [Adobe's workspace overview](https://helpx.adobe.com/premiere/desktop/get-started/tour-the-workspace/what-are-workspaces.html) also supports switching those views in one panel. Applied here: Timeline is the default editing view; Source remains explicitly independent, and timeline interaction returns to the linked canvas.

These are workflow references, not claims that MotionCraft reproduces either product's complete interface.

## Findings and fixes

| Finding                                                                                                                        | Result                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source mode was the default and its independent clock looked like a broken project preview.                                    | Timeline is now the default. Importing/selecting library media opens Source deliberately; its mode label says it is unlinked. Timeline focus, pointer interactions and timecode entry activate Timeline again.                                                         |
| Player synchronization used a one-shot effect that could run before a deferred Player ref existed.                             | A callback-ref bridge installs listeners/subscriptions when the actual Player mounts and cleans them up on replacement/unmount. Frame publication is guarded against seek feedback.                                                                                    |
| Playback/readout checks did not explicitly test movement of the visible marker after a Source-to-Timeline pointer interaction. | Real Electron input now tests ruler clicks, the actual play/pause button, visible playhead movement and decoded source frames.                                                                                                                                         |
| A paused cursor beyond project end could be pulled back by the Player's clamped frame.                                         | The authoring cursor remains independent of that clamp. The canvas shows an out-of-range state, and Play restarts from the beginning when at/past the end.                                                                                                             |
| Long scrolling could leave the marker outside the viewport.                                                                    | The viewport follows the playhead only when it leaves the visible range; playback does not broadcast per-frame workspace state.                                                                                                                                        |
| Short projects occupied a tiny portion of a large empty timeline.                                                              | New documents and the first inserted content fit to the available width. Later edits retain manual zoom.                                                                                                                                                               |
| Repeated text commands, letter-based track controls and duplicate monitor headings crowded the workspace.                      | File commands are integrated into the main toolbar; timeline editing, snapping, fit, transport and track controls use SVG icons with accessible labels/tooltips. Necessary mode names and filenames remain text. Selection-dependent actions disable when unavailable. |
| The preview did not clearly behave as a fitted artboard.                                                                       | The complete project aspect ratio fits within a neutral canvas stage, with resolution metadata and a separate transport row. Portrait and landscape sizing are verified.                                                                                               |
| Side panels consumed the canvas area even during visual review.                                                                | Focus canvas temporarily hides side panels and compacts the timeline to 160px, without overwriting saved panel dimensions. Restoring returns the previous layout.                                                                                                      |
| Frame updates replaced the timecode input node while typing.                                                                   | A stable input preserves an explicit editing draft until submit/blur.                                                                                                                                                                                                  |

## Verification

- `npm run check`: lint, route generation, strict TypeScript and all **58 tests** pass.
- `npm run build`: production Next.js build passes.
- Electron preload, media, project, timeline and render suites pass. Native picker responses remain substituted.
- Interaction coverage includes empty-to-content Player mounting, automatic Source-to-Timeline activation, actual ruler pointer input, play-button marker movement, canvas focus and full portrait artboard containment at 1100/820/520px widths.
- Existing move/trim/split/history/save/open workflows and real H.264/AAC export still pass. The timeline gesture test explicitly sets its zoom rather than relying on the old default.
- `.next/canvas-workspace-smoke.png` captures the revised workspace. Generated screenshots and test exports are development artifacts and can be cleared by builds.

## Remaining UI priorities

Before adding a large new editing milestone, prioritize hands-on use of this workspace with representative projects:

1. Direct canvas object selection and transform handles, connected to the existing layer commands and history. The current canvas displays transforms but editing remains in the inspector.
2. Context menus and shortcut discovery for clips/tracks, to move less frequent actions out of the permanent toolbar while retaining keyboard access.
3. Actual video thumbnails and audio waveforms with bounded cache ownership; do not draw fake signal data.
4. Inspector simplification for scene, clip and source contexts; avoid presenting overlapping timing controls without a clear owner.
5. Extended high-DPI/multiple-monitor/fullscreen and long-project performance checks. Automated fit tests do not establish every Windows display/codec combination.

These are recorded follow-ups, not newly implemented tools. No new feature milestone was started.

## Files in this cleanup

- `features/preview/`: new `use-timeline-player.ts` and `composition-transport.tsx`; revised `composition-monitor.tsx`.
- `features/editor/`: workspace composition, toolbar and shared SVG icons.
- `features/projects/project-actions.tsx`: compact accessible file commands.
- `features/timeline/`: monitor/playback view state, automatic fit/follow, icon controls and stable timecode editing.
- `app/globals.css`: fitted canvas, transport, focus mode and responsive layout.
- `core/timeline/timeline.test.cjs`, `electron/{media-smoke,timeline-smoke,render-smoke}.cjs`: view-state and interaction regressions.
- README, architecture/workspace/rendering/timeline/roadmap/audit documentation and this review.

Workspace overflow correction: positioned editor/panel containers keep absolutely positioned visually hidden file inputs inside the inspector's scroll boundary. `electron electron/layout-smoke.cjs` verifies no outer document scroll or gap below the footer at 1920x1000, 1280x720, 1100x640 and 150% zoom. Panel scrolling remains available. Lint, strict types and 139 tests pass.
