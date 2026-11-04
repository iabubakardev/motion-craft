# MotionCraft engineering standards

These are permanent repository rules. Read this document through `AGENTS.md` before every task, then inspect the relevant product, architecture, roadmap, format and decision documents. Explicit user instructions determine task scope. Phase 4 timeline editing was separately authorized and is implemented as documented in TIMELINE.md. These standards do not authorize future milestones.

## 1. Preserve the established system

- Keep the root-level `app/`, `features/`, `core/`, `platform/`, `electron/` layout and `@/* -> ./*` alias. Do not introduce `src/`, a monorepo, databases, queues, containers or services without a concrete requirement.
- Retain the modular monolith. Organize by feature and ownership; create a directory only when it contains an implementation. Shared helpers must have real reuse and a clear owner. Avoid circular dependencies and speculative abstraction layers.
- The project schema is authoritative. `core/` owns models, validation, timing and immutable editing commands; it must not import React, Next.js, Electron, Remotion or AI clients. React owns presentation and orchestration; `platform/` owns renderer-safe adapters; Electron owns native capabilities and trusted paths. Rendering/AI services must remain separate adapters when implemented.
- Preserve useful instructions, stable IDs, schema semantics, public bridge APIs and manual edits. Record meaningful changes in `DECISIONS.md`. Never call an unimplemented capability complete.

## 2. TypeScript, naming and formatting

- Keep `strict: true`, no emit for validation, and the installed module-resolution conventions. Prefer explicit domain types and Zod-inferred data contracts. Use `unknown` at untrusted boundaries and narrow it; explicit `any` requires a documented exceptional reason and a narrow suppression, not a file-wide rule disable.
- Use discriminated unions for domain commands/events and complex UI transitions. Critical switches must be exhaustive with a `never` assertion or an equivalent compile-time check, and fail explicitly on unsupported runtime transitions.
- Use `import type` for type-only imports. Avoid casts that bypass validation, double assertions, non-null assertions without a proven invariant, and invented duplicate DTOs. Validate a value to obtain its type instead of asserting it.
- New domain logic should be TypeScript. Where shared Electron CommonJS is necessary without a new build pipeline, use typed JSDoc and `// @ts-check`. Existing unchecked CJS is tracked technical debt; increase coverage incrementally rather than enabling global `checkJs` without fixing its errors or rewriting Phase 3.
- Prefer cohesive functions and named domain operations over duplicated logic or deeply nested conditionals. Name files in kebab-case, components/types in PascalCase, functions/values in camelCase, hooks `use...`, and module constants in UPPER_SNAKE_CASE where appropriate. Keep established public names stable.
- ESLint handles correctness, hooks and boundaries; the pinned Prettier handles formatting. Use two spaces, double quotes, semicolons and LF as configured. Do not add an ESLint Prettier execution plugin or competing formatting rules without a need.
- Format new and substantively edited files, not the entire repository during an unrelated change. There is no blanket ignore for legacy source. Pass explicit paths: `npm run format -- path/to/file.ts` and `npm run format:check -- path/to/file.ts`. Whole-repository adoption (`... -- .`) is a separate mechanical change because the existing baseline has formatting debt.

## 3. React and component design

- Follow patterns supported by the installed React/Next.js versions; read the relevant local Next.js guide before coding. Do not assume older `error.tsx` or other framework APIs still apply.
- Keep derived values out of state. Use local state for small interactions and reducers for coordinated transitions. Effects synchronize with external systems; do not use them to manufacture data that could be computed during render or handled in the originating event.
- Use composition and focused props for small feature trees. Avoid passing an entire controller through a growing editor tree or introducing a context provider for every concern. Extract components/hooks when responsibilities or reuse justify them, not to satisfy a line-count target.
- Use `useMemo`/`useCallback` for a demonstrated expensive calculation, stable subscription or meaningful reference identity. They do not fix broad subscriptions or replace correct state ownership.
- Clean up event listeners, observers, timers, pointer capture and media resources. Abort obsolete work and guard responses by document/request generation. Test development-mode setup/cleanup behavior as well as normal unmounts. Async completions must not overwrite newer edits or reinsert assets from a replaced project.
- Keep one selection owner per entity and separate transient selection/playback/layout from persisted project data. Input drafts must commit or reject clearly without silently losing edits.
- Provide loading, unavailable, empty and actionable error states, accessible labels/focus/keyboard behavior and an error boundary for unexpected rendering failures. Recovery must explain any risk to unsaved edits; retry is not autosave.

