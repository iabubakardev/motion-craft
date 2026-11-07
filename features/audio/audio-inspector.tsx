"use client";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { useTimeline } from "@/features/timeline/timeline-store";
import { createTimelineIndex } from "@/core/timeline/commands.cjs";
import { audioSchema, defaultAudio } from "@/core/audio/schema.cjs";
import { analyzeAudio, inspectProcessedClip } from "@/platform/audio";
import type { analysisSchema } from "@/core/audio/schema.cjs";
import type { Clip } from "@/core/project/types";
import type { ProjectDocumentController } from "@/features/projects/use-project-document";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
export function AudioInspector({ document: doc }: { document: ProjectDocumentController }) {
  const ids = useTimeline((s) => s.selectedIds),
    active = useTimeline((s) => s.activeTrackId),
    index = useMemo(() => createTimelineIndex(doc.project), [doc.project]);
  const r = index.clips.get(ids.length === 1 ? ids[0] : ""),
    clip = r?.clip,
    track =
      r?.track ??
      (ids.length > 1 ? index.clips.get(ids[0])?.track : undefined) ??
      doc.project.tracks.find((t) => t.id === active);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [analysis, setAnalysis] = useState<{
      assetId: string;
      clipId: string;
      sourceStart: number;
      sourceEnd: number;
      result: z.infer<typeof analysisSchema>;
    } | null>(null),
    [after, setAfter] = useState<{ key: string; result: z.infer<typeof analysisSchema> } | null>(
      null,
    ),
    [target, setTarget] = useState(-16),
    [ceiling, setCeiling] = useState(-1),
    [narration, setNarration] = useState(""),
    [music, setMusic] = useState(""),
    [depth, setDepth] = useState(-18),
    [attack, setAttack] = useState(0.1),
    [release, setRelease] = useState(0.5),
    [preRoll, setPreRoll] = useState(0.1),
    [gap, setGap] = useState(0.2),
    [crossfade, setCrossfade] = useState(0.5),
    [crossCurve, setCrossCurve] = useState<"linear" | "equal-power">("equal-power"),
    [confirm, setConfirm] = useState(false);
  if (
    !track ||
    (!clip && track.type !== "audio") ||
    r?.asset?.type === "image" ||
    (r?.layer && !["audio", "video"].includes(r.layer.type))
  )
    return null;
  const baseVolume =
    clip?.volume ?? (r?.layer && "volume" in r.layer.properties ? r.layer.properties.volume : 1);
  const a = audioSchema.parse(clip?.audio ?? defaultAudio()),
    disabled = doc.busy || busy || track.locked;
  const afterKey = JSON.stringify({
    id: clip?.id,
    start: clip?.sourceStart,
    end: clip?.sourceEnd,
    a,
    fadeIn: clip?.fadeIn,
    fadeOut: clip?.fadeOut,
    trackDb: track.gainDb,
  });
  const update = (patch: Partial<typeof a>) =>
    clip && doc.executeAudio({ type: "SetAudio", clipId: clip.id, audio: { ...a, ...patch } });
  const duck = async (replace: boolean) => {
    setConfirm(false);
    setBusy(true);
    const expected = doc.project;
    try {
      const source = expected.tracks.find((t) => t.id === narration),
        regions: [number, number][] = [];
      if (!source || narration === music)
        throw new Error("Choose different narration and music tracks.");
      for (const c of source.clips) {
        const item = index.clips.get(c.id);
        if (!item?.asset || c.muted) continue;
        const transcript = expected.transcripts.find((t) => t.assetId === item.asset?.id),
          range =
            transcript?.result.segments.flatMap((s) =>
              s.words.length
                ? s.words.map((w) => [w.start, w.end] as [number, number])
                : [[s.start, s.end] as [number, number]],
            ) ?? (await analyzeAudio(item.asset.id)).speech;
        for (const [start, end] of range) {
          const left = Math.max(c.sourceStart ?? 0, start),
            right = Math.min(c.sourceEnd ?? Infinity, end);
          if (right > left)
            regions.push([
              c.start + (left - (c.sourceStart ?? 0)) / (c.playbackRate ?? 1),
              c.start + (right - (c.sourceStart ?? 0)) / (c.playbackRate ?? 1),
            ]);
        }
      }
      if (
        doc.executeAudio(
          {
            type: "Duck",
            musicId: music,
            regions,
            depthDb: depth,
            attack,
            release,
            preRoll,
            gap,
            replace,
          },
          expected,
        )
      )
        setMessage(
          "Editable ducking keys generated. Manual override: move or delete the volume diamonds.",
        );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ducking failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Audio editing"
      className="space-y-4 border-t border-[var(--editor-border)] p-4 text-xs"
    >
      <h3 className="font-medium">Audio / {track.name}</h3>
      <fieldset disabled={disabled} className="space-y-3">
        <label>
          Track gain (dB)
          <input
            aria-label="Track gain dB"
            className="editor-input w-full"
            type="number"
            min={-60}
            max={12}
            step={0.5}
            defaultValue={track.gainDb ?? 0}
            key={`${track.id}:${track.gainDb}`}
            onBlur={(e) =>
              doc.executeAudio({
                type: "SetTrackMix",
                trackId: track.id,
                gainDb: Number(e.target.value),
                solo: track.solo ?? false,
              })
            }
          />
        </label>
        <button
          className="editor-secondary"
          aria-pressed={!!track.solo}
          onClick={() =>
            doc.executeAudio({
              type: "SetTrackMix",
              trackId: track.id,
              gainDb: track.gainDb ?? 0,
              solo: !track.solo,
            })
          }
        >
          Solo track
        </button>
        {clip && (
          <>
            <label className="block">
              Clip gain (dB)
              <input
                aria-label="Clip gain dB"
                className="editor-input w-full"
                type="number"
                min={-60}
                max={12}
                step={0.5}
                defaultValue={a.gainDb}
                key={`${clip.id}:${a.gainDb}`}
                onBlur={(e) => update({ gainDb: Number(e.target.value) })}
              />
            </label>
            <div className="flex gap-2">
              <button
                className="editor-secondary"
                onClick={() =>
                  doc.executeAudio({
                    type: "SetAudio",
                    clipId: clip.id,
                    audio: { ...a, gainDb: 0 },
                    legacyVolume: 1,
                  })
                }
              >
                Reset gain
              </button>
              <button
                className="editor-secondary"
                aria-pressed={!!clip.muted}
                onClick={() =>
                  doc.executeTimeline({
                    type: "UpdateAudio",
                    clipId: clip.id,
                    patch: { muted: !clip.muted },
                  })
                }
              >
                Mute clip
              </button>
            </div>
            {baseVolume !== 1 && (
              <p>
                Existing linear volume: {baseVolume.toFixed(2)}x. The dB gain is applied on top.
              </p>
            )}
            <label className="block">
              Stereo pan
              <input
                aria-label="Audio pan"
                className="w-full"
                type="range"
                min={-1}
                max={1}
                step={0.05}
                defaultValue={a.pan}
                key={`${clip.id}:${a.pan}`}
                onPointerUp={(e) => update({ pan: Number(e.currentTarget.value) })}
                onKeyUp={(e) => update({ pan: Number(e.currentTarget.value) })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["fadeIn", "fadeOut"] as const).map((key) => (
                <label key={`${clip.id}:${key}:${clip[key]}`}>
                  {key === "fadeIn" ? "Fade in (s)" : "Fade out (s)"}
                  <input
                    aria-label={`Audio ${key}`}
                    className="editor-input w-full"
                    type="number"
                    min={0}
                    max={clip.duration}
                    step={0.1}
                    defaultValue={clip[key] ?? 0}
                    onBlur={(e) =>
                      doc.executeAudio({
                        type: "SetAudio",
                        clipId: clip.id,
                        audio: a,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="block">
              Fade curve
              <select
                aria-label="Audio fade curve"
                className="editor-input w-full"
                value={a.fadeCurve}
                onChange={(e) =>
                  update({ fadeCurve: e.target.value === "equal-power" ? "equal-power" : "linear" })
                }
              >
                <option value="linear">Linear</option>
                <option value="equal-power">Equal power</option>
              </select>
            </label>
            <AddVolumeKey
              clip={clip}
              fps={doc.project.fps}
              audio={a}
              onUpdate={(keys) => update({ keys })}
            />

            <p className="text-[var(--editor-muted)]">
              Double-click the waveform to add keys. Drag diamonds to move; Delete removes a focused
              key. Gain automation is relative to clip gain.
            </p>
            <details>
              <summary className="cursor-pointer">Volume keyframes ({a.keys.length})</summary>
              {a.keys.slice(0, 200).map((k) => (
                <div className="my-2 flex items-center gap-1" key={`${clip.id}:${k.id}:${k.db}`}>
                  <span className="w-14">{(k.frame / doc.project.fps).toFixed(2)}s</span>
                  <input
                    aria-label={`Volume dB frame ${k.frame}`}
                    className="editor-input min-w-0 flex-1"
                    type="number"
                    min={-60}
                    max={12}
                    step={0.5}
                    defaultValue={k.db}
                    onBlur={(e) =>
                      update({
                        keys: a.keys.map((x) =>
                          x.id === k.id
                            ? { ...x, db: Number(e.target.value), origin: "manual" as const }
                            : x,
                        ),
                      })
                    }
                  />
                  <button
                    aria-label={`Delete volume key ${k.frame}`}
                    onClick={() => update({ keys: a.keys.filter((x) => x.id !== k.id) })}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </details>
            <details>
              <summary className="cursor-pointer">Audio effects</summary>
              <p className="my-2 text-[var(--editor-muted)]">
                Processed locally before playback; preview and export share the prepared mix. Noise
                reduction is an adjustable noise gate, not speech separation.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={a.effects.bypass}
                  onChange={(e) => update({ effects: { ...a.effects, bypass: e.target.checked } })}
                />{" "}
                Bypass effects
              </label>
              {(
                [
                  "highpass",
                  "lowDb",
                  "midDb",
                  "highDb",
                  "thresholdDb",
                  "ratio",
                  "ceilingDb",
                  "noiseFloorDb",
                ] as const
              ).map((key) => (
                <label className="block my-2" key={`${clip.id}:${key}:${a.effects[key]}`}>
                  {
                    {
                      highpass: "High-pass Hz (0 bypass)",
                      lowDb: "Low EQ dB",
                      midDb: "Mid EQ dB",
                      highDb: "High EQ dB",
                      thresholdDb: "Compressor threshold dB",
                      ratio: "Compressor ratio",
                      ceilingDb: "Sample-peak ceiling dB",
                      noiseFloorDb: "Noise gate floor dB",
                    }[key]
                  }
                  <input
                    aria-label={`Audio effect ${key}`}
                    className="editor-input w-full"
                    type="number"
                    step={key === "highpass" ? 10 : 0.5}
                    defaultValue={a.effects[key]}
                    onBlur={(e) =>
                      update({ effects: { ...a.effects, [key]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
              {(["compressor", "limiter", "noiseGate"] as const).map((key) => (
                <label className="block my-2" key={key}>
                  <input
                    aria-label={`Enable ${key}`}
                    type="checkbox"
                    checked={a.effects[key]}
                    onChange={(e) => update({ effects: { ...a.effects, [key]: e.target.checked } })}
                  />{" "}
                  {key === "noiseGate" ? "Noise gate" : key}
                </label>
              ))}
            </details>
            {r?.asset && (
              <details>
                <summary className="cursor-pointer">Loudness normalization</summary>
                <label>
                  Target LUFS
                  <input
                    aria-label="Target LUFS"
                    className="editor-input w-full"
                    type="number"
                    min={-36}
                    max={-6}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                </label>
                <label>
                  True-peak target dBTP
                  <input
                    aria-label="True peak target"
                    className="editor-input w-full"
                    type="number"
                    min={-12}
                    max={0}
                    value={ceiling}
                    onChange={(e) => setCeiling(Number(e.target.value))}
                  />
                </label>
                <button
                  className="editor-secondary my-2"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const assetId = r.asset?.id;
                      if (!assetId) return;
                      const result = await analyzeAudio(assetId, {
                        start: clip.sourceStart ?? 0,
                        end: clip.sourceEnd ?? clip.duration,
                      });
                      setAnalysis({
                        assetId,
                        clipId: clip.id,
                        sourceStart: clip.sourceStart ?? 0,
                        sourceEnd: clip.sourceEnd ?? clip.duration,
                        result,
                      });
                      setMessage(
                        "Analysis covers this clip source range. Normalization changes gain; analyze processed clip for the actual result including fades/effects.",
                      );
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : "Analysis failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Analyze clip loudness
                </button>
                {analysis?.assetId === r.asset.id &&
                  analysis.clipId === clip.id &&
                  analysis.sourceStart === (clip.sourceStart ?? 0) &&
                  analysis.sourceEnd === (clip.sourceEnd ?? clip.duration) && (
                    <>
                      <p>
                        Before: {analysis.result.lufs?.toFixed(1) ?? "unavailable"} LUFS /{" "}
                        {analysis.result.truePeakDb?.toFixed(1) ?? "unavailable"} dBTP /{" "}
                        {analysis.result.peakDb?.toFixed(1) ?? "silence"} dB peak
                      </p>
                      <p>
                        After current gain (estimate):{" "}
                        {analysis.result.lufs === null
                          ? "unknown"
                          : (analysis.result.lufs + a.gainDb).toFixed(1)}{" "}
                        LUFS
                      </p>
                      {(["peak", "lufs"] as const).map((kind) => (
                        <button
                          className="editor-secondary my-2 mr-1"
                          key={kind}
                          onClick={() => {
                            const measured =
                              kind === "lufs" ? analysis.result.lufs : analysis.result.peakDb;
                            if (measured === null) {
                              setMessage("This analysis is unavailable or the source is silent.");
                              return;
                            }
                            const offset = 20 * Math.log10(baseVolume) + (track.gainDb ?? 0);
                            const gain = Math.min(
                              (kind === "lufs" ? target : ceiling) - measured - offset,
                              ceiling -
                                (analysis.result.truePeakDb ?? analysis.result.peakDb ?? 0) -
                                offset,
                            );
                            update({ gainDb: Math.max(-60, Math.min(12, gain)) });
                            setMessage(
                              "Non-destructive normalization applied. Gain is limited to -60 to +12 dB; silence cannot be normalized.",
                            );
                          }}
                        >
                          {kind === "peak" ? "Peak normalize" : "Normalize to LUFS"}
                        </button>
                      ))}
                    </>
                  )}
                <button
                  className="editor-secondary"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setAfter({
                        key: afterKey,
                        result: await inspectProcessedClip(doc.project, clip.id),
                      });
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : "Processed analysis failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Analyze processed clip
                </button>
                {after?.key === afterKey && (
                  <p>
                    Processed result: {after.result.lufs?.toFixed(1) ?? "unavailable"} LUFS /{" "}
                    {after.result.truePeakDb?.toFixed(1) ?? "unavailable"} dBTP
                  </p>
                )}
              </details>
            )}
          </>
        )}
      </fieldset>
      <details>
        <summary className="cursor-pointer">Automatic music ducking</summary>
        <p className="my-2 text-[var(--editor-muted)]">
          Uses saved speech timestamps where available; otherwise source energy activity. Generated
          keys remain editable.
        </p>
        {(["Narration", "Music"] as const).map((kind) => (
          <label className="block my-2" key={kind}>
            {kind} track
            <select
              aria-label={`${kind} ducking track`}
              className="editor-input w-full"
              value={kind === "Narration" ? narration : music}
              onChange={(e) =>
                kind === "Narration" ? setNarration(e.target.value) : setMusic(e.target.value)
              }
            >
              <option value="">Choose track</option>
              {doc.project.tracks
                .filter((t) => t.type === "audio")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {(
          [
            ["Depth dB", depth, setDepth],
            ["Attack seconds", attack, setAttack],
            ["Release seconds", release, setRelease],
            ["Pre-roll seconds", preRoll, setPreRoll],
            ["Minimum speech gap", gap, setGap],
          ] as const
        ).map(([label, value, set]) => (
          <label className="block my-2" key={label}>
            {label}
            <input
              aria-label={label}
              className="editor-input w-full"
              type="number"
              step={0.1}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
            />
          </label>
        ))}
        <button
          className="editor-primary"
          disabled={busy || doc.busy || !narration || !music}
          onClick={() => {
            if (
              doc.project.tracks
                .find((t) => t.id === music)
                ?.clips.some((c) => c.audio?.keys.length)
            )
              setConfirm(true);
            else void duck(false);
          }}
        >
          Generate ducking automation
        </button>
      </details>
      {ids.length === 2 && (
        <div>
          <label>
            Crossfade curve
            <select
              aria-label="Crossfade curve"
              className="editor-input w-full"
              value={crossCurve}
              onChange={(e) =>
                setCrossCurve(e.target.value === "equal-power" ? "equal-power" : "linear")
              }
            >
              <option value="linear">Linear</option>
              <option value="equal-power">Equal power</option>
            </select>
          </label>
          <label>
            Crossfade seconds
            <input
              aria-label="Crossfade duration"
              className="editor-input w-full"
              type="number"
              min={0.01}
              max={30}
              step={0.1}
              value={crossfade}
              onChange={(e) => setCrossfade(Number(e.target.value))}
            />
          </label>
          <button
            className="editor-secondary"
            onClick={() => {
              const sorted = ids
                .map((id) => index.clips.get(id))
                .filter((x) => !!x)
                .sort((a, b) => a.clip.start - b.clip.start);
              if (sorted.length === 2)
                doc.executeAudio({
                  type: "Crossfade",
                  leftId: sorted[0].clip.id,
                  rightId: sorted[1].clip.id,
                  duration: crossfade,
                  curve: crossCurve,
                });
            }}
          >
            Crossfade selected audio
          </button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="Replace music automation?"
          confirmLabel="Replace automation"
          onCancel={() => setConfirm(false)}
          onConfirm={() => void duck(true)}
        >
          Existing manual and generated volume keys on the music track will be replaced. Undo
          restores them.
        </ConfirmDialog>
      )}
      {message && <p role="status">{message}</p>}
      <p className="text-[10px] text-[var(--editor-muted)]">
        The master mix uses a -1 dB sample-peak safety ceiling. True-peak results require loudness
        analysis; subsequent effects may change them.
      </p>
    </section>
  );
}

function AddVolumeKey({
  clip,
  fps,
  audio,
  onUpdate,
}: {
  clip: Clip;
  fps: number;
  audio: z.infer<typeof audioSchema>;
  onUpdate: (keys: z.infer<typeof audioSchema>["keys"]) => void;
}) {
  const frame = useTimeline((s) => s.playheadFrame);
  return (
    <button
      className="editor-secondary"
      disabled={frame < clip.start * fps || frame >= (clip.start + clip.duration) * fps}
      onClick={() => {
        const local = Math.round(frame - clip.start * fps);
        onUpdate(
          [
            ...audio.keys.filter((k) => k.frame !== local),
            { id: crypto.randomUUID(), frame: local, db: 0, origin: "manual" as const },
          ].sort((a, b) => a.frame - b.frame),
        );
      }}
    >
      Add volume key at playhead
    </button>
  );
}
