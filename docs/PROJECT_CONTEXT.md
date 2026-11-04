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
Next.js/Electron development and the resizable workspace are verified. Phase 3 adds strict schema v1 project documents, scene/layer management, real timeline data, snapshot history, JSON paste/upload/export, confirmed replacement, native save/open and trusted missing-media relinking. The source monitor still previews original files, not compositions. Native dialog responses are substituted in automated tests; actual Windows picker interaction and representative codecs remain manual checks. No dependencies were added. Project files contain IDs/metadata while native path bindings stay in trusted app data. Composition rendering, advanced timeline editing, autosave/crash recovery, AI and packaged production runtime are not implemented.

For full requirements consult `MotionCraft_Project_Handoff.md` when present in the repository or conversation.