## 4. Choose state tools by responsibility

| Responsibility           | Policy                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated UI              | `useState`; use `useReducer` for coordinated local transitions.                                                                                                                                                                                                                                                         |
| Shared editor state      | Prefer Zustand when independent panels need selective shared subscriptions or measured prop/subscription complexity warrants it. Use focused selectors; shallow comparison is useful for selected objects/tuples, not automatically for primitives. Keep persistent documents and transient interaction state distinct. |
| Forms                    | Prefer React Hook Form with Zod for new complex forms needing coordinated fields, cross-field errors or validation lifecycle. Keep existing small native forms. Formik is acceptable only when already present or specifically justified; never use a form library as timeline state.                                   |
| Server/worker async data | Consider TanStack Query when caching, invalidation, retries or shared request lifecycle provides a benefit. Use stable keys including project/job identity, cancellation, bounded retries and deliberate invalidation. Native file dialogs and synchronous local editing are not queries. Avoid duplicate caches.       |
| Nested immutable edits   | Consider Immer when tested command complexity justifies it. Do not add it just to replace a small spread, and avoid full-project clones for every pointer movement.                                                                                                                                                     |

The existing React hooks, editor reducer, project snapshots and Node test runner remain valid. This policy is not an instruction to install or migrate libraries now.

## 5. Editing domain, timing and history

- Implement edits as testable commands preserving project invariants: existing `addScene`, `deleteScene`, `duplicateScene`, `reorderScene`, `updateLayer` are examples. Phase 4 MoveClip/TrimClip/SplitClip commands are separately authorized and implemented in core/timeline; future commands still require explicit task scope.
- Keep commands atomic and immutable. Pass or isolate ID/clock generation where deterministic tests need it. Preserve unrelated scenes, assets, properties and metadata. Invalid edits return useful errors and leave the prior document intact.
- Schema v1 timing is finite seconds: contiguous scene-array order, scene-relative layers, timeline-global clips, and strict derived clip consistency. Keep `PROJECT_FORMAT.md` authoritative. Do not silently convert persisted v1 data to frames.
- Prefer integer frame coordinates for future editing gestures/commands, with explicit FPS conversion and documented rounding at the v1 boundary. Use deterministic helpers and test fractional-second boundaries, durations and source ranges. A format change requires a versioned, tested migration.
- Avoid duplicate truth between scenes/layers and their derived track clips. Standalone asset clips retain their documented canonical ownership. UI display and rendering must consume these models through adapters.
- History must be predictable and bounded. Record completed domain edits, not hover, playback, selection, panel resizing or each drag event. Future drags need a preview transaction and one commit/cancel boundary. Preserve saved checkpoints; undo/redo after save and history reset on confirmed replacement must remain tested.

## 6. Electron and data security

- Keep context isolation and sandboxing enabled and renderer Node integration disabled. Do not weaken web security, CSP, navigation, popup or permission policies for convenience. The existing fullscreen exception is only for a trusted main frame in an owned window.
- Expose a minimal, capability-specific preload bridge; never expose raw IPC, `require`, unrestricted filesystem/network/shell APIs or arbitrary executable commands. Enforce the same input/output schemas in main and renderer adapters.
- Validate the owning window, sender, main frame, origin and exact argument tuple for every IPC capability. Revalidate after native dialogs/awaits; obsolete document generations must not change a newer file target or document.
- Read/write only native-selected paths or an already-authorized current target. Validate supported types, regular files, size limits, canonical identities and extensions. Protect unexpected overwrite cases. Never resolve an imported filename directly against disk.
- Keep original paths and trusted binding catalogs inside Electron. Persist IDs and safe metadata in project JSON; keep media bytes separate. Serve only approved IDs through the controlled media protocol with explicit MIME, no-sniff, origin restrictions and correct range handling. Missing/moved/changed files require explicit relinking.
- Imported JSON and future AI output are data only: no `eval`, `Function`, script templates, shell fragments, HTML injection or unrestricted URLs. Never execute imported code. Test malformed fields, references, schema versions and unauthorized senders.

## 7. Validation, failures and recovery

