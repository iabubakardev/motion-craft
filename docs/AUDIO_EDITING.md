# Phase 7.6: audio editing and mixing

## Status and workflow

The implementation adds source waveforms, dB mixing controls, fades, automation, editable ducking, loudness analysis/normalization, effects and audio crossfades. Core, worker and IPC tests run without Electron UI. Native Electron acceptance now passes, including captured fade gestures, confirmed ducking, normalization/effects, approved processed preview, native persistence and actual MP4 output. Encoded AAC RMS is compared with the prepared preview mix. Physical listening and long-form profiling remain manual gates.

1. Import narration and music, then place them on separate audio tracks. Audio-only clips detached from video reuse the same source waveform. Source peaks are prepared lazily on first use by the audio worker and cached by native fingerprint, never decoded in React.
2. Select a clip and open Basic. Audio editing contains clip/track gain in dB, clip mute, track solo, stereo pan, reset gain and fade controls. Existing track mute/visibility controls remain authoritative.
3. Drag the white fade handles on an audio clip or enter exact durations. Choose linear or equal-power curves. Double-click a waveform to add a volume key, drag a diamond to change its frame/dB value, or focus it and press Delete. The inspector also creates keys at the playhead and edits/deletes them numerically.
4. Under Automatic music ducking, choose narration/music tracks and depth, attack, release, pre-roll and minimum gap. Saved transcript words/segments supply speech activity when available; otherwise cached source energy activity is used. Existing music automation requires explicit replacement confirmation. All generated keys can be edited manually and all edits support undo.
5. Under Loudness normalization, analyze the selected clip's source range. Peak normalization and LUFS targets apply a bounded static gain correction while respecting measured source true peak. Existing linear volume and track gain are included. Analyze processed clip measures the resulting isolated clip including effects, fades, automation and track gain. Processing changes after analysis invalidate the displayed processed result; normalization is not a continuously running automatic leveling effect.
6. Under Audio effects, configure/bypass high-pass, three-band EQ, compressor, sample-peak limiter and optional noise gate. The gate reduces low-level noise during pauses; it is not spectral denoising or speech separation.
7. Select two independent clips on one audio track, set crossfade duration and apply a linear/equal-power crossfade. The right clip moves to overlap the left, retaining its source range. This track then permits audio overlap; visual-track overlap rules are unchanged.
8. Save/reopen normally and export through the existing MP4 workflow. Originals are unchanged; processed media stays in native cache, not project JSON.

## Architecture and gain model

Existing project schema v4, asset IDs/native bindings, snapshot history, timeline commands, external transcription archive, Remotion playback and supervised FFmpeg rendering are reused. No Python server, paid service, dependency or second playback engine is added.

Optional clip `audio` stores gainDb, pan, fadeCurve, sorted relative-frame keys (IDs, dB and manual/ducking origin) and the effects configuration. Existing clip volume/mute/fade fields remain supported. Optional track gainDb, solo and audioOverlap store mix controls. Old files without these fields keep their prior behavior. `SetAudio`, `SetTrackMix`, `Duck` and `Crossfade` are atomic domain edits. Trims/splits interpolate boundary automation, retain existing IDs and remove fades outside the retained portion. Source waveform indices use sourceStart plus local time times playbackRate, so trims, splits and detached clips share the same peaks.

For each sample, gain is:

`legacy clip volume � 10^((clip dB + track dB + automation dB) / 20) � fade envelope`

Automation interpolates linearly in dB at frame positions and is evaluated at sample time. The gain/fades feed the per-clip effect chain: first-order high-pass, complementary three-band EQ (250 Hz / 4 kHz), linked stereo compressor, optional gate and sample limiter; pan then attenuates the opposite channel. Track visibility/mute, clip/layer mute and solo select audible inputs. All inputs sum into the master mix, whose sample-peak safety ceiling is -1 dBFS. Reset gain resets clip dB and legacy linear trim, preserving automation.

The pinned FFmpeg build supplies loudnorm, atempo, pan, adelay, amix and PCM decoding but omits the standard highpass/equalizer/acompressor/alimiter/afftdn filters. Pure checked DSP runs in the owned Node worker over streaming PCM. Temporary wet clips use floating-point WAV; FFmpeg mixes bounded PCM with fixed input padding so ending clips do not change other clips' gain. The final sample ceiling is applied after summation. Input/output chunks retain stereo alignment and writes handle partial writes. This is a basic sample limiter, not an oversampled mastering true-peak limiter; gain staging is still necessary to avoid audible limiting. True-peak measurement comes from FFmpeg loudnorm, and a measured normalization ceiling is not guaranteed after subsequent nonlinear processing or AAC encoding.

