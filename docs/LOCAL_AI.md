# Local AI production working slice

Phase 7 is **not fully accepted**. The editor, contracts and optional local integrations are implemented; real inference is still unverified on this machine. Ollama is reachable with zero installed local models. Python 3.11 is installed, but faster-whisper and its model files are absent. No model or Python package was installed or downloaded during this change.

## Workflow

Open **AI** in the toolbar; local runtime detection starts automatically. The modal shows the connected Ollama server version separately from installed model availability. Use Detect local AI to refresh, select an installed Ollama model, then paste a script or choose imported MP3/WAV narration. Script timing is explicitly estimated using the selected words/minute. Narration uses source timestamps. Change project FPS/aspect ratio in Project settings before opening the workflow; applying a plan with different settings is rejected.

For audio, select a local transcription model and language code (blank detects language). Transcription runs in a separate Python process using CPU int8. Segment times and optional word times are preserved in seconds. Correct segment text without retranscription; correcting text removes that segment's obsolete word alignment. Discard the transcript draft explicitly before transcribing again. Download transcript JSON to retain corrections and original alignment metadata.

Generate a scene plan, review visual descriptions, inspect ranked imported assets and choose replacements or **Unmatched / background**. Ranking uses filename tokens, requested media type, duration and aspect ratio. It does **not** inspect image contents or use embeddings. The metadata score is a ranking heuristic, not an accuracy/confidence probability. Automatic suggestions require keyword overlap and score >= 0.6. No external assets are downloaded.

Approve the checkbox and append the plan. Nothing changes in the project before approval. Application is one undoable command after the existing project duration; it never replaces existing scenes or moves existing clips. If standalone clips extend beyond the scene sequence, an empty spacing scene preserves canonical contiguous scene ownership. Reapplying the same scene IDs rejects rather than duplicating them. Required tracks must exist and be unlocked.

- V1 receives selected image/video layers; shorter footage leaves background after its source ends, without looping or stretching.
- V4 receives editable segment-caption layers when a transcript is available. Intervals crossing scene boundaries are split only for scene ownership; their visible timing remains continuous.
- A1 receives the original narration asset, with source range starting at zero.
- Supported presets generate ordinary v3 animation keys. Unmatched scenes retain background and visual descriptions in scene notes.

Script-only plans do not invent audio or captions. Word-level caption effects and Phase 6's unfinished typography/transitions are not added here. Save/open and MP4 export use the existing project and render pipeline. Source transcript/word metadata and the resumable plan are separate downloadable AI JSON; the project saves the resulting editable clips, captions and scene notes, not a duplicate AI state store.

Closing the wizard discards its unsaved draft and cancels its active job. Save plan/transcript JSON first when needed. There is no automatic draft persistence or fingerprint result cache. If the project changes during generation/review, applying the stale baseline rejects; import the saved AI plan and review against the current document.

## Ollama setup

Start a locally installed Ollama server on `127.0.0.1:11434`. Run `ollama list` to inspect installed models. Install a local text model manually using Ollama's tools after reviewing its size, license and hardware requirements. MotionCraft does not install models or contact cloud providers. Model names identifying cloud/remote models and server-reported remote model/host metadata are rejected. Only the fixed loopback endpoint is used; HTTP redirects are rejected.

