import type { ReactNode } from "react";
export type EditorIconName =
  | "undo"
  | "redo"
  | "settings"
  | "export"
  | "play"
  | "pause"
  | "fullscreen"
  | "volume"
  | "mute"
  | "reset"
  | "scene"
  | "focus"
  | "eye"
  | "hidden"
  | "lock"
  | "unlock"
  | "up"
  | "down"
  | "split"
  | "delete"
  | "copy"
  | "duplicate"
  | "paste"
  | "magnet"
  | "fit"
  | "start"
  | "previous"
  | "next"
  | "minus"
  | "plus"
  | "file"
  | "folder"
  | "save"
  | "saveAs"
  | "import";

const extraIcons: Partial<Record<EditorIconName, ReactNode>> = {
  focus: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16m8-16v16" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  hidden: (
    <>
      <path d="m3 3 18 18M9 5c7-2 13 7 13 7a23 23 0 0 1-4 4M6 6a24 24 0 0 0-4 6s4 7 10 7c2 0 4-1 5-2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0m-4 9v2" />
    </>
  ),
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  split: (
    <>
      <circle cx="5" cy="5" r="3" />
      <circle cx="5" cy="19" r="3" />
      <path d="m7 7 14 14M7 17l6-6m3-3 5-5" />
    </>
  ),
  delete: <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="7" y="7" width="14" height="14" rx="2" />
      <path d="M16 7V3H3v13h4m7-5v6m-3-3h6" />
    </>
  ),
  paste: (
    <>
      <path d="M8 5H4v16h16V5h-4" />
      <rect x="8" y="2" width="8" height="6" rx="1" />
    </>
  ),
  magnet: (
    <>
      <path d="M4 4v9a8 8 0 0 0 16 0V4h-5v9a3 3 0 0 1-6 0V4Z" />
      <path d="M4 8h5m6 0h5" />
    </>
  ),
  fit: (
    <>
      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
      <rect x="7" y="7" width="10" height="10" />
    </>
  ),
  start: <path d="M4 4v16m15-16L7 12l12 8Z" />,
  previous: <path d="M6 4v16m12-16L8 12l10 8Z" />,
  next: <path d="M18 4v16M6 4l10 8L6 20Z" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M5 12h14M12 5v14" />,
  file: (
    <>
      <path d="M14 2H5v20h14V7Z" />
      <path d="M14 2v5h5M8 14h8m-4-4v8" />
    </>
  ),
  folder: <path d="M2 7V4h7l3 3h10l-3 14H3L2 7h20" />,
  save: (
    <>
      <path d="M3 3h15l3 3v15H3Z" />
      <path d="M7 3v6h9V3M7 21v-8h10v8" />
    </>
  ),
  saveAs: (
    <>
      <path d="M3 3h15l3 3v7M7 3v6h9V3M3 3v18h9m3-3 6-6 2 2-6 6-3 1Z" />
    </>
  ),
  import: <path d="M12 2v13m-4-4 4 4 4-4M4 16v6h16v-6" />,
};
export function EditorIcon({
  name,
  className = "h-4 w-4",
}: {
  name: EditorIconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {extraIcons[name] ??
        (name === "undo" ? (
          <path d="m8 5-5 5 5 5M3 10h10a7 7 0 0 1 7 7" />
        ) : name === "redo" ? (
          <path d="m16 5 5 5-5 5m5-5H11a7 7 0 0 0-7 7" />
        ) : name === "settings" ? (
          <>
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="3" fill="currentColor" />
            <circle cx="15" cy="17" r="3" fill="currentColor" />
          </>
        ) : name === "export" ? (
          <>
            <path d="M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6" />
          </>
        ) : name === "play" ? (
          <path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none" />
        ) : name === "pause" ? (
          <>
            <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />
          </>
        ) : name === "fullscreen" ? (
          <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        ) : name === "reset" ? (
          <>
            <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
          </>
        ) : name === "scene" ? (
          <>
            <rect x="3" y="5" width="18" height="15" rx="1" />
            <path d="m3 10 5-5m2 5 5-5m2 5 4-4M3 10h18" />
          </>
        ) : (
          <>
            <path d="M4 9h4l5-4v14l-5-4H4Z" />
            {name === "mute" ? (
              <path d="m17 9 5 6m0-6-5 6" />
            ) : (
              <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
            )}
          </>
        ))}
    </svg>
  );
}
