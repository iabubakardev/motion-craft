# Architecture decision log

| Date       | Decision                                                                   | Rationale                                                                                                           | Status                            |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 2026-11-04 | Next.js + TypeScript for UI                                                | Existing experience and potential web reuse                                                                         | Confirmed                         |
| 2026-11-04 | Root-level source directories with `@/*` mapped to `./*`                   | Match the existing `app/`, `components/`, and `types/` layout; create feature folders as needed                     | Confirmed                         |
| 2026-11-04 | Electron for Windows desktop                                               | Native dialogs/filesystem through secure bridge                                                                     | Confirmed                         |
| 2026-11-04 | Remotion + FFmpeg for video                                                | React compositions and local encoding                                                                               | Planned                           |
| 2026-11-04 | Modular monolith initially                                                 | Avoid premature distributed infrastructure                                                                          | Recommended                       |
| 2026-11-04 | Local JSON persistence before DB                                           | Simplify early usable editor                                                                                        | Recommended; revisit              |
| 2026-11-04 | Minimal platform adapter and main-frame/origin-validated IPC               | Keep UI independent of desktop runtime and restrict native access without new dependencies                          | Implemented for development       |
| 2026-11-04 | Main-process media registry with opaque custom-protocol asset URLs         | Keep original paths out of React, support range playback without broad filesystem APIs or media copies              | Implemented for Phase 2           |
| 2026-11-04 | Shared Zod media contracts and React hook state                            | Validate IPC in both runtimes; avoid a state-management dependency for one feature                                  | Implemented for Phase 2           |
| 2026-11-04 | Session-only media metadata using Chromium decoders                        | Deliver import/preview before project persistence or FFmpeg integration; codec limitations remain explicit          | Implemented for Phase 2           |
| 2026-11-04 | Editor reducer composed with one media hook                                | Share selection and transient workspace state without a global store or duplicate imported assets                   | Implemented for Phase 2.2         |
| 2026-11-04 | Native pointer-capture dividers and validated preferences                  | Three fixed dividers need bounded resizing and keyboard support without another dependency; persist dimensions only | Implemented for Phase 2.2         |
| 2026-11-04 | Source preview separate from the timeline marker                           | Avoid implying composition playback before scene/layer models and Remotion exist                                    | Implemented for Phase 2.2         |
| 2026-11-04 | Fullscreen permission limited to trusted main frames in owned windows      | Enable source monitor fullscreen while retaining denial for other permissions                                       | Implemented and tested            |
| 2026-11-04 | Strict schema v1 shared by Electron and renderer with inferred TS types    | One validation contract, bounded JSON, explicit supported styles/properties and no executable payloads              | Implemented for Phase 3           |
| 2026-11-04 | Contiguous scene order and scene-relative layer times; derived layer clips | Atomic scene operations prevent conflicting timing; standalone asset clips retain global timing                     | Implemented and validated         |
| 2026-11-04 | Portable path-free project JSON plus per-user trusted media catalogs       | Persist editing data without granting filesystem access from imported JSON; relink by native selection              | Implemented and tested            |
| 2026-11-04 | Bounded snapshot history and serialized save checkpoints                   | Predictable undo/redo and dirty tracking; transient UI excluded                                                     | Implemented for Phase 3           |
| 2026-11-04 | Staged open/import confirmation and native unload warning                  | Replacement and canceled file dialogs must not discard edits or change save destinations                            | Implemented and tested            |
| 2026-11-04 | Permanent engineering standards discoverable from AGENTS.md                | Preserve Phase 3 invariants and require scoped validation, tests and dependency review in future sessions           | Adopted                           |
| 2026-11-04 | Pinned Prettier with touched-file adoption and LF policy                   | Consistent formatting without a disruptive repository-wide rewrite during Phase 3                                   | Implemented                       |
| 2026-11-04 | Keep existing React state, schema v1 timing and Node tests                 | Zustand/forms/query/test libraries remain conditional; no speculative migrations or Phase 4 work                    | Confirmed                         |
| 2026-11-04 | Fail saves on unreadable existing media catalogs                           | Preserve approved bindings and prior saved data instead of treating corruption as an empty catalog                  | Implemented and regression-tested |

Add dated entries when making or changing significant technical decisions.

## Phase 4 decisions (2026-11-04)

