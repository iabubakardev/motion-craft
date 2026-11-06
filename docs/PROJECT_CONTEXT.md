# MotionCraft product context

MotionCraft is a local-first AI-assisted Windows desktop video editor, not merely an MP3-to-video generator. A future web edition should be possible.

## Core workflows

- Import scripts, narration, images, footage, audio, SVGs and other assets.
- Manually build and edit a multi-track timeline with preview, scene manager, inspector and captions.
- Import/export a versioned, validated scene-plan JSON from external LLMs.
- Generate/edit scenes and captions using optional local AI (Ollama, faster-whisper).
- Preview with Remotion and export MP4 locally with Remotion/FFmpeg.
- Preserve user edits; each scene can be independently edited or regenerated.

## Constraints

- No required paid APIs or cloud inference.
- Multiple visual styles; do not hardcode finance-channel styling.
- Local media files should remain outside the database.
- Support long projects, autosave, undo/redo, failure recovery and progress reporting as development advances.
- Validate all AI/external inputs; human review of factual claims.

## Current status

Next.js/Electron development, scene/layer editing, strict JSON exchange, native persistence and the Phase 4 multi-track timeline working slice are verified. Timeline operations include insert, move, trim, split, selection, copy/paste/delete, track controls and snapshot undo/redo. Schema v3 preserves seconds and canonical scene ownership, adds clip-owned frame keyframes, and validates v1/v2 migration. Animation keyframes/presets and shared preview/export evaluation are implemented; transitions, expanded typography and dedicated manual/animated caption workflows remain incomplete. See [Animation](ANIMATION.md). Zustand isolates transient timeline interactions. Project files contain IDs/metadata; native path bindings remain in trusted app data. Source preview still plays originals; the Phase 5 Timeline monitor and MP4 worker use a shared Remotion composition. Local H.264/AAC export, native output selection, progress/cancel, approved loopback media serving and real output verification are implemented. A Phase 7 local AI working slice now provides runtime discovery, optional Ollama/faster-whisper adapters, transcript correction, scene-plan review, metadata asset ranking and atomic append conversion. Phase 7.1 real qwen3:8b structured script planning and editable Electron review are verified; faster-whisper transcription remains unverified; see [Local AI](LOCAL_AI.md). Waveform generation, advanced ripple/scene transfer, autosave/crash recovery and packaged Electron loading remain incomplete. Native pickers, codec coverage and long-project performance require further manual/profiling work.

For full requirements consult `MotionCraft_Project_Handoff.md` when present in the repository or conversation.
