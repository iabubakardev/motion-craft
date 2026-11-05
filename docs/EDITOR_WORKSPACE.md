# Editor workspace (Phases 2.2 and 3)

## Implemented behavior

The home route loads a compact desktop workspace with toolbar, Media/Scenes/Audio sidebar, source monitor, properties inspector and project timeline. Existing media IPC, streaming, decoding, import errors, search, filters and duplicate handling are reused. Tabs do not unmount the media hook or library panel. The Audio tab filters imported audio; it does not provide a separate music catalog. Scenes supports add, rename, duplicate, confirmed delete, reorder, duration/narration/style edits and active selection.

The source monitor fits the selected image, video or audio into a 16:9 viewport without stretching the source. Play/pause, source seeking, mute, time/duration, resolution and fullscreen are functional. Selection changes stop previous playback. This is original-source preview, not composition playback. Unknown duration is displayed as `--:--`; codec support remains dependent on Chromium.

The inspector shows source metadata, project settings, scene fields or selected layer fields. Layer position, scale, rotation, opacity, timing and text edit project data; composition rendering is not implemented. Media, text, shape and caption layers can be added through the inspector. Undo/redo and save indicators use project history/checkpoints. Project settings edit the real document; video Export remains disabled while JSON export is functional.

## Layout and state

Desktop layout defaults to a 300px sidebar, 260px inspector and 240px timeline. Bounds are 200-480px for the sidebar, 220-420px for the inspector and 160-480px for the timeline, additionally constrained to retain at least 320px for the source monitor and 240px above the timeline. The existing Electron minimum window remains 1100 x 700.

Each divider supports dragging with pointer capture, arrow-key resizing (10px, Shift for 50px), Home/double-click reset and End to maximize within current bounds. A toolbar action resets all dimensions. ResizeObserver updates constraints on window changes; no global pointer listeners are used. Below 980px browser width, panels stack and dividers are hidden. Below 600px, the sidebar and source monitor also stack vertically.

Only `{ version: 1, left, right, bottom }` is saved under `motioncraft.workspace-layout.v1` in localStorage. Invalid or unavailable storage falls back to defaults. No paths, assets, project data or media selection are saved in browser state. Layout preferences hydrate after the first render, keeping server/client markup consistent.

`useEditorState` combines the single media-session hook with an editor reducer. The media hook owns the selected ID; reducer state owns sidebar tab, source preview status and panel preferences. A separate per-workspace Zustand store owns timeline zoom, frame playhead, selection, viewport, clipboard and active drag. Project data/history are owned separately by `useProjectDocument`. Child panels receive explicit props. Phase 4 adds Zustand for selectively subscribed timeline state; resize controls still use native pointer events.

## Shortcuts

| Shortcut              | Behavior                                               |
| --------------------- | ------------------------------------------------------ |
| Space                 | Toggle the selected playable source                    |
| Escape                | Exit fullscreen first, otherwise clear media selection |
| Ctrl+O                | Open the existing native media importer when available |
| Ctrl+S                | Save the current desktop project                       |
| Ctrl+Z / Ctrl+Shift+Z | Undo/redo project edits outside text inputs            |

Text inputs, selects and editable content are protected. Space also leaves focused buttons, tabs and sliders to their own keyboard behavior. A modal settings dialog receives its own keys. Repeat/composition events are ignored. Window keyboard, document fullscreen and resize-observer listeners have explicit cleanup.

Electron permissions allow fullscreen only for trusted main frames in owned app windows. Other permissions remain denied; no new IPC or unrestricted native access was introduced. See the [Electron session permission API](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler).

## Timeline scope

The timeline edits actual project tracks and clips using integer-frame commands: media placement, move/trim/split, multi-selection, copy/paste/delete and snapping. The empty ruler covers two minutes; nonempty timelines use project/viewport extent, zoom/fit and an independent frame playhead. Visible horizontal clip ranges are rendered. See [Timeline](TIMELINE.md) for shortcuts, overlap/scene policies, persisted controls and limitations. Keyframes and composition playback remain pending.

