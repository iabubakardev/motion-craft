// @ts-check
const { transcriptSchema } = require("./schema.cjs");
const { transcriptSchema: externalSchema } = require("../transcription/schema.cjs");
const { stableId } = require("../animation/engine.cjs");
/** Convert a reviewed worker result to the CPU/int8 planning contract.
 * @param {unknown} raw */
function toPlanningTranscript(raw) {
  const transcript = externalSchema.parse(raw);
  const result = transcript.result;
  return transcriptSchema.parse({
    version: 1,
    id: transcript.id,
    sourceAssetId: transcript.assetId,
    language: result.language,
    duration: result.duration,
    text: result.segments.map((segment) => segment.text).join(" "),
    model: { engine: "faster-whisper", name: result.model, device: "cpu", computeType: "int8" },
    segments: result.segments.map((segment) => ({
      ...segment,
      id: stableId(`${transcript.id}:segment:${segment.id}`),
      words: segment.words.filter((word) => word.end > word.start),
    })),
  });
}
module.exports = { toPlanningTranscript };
