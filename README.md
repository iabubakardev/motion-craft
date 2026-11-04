# MotionCraft

**A local-first, AI-assisted desktop video editor for Windows.**

> 🚧 Early development — the editor, AI pipeline and video export are planned features, not yet released.

MotionCraft aims to combine hands-on timeline editing with optional AI-assisted scene planning, asset matching and captions. The product is designed to work with your own media, without requiring paid cloud APIs.

## Vision

- Multi-track editing for video, images, narration, music, graphics and captions
- Editable scenes, transitions, timing, animations and overlays
- Import/export structured, versioned scene-plan JSON from external LLMs
- Optional local transcription and scene planning using faster-whisper and Ollama
- Local preview and MP4 rendering using Remotion and FFmpeg
- Multiple visual styles, not limited to any content niche

## Current status

The Next.js development app runs. Electron development integration is in progress. The full video editor and rendering pipeline are not yet implemented.

See [Roadmap](docs/ROADMAP.md) for checked milestones.

## Tech stack

| Layer | Technology | Status |
|---|---|---|
| UI | Next.js, React, TypeScript, Tailwind | Foundation |
| Desktop shell | Electron | Integration in progress |
| Composition | Remotion | Planned |
| Processing | FFmpeg | Planned |
| Local AI | Ollama, faster-whisper | Planned |
| Persistence / jobs | PostgreSQL, Redis, BullMQ | Later phases |

## Development setup

Prerequisites: Node.js and npm; Windows recommended for desktop testing.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

To launch the Next.js dev server and Electron desktop window together:

```bash
npm run dev:desktop
```

**Note:** This repository does not yet provide a tested packaged Windows installer. `dev:desktop` is a development workflow only.

## Architecture

Source directories live at the repository root: `app/`, `components/`, and `types/`. The `@/*` import alias maps to that root. Add future feature and domain folders alongside them as needed.

The UI lives in Next.js, desktop capabilities are exposed via a secure Electron preload bridge, and framework-independent editing logic belongs in `core/` (planned). See [Architecture](docs/ARCHITECTURE.md) and [Project Context](docs/PROJECT_CONTEXT.md).

## Roadmap

See [Development roadmap](docs/ROADMAP.md). Planned milestones include the editor workspace, versioned JSON schema, media import, timeline editing, rendering, local AI, and packaging.

## Screenshots / demo

Screenshots and a demo will be added when the editor UI is implemented. Do not treat mockups as working features.

## Contributing

The project is in an early architecture phase. Before contributing, read [AGENTS.md](AGENTS.md), [Architecture](docs/ARCHITECTURE.md) and [Decisions](docs/DECISIONS.md). Open an issue to discuss substantial changes before implementing them.

## License

A license has not yet been selected. Until a license is added, do not assume the repository grants open-source reuse rights.
