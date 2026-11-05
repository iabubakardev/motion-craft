// @ts-check
const { z } = require("zod");
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
      duration: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string() }),
});
/** @param {unknown} raw @param {{width:number,height:number,fps:number,durationInFrames:number}} model @param {boolean} needsAudio */
function verifyRender(raw, model, needsAudio) {
  const result = probeSchema.parse(raw),
    video = result.streams.find((stream) => stream.codec_type === "video"),
    audio = result.streams.find((stream) => stream.codec_type === "audio");
  const rate = (video?.avg_frame_rate || "0/1").split("/").map(Number),
    fps = rate[0] / rate[1],
    duration = Number(video?.duration || result.format.duration);
  if (
    video?.codec_name !== "h264" ||
    video.width !== model.width ||
    video.height !== model.height ||
    Math.abs(fps - model.fps) > 0.001 ||
    !Number.isFinite(duration) ||
    Math.abs(duration - model.durationInFrames / model.fps) > 1.01 / model.fps ||
    (needsAudio && !audio) ||
    (audio && audio.codec_name !== "aac")
  )
    throw new Error(
      "Rendered output did not pass codec, dimensions, timing or audio verification.",
    );
  return {
    width: video.width,
    height: video.height,
    fps,
    duration,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name || null,
  };
}
/** @param {unknown} raw @param {'video'|'audio'} type */
function sourceDuration(raw, type) {
  const result = probeSchema.parse(raw);
  const stream = result.streams.find((item) => item.codec_type === type);
  const duration = Number(stream?.duration || result.format.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0)
    throw new Error("Source media has no usable stream or duration.");
  return duration;
}
/** @param {number} sourceStart @param {number} durationInFrames @param {number} fps @param {number} actualDuration */
function verifySourceRange(sourceStart, durationInFrames, fps, actualDuration) {
  if ((sourceStart + durationInFrames) / fps > actualDuration + 1 / fps)
    throw new Error(
      "A source trim exceeds the actual media duration. Relink or correct the project timing.",
    );
}
module.exports = { verifyRender, sourceDuration, verifySourceRange };
