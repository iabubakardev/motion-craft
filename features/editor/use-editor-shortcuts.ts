"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import type { PreviewMonitorHandle } from "@/features/preview/preview-monitor";
import { isEditingText } from "./editor-state.cjs";

export function useEditorShortcuts({
  previewRef,
  importMedia,
  clearSelection,
  canImport,
  hasSelection,
  canPlay,
  settingsOpen,
  saveProject,
  undo,
  redo,
  canUndo,
  canRedo,
  canSave,
}: {
  previewRef: RefObject<PreviewMonitorHandle | null>;
  importMedia: () => void;
  clearSelection: () => void;
  canImport: boolean;
  hasSelection: boolean;
  canPlay: boolean;
  settingsOpen: boolean;
  saveProject: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
}) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || settingsOpen) return;
      if (event.key === "Escape" && document.fullscreenElement) {
        event.preventDefault();
        void document.exitFullscreen().catch(() => {});
        return;
      }
      if (isEditingText(event.target)) return;
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s" && canSave) {
        event.preventDefault();
        saveProject();
        return;
      }
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        if (canRedo) redo();
        return;
      }
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey ? canRedo : canUndo) (event.shiftKey ? redo : undo)();
        return;
      }
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "o" &&
        canImport
      ) {
        event.preventDefault();
        importMedia();
      } else if (
        event.code === "Space" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !(
          event.target instanceof Element &&
          event.target.closest("button, [role='slider'], [role='tab']")
        )
      ) {
        if (canPlay) {
          event.preventDefault();
          previewRef.current?.togglePlayback();
        }
      } else if (event.key === "Escape" && hasSelection) {
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    previewRef,
    importMedia,
    clearSelection,
    canImport,
    hasSelection,
    canPlay,
    settingsOpen,
    saveProject,
    undo,
    redo,
    canUndo,
    canRedo,
    canSave,
  ]);
}
