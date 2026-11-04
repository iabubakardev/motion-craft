export type EditorIconName = "undo" | "redo" | "settings" | "export" | "play" | "pause" | "fullscreen" | "volume" | "mute" | "reset" | "scene";
export function EditorIcon({ name, className = "h-4 w-4" }: { name: EditorIconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {name === "undo" ? <path d="m8 5-5 5 5 5M3 10h10a7 7 0 0 1 7 7" /> :
      name === "redo" ? <path d="m16 5 5 5-5 5m5-5H11a7 7 0 0 0-7 7" /> :
      name === "settings" ? <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" /><circle cx="15" cy="17" r="3" fill="currentColor" /></> :
      name === "export" ? <><path d="M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6" /></> :
      name === "play" ? <path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none" /> :
      name === "pause" ? <><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></> :
      name === "fullscreen" ? <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /> :
      name === "reset" ? <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></> :
      name === "scene" ? <><rect x="3" y="5" width="18" height="15" rx="1" /><path d="m3 10 5-5m2 5 5-5m2 5 4-4M3 10h18" /></> :
      <><path d="M4 9h4l5-4v14l-5-4H4Z" />{name === "mute" ? <path d="m17 9 5 6m0-6-5 6" /> : <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}</>}
  </svg>;
}
