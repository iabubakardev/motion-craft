# MotionCraft

**A local-first, AI-assisted desktop video editor for Windows.**

> Early development: local timeline preview and MP4 export work in the desktop development app. A packaged Windows release and AI features remain pending.

MotionCraft aims to combine hands-on timeline editing with optional AI-assisted scene planning, asset matching and captions. The product is designed to work with your own media, without requiring paid cloud APIs.

## Vision

- Multi-track editing for video, images, narration, music, graphics and captions
- Editable scenes, transitions, timing, animations and overlays
- Import/export structured, versioned scene-plan JSON from external LLMs
- Optional local transcription and scene planning using faster-whisper and Ollama
- Local preview and MP4 rendering using Remotion and FFmpeg
- Multiple visual styles, not limited to any content niche

## Current status

MotionCraft now has a versioned project model, scene/layer editing, JSON import/export, native local save/open, missing-media relinking and undo/redo, integrated with the resizable workspace and original-source preview. The Phase 4 timeline adds media placement, move/trim/split, multi-selection, snapping, track controls and persistent undoable edits. Phase 5 adds real timeline playback and local H.264/AAC MP4 export through a separate rendering worker. AI and packaged delivery remain future work.

See [Roadmap](docs/ROADMAP.md) for checked milestones.

## Tech stack

| Layer              | Technology                           | Status                                  |
| ------------------ | ------------------------------------ | --------------------------------------- |
| UI                 | Next.js, React, TypeScript, Tailwind | Foundation                              |
| Desktop shell      | Electron                             | Development verified; packaging pending |
| Composition        | Remotion                             | Preview and local export implemented    |
| Processing         | Bundled FFmpeg / FFprobe             | Local encoding and output verification  |
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
- The timeline displays actual scenes and validated layer clips with a marker, scrolling and zoom. Add media/text/shape/caption layers through the inspector. Media drag-and-drop, moving, trimming, splitting, multi-selection and snapping are implemented. Select Timeline above the monitor for composition playback; Source preserves original-media inspection.
- Project settings, scene narration/style and layer transform/timing/text controls update the project document. Undo/redo covers project edits. Transforms appear in the Timeline monitor. Export opens the local MP4 workflow with native destination selection, progress and cancellation; Export JSON remains available.

## Saving and importing projects

Use Save project / Save as to write `.motioncraft.json` through Electron native dialogs. Open project validates a file and shows a summary before replacement. Import JSON accepts pasted or uploaded schema v1/v2/v3/v4 JSON (v1/v2/v3 are validated and migrated for review) and also requires replacement confirmation; Export JSON downloads the validated, path-free document. Ctrl+S saves and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo outside text inputs. Ctrl+O continues to import media.

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

## Preview and export (Phase 5)

Timeline is the default project canvas. Importing/selecting media opens Source inspection; clicking or focusing the timeline automatically restores the linked project preview. The Player and timeline seek each other in project frames; Space toggles the active monitor. Source preview remains independent. Video/image tracks, basic text/caption/shape layers, transforms, opacity, track visibility/mute, source trims and simultaneous audio are supported.

In Electron, choose **Export**, then **Export MP4**. Select a native destination; progress is real. Existing files are replaced only after a verified render succeeds. Cancel preserves the previous output. The job uses a project snapshot and runs outside the UI process. Browser-only mode supports preview with unavailable-media placeholders but has no native export.

```bash
npm run render:setup
# With npm run dev active and ELECTRON_RUN_AS_NODE cleared:
npm run test:render
```

`render:setup` prepares the headless browser (network required for the initial download) and checks Remotion's bundled media binaries. Rendering then runs locally without a cloud service. The current binary adapter supports Windows x64; it does not depend on FFmpeg being in PATH. A packaged offline runtime, broader codec testing and Remotion license review before distribution remain release gates. See [Rendering architecture, timing, security and limitations](docs/RENDERING.md). The deterministic [render sample](public/render-sample.motioncraft.json) contains generated graphics and requires no external media.