The adapter uses [`/api/tags`](https://docs.ollama.com/api/tags) for discovery and [`/api/chat`](https://docs.ollama.com/api/chat) with a JSON schema, `stream:false`, bounded context/output and `keep_alive:0`. Models must support structured JSON; unsupported models produce an actionable failure, not a fabricated plan. There are at most two attempts per batch. Inference temperature is configurable. The model supplies visual descriptions/keywords only; it never controls timing, filesystem access or editing commands.

Detection reports service reachability and locally advertised model availability. If the service is stopped, the UI asks you to start it; it does not claim that an unreachable service proves Ollama is uninstalled. The selected model's actual speed, memory footprint and output quality need hardware/model-specific testing.

## Python / faster-whisper setup

This optional adapter targets Python 3.9+ and the faster-whisper 1.2.1 API. Python 3.11 was detected here. The upstream package is MIT licensed; its native dependencies, decoder binaries, model licenses and security updates require review before distributing a bundled environment. No npm dependency was added, and no Python runtime is bundled or claimed verified.

Example **manual** setup (downloads Python packages, not model weights):

```powershell
py -3.11 -m venv .venv-ai
.\.venv-ai\Scripts\python.exe -m pip install faster-whisper==1.2.1
$env:MOTIONCRAFT_PYTHON = (Resolve-Path .\.venv-ai\Scripts\python.exe).Path
$env:MOTIONCRAFT_WHISPER_MODELS = 'D:\Models\MotionCraft\whisper'
npm run electron:dev
```

The documented `.venv-ai/` environment and Python bytecode caches are ignored by Git. Keep models outside source. If launched from an IDE, configure those environment variables in the Electron launch environment. Restart Electron after changing them. Without `MOTIONCRAFT_PYTHON`, the trusted host PATH's `python` is used; the renderer cannot supply an executable or arbitrary arguments. Model paths stay inside the worker and never enter project JSON.

Place complete, user-obtained CTranslate2 Whisper model directories directly under `MOTIONCRAFT_WHISPER_MODELS`, for example `tiny-en/`. Each detected model requires `model.bin`, `config.json` and `tokenizer.json`; retain all other model files too. Empty/incomplete directories are not advertised as installed. No model download command runs automatically. `local_files_only=True` and offline hub settings are used. Requiring a local tokenizer avoids the upstream tokenizer-download fallback.

The supported execution mode is **CPU int8**, with at most four CPU threads. GPU selection is deliberately unavailable, so CUDA is never assumed compatible. Upstream's current GPU requirements include CUDA 12/cuBLAS and cuDNN 9; GPU support would require compatibility probing, an explicit selection/fallback policy and real testing before enabling it. MP3/WAV decoding uses faster-whisper's PyAV dependency, which bundles FFmpeg libraries, rather than a PATH FFmpeg executable. See [upstream requirements and CPU usage](https://github.com/SYSTRAN/faster-whisper#requirements).

## Contracts and architecture

`core/ai/schema.cjs` defines separate version-1 transcript and scene-plan contracts. The project stays schema v3. `core/ai/planning.cjs` owns deterministic grouping, bounded scene durations, metadata matching and append conversion. Nearby sentence ends/known segment boundaries guide grouping when they satisfy duration bounds; long segments can span multiple visual scenes while their source timestamps remain unchanged. A narration shorter than the minimum remains one short scene. There are at most 512 scenes; longer work must be split into plans. The LLM sees at most four scenes per batch and 1,000 narration characters per scene; full narration is retained in the plan.

`platform/ai.ts` validates bridge results and provides browser-unavailable inference states. External plan JSON review/apply remains usable without Electron. `features/ai` owns transient wizard/job state; it never imports Electron or touches native paths. Applying uses the existing `useProjectDocument` command/history boundary with a baseline identity check and track-lock guard.

`electron/ipc/ai.cjs` exposes only start(request), status() and cancel(jobId), with exact tuples, owning-window/main-frame/origin validation and approved narration asset IDs. Trusted bindings are rechecked for canonical file identity before and after transcription. The worker receives native paths internally; the renderer does not. Unsupported audio types and missing/replaced assets reject. AI output is data only and is rendered as text, never executed.

`electron/ai-jobs.cjs` supervises a Node child; `workers/ai.cjs` runs provider orchestration and supervises `workers/transcribe.py`. The Python stdin/stdout JSON-lines protocol is version 1 and bounded; every message and final result is validated. AI and rendering share process-tree termination primitives in `electron/child-process.cjs`. Existing render-specific atomic-output logic remains intact. AI/export busy checks prevent conflicting heavy work and output-picker races; no database, queue service or second project store was introduced.

States are preparing, running, validating, completed, failed, cancelling and cancelled (idle is the empty UI state). Discovery has a 30-second supervisor limit; production tasks have a 30-minute limit. Individual Ollama calls time out after 120 seconds. Planning reports named stages, not invented percentages. Transcription progress uses actual emitted segment end / audio duration. Cancellation ignores late results and keeps its slot until worker exit. Navigation, window destruction and application shutdown release owned jobs. No model/service process installed by the user is forcibly stopped; cancellation terminates only owned workers and their children.

## External JSON

Use the wizard's **External scene-plan / transcript JSON** section to paste or upload up to 5 MB, validate, review, change assets and approve. This is distinct from **Import JSON** for complete MotionCraft projects. Unknown fields/versions and invalid timings/references reject. No arbitrary CSS, commands, media URLs or paths are allowed.

- [Scene-plan JSON Schema](../public/ai-scene-plan.schema.json)
- [Transcript JSON Schema](../public/ai-transcript.schema.json)
- [Unmatched script-plan example](../public/ai-plan-sample.json)

Scenes must be contiguous from zero, with unique IDs and positive durations ending at plan duration. Narration plans require an original transcript with matching duration; script plans use `timing: "estimated"` and `transcript: null`. Asset IDs must refer to imported project assets or be null. Transcript source IDs must match the original imported narration; relink it before application. Schema documents describe structure; Zod additionally enforces cross-field timing, ordering, IDs, transcript text consistency and source relationships.

## Tests and acceptance

`npm run check` runs deterministic domain, IPC, lifecycle and provider tests without AI models or Python. Provider responses are mocked only in those tests. `npm run test:ai` uses real Electron/IPC, runtime discovery, isolated generated media, a clearly labeled external-plan fixture, explicit asset approval, timeline/history, native save/open and an actual H.264/AAC MP4. Native pickers are substituted. The fixture's tone and known timestamps are not a speech-recognition test.

`npm run test:ai:models` runs optional real-provider checks and prints explicit SKIP messages when models are unavailable. To enable actual transcription, configure Python/models and set `MOTIONCRAFT_TEST_AUDIO` to an MP3/WAV recording. Optional `MOTIONCRAFT_TEST_OLLAMA_MODEL` and `MOTIONCRAFT_TEST_WHISPER_MODEL` choose installed models. This command never pulls models. A skipped test is not acceptance evidence.

| Phase 7 item                           | Evidence / status                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ollama connection and installed models | Real discovery passes; service running, model list empty                                           |
| Local narration transcription          | Adapter implemented; real inference unverified (package/model absent)                              |
| Preserved transcript timestamps        | Strict contracts/core tests and external fixture verified                                          |
| Captions from transcription            | Conversion verified with timestamped fixture; real transcription-to-caption run pending            |
| Valid Ollama scene plan                | Structured adapter/repair tests pass; real inference pending                                       |
| Relevant visual descriptions           | Descriptions are editable and contract-tested; real-model relevance not verified                   |
| Ranked imported assets                 | Deterministic metadata ranking tested; no semantic image understanding claimed                     |
| Review/change proposed assets          | Real wizard asset selection and explicit approval verified                                         |
| Editable timeline clips                | Real V1/V4/A1 clips and one-step undo/redo verified                                                |
| Save/export generated project          | Reviewed external-plan project saves/reopens and exports real MP4; full AI-origin workflow pending |

Full 10/10 acceptance remains open. CPU inference quality/performance, silent/non-speech audio handling, model-specific structured-output behavior, GPU operation, long-project memory/profiling and production packaging remain unverified. Existing Phase 6 and release/security gates remain open.

Recommended next task: install an explicitly chosen local Ollama model and a complete small Whisper model, run the optional checks with representative spoken narration, then verify transcript correction → planning → captions → export. Only after that evidence should the inference-dependent acceptance items be checked.

## Troubleshooting

- No Ollama models: install a local text model manually and Detect again; cloud models are filtered out.
- Python unavailable: point `MOTIONCRAFT_PYTHON` at the desired environment's Python and restart Electron.
- No Whisper models: verify the model root and complete model files; no implicit download fallback is offered.
- Invalid transcript: verify ordered positive segment/word times and source duration. Corrected text must match aggregate transcript text; remove obsolete word alignment after correction.
- Structured output rejected: try a model with JSON-schema support or simplify the instructions/input; at most one repair retry runs per batch.
- Stale/locked plan: save the plan JSON, resolve track locks or project changes, then reimport and review.
- Transcription/job failure: verify dependencies, model files, available memory and source media; the existing project remains untouched.

## Changed files

- Added domain/contracts/tests: `core/ai/{schema.cjs,planning.cjs,ai.test.cjs}`.
- Added UI/adapters: `features/ai/{ai-production.tsx,use-ai-job.ts}`, `platform/ai.ts`.
- Added supervised execution/tests: `electron/{ai-jobs.cjs,ai-jobs.test.cjs,child-process.cjs,ai-smoke.cjs}`, `electron/ipc/{ai.cjs,ai.test.cjs}`, `workers/{ai.cjs,ollama.cjs,transcribe.py,ai.test.cjs,check-ai.cjs}`.
- Added portable schemas/example: `public/{ai-scene-plan.schema.json,ai-transcript.schema.json,ai-plan-sample.json}`.
- Updated integration: `electron/{main.cjs,preload.cjs,render-jobs.cjs,smoke.cjs}`, `electron/ipc/render.cjs`, `features/editor/editor-workspace.tsx`, `features/projects/use-project-document.ts`, `platform/app.ts`, `package.json`, `tsconfig.json`, `.gitignore`.
- Updated product/setup records: `README.md`, `docs/{ARCHITECTURE.md,DECISIONS.md,ENGINEERING_AUDIT.md,PROJECT_CONTEXT.md,ROADMAP.md}` and this guide. No lockfile/package dependency changes were needed.

Verification on 2026-11-05: lint, generated-route TypeScript, 85 deterministic tests, production build and native desktop/project/timeline/animation/render/AI suites passed. The real-model command explicitly skipped generation/transcription because models/dependencies are absent. The reviewed external-plan artifact is `.next/ai-smoke-EFuQoG/ai.mp4` (320?180, 30 fps, 2 seconds, H.264/AAC); ignored test profiles/media are not application assets.

Ollama detection follow-up: `/api/version` identifies the running service independently of `/api/tags`. An empty list reports a connected installation with no local models; a model-list error retains the connected version. The verified server version is 0.40.14 with zero models. If the AI bridge is absent in an older Electron window, restart Electron (page reload does not replace preload).
