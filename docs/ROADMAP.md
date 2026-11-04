# MotionCraft roadmap

Current milestone: Phase 3 foundation hardening and validation. Phase 4 multi-track editing has not started. Follow ENGINEERING_STANDARDS.md before future work.

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
- [ ] Timeline drag-and-drop, trim/split and advanced clip editing
- [ ] Remotion preview and local MP4 export via FFmpeg
- [ ] Captions, transitions, basic keyframes
- [ ] Local backend/persistence and background jobs as needed
- [ ] Ollama and faster-whisper pipeline
- [ ] Asset semantic search, RAG and controlled agents
- [ ] Windows packaging, tests, CI/CD and future web investigation

Each milestone must yield a verifiable working slice. Update checkboxes only after successful testing.

Project schema v1 and local JSON persistence are implemented. Native dialogs are exercised through substituted responses in automated tests; actual picker interaction and representative codec coverage remain manual checks. Timeline entries are validated data projections, not composition playback. Rendering, autosave/crash recovery and advanced timeline editing remain incomplete.
