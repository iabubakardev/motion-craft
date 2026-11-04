"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { useMediaLibrary } from "@/features/media/use-media-library";
import type { Layer, Project, ProjectHistory, ValidationIssue } from "@/core/project/types";
import * as operations from "@/core/project/operations.cjs";
import { createHistory, commitProject, undoProject, redoProject } from "@/core/project/history.cjs";
import { fpsSchema, serializeProject } from "@/core/project/schema.cjs";
import {
  activateProject,
  isProjectDesktopAvailable,
  openProjectFile,
  relinkProjectAsset,
  saveProjectFile,
} from "@/platform/projects";

// Stable prerender data; replaced after hydration before document commands are enabled.
const bootstrap = operations.createProject({
  id: "00000000-0000-4000-8000-000000000001",
  now: "2026-01-01T00:00:00.000Z",
  trackIds: Array.from(
    { length: 7 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
  ),
});
export interface ProjectCandidate {
  project: Project;
  candidateId: string | null;
  filename: string | null;
  mode: "open" | "import" | "new";
}

export function useProjectDocument(library: ReturnType<typeof useMediaLibrary>) {
  const [history, setHistory] = useState<ProjectHistory>(() => createHistory(bootstrap));
  const current = useRef(history);
  const epoch = useRef(0);
  const busyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [candidate, setCandidate] = useState<ProjectCandidate | null>(null);
  const [deleteSceneId, setDeleteSceneId] = useState<string | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const { replaceAssets, setSelectedId, assets, loading } = library;
  const clearSelection = useCallback(() => {
    setActiveSceneId(null);
    setSelectedLayerId(null);
    setSelectedId(null);
  }, [setSelectedId]);
  const selectMedia = useCallback(
    (value: React.SetStateAction<string | null>) => {
      setSelectedLayerId(null);
      setSelectedId(value);
    },
    [setSelectedId],
  );
  const install = useCallback((next: ProjectHistory) => {
    current.current = next;
    setHistory(next);
  }, []);
  const reportError = useCallback((error: unknown) => {
    setIssues(
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 100)
            .map((issue) => ({ path: issue.path.join(".") || "project", message: issue.message }))
        : [
            {
              path: "project",
              message: error instanceof Error ? error.message : "The change could not be applied.",
            },
          ],
    );
  }, []);

  useEffect(() => {
    let canceled = false;
    Promise.resolve().then(() => {
      if (canceled) return;
      install(createHistory(operations.createProject()));
      setDesktop(isProjectDesktopAvailable());
      setReady(true);
    });
    return () => {
      canceled = true;
    };
  }, [install]);

  useEffect(() => {
    if (!ready || loading) return;
    const generation = epoch.current;
    let canceled = false;
    Promise.resolve().then(() => {
      if (canceled || generation !== epoch.current) return;
      try {
        const incoming = assets.map(operations.toProjectAsset);
        const snapshot = current.current;
        const present = operations.mergeProjectAssets(snapshot.present, incoming);
        if (present === snapshot.present) return;
        // Metadata/import enrichment is not a scene-history command. Keep all undo snapshots referentially valid.
        install({
          ...snapshot,
          present,
          past: snapshot.past.map((project) => operations.mergeProjectAssets(project, incoming)),
          future: snapshot.future.map((project) =>
            operations.mergeProjectAssets(project, incoming),
          ),
        });
      } catch (error) {
        reportError(error);
      }
    });
    return () => {
      canceled = true;
    };
  }, [assets, loading, ready, install, reportError]);

  const dirty = useMemo(
    () => serializeProject(history.present) !== history.savedJSON,
    [history.present, history.savedJSON],
  );
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function mutate(operation: (project: Project) => Project) {
    if (!ready || busyRef.current) return null;
    try {
      const snapshot = current.current;
      const next = operation(snapshot.present);
      install(commitProject(snapshot, next));
      setIssues([]);
      setNotice("");
      return next;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  function selectScene(id: string) {
    setActiveSceneId(id);
    setSelectedLayerId(null);
    setSelectedId(null);
  }
  function selectLayer(sceneId: string, layerId: string) {
    const layer = current.current.present.scenes
      .find((scene) => scene.id === sceneId)
      ?.layers.find((item) => item.id === layerId);
    setActiveSceneId(sceneId);
    setSelectedLayerId(layerId);
    setSelectedId(layer && "assetId" in layer ? layer.assetId : null);
  }
  function addScene() {
    const next = mutate(operations.addScene);
    if (next) selectScene(next.scenes[next.scenes.length - 1].id);
  }
  function duplicateScene(id: string) {
    const next = mutate((project) => operations.duplicateScene(project, id));
    if (next) selectScene(next.scenes[next.scenes.findIndex((scene) => scene.id === id) + 1].id);
  }
  function addLayer(type: Layer["type"], assetId?: string) {
    if (!activeSceneId) return;
    const next = mutate((project) => operations.addLayer(project, activeSceneId, type, assetId));
    const scene = next?.scenes.find((item) => item.id === activeSceneId);
    if (scene) selectLayer(scene.id, scene.layers[scene.layers.length - 1].id);
  }
  async function save(saveAs = false) {
    if (!ready || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setIssues([]);
    const snapshot = current.current.present;
    try {
      const result = await saveProjectFile(snapshot, saveAs);
      if (result.status === "saved") {
        setFilename(result.filename);
        install({ ...current.current, savedJSON: serializeProject(snapshot) });
        setNotice(`Saved ${result.filename}`);
      } else setNotice("Save canceled. Your changes are still in the project.");
    } catch (error) {
      reportError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function open() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setIssues([]);
    try {
      const result = await openProjectFile();
      if (result.status === "error") setIssues(result.errors);
      else if (result.status === "ready") setCandidate({ ...result, mode: "open" });
      else setNotice("Open canceled.");
    } catch (error) {
      reportError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function confirmReplacement() {
    if (!candidate || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setIssues([]);
    try {
      const result = await activateProject(candidate.project, candidate.candidateId);
      epoch.current++;
      replaceAssets(result.assets);
      setSelectedId(null);
      setActiveSceneId(null);
      setSelectedLayerId(null);
      const next = createHistory(result.project);
      // Imported/new documents have no current file. Opening a saved file starts at a clean checkpoint.
      install(candidate.mode === "import" ? { ...next, savedJSON: "" } : next);
      setFilename(result.filename);
      setCandidate(null);
      setNotice(
        result.missingAssetIds.length
          ? `Loaded project. ${result.missingAssetIds.length} media files need relinking.`
          : "Project loaded.",
      );
    } catch (error) {
      reportError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function relink(id: string) {
    const asset = current.current.present.assets.find((item) => item.id === id);
    if (!asset || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const restored = await relinkProjectAsset(asset);
      if (restored) {
        const project = operations.mergeProjectAssets(current.current.present, [
          operations.toProjectAsset(restored),
        ]);
        install(commitProject(current.current, project));
        replaceAssets((items) => [...items.filter((item) => item.id !== id), restored]);
        setNotice(`Relinked ${restored.filename}. Asset ID and layer references were preserved.`);
      }
    } catch (error) {
      reportError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const project = history.present;
  const activeScene = project.scenes.find((scene) => scene.id === activeSceneId);
  const candidateLayer = activeScene?.layers.find((layer) => layer.id === selectedLayerId);
  const selectedLayer =
    candidateLayer &&
    ("assetId" in candidateLayer
      ? candidateLayer.assetId === library.selectedId
      : library.selectedId === null)
      ? candidateLayer
      : undefined;
  return {
    project,
    ready,
    desktop,
    dirty,
    busy,
    filename,
    issues,
    notice,
    importOpen,
    setImportOpen,
    candidate,
    setCandidate,
    confirmReplacement,
    activeScene,
    activeSceneId,
    selectedLayer,
    selectedLayerId,
    selectScene,
    selectLayer,
    selectMedia,
    clearSelection,
    addScene,
    duplicateScene,
    addLayer,
    updateScene: (id: string, patch: Parameters<typeof operations.updateScene>[2]) =>
      !!mutate((doc) => operations.updateScene(doc, id, patch)),
    reorderScene: (id: string, index: number) =>
      mutate((doc) => operations.reorderScene(doc, id, index)),
    deleteSceneId,
    setDeleteSceneId,
    confirmDeleteScene: () => {
      if (deleteSceneId) {
        mutate((doc) => operations.deleteScene(doc, deleteSceneId));
        setDeleteSceneId(null);
      }
    },
    updateLayer: (id: string, patch: Parameters<typeof operations.updateLayer>[3]) =>
      !!activeSceneId && !!mutate((doc) => operations.updateLayer(doc, activeSceneId, id, patch)),
    deleteLayer: (id: string) => {
      if (activeSceneId) mutate((doc) => operations.deleteLayer(doc, activeSceneId, id));
    },
    updateSettings: (settings: {
      name: string;
      width: number;
      height: number;
      fps: number;
      aspectRatio?: Project["aspectRatio"];
    }) =>
      mutate((doc) =>
        doc.name === settings.name &&
        doc.resolution.width === settings.width &&
        doc.resolution.height === settings.height &&
        doc.fps === settings.fps &&
        doc.aspectRatio === (settings.aspectRatio || doc.aspectRatio)
          ? doc
          : operations.rebuildProject({
              ...doc,
              name: settings.name,
              resolution: { width: settings.width, height: settings.height },
              aspectRatio: settings.aspectRatio || doc.aspectRatio,
              fps: fpsSchema.parse(settings.fps),
            }),
      ),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo: () => {
      if (!busyRef.current) install(undoProject(current.current));
    },
    redo: () => {
      if (!busyRef.current) install(redoProject(current.current));
    },
    save,
    open,
    relink,
    requestNew: () =>
      setCandidate({
        project: operations.createProject(),
        candidateId: null,
        filename: null,
        mode: "new",
      }),
    dismissIssues: () => setIssues([]),
    reportIssues: setIssues,
  };
}

export type ProjectDocumentController = ReturnType<typeof useProjectDocument>;