Workspace stabilization adds compact icon controls, a fitted artboard, a focus-canvas mode, automatic timeline fit/follow and a dedicated transport. See [Workspace usability review](docs/WORKSPACE_REVIEW.md) for the research, fixes, verification and remaining UI priorities.

Animation keyframes and presets are available in the inspector and timeline. Projects now save as schema v4; v1/v2/v3 imports migrate with review. See [Animation controls and Phase 6 acceptance](docs/ANIMATION.md), import the [media-free animation sample](public/animation-sample.motioncraft.json), and run `npm run test:animation` for the Player/MP4 regression. Transitions and dedicated caption effects remain incomplete.

## Local AI production (Phase 7 working slice)

Open **AI** in the toolbar to detect local models, transcribe imported narration when a local faster-whisper environment is configured, or plan from a script using an installed local Ollama model. Review descriptions and imported asset matches, then explicitly approve appending real editable visual/caption/narration clips in one undoable edit. Existing scenes and clips remain intact. External AI scene-plan/transcript JSON is distinct from project JSON.

See [local AI setup, contracts, workflow and acceptance](docs/LOCAL_AI.md), [plan JSON Schema](public/ai-scene-plan.schema.json), [transcript JSON Schema](public/ai-transcript.schema.json) and [unmatched example plan](public/ai-plan-sample.json). `npm run test:ai` exercises Electron review/apply/save/export with an external fixture; `npm run test:ai:models` optionally checks actual installed models and explicitly prints skips. No model downloads occur automatically and no npm dependency was added. Real Ollama 0.40.14 / qwen3:8b script generation and the Electron review/cancellation path are verified. Faster-whisper transcription and full Phase 7 acceptance remain pending.

## Phase 7.1: local structured scene planning

Install Ollama for Windows from https://ollama.com/download/windows, then run `ollama pull qwen3:8b` and `ollama list`. Start Ollama and open **AI** in MotionCraft. Select the installed model, paste a script and generate a scene plan. Narration, visual prompts, keywords and suggested asset types are editable in review. Script durations are estimates; generation never modifies the timeline. Existing explicit approval/appending remains a separate action.

Default endpoint: `http://127.0.0.1:11434`. Configure `MOTIONCRAFT_OLLAMA_URL` before launching Electron for a different loopback origin; restart Electron after changes. No cloud models, arbitrary renderer URLs or paid APIs are required.

`npm run test:ai:models` verifies available real models. With the dev server running and qwen3:8b installed, `npm run test:ai:planning` verifies real UI/IPC generation, editable review, cancellation and an unchanged project using an isolated test profile. See [Local AI](docs/LOCAL_AI.md) for JSON formats and limitations.

## External transcription (Phase 7.3 Part B)

Use **Transcribe** to configure a native-selected Python interpreter and external `motion_craft_ai/worker.py`, transcribe imported audio/video locally, review/edit/seek segments, and generate ordinary editable captions in one undoable operation. Project v4 persists original/reviewed transcripts, model metadata and caption references; v1?v3 migrate with review. No dependencies were added and no external repository was modified. See [setup, protocol, limitations and real-worker tests](docs/TRANSCRIPTION.md).

Phase 7.4 adds six editable caption presets, word-level frame animation, subtitle import/export, caption inspector and direct preview manipulation through existing project/history/timeline commands. See [Caption editor](docs/CAPTIONS.md) for workflow, tests and limits. Run `npm run test:captions` against the development server for isolated native UI and encoded-frame acceptance.

Audio detachment, selected-clip transcription, grouping and multi-format transcript export: see [workflow and limitations](docs/AUDIO_TRANSCRIPTS.md). Run `npm run test:audio-transcripts` for the real local speech-video acceptance test.

Audio editing: [controls, processing and verification](docs/AUDIO_EDITING.md). Run `npm run test:audio` for the prepared native mixing acceptance suite to verify the native audio mixing workflow.
