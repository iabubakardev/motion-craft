import { z } from "zod";
import type { transcriptSchema, sourceRangeSchema } from "./schema.cjs";
export const groupingOptionsSchema = z
  .object({
    mode: z.enum([
      "word",
      "sentence",
      "duration",
      "count",
      "characters",
      "paragraph",
      "continuous",
      "smart",
    ]),
    maxDuration: z.number().min(0.1).max(86400),
    minDuration: z.number().min(0).max(60),
    maxWords: z.number().int().min(1).max(20000),
    maxCharacters: z.number().int().min(1).max(100000),
    maxLines: z.number().int().min(1).max(20),
    pauseThreshold: z.number().min(0).max(30),
    punctuation: z.boolean(),
    includeFillers: z.boolean(),
  })
  .strict();
export type GroupOptions = z.infer<typeof groupingOptionsSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type Range = z.infer<typeof sourceRangeSchema>;
export type Word = { text: string; start: number; end: number };
export type Group = { start: number; end: number; text: string; words: Word[] };
export const defaultGrouping: GroupOptions = {
  mode: "smart",
  maxDuration: 3,
  minDuration: 0,
  maxWords: 7,
  maxCharacters: 32,
  maxLines: 2,
  pauseThreshold: 0.6,
  punctuation: true,
  includeFillers: true,
};

function wrapText(words: { text: string }[], width: number): string[] {
  const lines: string[] = [];
  for (const word of words) {
    for (const text of word.text.trim().split(/\s+/)) {
      const last = lines.length - 1;
      if (last < 0 || lines[last].length + text.length + 1 > width) lines.push(text);
      else lines[last] += " " + text;
    }
  }
  return lines;
}

