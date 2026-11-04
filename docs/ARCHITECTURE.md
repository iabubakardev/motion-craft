# Architecture and directory conventions

The permanent [Engineering standards](ENGINEERING_STANDARDS.md) apply to all modules. See [Engineering audit](ENGINEERING_AUDIT.md) for scoped findings and release gates.

## Current approach

Single Next.js application with Electron shell and modular feature folders. Source directories live at the repository root; there is no `src/` directory. The `@/*` alias maps to `./*` in `tsconfig.json`. Do not introduce a monorepo, microservices or containers until justified by actual workflows.

Existing source folders are `app/`, `components/`, `core/media/`, `features/media/`, `types/`, `platform/`, and `electron/` (including `electron/ipc/`). Workspace features also live in `features/editor/`, `features/preview/`, `features/inspector/`, `features/scenes/`, and `features/timeline/`; the reusable divider lives in `components/ui/`. Global styles and design tokens live in `app/globals.css`. The home route composes `features/editor/editor-workspace.tsx`; `components/electron-test.tsx` remains available as a diagnostic component. The tree below also includes planned folders as ownership conventions.

```text
motion-craft/
├── electron/
│   ├── main.cjs                 # desktop lifecycle, window creation
│   ├── preload.cjs              # minimal typed API exposure
│   └── ipc/                     # validated IPC handlers (when needed)
├── app/                     # Next.js routes/layouts
├── components/
│   ├── ui/                  # generic controls
│   └── layout/              # reusable shell/panels
├── features/
│   ├── editor/              # workspace composition
│   ├── projects/            # create/open/save/version
│   ├── media/               # import, catalog, thumbnails
│   ├── scenes/              # scene editing and scene list
│   ├── timeline/            # tracks, clips, playhead, editing
│   ├── preview/             # player and playback controls
│   ├── inspector/           # selected-item property editing
│   ├── captions/            # caption timing/styles
│   ├── rendering/           # export UI and job status
│   └── ai/                  # optional orchestration UI
├── core/
│   ├── schema/              # versioned Zod project schema
│   ├── timeline/            # pure timing calculations
│   ├── commands/            # undoable edit commands
│   ├── styles/              # style/template definitions
│   └── utils/               # pure helpers
├── platform/
│   ├── contracts/           # filesystem, dialogs, jobs interfaces
│   ├── desktop/             # Electron bridge adapters
│   └── browser/             # web-safe fallbacks
├── rendering/
│   ├── compositions/        # Remotion compositions
│   ├── templates/           # visual templates
│   └── adapters/            # scene -> render props
├── hooks/                   # truly shared hooks
├── lib/                     # shared integration helpers
├── types/                   # global ambient types
├── styles/                  # optional shared design tokens (planned)
├── workers/                     # add only when background jobs exist
├── public/                      # bundled static UI assets only
├── docs/
│   ├── PROJECT_CONTEXT.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── DECISIONS.md
├── tests/                       # cross-feature/integration tests
├── AGENTS.md                    # persistent Codex instructions
├── README.md
└── package.json
```

Directories describe intended ownership, not a request to create dozens of empty folders. Create them as features are implemented. Prefer colocated tests (`*.test.ts`) for pure logic.

## Dependency direction

UI features -> `core` and `platform/contracts`; platform adapters -> Electron preload bridge; rendering adapters -> `core`. `core` must never import Next.js, Electron or Remotion. Electron main must not import browser-only UI code.

## Runtime cautions

- Current Electron integration loads the Next.js dev server; production runtime is an open design task. Never claim packaging works until a packaged build is tested.
- Renderer process must not access Node filesystem directly. Validate IPC calls and restrict origins/navigation.
- Remotion preview and final render should share canonical scene data, but be separate execution paths.
- Desktop persistence can start with local project JSON; add PostgreSQL later for justified indexing and relational workflows.

## Implemented development foundation

- `platform/app.ts` owns the typed bridge contract and version adapter; `platform/media.ts` validates media IPC responses and provides browser/server fallbacks. `platform/projects.ts` validates project open/save/activate/relink IPC. Nested adapter folders are deferred until needed.
- `electron/security.cjs` restricts navigation to `http://localhost:3000` and validates IPC sender identity, owning main frame and origin. The version endpoint accepts no arguments; media endpoints additionally use strict Zod argument and response contracts.
- Main process denies popups and webviews. Permission requests/checks allow only fullscreen from a trusted app main frame in an owned window; camera, microphone, screen capture, filesystem, clipboard and other permissions remain denied. Context isolation and sandboxing are enabled; renderer Node integration is disabled. Preload exposes only `getAppVersion` and approved `media`/`projects` methods, never raw IPC or filesystem access.
- Development uses a fixed localhost port and bounded readiness wait. Closing Electron stops the paired dev server. The existing dev server must be stopped before starting `dev:desktop`; `electron:dev` can attach to it.
- `electron/security.test.cjs` covers origin and IPC rejection cases. `electron/smoke.cjs` verifies the real main/preload round trip and renderer security preferences against the running dev server.
- Missing later foundations: composition playback, advanced timeline editing, autosave/crash recovery, Remotion/FFmpeg integration and production runtime/packaging. No empty feature directories are created.
- Production content security policy and packaged-origin validation remain required before release. Development currently uses Next.js development scripts/HMR and Google-hosted fonts; offline font bundling is also pending.

