# MotionCraft — Codex project instructions

Read `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` before making architectural changes. Treat `docs/PROJECT_CONTEXT.md` as product requirements. The uploaded MotionCraft handoff remains the detailed product source of truth; update local docs when decisions change.

## Product
MotionCraft is a local-first Windows desktop video editor with optional AI assistance. Stack: Next.js App Router, React, TypeScript, Tailwind, Electron, Remotion, FFmpeg; later Ollama, faster-whisper, PostgreSQL, Redis/BullMQ as needed. Core editing must work without paid APIs or AI.

## Boundaries
Use root-level source directories; this repository does not use a `src/` directory. The `@/*` alias maps to `./*`. Create planned directories only when needed.

- `app`: route composition only, not business logic.
- `features`: domain-specific UI, hooks, commands, state, services.
- `components/ui`: reusable presentation components only.
- `core`: pure, framework-agnostic project schema, timeline math, editing operations, validation.
- `platform`: interfaces/adapters for desktop and browser; UI never imports Electron directly.
- `electron`: Electron main, preload, IPC handlers, native integrations. Validate IPC inputs; use contextIsolation, no nodeIntegration, and least privilege.
- `rendering`: Remotion compositions and render mapping; no persistence side effects.
- `workers`: later long-running transcription, indexing and rendering coordination; avoid blocking renderer/UI.

## Engineering rules
- Keep changes small and targeted. Reuse existing code; do not add a dependency without explaining why.
- TypeScript strict; no `any` without justification. Validate external JSON and IPC inputs with Zod.
- Preserve stable IDs and manual edits; scene regeneration must not mutate unrelated scenes.
- No arbitrary JavaScript execution from imported JSON or AI output.
- Store media on disk; persist references/metadata rather than media blobs.
- Support browser fallback when Electron bridge is absent.
- No paid API requirements, no premature Docker/Redis/PostgreSQL/Kubernetes.
- Maintain clear separation between scene-plan data and rendering implementation.
- Add tests for pure core logic and critical edit operations.
- Update README/docs when behavior, setup or architecture changes.

## Workflow for each task
1. Inspect relevant existing files and summarize the plan briefly.
2. Implement the smallest working vertical slice.
3. Run relevant lint, typecheck and tests (or state what could not run).
4. Report changed files, behavior, verification, risks and next step.
5. Do not refactor unrelated areas or silently change confirmed decisions.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
