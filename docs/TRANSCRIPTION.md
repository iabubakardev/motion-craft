# External transcription (Phase 7.3 Part B)

Use **Transcribe** in the desktop toolbar. This integration uses the separate Python-only `motion-craft-ai` repository and its documented protocol v1. No Python implementation was copied or changed. The existing AI planning wizard and its older transcript-sidecar workflow remain compatible; this dedicated panel is the external-worker integration.

## Setup and configuration

Prepare Python dependencies and the cached `tiny` model in the external repository using its README. Model installation is explicit and separate; MotionCraft never installs packages, downloads models or calls cloud APIs during transcription.

Open **Transcribe**, then **Choose Python and worker**. Native file dialogs select the interpreter and `motion_craft_ai/worker.py` entrypoint. For this developer machine, examples are:

- Python: `D:\Automation\motion-craft-ai\.venv\Scripts\python.exe`
- Worker: `D:\Automation\motion-craft-ai\motion_craft_ai\worker.py`

These are examples, not defaults. The application derives the AI repository cwd from the selected module file and launches the fixed module `-m motion_craft_ai.worker`, with `shell:false`. No renderer-supplied command, module argument or media path is accepted. Settings are validated and atomically saved in Electron userData as `transcription-settings.json`; paths are separate from project JSON. Select the default model/device/compute type and choose **Save transcription defaults**. CPU/int8/tiny is verified; CUDA and auto are selectable but hardware compatibility is not verified.

Worker availability means the selected interpreter and entrypoint exist. Actual dependency/model loading is verified at job start; configuration does not imply the cache is complete. Configure the external worker's model cache in the Electron launch environment if using HF_HOME/HF_HUB_CACHE. No Python environment is bundled.

## Review and captions

1. Import supported audio or video, then select it in **Transcription source**. Unsupported/corrupt decoder input produces an error.
2. Choose a model, start transcription, and observe named stages and segment end times. No invented progress percentage is shown. Cancel or close the panel to terminate the owned job.
3. Click a timestamp to seek the panel's original-source preview. Correct segment text. Original text and word alignment remain archived; corrected segments clear obsolete word alignment.
4. Choose **Save reviewed transcript** to persist the review without captions, or **Generate Captions** to save the transcript and add clips atomically.
5. Captions use source timestamps plus an explicit project-frame offset. Place source audio/video on the timeline separately; its placement is never guessed. Dedicated **Captions** is above existing visual tracks. Clips are ordinary inspector-editable caption layers rendered by the existing Remotion composition.

Start/end boundaries use existing project-FPS conversion and positive integer frame intervals. Tiny positive segments get at least one frame. At canonical scene boundaries, captions split into scene-owned layers without extending/moving existing scenes; a tail scene covers uncovered time. Existing captions/manual content remain intact. Generating again from a saved transcript with live caption references rejects instead of replacing clips. Edit those clips in the inspector, or remove them explicitly first. Transcript review edits do not silently rewrite already-created caption text.

Generation/save is one history command. Undo/redo includes transcript data and caption references. Deleting caption clips prunes their references on document rebuild. Reopen the panel and choose **Review saved transcript** after project open. Closing with an unsaved review discards that draft; choose Save reviewed transcript first. Source timestamps stay in seconds; caption clips use seconds corresponding to project frame boundaries. Empty/silent results can be saved but create no captions.

## Protocol and security

The adapter follows `motion-craft-ai/docs/worker-protocol.md`: one compact stdin request with protocolVersion/jobId/action/audioPath/model/device/computeType/options, then NDJSON started, model_loading, model_ready, segment and completed/error events. UTF-8 is decoded across arbitrary chunk boundaries. Zod validates fields, ordered transitions, request/result identity, timestamp bounds and streamed/final segment consistency. A result commits only after completed **and** successful process exit. Error messages are mapped to safe actions rather than exposing native paths or worker tracebacks.

Total stdout is capped at 32 MB, each line at 8 MB, stderr diagnostics at 16 KB; project JSON remains limited to 5 MB. Oversized results fail explicitly. Stderr is bounded in memory and discarded after the job, not persisted or sent to the renderer. Existing AI supervisor provides a 30-minute deadline, one active job, owner isolation, cancellation, shutdown/navigation cleanup and AI/export exclusion. Cancellation kills only the application's owned worker tree. Python bytecode writes are disabled so loading the external package does not alter that repository.

IPC start accepts imported asset IDs and bounded model/device preferences. Electron resolves the approved path and rechecks file identity before/after inference. Interpreter/entrypoint paths can only be changed through native selections. Browser mode reports desktop unavailable. Settings read/configure and job operations validate trusted owning main-frame senders and exact tuples.

## Persistence

Project schema v4 adds `transcripts`. Each record has its own version 1, job ID, source asset ID, safe source fingerprint metadata, original segments, reviewed result, execution/model metadata and generated caption clip IDs. Absolute audio/interpreter/worker paths and media binaries never enter projects. Strict v1/v2/v3 input validation precedes reviewed migration to v4; earlier editing/animation data and IDs are preserved and transcripts initializes empty. Saves/exports use v4. Older application versions do not support v4 files.

