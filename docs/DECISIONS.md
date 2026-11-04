# Architecture decision log

| Date | Decision | Rationale | Status |
|---|---|---|---|
| 2026-11-04 | Next.js + TypeScript for UI | Existing experience and potential web reuse | Confirmed |
| 2026-11-04 | Root-level source directories with `@/*` mapped to `./*` | Match the existing `app/`, `components/`, and `types/` layout; create feature folders as needed | Confirmed |
| 2026-11-04 | Electron for Windows desktop | Native dialogs/filesystem through secure bridge | Confirmed |
| 2026-11-04 | Remotion + FFmpeg for video | React compositions and local encoding | Planned |
| 2026-11-04 | Modular monolith initially | Avoid premature distributed infrastructure | Recommended |
| 2026-11-04 | Local JSON persistence before DB | Simplify early usable editor | Recommended; revisit |

Add dated entries when making or changing significant technical decisions.