## Verification

```bash
npm run lint
npm run typecheck
npm test
```

With `npm run dev` already running and `ELECTRON_RUN_AS_NODE` cleared:

```bash
npm run test:desktop
npm run test:media
```

The media integration test now covers actual Electron/React workspace interactions as well as the original media regression suite. It generates temporary PNG/WAV/WebM fixtures; only native dialog results are stubbed. It exercises tabs, contextual inspection, playback shortcuts, text-input protection, Ctrl+O cancellation, all three pointer dividers, keyboard/double-click reset, saved layout hydration, minimum 1100 x 700 desktop size, zoom/scroll/marker, project settings, disabled controls and fullscreen/Escape. Console hydration/runtime errors are checked. Layout preferences are restored after the test. A capture is saved to `.next/media-library-smoke.png`.

Pure unit tests cover dimension constraints, strict persisted-layout validation, reducer immutability, independent preview/timeline clocks and shortcut guards. Security tests additionally cover the narrow fullscreen exception and rejection of other permissions/origins/subframes.

Verified on 2026-11-04: lint and TypeScript passed, the then-current 15 unit/security tests passed, the original desktop preload/sandbox smoke passed, and the expanded media/workspace integration suite passed including 820px/520px browser layouts. No hydration errors were captured. The desktop smoke logged Chromium GPU messages after its successful assertions; no production build or packaged installer verification is claimed.

Manual checks remain for the actual Windows picker, representative codecs, high-DPI/multiple-monitor dragging and extended editing sessions. Project saving, scenes/layers, JSON exchange and history are implemented in Phase 3. The Phase 4 editing slice is implemented; advanced ripple/scene transfer, composition playback and video export remain future work. See [Project format and Phase 3 verification](PROJECT_FORMAT.md).

## Changed modules

- Added `components/ui/panel-resize-handle.tsx`.
- Added `features/editor/{types.ts, layout.cjs, editor-state.cjs, editor-state.test.cjs, use-editor-state.ts, use-editor-shortcuts.ts, editor-workspace.tsx, editor-toolbar.tsx, editor-icon.tsx, media-sidebar.tsx, project-settings.tsx}`.
- Added `features/preview/preview-monitor.tsx`, `features/inspector/properties-inspector.tsx`, `features/scenes/scene-panel.tsx`.
- Added `features/timeline/{timeline-panel.tsx, timeline-ruler.tsx, track-header.tsx}`.
- Updated `features/media/{media-library.tsx, media-items.tsx, media-preview.tsx, use-media-library.ts}` to reuse session state and source rendering in panels.
- Updated `app/{page.tsx, layout.tsx, globals.css}`, `electron/{main.cjs, security.cjs, security.test.cjs, media-smoke.cjs}`, `package.json`, README and project documentation.

## Phase 5 monitors and export

Source preserves the original media controls. Timeline above the monitor opens the shared Remotion Player, synchronized directly with the frame playhead. Space controls the active monitor. Export now opens native MP4 destination selection, real job progress and cancellation. See [Rendering](RENDERING.md) for the tested pipeline and remaining production/codec limits.

## Workspace stabilization

Timeline is now the default monitor. Source inspection is explicit and unlinked; using the timeline switches back to composition preview. Monitor mode and project-playback status live in the existing transient Zustand store. A callback-ref Player bridge handles late mounting, direct seeking and frame publication. Playback moves the visible marker; out-of-range authoring cursors are preserved.

File commands share the main toolbar. Editing and track actions use accessible SVG icons, and the canvas has its own transport beneath a fitted artboard. Focus canvas temporarily hides side panels and reduces timeline height to 160px without changing saved dimensions. New content auto-fits the timeline; subsequent edits retain manual zoom. See [research and verification](WORKSPACE_REVIEW.md).
