# MotionCraft roadmap

Current milestone: Phase 4 multi-track timeline working slice. Follow ENGINEERING_STANDARDS.md before future work. Composition preview is the recommended next milestone.

- [x] Next.js application created and running (user confirmed)
- [x] Electron dev window and secure preload IPC verified (automated desktop smoke test)
- [x] Session media library: native selection handler, safe asset URLs, search/filter/grid/list UI and image/video/audio preview (automated tests; dialog results stubbed)
- [ ] Manually verify Windows native multi-selection and representative MP4/MOV/MP3/JPG/WebP files (see MEDIA_IMPORT.md)
- [x] Editor workspace shell: media sidebar, source monitor, inspector, empty scene tab/timeline rows; resizing, preferences, shortcuts and fullscreen verified
- [x] Scene/layer model and scene management; inspector layer creation/editing and derived real timeline clips
- [x] Versioned project/scene/layer/track/clip/asset schema with strict Zod validation
- [x] JSON paste/upload/export, sample document, validation summary and confirmed replacement
- [x] Native local project save/open, trusted media bindings, missing-media relinking and unsaved-change protection
- [x] Snapshot undo/redo for scene, layer and project settings operations
- [x] Timeline media drag-and-drop, move/trim/split, selection/copy/paste/delete, snapping, track controls, bounded undo/redo and persistence
- [ ] Timeline ripple/slip/stretch, cross-scene layer transfer, multi-track group transfer, waveform generation and large-project profiling
- [ ] Remotion preview and local MP4 export via FFmpeg
- [ ] Captions, transitions, basic keyframes
- [ ] Local backend/persistence and background jobs as needed
- [ ] Ollama and faster-whisper pipeline
- [ ] Asset semantic search, RAG and controlled agents
- [ ] Windows packaging, tests, CI/CD and future web investigation

Each milestone must yield a verifiable working slice. Update checkboxes only after successful testing.

Schema v2 and local JSON persistence are implemented, with strict v1 validation and migration before reviewed replacement. Timeline editing is real; the source monitor still plays original media, not compositions. Native dialogs use substituted responses in automated tests; actual picker interaction, codecs, high-DPI gestures and long-project profiling remain manual checks. Rendering, autosave/crash recovery and packaged Electron loading are incomplete. See [Timeline](TIMELINE.md).
