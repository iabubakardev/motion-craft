# MotionCraft roadmap

Current milestone: Phase 7 local AI working slice (worker integrations and reviewed plan-to-timeline flow). Real inference is unverified: Ollama has no local models and faster-whisper is absent. Phase 6 transitions/caption effects remain pending. Follow ENGINEERING_STANDARDS.md before future work. Production desktop packaging/security and representative media validation are recommended next.

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
- [x] Shared Remotion composition, synchronized Player preview, local H.264/AAC MP4 worker, secure media resolver, progress/cancel and verified output
- [x] Workspace stabilization: default linked canvas, mount-safe Player sync, icon controls, fitted/focused canvas and responsive portrait checks
- [ ] Direct canvas selection/handles and representative daily-workflow UX review (see WORKSPACE_REVIEW.md)
- [ ] Packaged offline rendering runtime, Remotion distribution-license review and broad codec/performance testing
- [x] Validated animation keyframes, easing, presets, inspector/timeline markers and shared preview/export evaluation
- [ ] Compatible transitions, expanded typography and dedicated manual/animated captions (see ANIMATION.md)
- [ ] Local backend/persistence and background jobs as needed
- [x] Local AI contracts, supervised workers, discovery, reviewed external plans, metadata asset ranking and append-to-timeline conversion
- [ ] Real Ollama/faster-whisper inference acceptance with installed models and spoken narration (see LOCAL_AI.md)
- [ ] Asset semantic search, RAG and controlled agents
- [ ] Windows packaging, tests, CI/CD and future web investigation

Each milestone must yield a verifiable working slice. Update checkboxes only after successful testing.

Schema v3 and local JSON persistence are implemented, with strict v1/v2 validation and migration before reviewed replacement. Timeline editing is real; the Source monitor plays originals and the Timeline monitor plays the shared composition. Native dialogs use substituted responses in automated tests; actual picker interaction, codecs, high-DPI gestures and long-project profiling remain manual checks. Local MP4 rendering is implemented and verified; autosave/crash recovery and packaged Electron loading remain incomplete. See [Timeline](TIMELINE.md).
