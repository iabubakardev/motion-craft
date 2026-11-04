# MotionCraft

**A local-first, AI-assisted desktop video editor for Windows.**

> Early development: the workspace and project foundation work; composition playback, AI and video export are not released.

MotionCraft aims to combine hands-on timeline editing with optional AI-assisted scene planning, asset matching and captions. The product is designed to work with your own media, without requiring paid cloud APIs.

## Vision

- Multi-track editing for video, images, narration, music, graphics and captions
- Editable scenes, transitions, timing, animations and overlays
- Import/export structured, versioned scene-plan JSON from external LLMs
- Optional local transcription and scene planning using faster-whisper and Ollama
- Local preview and MP4 rendering using Remotion and FFmpeg
- Multiple visual styles, not limited to any content niche

## Current status

MotionCraft now has a versioned project model, scene/layer editing, JSON import/export, native local save/open, missing-media relinking and undo/redo, integrated with the resizable workspace and original-source preview. The Phase 4 timeline adds media placement, move/trim/split, multi-selection, snapping, track controls and persistent undoable edits. Composition playback, AI and video rendering remain future work.

See [Roadmap](docs/ROADMAP.md) for checked milestones.

## Tech stack

| Layer              | Technology                           | Status                                  |
| ------------------ | ------------------------------------ | --------------------------------------- |
| UI                 | Next.js, React, TypeScript, Tailwind | Foundation                              |
| Desktop shell      | Electron                             | Development verified; packaging pending |
| Composition        | Remotion                             | Planned                                 |
| Processing         | FFmpeg                               | Planned                                 |
| Local AI           | Ollama, faster-whisper               | Planned                                 |
| Persistence / jobs | PostgreSQL, Redis, BullMQ            | Later phases                            |

## Development setup

Prerequisites: Node.js and npm; Windows recommended for desktop testing.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

To launch the Next.js dev server and Electron desktop window together:

```bash
npm run dev:desktop
```

**Note:** This repository does not yet provide a tested packaged Windows installer. `dev:desktop` is a development workflow only.

## Verification

```bash
npm run lint
npm run typecheck
npm test
```

With `npm run dev` already running, use `npm run test:desktop` for a real Electron preload/IPC smoke test. It opens a temporary app window and exits automatically. Use `npm run electron:dev` to open Electron against that existing server, or `npm run dev:desktop` to start both from scratch. Development is fixed to `http://localhost:3000`.

Run `npm run test:media` against that server to exercise media import, image decoding, video/audio playback, search/filter/list interactions, duplicates, cancellation and reload recovery in Electron. It creates and removes temporary fixtures and substitutes native dialog results; interaction with the Windows file picker still requires a manual check. A screenshot is saved to `.next/media-library-smoke.png`.

If your terminal inherits `ELECTRON_RUN_AS_NODE=1`, clear it before launching Electron (PowerShell: `$env:ELECTRON_RUN_AS_NODE = $null`). Otherwise Electron runs as Node instead of opening the desktop app.

Run `npm run test:projects` against the running dev server to exercise real scene/layer UI, JSON paste/upload/export, replacement confirmation, save/open round trips, relinking, history and unsaved-change protection. Native dialog responses are stubbed and project files/profile are isolated under `.next`. A screenshot is saved to `.next/project-workspace-smoke.png`.

The media integration suite also verifies workspace tabs and inspector, keyboard shortcuts and text-input protection, pointer/keyboard resizing, layout persistence, minimum desktop size, timeline zoom/scroll/marker, session settings and fullscreen. See [Workspace behavior and verification](docs/EDITOR_WORKSPACE.md).

## Engineering workflow

Read [Engineering standards](docs/ENGINEERING_STANDARDS.md) for every change; [Engineering audit](docs/ENGINEERING_AUDIT.md) records prioritized follow-up work. Phase 4 timeline editing is implemented as a working vertical slice. See [Timeline editing](docs/TIMELINE.md) for commands, shortcuts, migration and limits.

```bash
npm run check
npm run format -- path/to/changed-file.ts
npm run format:check -- path/to/changed-file.ts
```

`check` runs ESLint, route generation/strict TypeScript and unit tests. Formatting uses pinned Prettier 3.9.10; pass explicit files/directories to avoid unrelated changes. A full formatting baseline (`npm run format:check -- .`) still has legacy debt and is not a clean gate yet. Use `npm ci` for a clean lockfile-based install. LF is configured through Git, EditorConfig and Prettier. No state, form or test-runner migration is required by the standards.

## Architecture