## Verification

`npm run check` covers mocked process/NDJSON/configuration failures, transcript editing, frame conversion, captions/history, JSON round trips, migration and existing domain/security tests. Run the optional real desktop acceptance against an existing dev server:

```powershell
$env:MOTIONCRAFT_TRANSCRIPTION_PYTHON = 'D:\Automation\motion-craft-ai\.venv\Scripts\python.exe'
$env:MOTIONCRAFT_TRANSCRIPTION_WORKER = 'D:\Automation\motion-craft-ai\motion_craft_ai\worker.py'
$env:MOTIONCRAFT_TEST_AUDIO = 'D:\Automation\motion-craft-ai\test.mp3'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:transcription
```

These variables configure only the isolated integration test, not universal app defaults. Missing variables print SKIP; a skip is not acceptance. Native file dialogs are substituted in this test. Real worker verification on 2026-11-06 returned seven segments over 31.344 seconds using cached tiny/CPU/int8. Real Electron verification covers review/edit/source-seek, visible composition captions, atomic history, native save/reload and cancellation. Broader video/codecs, GPU/auto, long recordings, physical native dialogs and packaged deployment remain unverified.

## Changed files and final checks

No dependencies were added. All 103 unit/security/lifecycle tests, strict TypeScript, lint and scoped formatting pass (one existing unused-variable lint warning remains in the asset index worker). Real transcription acceptance and native desktop/project/timeline/AI export regressions pass. Production build and packaged distribution were not tested for this change.

- `README.md`
- `core/ai/schema.cjs`
- `core/animation/animation.test.cjs`
- `core/project/ipc.cjs`
- `core/project/operations.cjs`
- `core/project/project.test.cjs`
- `core/project/schema.cjs`
- `core/project/types.ts`
- `core/timeline/timeline.test.cjs`
- `core/transcription/commands.cjs`
- `core/transcription/fixture.cjs`
- `core/transcription/schema.cjs`
- `core/transcription/transcription.test.cjs`
- `core/transcription/types.ts`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/LOCAL_AI.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_FORMAT.md`
- `docs/ROADMAP.md`
- `docs/TRANSCRIPTION.md`
- `electron/ai-jobs.cjs`
- `electron/ipc/ai.cjs`
- `electron/ipc/ai.test.cjs`
- `electron/preload.cjs`
- `electron/project-smoke.cjs`
- `electron/timeline-smoke.cjs`
- `electron/transcription-settings.cjs`
- `electron/transcription-settings.test.cjs`
- `electron/transcription-smoke.cjs`
- `features/ai/transcription-panel.tsx`
- `features/editor/editor-workspace.tsx`
- `features/projects/json-import-dialog.tsx`
- `features/projects/use-project-document.ts`
- `package.json`
- `platform/app.ts`
- `platform/transcription.ts`
- `workers/ai.cjs`
- `workers/transcription.cjs`
- `workers/transcription.test.cjs`

AI Production also uses the configured external worker for narration with CPU/int8. Its model list shows supported choices (tiny/base/small/medium), not a cache inventory; missing models fail explicitly without downloading. The legacy environment-based worker remains a fallback when the external worker is not configured. Language auto-detection is used for the external worker. The Transcription panel scrolls within the window and provides an Import transcription source button; unavailable sources remain visible with a relink hint.

Both transcription buttons display their blocking requirements beside the action (worker setup, source selection/availability, model selection and active work). Start transcription shows an explicit alert for failed jobs. Python dependencies and model cache availability are validated at job start, not inferred from configuration alone.

Development builds automatically detect `tools/motion-craft-ai/.venv/Scripts/python.exe` and `tools/motion-craft-ai/motion_craft_ai/worker.py` relative to the application root. Valid saved configuration takes priority. Missing settings or missing files in an old configuration fall back to tiny/CPU/int8 defaults without rewriting the settings file. Corrupt or unreadable configuration remains an explicit error. Use Save transcription defaults for custom preferences; native selection remains available. Packaged builds retain manual configuration until a packaged runtime strategy is implemented. The local worker checkout (including its environment and test media) is ignored by the parent repository. Moving a Python virtual environment may require recreating it; test the interpreter at its new location.

The panel displays the selected interpreter and worker in read-only fields. When configured, Change Python and worker is optional; native pickers open at the current paths. No selection dialogs are required before starting with detected defaults.

The primary transcription flow starts with Choose audio file (native media import and automatic source selection) or an existing Audio source. Runtime paths, model/device/compute choices and configuration actions are under collapsed Advanced settings. Defaults remain automatic; missing setup and job failures remain visible beside Start transcription.

Phase 7.5 extends this workflow with selected clip source resolution, interval-only inference, reviewed project-local reuse, grouping and multi-format native export. See [Audio and transcripts](AUDIO_TRANSCRIPTS.md) for current behavior and verification; this supersedes the earlier picker-first description when a clip or library asset is selected.
