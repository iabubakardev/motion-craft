# Phase 7.5 � Audio and transcripts

## Workflow

1. Import a video with audio and place it on the timeline. Right-click **Detach Audio**, use the clip inspector, or use the timeline toolbar. The video is muted and an independent audio clip appears with the same source range and timeline position. Volume, mute and fade controls are in its inspector. Undo restores the original state.
2. Select an audio/video clip and choose **Generate captions**, **Transcribe**, or **Export Transcript**. Video context menus also offer **Transcribe Video Audio**. The selected clip is the source; no additional file dialog opens. Multiple eligible selections show a source-choice dialog. Without a compatible clip, the selected library asset is used, otherwise the source picker appears.
3. Start transcription, review/edit text and select word, sentence, duration, count, characters, paragraph, continuous or smart grouping. Set duration mode to 2 seconds for two-second groups. Smart mode uses deterministic punctuation, pauses and readability limits, not another model.
4. Copy the export preview or save TXT (plain, inline timestamps or timestamped lines), SRT, VTT, JSON or CSV. Choose source, clip-relative or timeline timestamps. Subtitle formats always use their required millisecond clock. Other text formats offer minutes/seconds or hours/minutes/seconds, optional milliseconds and line layout.
5. Generate captions, then use existing caption templates and editing tools. Changing grouping alone changes the preview only. Regenerating a transcript's existing captions asks for confirmation; replacement preserves their first visual style and unrelated captions. Undo restores the previous edit.
6. Save/reopen the project and export MP4 through the existing rendering workflow.

## Audit and implementation decisions

Existing foundations reused: schema-v4 scene/layer and standalone clips, media asset IDs and native trusted bindings, one timeline selection store, immutable commands and snapshot history, approved-file FFmpeg adapter, supervised external-worker NDJSON protocol, canonical transcript archives, caption presets/append operations, shared Remotion Player/export composition, native save dialogs and project persistence.

New clip fields are optional: `audioOnly`, `muted`, `volume`, `fadeIn`, `fadeOut`, `detachedFrom`, `detachedAudioId`. Existing v4 projects remain valid. An `audioOnly` clip references a video asset on an audio track; detachment performs no re-encoding and creates no duplicate media. Derived clip metadata survives scene reconstruction. A suitable unlocked, non-overlapping audio track is reused or created. Duplicate detachment is rejected. No-audio videos produce an actionable error without a project edit. Async inspection guards the selected clip/project without rejecting unrelated metadata completion.

Transcript version 1 adds optional `status: completed` and `context` (clip ID, source start/end, timeline start and rate=1). Original segments remain separate from reviewed result segments. Transcription executes only the chosen source interval: the supervised worker decodes that interval to temporary PCM, calls the existing Python worker unchanged, then rebases returned segment/word timestamps to source coordinates. For ranged transcripts `result.duration` is the absolute source endpoint, not the cropped file length. Context retains the actual interval.

The main process accepts asset IDs, bounded settings/ranges and export text, never renderer-supplied media/executable paths. A bounded, trusted write-only clipboard action supports Copy without granting renderer clipboard-read permissions. Inspection verifies regular-file canonical identity, inode, size and mtime before/after probing. Transcript save validates exact IPC arguments, format and 5 MB limits, revalidates owner/origin after the dialog, writes a unique temporary sibling and renames it. Paths stay native-owned. Range decoding is bounded, shell-free, supervised and cleaned up on success/failure, with best-effort process-exit cleanup.

Completed reviewed transcripts are reused by asset ID, size/mtime, model/device/compute and source interval. **Re-transcribe** explicitly bypasses reuse. This is a project-local cache, not a global cache. Export grouping is derived data; no second word-timing source is persisted. Reviewed text without valid positive word alignment stays an intact segment. Zero-duration Whisper words likewise cause segment-level fallback; no word timestamps or speakers are invented. JSON word times use the same selected basis as group times.

## Changed areas