- Keep persisted timing in seconds; accept integer project-frame command inputs with explicit conversion. Preserve imported fractional timing on moves rather than silently quantizing source ranges.
- Introduce strict schema v2 for persisted track controls and null source endpoints for still/generated content. Validate v1 before migration and require reviewed replacement; a migrated document must be saved as v2.
- Keep scene layers canonical and contained in their scene. Timeline edits update layers and derived clips atomically; standalone media clips remain independent. Cross-scene transfer/ripple require a future ownership design.
- Reject new same-track timeline overlaps; allow adjacent clips and preserve legacy/imported overlaps. No automatic destructive overwrite/ripple. Existing scene tools retain composition semantics.
- Add pinned Zustand 5.0.16 (MIT, React 19 compatible, no native code) for focused transient subscriptions across the library, timeline and inspector. Keep project/history in the existing controller. No additional drag, form, virtualization or test dependency is justified for this slice.
- Use native media drag-and-drop and pointer events, rAF previews and window gesture cleanup. One command/history commit on pointer release; Escape cancels. Reuse the existing Node runner with checked JSDoc CommonJS domain modules so Node/Electron tests need no new transpilation pipeline.
- Use horizontal visible-range rendering and memoized indexes; seven tracks do not justify TanStack Virtual yet. Large-project profiling remains pending; bounded full project snapshots remain the existing history tradeoff.
- Persist visibility and mute as composition flags; show their current source-preview limitation explicitly until a composition renderer exists. Do not fake waveforms or composition playback.

## Phase 5 decisions (2026-11-05)

- Pin remotion, @remotion/player, @remotion/renderer and @remotion/bundler together at 4.0.540, compatible with installed React 19. No separate media/form/query/queue dependency is needed. Remotion's own license must be reviewed before distribution; it is not MIT.
- Reuse OffthreadVideo (native HTML video in Player, deterministic frame extraction in export), Html5Audio and Img from the installed Remotion API. This keeps the existing custom-protocol preview adapter without another decoder package. Register one dynamic composition and use the same component for preview/export.
- Keep schema v2 unchanged. Validate a project plus derived URL map at the render boundary; resolve scene layers once, and convert half-open seconds to frame sample intervals using ceil start/end and nearest source offset with first-frame compensation.
- Draw lower tracks first, then higher layers within each track. Apply track visibility to the entire track; mute suppresses audio while retaining video pictures. Use project background over opaque black for consistent MP4/Player gaps. Plain text/system fonts and fixed default shape proportions avoid introducing arbitrary styles or another schema.
- Synchronize Player and the existing per-workspace timeline store directly, comparing frames to avoid loops. Keep Source mode for original-media preview. Do not feed per-frame updates into document/history or the whole workspace.
- Export an immutable snapshot in a dedicated child process. Keep native paths and file selection in Electron, expose only typed start/status/cancel capabilities, and poll job snapshots with cleanup. Do not introduce Redis/BullMQ or cloud rendering.
- Use an ephemeral loopback server scoped to approved asset IDs and a random 256-bit token for headless media. Validate Host/Origin/methods and fingerprints on each request; do not enable file:// or disable web security.
- Render to a unique sibling partial file, inspect H.264/AAC/dimensions/FPS/duration using bundled FFprobe, sync and atomically rename after confirming the destination has not changed. Cancellation/failure preserves existing output.
- Resolve pinned Windows x64 FFmpeg/FFprobe binaries from Remotion's installed platform package, never PATH. Prepare/cache Chrome ahead of offline rendering. Production packaging, native runtime advisories and distribution licensing remain separate release gates.

## Phase 6 animation slice decisions (2026-11-05)

- Advance project schema to v3 with one clip-owned animation map, preserving existing clip/layer IDs and scene timing. Strict v1/v2 migration converts legacy motion to ordinary keys; save writes v3.
- Use integer local frames, bounded transform values and deterministic named/Bezier easing. Presets generate editable keys, rather than a separate renderer. New shared CJS uses checked JSDoc for Electron compatibility. No dependency was added.
- Preserve curves through timeline crop/split; regenerate key IDs for duplication/paste. Use the existing snapshot history and reject invalid/locked edits atomically.
- Ship a tested animation vertical slice. Do not claim transitions, expanded text styling, dedicated caption timing or animated captions complete. Full Phase 6 acceptance remains open; see ANIMATION.md.

## Phase 7 local AI slice decisions (2026-11-05)

- Keep the project schema at v3. Add separate version-1 transcript and scene-plan contracts; AI descriptions are not trusted project JSON. Preserve exact source seconds and optional word alignment in transcript sidecars. Corrected text invalidates its old word alignment.
- Perform deterministic bounded grouping before Ollama; the model supplies descriptions/keywords, never timing or commands. Use fixed loopback APIs, bounded structured responses, at most one repair retry per batch, and exclude cloud/remote models.
- Use an optional configured Python environment and complete local CTranslate2 Whisper directories. CPU int8 is the only supported mode in this slice; no implicit downloads or unverified CUDA claim. No npm/Python package was installed. The setup guide targets the faster-whisper 1.2.1 API; actual inference remains a verification gate.
- Reuse the established supervised child-process approach and extracted process-tree termination. Keep render-specific output transactions intact; coordinate AI/export busy states. Report real stages and measured transcription progress, and cancel owned children on navigation/shutdown.
- Default application to append, retain existing edits and require review/approval. Use existing clips, track roles, bounded history and persistence. Unmatched visuals stay background; metadata matching is not semantic image recognition.
- Ship the verified editor/external-plan flow without claiming unavailable inference succeeded. Local model installation and a real spoken-narration end-to-end run are the next acceptance gates.

