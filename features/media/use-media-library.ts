"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaAsset } from "@/core/media/types";
import {
  isMediaAvailable,
  listMediaAssets,
  selectMediaFiles,
  updateMediaMetadata,
} from "@/platform/media";
import { mergeAssets } from "./library.cjs";
import { readMediaMetadata } from "./read-metadata";

export function useMediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const mounted = useRef(false);
  const pending = useRef(new Set<string>());
  const busy = useRef(false);
  const generation = useRef(0);
  const probes = useRef(new Set<AbortController>());
  const cancelProbes = useCallback(() => {
    generation.current++;
    for (const probe of probes.current) probe.abort();
    probes.current.clear();
    pending.current.clear();
  }, []);
  const replaceAssets = useCallback(
    (value: React.SetStateAction<MediaAsset[]>) => {
      cancelProbes();
      setAssets(value);
      setLoading(false);
      setAvailable(isMediaAvailable());
    },
    [cancelProbes],
  );

  useEffect(() => {
    mounted.current = true;
    const initialGeneration = generation.current;
    // Resolve desktop availability after hydration to keep browser/server markup identical.
    listMediaAssets()
      .then((sessionAssets) => {
        if (!mounted.current || initialGeneration !== generation.current) return;
        setAvailable(isMediaAvailable());
        setAssets(sessionAssets);
      })
      .catch(() => {
        if (mounted.current)
          setErrors(["The media session could not be loaded. Reload the app to try again."]);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      cancelProbes();
    };
  }, [cancelProbes]);

  useEffect(() => {
    const queue = assets.filter(
      (asset) => asset.status === "imported" && !pending.current.has(asset.id),
    );
    for (const asset of queue.slice(0, Math.max(0, 3 - pending.current.size))) {
      const activeGeneration = generation.current;
      const controller = new AbortController();
      probes.current.add(controller);
      pending.current.add(asset.id);
      readMediaMetadata(asset, controller.signal)
        .then((metadata) => {
          if (activeGeneration !== generation.current) return null;
          return updateMediaMetadata(asset.id, metadata);
        })
        .then((updated) => {
          probes.current.delete(controller);
          if (activeGeneration !== generation.current || !updated) return;
          pending.current.delete(asset.id);
          if (mounted.current) setAssets((current) => mergeAssets(current, [updated]));
        })
        .catch(() => {
          probes.current.delete(controller);
          if (activeGeneration !== generation.current) return;
          pending.current.delete(asset.id);
          if (mounted.current)
            setAssets((current) =>
              current.map((item) => (item.id === asset.id ? { ...item, status: "error" } : item)),
            );
        });
    }
  }, [assets]);

  const importMedia = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setImporting(true);
    setErrors([]);
    setNotice("");
    try {
      const result = await selectMediaFiles();
      if (!mounted.current) return;
      if (result.canceled) {
        setNotice("Import canceled.");
        return;
      }
      setAssets((current) => mergeAssets(current, result.assets));
      if (result.assets[0]) setSelectedId(result.assets[0].id);
      const added = result.assets.length - result.duplicates;
      setNotice(
        `${added} file${added === 1 ? "" : "s"} imported.${result.duplicates ? ` ${result.duplicates} already in this session.` : ""}`,
      );
      setErrors(result.errors.map((error) => `${error.filename}: ${error.message}`));
      return result.assets;
    } catch {
      if (mounted.current)
        setErrors(["Media import failed. Check that the desktop app is running and try again."]);
    } finally {
      busy.current = false;
      if (mounted.current) setImporting(false);
    }
  }, []);

  const markUnavailable = useCallback((id: string) => {
    setAssets((current) =>
      current.map((asset) => (asset.id === id ? { ...asset, status: "error" } : asset)),
    );
    void updateMediaMetadata(id, { status: "error" }).catch(() => {});
  }, []);

  return {
    assets,
    replaceAssets,
    selectedId,
    setSelectedId,
    available,
    loading,
    importing,
    notice,
    errors,
    importMedia,
    markUnavailable,
  };
}
