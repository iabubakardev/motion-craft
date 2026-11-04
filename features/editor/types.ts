export type SidebarTab = "media" | "scenes" | "audio";
export interface PanelSizes {
  left: number;
  right: number;
  bottom: number;
}
export interface PreviewState {
  assetId: string | null;
  currentTime: number;
  duration: number;
  playing: boolean;
  fullscreen: boolean;
}
export interface ProjectPlaceholder {
  name: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3";
}
export interface EditorState {
  sidebarTab: SidebarTab;
  panels: PanelSizes;
  preview: PreviewState;
  settingsOpen: boolean;
}
export type EditorAction =
  | { type: "tab"; tab: SidebarTab }
  | { type: "panels"; panels: PanelSizes }
  | { type: "preview"; preview: PreviewState }
  | { type: "settings"; open: boolean };