## Phase 7.1 decisions (2026-11-06)

- Reuse existing secure IPC, jobs, review and browser fallback. Generation remains a draft; no automatic timeline edit is introduced.
- Use /api/generate, JSON Schema, think:false and /no_think for qwen3 structured output. Keep application-owned logical grouping, IDs and timing; only descriptions/keywords/supported media and preset choices come from the model.
- Allow a trusted launch-environment HTTP loopback origin via MOTIONCRAFT_OLLAMA_URL; renderer requests never contain endpoints. Preserve redirect/cloud-model rejection and bounded payloads.
- Add a separate version-1 planning sidecar with the requested field names, retaining the existing review/apply JSON format. Trusted frame boundaries use existing FPS conversion; source timestamps remain unchanged.
- Reuse native forms, Zod, existing state and Node/Electron tests. React Hook Form/TanStack Query provide no demonstrated benefit for this scoped extension; no dependency was added.
- Real Ollama 0.40.14/qwen3:8b generation and Electron preview/edit/cancel/no-document-change checks pass. This does not establish broad factual quality, long-input performance or transcription acceptance.

## Phase 7.3 Part B decisions (2026-11-06)

- Follow the actual external protocol v1 (`motion-craft-ai/docs/worker-protocol.md`); do not copy Python code or modify the AI repository. Launch a fixed module in the native-selected package cwd, with shell disabled and bytecode writes disabled.
- Reuse AI start/status/cancel, owner validation, process-tree cancellation, timeouts and export exclusion. Add narrowly scoped native configuration capabilities; renderer requests cannot supply executable paths or shell arguments.
- Advance project persistence to v4 for version-1 transcript records, original/reviewed segments, source association, model execution metadata and caption references. Validate old formats before reviewed migration; keep IDs/seconds/animations unchanged.
- Generate ordinary caption layers on a dedicated top track; split at scene ownership boundaries and append only needed tail coverage. Preserve existing captions and make generation atomic with history. Place source media separately with explicit caption frame offset. No parallel renderer/timeline or automatic replacement is added.
- Allow safe merging onto the current document after harmless media metadata enrichment, while guarding document identity/FPS and source metadata. Native file identity is verified around inference.
- Keep native forms, Zod, existing hooks and the Node/Electron runners. No dependencies are added. Real tiny/CPU/int8 and Electron review/preview/history/persistence/cancellation pass; GPU, packaging and broad codec/performance gates remain open.

- Development transcription detects the user-managed `tools/motion-craft-ai` checkout when saved settings/files are missing; valid settings retain priority. Discovery stays in Electron and exposes no renderer path-setting capability. Packaged builds retain native manual setup. See TRANSCRIPTION.md.

## Phase 7.4 caption decisions

Extend schema v4 caption properties with an optional strict version-1 visual payload; preserve old documents and reject unsupported fields in older applications. Keep transcript originals separate from editable visual word ranges. Use existing scene ownership, track locks, frame commands, snapshot history and timeline selection rather than adding another timeline store. CJS caption contracts/helpers are shared by Electron acceptance and the existing Node tests; strict TS owns React UI. Six resolved presets require no font/network/dependency download. Preview and export use one deterministic renderer. Gesture preview is transient and commits once; new-project generation guards reject obsolete commits. See CAPTIONS.md for complete workflow, tests and deferred boundaries.

Spoken-caption display modes are optional visual-style data, leaving transcript originals untouched. Templates default to the persisted generated caption set; individual overrides remain explicit. Preserve audio/visual track compatibility and offer compact rows plus AddTrack rather than changing project ownership rules. Background replacement is one undoable edit to an ordinary bottom track; video is cover-fitted, muted and never extended beyond its source. Existing captions/narration and unrelated tracks remain unchanged.

Phase 7.5: selected audio/video transcription, reference-based audio detachment, grouped caption generation and transcript export reuse the established timeline/history/native worker boundaries. See [Audio and transcripts](AUDIO_TRANSCRIPTS.md). Source timestamps are canonical; reviewed text never fabricates word alignment. No dependency or Python server was added.
