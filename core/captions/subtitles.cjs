// @ts-check
const { z } = require("zod");
const cueSchema = z
  .object({
    start: z.number().finite().min(0).max(86400),
    end: z.number().finite().positive().max(86400),
    text: z.string().trim().min(1).max(10000),
  })
  .strict()
  .refine((c) => c.end > c.start, "Subtitle end must follow start");
const cuesSchema = z.array(cueSchema).min(1).max(10000);
/** @param {string} value */
function parseTime(value) {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value.trim());
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60)
    throw new Error("Invalid subtitle timestamp");
  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}
/** Plain text only. Markup is displayed literally, never interpreted.
 * @param {string} text */
function parseSubtitles(text) {
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
    throw new Error("Subtitles exceed 5 MB");
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n[ \t]*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0 || index > 1) throw new Error("Expected SRT or VTT cue timing");
    const match = /^(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[index]);
    if (!match) throw new Error("Invalid subtitle cue");
    cues.push({
      start: parseTime(match[1]),
      end: parseTime(match[2]),
      text: lines.slice(index + 1).join("\n"),
    });
  }
  return cuesSchema.parse(cues);
}
/** @param {number} seconds @param {string} separator */
function stamp(seconds, separator) {
  const ms = Math.round(seconds * 1000),
    h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}
/** @param {unknown} raw @param {'srt'|'vtt'} format */
function exportSubtitles(raw, format) {
  const cues = cuesSchema.parse(raw);
  return (
    (format === "vtt" ? "WEBVTT\n\n" : "") +
    [...cues]
      .sort((a, b) => a.start - b.start)
      .map(
        (cue, i) =>
          `${format === "srt" ? `${i + 1}\n` : ""}${stamp(cue.start, format === "srt" ? "," : ".")} --> ${stamp(cue.end, format === "srt" ? "," : ".")}\n${cue.text}`,
      )
      .join("\n\n") +
    "\n"
  );
}
module.exports = { cueSchema, cuesSchema, parseSubtitles, exportSubtitles };