For projects using advanced audio or detached audio, preview prepares a cached mix and plays that one approved WAV. Embedded video/source audio is silenced, preventing duplicate playback. Export invokes the same mix preparation and uses the same PCM result through the existing Remotion composition. While preparation is pending, preview audio is explicitly silent with a status message; failures are visible. Source monitor playback continues to represent the original source. Browser-only use cannot prepare the processed mix and shows an actionable desktop requirement. Native acceptance verifies the shared-file preview path and compares the encoded AAC level against the prepared PCM mix. Subjective listening and broad codec coverage remain manual gates.

## Boundaries, cache and lifecycle

`audio:analyze`, `audio:mix` and `audio:inspect-clip` validate exact arguments, project limits, main-frame ownership and trusted origin. Renderers provide IDs/projects/settings, never paths or executable/filter strings. The native library captures source bindings; canonical file identity, inode, size and mtime are checked before/after processing. Prepared audio uses hidden derived media registrations and the existing range-capable media protocol. Prepared URLs are transient composition inputs and are not persisted as project assets.

Analysis caches contain at most 60,001 stereo peak buckets, with a minimum 50 ms step and bounded duration. Waveform sampling is 8 kHz; full-source/range integrated LUFS and true peak are measured separately by loudnorm. Cached analysis is schema validated and bounded. Mix keys include source bindings and processing state. Output is written to an owned unique temporary file and renamed only on success. Scratch files are removed after completion/failure; process termination can leave scratch files until native cache maintenance. Old mixes are evicted best-effort above 2 GiB while retaining the newest two and respecting Windows open-file failures. Large newest mixes can exceed that budget.

The native audio service queues processing, owns workers, cancels superseded active mix work and invalidates queued requests after navigation/owner release. Renderer effects ignore obsolete results and debounce preparation. Waveforms draw only visible canvas pixels, with bounded pixel ratio, while analysis remains outside React. Physical pointer capture and long-project performance still require native testing/profiling.

## Verification

Actually run:

- `npm run check`: 151 domain/security/lifecycle tests, strict TypeScript and full ESLint; the existing unused-variable warning in `workers/asset-index.cjs` remains.
- Existing test suite plus new audio domain/worker/IPC tests, including real WAV peak/LUFS analysis, fingerprint cache reuse/invalidation, native child-worker service, cancellation, gain/fades, staggered clip starts, stable mix gain after another clip ends, locks, trim/split automation, ducking protection, overlap crossfades and history/persistence.
- Production build; final type/lint/domain checks are recorded in the task report.
- Scoped pinned Prettier and whitespace checks.

Passed native suites: `test:desktop`, `test:timeline`, `test:audio-transcripts`, `test:captions`, `test:render` and `npm run test:audio` (`electron/audio-mixing-smoke.cjs`) imports generated narration/music, checks canvases, gain/fade gestures, key creation/dragging/deletion and undo, mute/solo and confirmed ducking, normalization/effects, shared processed preview, native save and MP4 output. Native pickers are substituted in this test; physical picker behavior and listening checks remain manual.

## Limits and manual checks

Mix preparation currently supports up to two hours and 128 audible clips, uses disk scratch space and is not instantaneous live DSP. Source analysis supports up to 24 hours with bounded peaks. Manual keys are capped at 2,000 per clip. More advanced EQ, spectral noise reduction, mastering-grade true-peak limiting and per-track effect buses are not provided. Noise gating and source-energy speech detection are intentionally labeled. Crossfades currently require independent audio clips; scene layers keep their scene timing. Constant-speed changes rescale audio keyframes/fades into the new clip duration, preserving retained key IDs. Recheck or regenerate ducking afterward because narration activity may be anchored to another track.

Restart Electron to load the new bridge. Regression commands include `test:audio`, `test:desktop`, `test:timeline`, `test:audio-transcripts`, `test:captions` and `test:render`, then physically listen to narration/music with gain, mute/solo, both fades, automation and ducking. Verify normalization before/after, bypass effects, save/reopen, MP4 synchronization and AAC output true peak. Profile a representative 30�60 minute project and large imports before claiming production readiness.

## Changed files

New: `core/audio/{schema,engine,dsp,commands,audio.test}.cjs`, `workers/{audio,audio-processing}.cjs`, `electron/{audio-service.cjs,ipc/audio.cjs,ipc/audio.test.cjs,audio-mixing-smoke.cjs}`, `features/audio/{audio-inspector,audio-waveform}.tsx`, `features/preview/use-audio-mix.ts`, `platform/audio.ts`.

Integration: project/audio/timeline schemas and commands, media registration, main/preload, render contracts/IPC/worker/composition, project controller, timeline panel/clip controls, inspector, preview, typed bridge, smoke bridge assertion, TypeScript checked-CJS includes and package commands. The architecture and roadmap point to this record.
