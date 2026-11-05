"use client";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { MediaAsset } from "@/core/media/types";
import type { operationSchema, resultSchema } from "@/core/assets/index-schema.cjs";
import { useAIJob } from "@/features/ai/use-ai-job";
import { isAIAvailable } from "@/platform/ai";
type Result = z.infer<typeof resultSchema>;
type Operation = z.infer<typeof operationSchema>;
export function AssetSearch({
  assets,
  selectedId,
  onSelect,
  onClose,
  initialQuery = "",
  aspectRatio = 16 / 9,
  targetDuration = null,
}: {
  initialQuery?: string;
  aspectRatio?: number;
  targetDuration?: number | null;
  assets: MediaAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const initialAssets = useRef(assets);
  const dialog = useRef<HTMLDialogElement>(null),
    consumed = useRef<string | null>(null),
    operation = useRef<Operation["action"]>("list");
  const { job, error, running, start, cancel } = useAIJob();
  const [entries, setEntries] = useState<Result["entries"]>([]),
    [matches, setMatches] = useState<Result["matches"] | null>(null),
    [models, setModels] = useState<Result["models"]>([]),
    [message, setMessage] = useState(""),
    [vision, setVision] = useState(""),
    [embedding, setEmbedding] = useState(""),
    [query, setQuery] = useState(initialQuery),
    [type, setType] = useState<"all" | "image" | "video">("all"),
    [selected, setSelected] = useState(selectedId || "");
  const visuals = assets
    .filter((asset) => asset.type !== "audio" && asset.status !== "error")
    .slice(0, 512);
  const ids = visuals.map((a) => a.id);
  const request = (next: Operation) => {
    operation.current = next.action;
    void start({ kind: "assets", operation: next });
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const assetIds = initialAssets.current
      .filter((a) => a.type !== "audio" && a.status !== "error")
      .slice(0, 512)
      .map((a) => a.id);
    const timer = setTimeout(() => {
      if (assetIds.length && isAIAvailable())
        void start({ kind: "assets", operation: { action: "list", assetIds } });
    }, 0);
    return () => {
      clearTimeout(timer);
      element?.close();
    };
  }, [start]);
  useEffect(() => {
    if (job?.state !== "completed" || job.result?.kind !== "assets" || consumed.current === job.id)
      return;
    consumed.current = job.id;
    const result = job.result,
      action = operation.current;
    queueMicrotask(() => {
      setMessage(result.message);
      if (action === "models") {
        setModels(result.models);
        setVision((current) =>
          result.models.some((m) => m.name === current && m.vision)
            ? current
            : result.models.find((m) => m.vision)?.name || "",
        );
        setEmbedding((current) =>
          result.models.some((m) => m.name === current && m.embedding)
            ? current
            : result.models.find((m) => m.embedding)?.name || "",
        );
        return;
      }
      setEntries((current) =>
        action === "list"
          ? result.entries
          : [
              ...current.filter(
                (e) => !result.entries.some((next) => next.asset.id === e.asset.id),
              ),
              ...result.entries,
            ],
      );
      setMatches(action === "search" ? result.matches : null);
    });
  }, [job]);
  const entry = entries.find((e) => e.asset.id === selected);
  const rows = matches
    ? matches.map((match) => ({ asset: visuals.find((a) => a.id === match.assetId), match }))
    : visuals
        .filter((a) => type === "all" || a.type === type)
        .map((asset) => ({ asset, match: undefined }));
  return (
    <dialog
      ref={dialog}
      aria-label="Intelligent asset search"
      className="project-settings-dialog !w-[min(960px,95vw)] !max-w-none"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Asset search & visual index</h2>
        <button className="editor-icon-button" aria-label="Close asset search" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="max-h-[75vh] space-y-4 overflow-y-auto pt-3 text-xs">
        <p>
          {entries.length} of {visuals.length} visual assets described. Unanalyzed assets have no
          inferred visual metadata. Video analysis covers three sampled frames only.
        </p>
        {!isAIAvailable() && (
          <p>
            Open/restart Electron for local indexing. Your existing filename search remains
            available.
          </p>
        )}
        <fieldset disabled={running || !isAIAvailable()} className="space-y-3">
          <button className="editor-secondary" onClick={() => request({ action: "models" })}>
            Detect vision & embedding models
          </button>
          <div className="grid grid-cols-2 gap-3">
            <label>
              Vision model
              <select
                aria-label="Vision model"
                className="editor-input w-full"
                value={vision}
                onChange={(e) => setVision(e.target.value)}
              >
                <option value="">No vision model selected</option>
                {models
                  .filter((m) => m.vision)
                  .map((m) => (
                    <option key={m.name}>{m.name}</option>
                  ))}
              </select>
            </label>
            <label>
              Embedding model
              <select
                aria-label="Embedding model"
                className="editor-input w-full"
                value={embedding}
                onChange={(e) => setEmbedding(e.target.value)}
              >
                <option value="">Keyword/tag search only</option>
                {models
                  .filter((m) => m.embedding)
                  .map((m) => (
                    <option key={m.name}>{m.name}</option>
                  ))}
              </select>
            </label>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ids.length) return;
              request({
                action: "search",
                assetIds: ids,
                query,
                model: embedding || null,
                type,
                aspectRatio,
                duration: targetDuration,
              });
            }}
          >
            <input
              aria-label="Natural language asset query"
              className="editor-input min-w-0 flex-1"
              value={query}
              maxLength={2000}
              required
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe a scene, subject, action or tag…"
            />
            <select
              aria-label="Indexed media type"
              className="editor-input"
              value={type}
              onChange={(e) => {
                setType(
                  e.target.value === "image"
                    ? "image"
                    : e.target.value === "video"
                      ? "video"
                      : "all",
                );
                setMatches(null);
              }}
            >
              <option value="all">All visuals</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </select>
            <button className="editor-primary" disabled={!ids.length}>
              Search by relevance
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <button
              className="editor-secondary"
              disabled={!vision || !selected}
              onClick={() =>
                request({ action: "analyze", assetIds: [selected], model: vision, force: false })
              }
            >
              Analyze selected / use cache
            </button>
            <button
              className="editor-secondary"
              disabled={!vision || !selected}
              onClick={() =>
                request({ action: "analyze", assetIds: [selected], model: vision, force: true })
              }
            >
              Reanalyze selected (replaces description)
            </button>
            <button
              className="editor-secondary"
              disabled={!vision || !ids.length}
              onClick={() =>
                request({
                  action: "analyze",
                  assetIds: ids.slice(0, 8),
                  model: vision,
                  force: false,
                })
              }
            >
              Analyze first {Math.min(8, ids.length)} visuals
            </button>
            <button
              className="editor-secondary"
              disabled={!embedding || !entry}
              onClick={() => request({ action: "embed", assetIds: [selected], model: embedding })}
            >
              Index selected description
            </button>
            <button
              className="editor-secondary"
              disabled={!embedding || !entries.length}
              onClick={() =>
                request({
                  action: "embed",
                  assetIds: entries.slice(0, 8).map((e) => e.asset.id),
                  model: embedding,
                })
              }
            >
              Index first {Math.min(8, entries.length)} descriptions
            </button>
          </div>
        </fieldset>
        {job && (
          <div role="status">
            <p>
              {job.state}: {job.stage}
            </p>
            {job.progress !== null && <progress max={1} value={job.progress} />}{" "}
            {running && (
              <button className="editor-secondary" onClick={() => void cancel()}>
                Cancel indexing
              </button>
            )}
          </div>
        )}
        {(error || message) && <p role={error ? "alert" : "status"}>{error || message}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <ul aria-label="Indexed asset results" className="max-h-64 space-y-2 overflow-y-auto">
            {rows.map(
              ({ asset, match }) =>
                asset && (
                  <li key={asset.id} className="rounded border border-[var(--editor-border)] p-2">
                    <button
                      className="w-full text-left"
                      aria-pressed={selected === asset.id}
                      onClick={() => setSelected(asset.id)}
                    >
                      {asset.filename}
                    </button>
                    <p className="text-[10px] text-[var(--editor-muted)]">
                      {entries.find((e) => e.asset.id === asset.id)?.embeddingModel
                        ? "Embedded"
                        : entries.some((e) => e.asset.id === asset.id)
                          ? "Described"
                          : "Not indexed / stale"}
                    </p>
                    {match && (
                      <>
                        <p>Relevance {match.score.toFixed(3)} (heuristic)</p>
                        <p className="text-[10px]">{match.reasons.join("; ")}</p>
                        <p className="text-[10px] text-amber-200">{match.missing.join("; ")}</p>
                      </>
                    )}
                  </li>
                ),
            )}
          </ul>
          <div>
            {selected && visuals.some((a) => a.id === selected) && (
              <form
                key={`${selected}:${entry?.analyzedAt || ""}`}
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  request({
                    action: "edit",
                    assetIds: [selected],
                    description: String(data.get("description")),
                    tags: String(data.get("tags"))
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  });
                }}
              >
                <h3>Review description & tags</h3>
                <textarea
                  aria-label="Asset description"
                  name="description"
                  required
                  maxLength={8000}
                  rows={5}
                  disabled={running}
                  className="editor-input w-full"
                  defaultValue={entry?.description || ""}
                />
                <input
                  aria-label="Asset tags"
                  name="tags"
                  maxLength={3200}
                  disabled={running}
                  className="editor-input w-full"
                  placeholder="Comma-separated tags"
                  defaultValue={entry?.tags.join(", ") || ""}
                />
                <button className="editor-secondary" disabled={running || !isAIAvailable()}>
                  Save reviewed description
                </button>
                <button
                  type="button"
                  className="editor-primary"
                  onClick={() => {
                    onSelect(selected);
                    onClose();
                  }}
                >
                  Choose this asset
                </button>
                {entry?.origin === "manual" && (
                  <p>Manual description. Visual contents are not independently verified.</p>
                )}
                {entry?.frames.map((frame) => (
                  <p key={frame.at} className="text-[10px]">
                    Sample {frame.at.toFixed(3)} s: {frame.observation.description}
                  </p>
                ))}
              </form>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
