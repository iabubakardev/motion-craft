"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMediaLibrary } from "@/features/media/use-media-library";
import { DEFAULT_PANELS, LAYOUT_KEY, constrainPanels, parseLayout } from "./layout.cjs";
import { editorReducer, initialEditorState } from "./editor-state.cjs";
import type { PanelSizes, PreviewState } from "./types";
import { useProjectDocument } from "@/features/projects/use-project-document";

export function useEditorState() {
  const library = useMediaLibrary();
  const projectDocument = useProjectDocument(library);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1100, height: 620 });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(LAYOUT_KEY); } catch { /* Storage may be unavailable. */ }
    // No browser data is read during rendering or server-side generation.
    Promise.resolve().then(() => {
      dispatch({ type: "panels", panels: parseLayout(raw) });
      setPreferencesLoaded(true);
    });
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, ...state.panels })); }
    catch { /* Workspace stays functional without preference storage. */ }
  }, [state.panels, preferencesLoaded]);

  const panels = constrainPanels(state.panels, bounds.width, bounds.height);
  const resizePanel = (panel: keyof PanelSizes, value: number) => {
    dispatch({ type: "panels", panels: constrainPanels({ ...panels, [panel]: value }, bounds.width, bounds.height) });
  };
  const resetPanel = (panel: keyof PanelSizes) => resizePanel(panel, DEFAULT_PANELS[panel]);
  const selected = library.assets.find((asset) => asset.id === library.selectedId);
  const updatePreview = useCallback((preview: PreviewState) => dispatch({ type: "preview", preview }), []);

  const projectSettings = { name: projectDocument.project.name, width: projectDocument.project.resolution.width, height: projectDocument.project.resolution.height, fps: projectDocument.project.fps, aspectRatio: projectDocument.project.aspectRatio };
  return { library, projectDocument, projectSettings, state, dispatch, bodyRef, panels, bounds, resizePanel, resetPanel, selected, updatePreview };
}