- `core/project/{schema,operations}.cjs`, `core/timeline/{commands,audio}.cjs`: clip metadata, detachment/audio edit commands and preservation.
- `core/transcription/{schema,grouped-captions}.cjs`, `grouping.ts`, `source.ts`: context contracts, pure grouping/export, selection resolution and atomic caption generation.
- `core/ai/schema.cjs`, `workers/{ai,audio-range}.cjs`: selected-range requests and supervised interval preparation.
- `electron/{preload.cjs,ipc/ai.cjs}`, `platform/{app.ts,transcription.ts}`: validated inspection and secure export capabilities.
- `features/ai/{transcription-panel,transcript-center,transcription-source-choice}.tsx`: source-aware review, grouping and export controls.
- `features/{editor/editor-workspace,captions/caption-inspector,timeline/timeline-panel,timeline/clip-properties}.tsx`, `features/projects/use-project-document.ts`: editor integration and guarded atomic changes.
- `rendering/{input.cjs,project-composition.tsx}`: audio-only video references, independent mute/volume and fades shared by preview/export.
- Tests: `core/transcription/grouping.test.cjs`, `electron/ipc/ai.test.cjs`, `electron/audio-transcript-smoke.cjs`, updated `electron/transcription-smoke.cjs`; package test commands.

## Verification and limits

`npm run check` runs lint, strict TypeScript and domain/security/lifecycle tests. `npm run test:audio-transcripts` requires the local tiny model, `tools/motion-craft-ai/.venv/Scripts/python.exe`, its worker and `test.mp3`; it does not download models. It creates an isolated speech video, trims it to source 1�5 seconds at timeline 4 seconds, detaches through the UI, tests undo/redo, runs real inference, saves every transcript format, generates captions, saves/reopens and renders H.264/AAC. Encoded audio level and silence before the clip check synchronization and absence of doubled video audio. Native dialogs are substituted, not physically clicked.

Normal speed only: the existing strict project format has no speed/remapping model. This work does not add one. Source and timeline mapping therefore use rate=1. Group minimum duration is a preference; applicable maximums and genuine speech boundaries take priority. A single unaligned segment or indivisible long word may exceed requested grouping limits rather than invent timing. Continuous mode intentionally returns one group; very large groups can exceed existing caption field limits and must be regrouped. Filler filtering is a small English heuristic. No diarization or semantic paragraph model is supplied. Caption templates retain their own typography/line-limit settings.

GPU, broad codecs, long recordings, packaged Python/runtime/fonts and physical high-DPI gestures remain manual/release gates. Native transcript saving requires Electron; browser users can copy the preview. Hard process termination can leave a temporary range directory if Windows still holds the file open. No optional standalone Extract Audio File action was added; detachment remains a reference edit.

Manual checks: exercise actual native export/cancel/overwrite dialogs; select multiple clips and choose a source; try a silent video; adjust detached-audio gain/fades and trim independently; reuse/retranscribe a saved transcript; cancel caption replacement; apply templates and inspect preview/export; check a long multilingual recording. Recommended next phase: waveform generation and long-form performance/codec acceptance, followed by packaged offline runtime validation.

## Phase 7.5 verification record (2026-11-07)

- `npm run check`: lint (one existing unused-variable warning in `workers/asset-index.cjs`), strict TypeScript and 139 unit/security/lifecycle tests pass.
- `npm run build`: optimized production build passes.
- `npm run test:transcription`: real tiny/CPU/int8 inference, review/edit/seek, captions, undo/redo, native save/reload and explicit retranscription cancellation pass.
- `npm run test:captions`: six preset preview/encoded frame comparisons, caption selection, gestures, templates, subtitle exchange and persistence pass.
- `npm run test:timeline`: real captured clip gestures, context menus, multi-clip operations, migration and save/reopen pass.
- `npm run test:audio-transcripts`: real speech-video detachment, selected trimmed inference, exports, caption placement, save/reopen and encoded audio gain/start checks pass. Source 1�5 seconds is placed at timeline 4 seconds; silent video stream inspection also passes.

No new dependencies were added. These runs use development Electron and substituted native picker results; the manual/release limits above still apply.