Source directories live at the repository root. Media contracts live in `core/media/`, React UI/state in `features/media/`, desktop adapters in `platform/`, and native selection/streaming in `electron/`. The `@/*` import alias maps to that root.

The UI lives in Next.js, desktop capabilities are exposed via a secure Electron preload bridge, and framework-independent domain logic belongs in `core/`. See [Architecture](docs/ARCHITECTURE.md), [Media import and testing](docs/MEDIA_IMPORT.md), and [Project Context](docs/PROJECT_CONTEXT.md).

## Using the media library

In the Electron window, click **Import media** and select multiple MP4, MOV, WebM, MP3, WAV, PNG, JPG/JPEG, or WebP files. Select a card to preview it, search by filename, or choose a type filter. Video/audio codec support depends on Electron/Chromium; unsupported or corrupted files display an unavailable state.

Imports reference originals without copying them. Duplicate paths retain asset IDs. Save a project to keep its asset descriptors and editing data; desktop path bindings are stored separately in trusted app data. Missing/moved files stay declared and can be relinked while preserving IDs. The browser supports JSON import/export with local media unavailable. No dependencies were added for Phase 3; existing Zod validates project and IPC contracts.

## Using the workspace

- Switch between Media, Scenes and Audio without losing the media session. Add, rename, duplicate, delete, reorder and retime scenes. Deletion asks for confirmation; shortening cannot silently cut off layers.
- Select media to preview it in the 16:9 source monitor and inspect its metadata. Use play/pause, seek, mute or fullscreen. This plays the original source, not a composition.
- Drag the sidebar, inspector or timeline divider, or use arrow keys on a focused divider. Double-click or press Home to reset that divider. Reset workspace layout restores all defaults. Only panel dimensions are stored locally.
- Space toggles a playable source, Escape exits fullscreen or clears selection, and Ctrl+O imports media. Text fields and focused interactive controls retain their keyboard behavior.
- The timeline displays actual scenes and validated layer clips with a marker, scrolling and zoom. Add media/text/shape/caption layers through the inspector. Drag-and-drop, trimming and composition playback are not implemented.
- Project settings, scene narration/style and layer transform/timing/text controls update the project document. Undo/redo covers project edits. Transform data is not composited in the source monitor. The video Export button stays disabled; Export JSON is functional.

## Saving and importing projects

Use Save project / Save as to write `.motioncraft.json` through Electron native dialogs. Open project validates a file and shows a summary before replacement. Import JSON accepts pasted or uploaded schema v1/v2 JSON (v1 is validated and migrated for review) and also requires replacement confirmation; Export JSON downloads the validated, path-free document. Ctrl+S saves and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo outside text inputs. Ctrl+O continues to import media.

Unsaved edits are tracked. New/open/import replacement explicitly warns before discarding them; closing or reloading a dirty desktop document asks whether to keep editing or discard. There is no autosave or crash recovery. Always save before exiting. A reload starts a new unsaved document and clears the previous save target.

See [Project JSON format, timing and persistence](docs/PROJECT_FORMAT.md) and [sample project](public/sample-project.motioncraft.json). The sample deliberately references a missing image so relinking can be tested; no media is embedded. Copying project JSON to another machine requires relinking media because local paths are never included.

## Roadmap

See [Development roadmap](docs/ROADMAP.md). Planned milestones include the editor workspace, versioned JSON schema, media import, timeline editing, rendering, local AI, and packaging.

## Screenshots / demo

`npm run test:media` generates `.next/media-library-smoke.png` from the real workspace using temporary test assets. This is a development verification artifact, not a rendered composition.

## Contributing

The project is in an early architecture phase. Before contributing, read [AGENTS.md](AGENTS.md), [Architecture](docs/ARCHITECTURE.md) and [Decisions](docs/DECISIONS.md). Open an issue to discuss substantial changes before implementing them.

## License

A license has not yet been selected. Until a license is added, do not assume the repository grants open-source reuse rights.

Run `npm run test:timeline` against the dev server for media-to-track placement, real pointer move/trim, one-commit history, split, copy/paste/delete, track flags and native save/new/reopen. Pickers are stubbed; placement uses DOM drag events; clip gestures use Electron mouse input. The screenshot is `.next/timeline-workspace-smoke.png`.

Zustand 5.0.16 is the only Phase 4 dependency: a per-workspace vanilla store keeps high-frequency drag/selection/playhead state outside project snapshots. Native drag-and-drop and pointer events avoid another drag library. `npm run build` verifies the Next.js production bundle; Electron packaging/loading remains unconfigured.
