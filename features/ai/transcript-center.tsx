"use client";
import { useMemo, useState } from "react";
import {
  defaultGrouping,
  groupingOptionsSchema,
  groupTranscript,
  exportTranscript,
  exportFormatSchema,
} from "@/core/transcription/grouping";
import type {
  Transcript,
  Range,
  GroupOptions,
  Group,
  ExportOptions,
} from "@/core/transcription/grouping";
import { saveTranscriptExport, copyTranscript } from "@/platform/transcription";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
export function TranscriptCenter({
  transcript,
  range,
  onGenerate,
}: {
  transcript: Transcript;
  range?: Range;
  onGenerate: (groups: Group[], replace: boolean) => boolean;
}) {
  const [options, setOptions] = useState<GroupOptions>(defaultGrouping),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false);
  const [format, setFormat] = useState<ExportOptions["format"]>("inline"),
    [basis, setBasis] = useState<ExportOptions["basis"]>("source"),
    [clock, setClock] = useState<ExportOptions["clock"]>("mmss"),
    [milliseconds, setMilliseconds] = useState(false),
    [timestamps, setTimestamps] = useState(true),
    [onePerLine, setOnePerLine] = useState(false);
  const result = useMemo(() => {
    try {
      return { groups: groupTranscript(transcript, options, range), error: "" };
    } catch (error) {
      return { groups: [], error: error instanceof Error ? error.message : "Invalid grouping" };
    }
  }, [transcript, options, range]);
  const text = exportTranscript(
    transcript,
    result.groups,
    { format, basis, clock, milliseconds, timestamps, onePerLine },
    range,
  );
  const generate = (replace: boolean) => {
    if (onGenerate(result.groups, replace))
      setMessage("Captions generated. Choose a template in Properties.");
    else setMessage("Captions were not changed. Review the project error message.");
  };
  return (
    <section
      aria-label="Transcript grouping and export"
      className="space-y-3 rounded border border-[var(--editor-border)] p-3 text-xs"
    >
      <h3 className="font-semibold">Transcript grouping and export</h3>
      <label>
        Grouping
        <select
          aria-label="Transcript grouping"
          className="editor-input w-full"
          value={options.mode}
          onChange={(e) =>
            setOptions({ ...options, mode: groupingOptionsSchema.shape.mode.parse(e.target.value) })
          }
        >
          {groupingOptionsSchema.shape.mode.options.map((mode) => (
            <option key={mode}>{mode}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            "maxDuration",
            "minDuration",
            "maxWords",
            "maxCharacters",
            "maxLines",
            "pauseThreshold",
          ] as const
        ).map((key) => (
          <label key={key}>
            {
              {
                maxDuration: "Maximum seconds",
                minDuration: "Minimum seconds",
                maxWords: "Maximum words",
                maxCharacters: "Characters per line",
                maxLines: "Maximum lines",
                pauseThreshold: "Pause seconds",
              }[key]
            }
            <input
              aria-label={`Grouping ${key}`}
              className="editor-input w-full"
              type="number"
              min={0}
              step={key.includes("Duration") || key === "pauseThreshold" ? 0.1 : 1}
              value={options[key]}
              onChange={(e) => setOptions({ ...options, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <div className="flex gap-4">
        <label>
          <input
            type="checkbox"
            checked={options.punctuation}
            onChange={(e) => setOptions({ ...options, punctuation: e.target.checked })}
          />{" "}
          Prefer punctuation
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.includeFillers}
            onChange={(e) => setOptions({ ...options, includeFillers: e.target.checked })}
          />{" "}
          Include filler words
        </label>
      </div>
      <p>
        {result.groups.length} groups. Grouping uses deterministic punctuation/pause heuristics.
        Edited segments without word alignment stay intact.
      </p>
      {result.error && <p role="alert">{result.error}</p>}
      <div className="max-h-40 overflow-y-auto">
        {result.groups.slice(0, 100).map((group, i) => (
          <p key={i}>
            <span className="text-[var(--editor-muted)]">
              {group.start.toFixed(3)} - {group.end.toFixed(3)} s:{" "}
            </span>
            {group.text}
          </p>
        ))}
      </div>
      <button
        aria-label="Generate grouped captions"
        className="editor-primary"
        disabled={!result.groups.length || !!result.error}
        onClick={() => (transcript.captionIds.length ? setConfirm(true) : generate(false))}
      >
        Generate Captions
      </button>
      {confirm && (
        <ConfirmDialog
          title="Replace generated captions?"
          confirmLabel="Replace captions"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            generate(true);
          }}
        >
          Only captions generated from this transcript will be replaced. Their current manual edits
          will be replaced; unrelated captions are preserved. Undo restores the previous captions.
        </ConfirmDialog>
      )}
      <h4 className="font-semibold">Export Transcript</h4>
      <div className="grid grid-cols-3 gap-2">
        <label>
          Format
          <select
            aria-label="Transcript export format"
            className="editor-input w-full"
            value={format}
            onChange={(e) => {
              setFormat(exportFormatSchema.parse(e.target.value));
            }}
          >
            {["txt", "inline", "lines", "srt", "vtt", "json", "csv"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Timestamp basis
          <select
            className="editor-input w-full"
            value={basis}
            onChange={(e) =>
              setBasis(
                e.target.value === "clip"
                  ? "clip"
                  : e.target.value === "timeline"
                    ? "timeline"
                    : "source",
              )
            }
          >
            <option value="source">Source relative</option>
            <option value="clip">Clip relative</option>
            <option value="timeline">Timeline absolute</option>
          </select>
        </label>
        <label>
          Clock
          <select
            className="editor-input w-full"
            value={clock}
            onChange={(e) => setClock(e.target.value === "hhmmss" ? "hhmmss" : "mmss")}
          >
            <option value="mmss">MM:SS</option>
            <option value="hhmmss">HH:MM:SS</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label>
          <input
            type="checkbox"
            checked={timestamps}
            onChange={(e) => setTimestamps(e.target.checked)}
          />{" "}
          Timestamps
        </label>
        <label>
          <input
            type="checkbox"
            checked={milliseconds}
            onChange={(e) => setMilliseconds(e.target.checked)}
          />{" "}
          Milliseconds
        </label>
        <label>
          <input
            type="checkbox"
            checked={onePerLine}
            onChange={(e) => setOnePerLine(e.target.checked)}
          />{" "}
          One group per line
        </label>
      </div>
      <textarea
        aria-label="Transcript export preview"
        className="editor-input w-full"
        rows={5}
        readOnly
        value={text}
      />
      <div className="flex gap-2">
        <button
          className="editor-secondary"
          onClick={() =>
            void copyTranscript(text)
              .then(() => setMessage("Transcript copied."))
              .catch(() => setMessage("Clipboard unavailable. Select and copy the export preview."))
          }
        >
          Copy transcript
        </button>
        <button
          className="editor-secondary"
          onClick={() =>
            void saveTranscriptExport(
              format === "inline" || format === "lines" ? "txt" : format,
              text,
            )
              .then((value) =>
                setMessage(value.saved ? "Transcript exported." : "Export canceled."),
              )
              .catch((error) =>
                setMessage(error instanceof Error ? error.message : "Export failed"),
              )
          }
        >
          Save transcript file
        </button>
      </div>
      <p className="text-[10px] text-[var(--editor-muted)]">
        No speaker labels are added because this worker provides no speaker identities.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