export function groupTranscript(transcript: Transcript, raw: GroupOptions, range?: Range): Group[] {
  const options = groupingOptionsSchema.parse(raw);
  const tokens = transcript.result.segments
    .flatMap((segment) =>
      segment.words.length && segment.words.every((w) => w.end > w.start)
        ? segment.words.map((w) => ({ ...w, aligned: true }))
        : [{ text: segment.text, start: segment.start, end: segment.end, aligned: false }],
    )
    .filter(
      (w) =>
        w.end > w.start &&
        w.text.trim() &&
        (!range || (w.end > range.sourceStart && w.start < range.sourceEnd)),
    )
    .filter((w) => options.includeFillers || !/^(um|uh|erm|hmm)[,.!?]?$/i.test(w.text.trim()))
    .map((w) => ({
      ...w,
      start: Math.max(w.start, range?.sourceStart ?? 0),
      end: Math.min(w.end, range?.sourceEnd ?? 86400),
    }));
  const groups: (typeof tokens)[] = [];
  let current: typeof tokens = [];
  for (const token of tokens) {
    const last = current[current.length - 1],
      duration = token.end - (current[0]?.start ?? token.start),
      count = current.length + 1,
      lineCount = wrapText([...current, token], options.maxCharacters).length;
    const punctuation =
      last && options.punctuation && /[.!?\u3002\uff01\uff1f]["')]*$/.test(last.text.trim());
    const pause = last ? token.start - last.end : 0;
    const shouldBreak =
      current.length > 0 &&
      options.mode !== "continuous" &&
      (options.mode === "word" ||
        !token.aligned ||
        !last.aligned ||
        (options.mode === "count" && count > options.maxWords) ||
        (options.mode === "duration" && duration > options.maxDuration) ||
        (options.mode === "sentence" &&
          (punctuation ||
            pause > Math.max(1, options.pauseThreshold) ||
            duration > options.maxDuration)) ||
        (options.mode === "paragraph" &&
          (pause > Math.max(1.5, options.pauseThreshold) || duration > options.maxDuration)) ||
        (options.mode === "characters" && lineCount > options.maxLines) ||
        (options.mode === "smart" &&
          (punctuation ||
            pause >= options.pauseThreshold ||
            duration > options.maxDuration ||
            count > options.maxWords ||
            lineCount > options.maxLines)));
    if (
      shouldBreak &&
      (!last.aligned ||
        !token.aligned ||
        options.mode === "word" ||
        duration > options.maxDuration ||
        count > options.maxWords ||
        lineCount > options.maxLines ||
        last.end - current[0].start >= options.minDuration)
    ) {
      groups.push(current);
      current = [];
    }
    current.push(token);
  }
  if (current.length) groups.push(current);
  return groups.map((tokens) => ({
    start: tokens[0].start,
    end: tokens[tokens.length - 1].end,
    text:
      options.mode === "smart" || options.mode === "characters"
        ? wrapText(tokens, options.maxCharacters).join("\n")
        : tokens.map((w) => w.text.trim()).join(" "),
    words: tokens.every((w) => w.aligned)
      ? tokens.map(({ text, start, end }) => ({ text, start, end }))
      : [],
  }));
}
export const exportFormatSchema = z.enum(["txt", "inline", "lines", "srt", "vtt", "json", "csv"]);
export type ExportOptions = {
  format: "txt" | "inline" | "lines" | "srt" | "vtt" | "json" | "csv";
  basis: "source" | "clip" | "timeline";
  clock: "mmss" | "hhmmss";
  milliseconds: boolean;
  timestamps: boolean;
  onePerLine: boolean;
};
export function timestamp(seconds: number, clock: ExportOptions["clock"], milliseconds: boolean) {
  const ms = Math.max(0, Math.round(seconds * 1000)),
    whole = Math.floor(ms / 1000),
    h = Math.floor(whole / 3600),
    m = Math.floor(whole / 60),
    s = whole % 60;
  const value =
    clock === "hhmmss"
      ? `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  return value + (milliseconds ? `.${String(ms % 1000).padStart(3, "0")}` : "");
}
export function exportTranscript(
  transcript: Transcript,
  groups: Group[],
  options: ExportOptions,
  range?: Range,
): string {
  const context = range || transcript.context,
    offset =
      options.basis === "source"
        ? 0
        : -(context?.sourceStart || 0) +
          (options.basis === "timeline" ? context?.timelineStart || 0 : 0);
  if (!Number.isFinite(offset)) throw new Error("Invalid transcript time basis.");
  const convert = (n: number) =>
    options.basis === "source"
      ? n
      : (n - (context?.sourceStart ?? 0)) / (context?.rate ?? 1) +
        (options.basis === "timeline" ? (context?.timelineStart ?? 0) : 0);
  const cues = groups.map((g) => ({
    ...g,
    start: Math.max(0, convert(g.start)),
    end: Math.max(0, convert(g.end)),
    words: g.words.map((w) => ({
      ...w,
      start: Math.max(0, convert(w.start)),
      end: Math.max(0, convert(w.end)),
    })),
  }));
  const stamp = (n: number) => timestamp(n, options.clock, options.milliseconds);
  if (options.format === "json")
    return (
      JSON.stringify(
        {
          schemaVersion: 1,
          transcriptId: transcript.id,
          sourceAssetId: transcript.assetId,
          basis: options.basis,
          context,
          groups: cues,
        },
        null,
        2,
      ) + "\n"
    );
  if (options.format === "csv") {
    const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
    return (
      "start,end,text\r\n" +
      cues.map((g) => `${g.start.toFixed(3)},${g.end.toFixed(3)},${quote(g.text)}`).join("\r\n") +
      "\r\n"
    );
  }
  if (options.format === "srt" || options.format === "vtt") {
    const format = options.format,
      clock = (n: number) => {
        const ms = Math.round(n * 1000),
          secs = Math.floor(ms / 1000);
        return `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor(secs / 60) % 60).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
      };
    return (
      (format === "vtt" ? "WEBVTT\n\n" : "") +
      cues
        .map(
          (g, i) =>
            `${format === "srt" ? `${i + 1}\n` : ""}${clock(g.start)} --> ${clock(Math.max(g.end, g.start + 0.001))}\n${g.text}`,
        )
        .join("\n\n") +
      "\n"
    );
  }
  const stamped = options.timestamps || options.format === "inline" || options.format === "lines";
  return (
    cues
      .map((g) => `${stamped ? `(${stamp(g.start)}) ` : ""}${g.text}`)
      .join(options.format === "lines" || options.onePerLine ? "\n" : " ") + "\n"
  );
}