- Use Zod at JSON import, IPC, persistence, local preferences and future external/AI/service boundaries. Use strict objects, bounded arrays/strings/files, supported identifiers and cross-reference/timing validation. Report unsupported fields instead of silently dropping them.
- Use discriminated results or typed domain error codes where they improve callers. Present safe, actionable errors; log technical operation/name/code separately. Do not disclose private media paths or raw imported content through renderer errors or telemetry.
- Catch failures at a boundary that can handle them. Do not silently map all failures to success/empty data. A missing optional file may be normal; permission errors, corrupt catalogs and failed writes are different conditions.
- Do not overwrite unreadable/corrupt trusted catalogs during save. Preserve the existing project and catalog and report failure. Loading can degrade to unavailable media without treating the portable document itself as invalid. Do not claim cross-file transactions, autosave or crash recovery until implemented and tested.
- Native cancellation is a normal result. New/open/import replacement must validate, show a summary and request explicit confirmation before discarding a dirty document. Closing/reloading dirty documents must retain their warning behavior.

## 8. Performance for long-form work

- Profile rendering, schema work, serialization, memory and media decoding before adding complex optimizations. State the workload, evidence and effect of an optimization.
- Avoid validating/stringifying an unchanged project during playback, hover or panel changes. Keep high-frequency state local or selectively subscribed; do not broadcast every tick to the whole editor when architecture grows.
- Consider TanStack Virtual for large media/scene/clip lists when measured sizes warrant it. Do not render thousands of off-screen timeline entries. Keep stable keys and labels during virtualization.
- Batch or animation-frame throttle pointer updates as appropriate and commit one history entry per gesture. Keep expensive parsing/indexing/transcription/rendering in workers or dedicated processes when workloads justify them; cancellation and progress are part of the contract.
- Avoid repeated media decoding. Use bounded probes and explicit thumbnail/waveform cache ownership keyed by asset identity, source changes and settings. Do not add a second cache by accident. Cap histories and caches, and account for retained full snapshots.

## 9. Tests and quality gates

- Preserve the working Node `node:test` domain/security/persistence tests and Electron integration scripts. Prefer Vitest for a justified new TypeScript-heavy domain/utility test setup, React Testing Library for component behavior, Playwright for suitable end-to-end workflows, and real Electron integration for preload/native boundaries. Do not install all runners or rewrite passing tests as a style exercise.
- Prioritize schema failures, scene operations, future frame/clip commands, undo/redo, JSON round trips, atomic persistence, IPC rejection, missing media, cancellation and recovery. Assert behavior/invariants rather than implementation details or hook call counts.
- Add regression tests for actual correctness/security bugs. Keep fixtures isolated and bounded. Native-dialog stubs do not verify the Windows picker: distinguish automated coverage, manual checks and packaged-build testing.
- For each substantive change run `npm run check` (lint, route generation/strict TypeScript and unit tests), scoped formatting checks, and relevant integration scripts against the running dev server. Run build/package checks when changing those workflows; report network/native limitations rather than claiming success.
- Current commands: `test:desktop`, `test:media`, `test:projects`. Clear inherited `ELECTRON_RUN_AS_NODE` for native tests. Do not stop the user's dev server or touch real project/media files for a test.

## 10. Dependency, tooling and delivery policy

Before adding a library: inspect equivalents already installed; verify compatibility with the actual React/Next.js/Electron/Node versions and peer dependencies; review maintenance/docs, bundle/runtime overhead, license and Electron security; explain the concrete use case and smaller alternatives. Keep npm and its lockfile consistent, use `npm ci` for clean reproducible installs, and pin formatting tools. No dependency is justified solely by popularity.

Candidate libraries are Zustand, Zod, React Hook Form, Formik, TanStack Query/Table/Virtual, Immer, dnd-kit, react-resizable-panels, Vitest, React Testing Library and Playwright. Evaluate only when the authorized feature needs them. Prettier is development-only and installed because formatting is an explicit repository standard; it is not a runtime dependency.

Review `npm audit` and relevant upstream advisories before release. Do not run forced upgrades or downgrades blindly. Electron is in devDependencies but is the actual desktop runtime: a clean `npm audit --omit=dev` is not proof of desktop runtime security. Track upgrade findings separately and verify native compatibility before adopting a major runtime change.

Keep scripts and environment configuration explicit. Never commit secrets, credentials, private media/catalogs, generated profiles, logs or `.next` artifacts. Keep README setup, format/timing docs and decisions accurate. Consider GitHub Actions when hosting/runtime support is known; a lightweight quality job is sufficient initially, with native Windows jobs separately provisioned. Do not add infrastructure for hypothetical needs.

Every future feature must: read context/standards, inspect implementation, reuse valid abstractions, justify libraries, implement real behavior within scope, test domain invariants, run quality checks, update docs and report changed files/results/limitations honestly. See [current audit](ENGINEERING_AUDIT.md) for concrete debt and release blockers.
