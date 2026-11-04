# Media import and library foundation

## Scope and lifetime

Phase 2 imports references to MP4, MOV, WebM, MP3, WAV, PNG, JPG, JPEG and WebP files. Native selection supports multiple files and cancellation. No media is uploaded or copied. The main-process registry and validated decoder metadata remain available during the Electron session, including renderer reloads. Closing Electron clears the runtime registry. Phase 3 saves project descriptors and trusted local bindings so native project open can restore media; see PROJECT_FORMAT.md.

Canonical paths are deduplicated (case-insensitive on Windows). Reimporting an unchanged file retains its ID; importing a changed file creates a new ID because the original URL must not silently serve changed content. An unavailable old entry remains visible. Copies at different paths are separate assets; content hashing is not implemented.

## IPC contract

| Renderer method | IPC channel | Arguments | Result |
|---|---|---|---|
| `window.motioncraft.media.selectFiles()` | `media:selectFiles` | None | `{ canceled, assets, duplicates, errors }` |
| `window.motioncraft.media.listAssets()` | `media:listAssets` | None | Renderer-safe asset array |
| `window.motioncraft.media.updateMetadata(id, metadata)` | `media:updateMetadata` | UUID and strict metadata object | Updated renderer-safe asset |

All methods validate the sender's owning window, main frame and development origin. Argument tuples and returned assets use shared Zod contracts. `selectFiles` opens `dialog.showOpenDialog` with fixed media filters; renderer-supplied filesystem paths are never accepted. Concurrent dialogs are rejected and the frame is revalidated after selection. Cancellation returns an empty normal result. Per-file import failures return only the filename and a sanitized message.

Safe assets contain ID, original filename, type, MIME, byte size, timestamp, status, approved URL, optional duration/dimensions and an image thumbnail reference. Absolute canonical paths, modification timestamps and file identity remain only in the trusted registry. Decoder metadata is descriptive and validated; it does not authorize file access or modify media.

`motioncraft-media://asset/<uuid>` resolves an exact registry ID. GET/HEAD are supported, including single byte ranges for video/audio seeking. Unknown IDs return 404; missing, replaced or modified files return 410; invalid ranges return 416. Files are streamed from open handles with explicit MIME types, no-sniff headers, no caching and development-origin CORS. CSP bypass and unrestricted `file://` access are not enabled. The navigation, popup and sandbox policies remain in place. Phase 2.2 allows only fullscreen from the trusted main frame of an owned app window; other permissions remain denied.

## Modules

- `core/media/schema.cjs`, `types.ts`: shared validation and inferred renderer-safe types. CommonJS allows one runtime schema in both Electron and Next.js.
- `electron/media-library.cjs`: trusted records, import/deduplication, metadata storage and streaming.
- `electron/ipc/media.cjs`: secure native selection and IPC registration.
- `electron/preload.cjs`, `platform/app.ts`, `platform/media.ts`: restricted bridge and validated platform adapter.
- `features/media/library.cjs`: pure merge, search/filter and metadata formatting helpers.
- `features/media/use-media-library.ts`, `read-metadata.ts`: session hydration/import state and bounded metadata decoding.
- `features/media/media-library.tsx`, `media-items.tsx`, `media-preview.tsx`, `media-icon.tsx`: library shell, cards/list, preview and icons.
- `app/page.tsx`, `app/layout.tsx`: feature composition and page metadata.

## Verification

```bash
npm run lint
npm run typecheck
npm test
```

Start `npm run dev` separately, then run:

```bash
npm run test:desktop
npm run test:media
```

Clear an inherited `ELECTRON_RUN_AS_NODE=1` before these commands (PowerShell: `$env:ELECTRON_RUN_AS_NODE = $null`). The scripts launch temporary Electron windows and exit automatically; they use the already-running localhost development server.

Automated coverage includes origin/frame and argument rejection, concurrent dialogs, cancellation, metadata validation, path privacy, duplicate IDs, invalid/missing/changed files, protocol method/ID/range restrictions, filename search and type filtering. The media smoke test generates PNG, WAV and WebM fixtures, runs real React interactions and IPC, decodes the image, plays audio/video, verifies renderer reload recovery and browser fallback, and captures `.next/media-library-smoke.png`. Only `dialog.showOpenDialog` results are stubbed; this does not verify interaction with the Windows picker.

Verified on 2026-11-04: lint, route generation, TypeScript, unit tests, HTTP 200, Electron preload smoke and media integration smoke passed. No production build or installer verification is claimed.

## Manual desktop checklist

1. Run `npm run dev:desktop` (stop a previously running dev server first), click **Import media**, and verify the Windows picker opens with the media filter and multi-selection enabled.
2. Select several supported files; check thumbnails, filenames, sizes, available durations/dimensions and selection. Cancel a subsequent dialog and verify there is no error.
3. Test representative MP4, MOV, MP3, JPG/JPEG and WebP files in addition to the automated PNG/WAV/WebM fixtures. Use playback controls to play, pause and seek video/audio. A container extension alone does not guarantee supported codecs.
4. Search by filename, select each type filter, toggle grid/list, and test an empty search result. Import the same files again and verify the count does not grow.
5. Remove or modify a throwaway imported file, then reload/select it. Verify an unavailable preview and no path disclosure. Import it again to retry. Import a corrupt supported file and verify an error state.
6. Reload the renderer and verify the session remains populated. Save a project, exit/restart Electron, then open it and verify media restores or reports missing bindings. Open the browser page and verify a working empty library with local import disabled.

## Known limits and next work

- Windows native picker interaction and representative codec coverage remain manual checks.
- Playback depends on Chromium's codecs; unsupported/corrupt media fails gracefully. MIME is inferred from an allowlisted extension, not a forensic file signature. Metadata decoding has a 15-second timeout and is intended for the current foundation, not bulk indexing.
- Thumbnails use original image URLs. Video thumbnails, generated proxies, waveform display, streaming metadata indexing, virtualization, deduplication by content are deferred. Project persistence and native relinking are now implemented.
- Original files must stay available and unchanged. Renderer-safe URLs are session capabilities, not portable persisted references.
- Production runtime, packaged-origin policy, production CSP and offline fonts remain open foundation work. Installation audit reported development-tool vulnerabilities; `npm audit --omit=dev` reported zero runtime dependency vulnerabilities during this change. Dependency upgrades were kept outside this milestone.
- Recommended next milestone: composition preview from the validated scene/layer model; advanced timeline editing remains deferred.

The media library is now embedded in the resizable editor workspace. Preview rendering remains shared; contextual metadata is in the inspector. The existing media smoke suite also exercises workspace interactions. See [Workspace behavior](EDITOR_WORKSPACE.md).

Phase 3 media-session replacement aborts pending metadata probes and uses generation checks so callbacks from the previous document cannot reinsert old assets. Descriptor enrichment is persisted as project data; playback status and runtime URLs are not.
