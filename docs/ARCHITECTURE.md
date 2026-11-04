# Architecture and directory conventions

## Current approach
Single Next.js application with Electron shell and modular feature folders. Source directories live at the repository root; there is no `src/` directory. The `@/*` alias maps to `./*` in `tsconfig.json`. Do not introduce a monorepo, microservices or containers until justified by actual workflows.

Existing source folders are `app/`, `components/`, `types/`, `platform/`, and `electron/`. Global styles currently live in `app/globals.css`, and the Electron smoke-test component lives in `components/electron-test.tsx`. The tree below includes planned folders as ownership conventions.

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
- `platform/app.ts` owns the typed bridge contract, version response validation, and browser/server fallback (`null` when unavailable). Additional adapters and contracts folders are deferred until there are more capabilities.
- `electron/security.cjs` restricts navigation to `http://localhost:3000` and validates IPC sender identity, owning main frame, origin, and zero arguments. This endpoint has no JSON payload; add Zod when structured input is introduced.
- Main process denies popups, webviews and permission requests/checks. Context isolation and sandboxing are enabled; renderer Node integration is disabled. Preload exposes only `getAppVersion`, never raw IPC.
- Development uses a fixed localhost port and bounded readiness wait. Closing Electron stops the paired dev server. The existing dev server must be stopped before starting `dev:desktop`; `electron:dev` can attach to it.
- `electron/security.test.cjs` covers origin and IPC rejection cases. `electron/smoke.cjs` verifies the real main/preload round trip and renderer security preferences against the running dev server.
- Missing later foundations: versioned project schema, editing commands, persistence, media handling, Remotion/FFmpeg integration and production runtime/packaging. No empty feature directories are created.
- Production content security policy and packaged-origin validation remain required before release. Development currently uses Next.js development scripts/HMR and Google-hosted fonts; offline font bundling is also pending.