## Media import boundary

`features/media/` owns React state, selection, filters, views, and browser-based metadata decoding (three concurrent probes with timeouts). It calls `platform/media.ts`; it never imports Electron. `core/media/schema.cjs` is a single Zod contract shared by Electron CommonJS and Next.js, with inferred TypeScript types in `core/media/types.ts`.

`electron/ipc/media.cjs` handles native selection and validates sender/frame/origin plus argument tuples. `electron/media-library.cjs` holds the trusted session registry, canonical local paths and file identity. Renderer-safe records contain opaque IDs and `motioncraft-media://asset/<uuid>` URLs, never paths. The protocol streams only registered, unchanged regular files with explicit MIME types and byte-range support. It does not translate request paths into filesystem paths, bypass CSP, or disable web security.

The main-process registry survives renderer reloads and ends when Electron exits. Project descriptors and trusted bindings now persist via the project store; there is no database, media copy, video thumbnail generation or transcoding. Images use their approved URLs for thumbnails; video/audio use placeholders. See [Media IPC and verification](MEDIA_IMPORT.md).

## Workspace ownership

`features/editor/editor-workspace.tsx` composes the toolbar, sidebar, source monitor, inspector and timeline shell. `useEditorState` combines one existing `useMediaLibrary` instance, `useProjectDocument` history, and a reducer for transient tab, preview, panel, settings-dialog and timeline-marker state. The previous duplicate project-placeholder state was removed. The selected asset ID remains owned by the media hook; there is no parallel selection store or external state library.

`MediaLibrary` is a reusable panel receiving that hook's state. It stays mounted while sidebar tabs change, preserving imports, search and view state. `features/media/media-preview.tsx` retains source rendering; `features/preview/preview-monitor.tsx` owns playback/fullscreen controls and releases old media when selection changes. Metadata previously shown beside playback now lives in `features/inspector/`.

`components/ui/panel-resize-handle.tsx` uses pointer capture and accessible keyboard separators. `features/editor/layout.cjs` validates saved pixel dimensions and constrains them against viewport bounds, preserving a 320px monitor and 240px upper workspace at desktop sizes. Only versioned panel dimensions are saved in localStorage. Assets, paths, project settings, selection and playback are not persisted there. Smaller browser widths use a stacked layout without resize handles.

`features/timeline/` displays real project scenes/tracks/clips, with zoom, scrolling and an independently positioned marker. Scene-layer clips are derived from the canonical scene/layer model; standalone asset clips imported in JSON own their global timing. There is no timeline drag-and-drop, trimming or composition playback. See [Workspace behavior](EDITOR_WORKSPACE.md).

## Project document and persistence

`core/project/schema.cjs` is the shared strict Zod model, with inferred TypeScript types in `types.ts`. `operations.cjs` contains immutable scene/layer operations and atomic recomputation of derived timing; `history.cjs` contains bounded snapshot undo/redo. These modules import no React, Electron, Next.js or rendering code. `core/project/ipc.cjs` defines renderer-safe results.

`features/projects/use-project-document.ts` owns the current project/history, saved checkpoint, active scene/layer, import candidate and file operations. UI selection, playback, tabs and layout do not enter project history. Media descriptors enrich the document without creating scene-history entries; metadata completion can make a previously saved snapshot dirty. Media probes are aborted and generation-checked on document replacement to prevent old results leaking into a new project.

`electron/project-store.cjs` writes project JSON and trusted asset binding catalogs atomically. Catalogs are under `app.getPath('userData')/project-media/<projectId>.media.json`, never inside renderer-facing project JSON. They contain only paths previously approved by native media selection/relinking. Open never interprets a JSON filename as a filesystem path. Missing/changed media remains declared and unavailable until explicitly relinked.

`electron/ipc/projects.cjs` uses strict argument tuples and existing sender/window/main-frame/origin checks. Opening stages a candidate; activation after user confirmation changes the save target. Reload clears that target and invalidates pending operations. Save/cancel errors retain current editing data; only exact selected paths or the active native-selected save target can be written. Native close/reload warnings are triggered by the dirty renderer's beforeunload handler. See [Project format and timing](PROJECT_FORMAT.md).

## Quality and recovery boundaries

ESLint prevents Node built-in/Electron imports in renderer, platform and core runtime modules (tests are excluded). Type-only imports and explicit-any restrictions apply to TypeScript. Shared CJS remains supported; the editor reducer is now checked with typed JSDoc and an exhaustive action switch. Remaining unchecked shared domain CJS is tracked debt rather than falsely covered by TypeScript strict mode.

`app/error.tsx` uses this installed Next.js version's `retry` and `unknown` error contract, logs technical errors separately and explains that retry may reset unsaved in-memory edits. It does not implement autosave or crash recovery. Unreadable existing media catalogs block saves instead of being silently replaced; project loading can still degrade to unavailable media. Dirty comparison is memoized on document/checkpoint identity so transient preview updates do not repeatedly validate and serialize an unchanged project.
