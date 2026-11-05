// @ts-check
const { vectorSchema } = require("./index-schema.cjs");
/** @typedef {import('zod').infer<typeof import('./index-schema.cjs').entrySchema>} Entry */
/** @param {number[]} a @param {number[]} b */
function cosine(a, b) {
  vectorSchema.parse(a);
  vectorSchema.parse(b);
  if (a.length !== b.length)
    throw new Error("Embedding dimensions differ. Reindex with the selected model.");
  const na = Math.hypot(...a),
    nb = Math.hypot(...b);
  return Math.max(
    -1,
    Math.min(
      1,
      a.reduce((sum, v, i) => sum + (v / na) * (b[i] / nb), 0),
    ),
  );
}
/** @param {number} duration */
function sampleTimes(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
    throw new Error("A valid video duration is required.");
  return [
    ...new Set(
      [0.1, 0.5, 0.9].map(
        (f) => Math.round(Math.min(Math.max(0,duration - 0.001), duration * f) * 1000) / 1000,
      ),
    ),
  ].filter((t) => t >= 0 && t < duration);
}
/** @param {string} text */
function tokens(text) {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}
/** Hybrid scores are heuristics, never calibrated probabilities.
 * @param {Entry[]} entries @param {string} query @param {{model?:{name:string,digest:string},vector?:number[],type:'all'|'image'|'video',aspectRatio:number,duration:number|null}} options */
function rank(entries, query, options) {
  const terms = tokens(query);
  return entries
    .filter((entry) => options.type === "all" || entry.asset.type === options.type)
    .map((entry) => {
      const words = tokens(`${entry.asset.filename} ${entry.description} ${entry.tags.join(" ")}`),
        tagWords = tokens(entry.tags.join(" "));
      const keyword = terms.size ? [...terms].filter((t) => words.has(t)).length / terms.size : 0,
        tags = terms.size ? [...terms].filter((t) => tagWords.has(t)).length / terms.size : 0;
      const emb = entry.embedding;
      const comparable = !!(
        options.vector &&
        options.model &&
        emb &&
        emb.model.name === options.model.name &&
        emb.model.digest === options.model.digest &&
        emb.vector.length === options.vector.length
      );
      const semantic =
        comparable && emb && options.vector ? Math.max(0, cosine(options.vector, emb.vector)) : 0;
      const aspect =
        entry.asset.width && entry.asset.height
          ? Math.max(
              0,
              1 - Math.abs(Math.log(entry.asset.width / entry.asset.height / options.aspectRatio)),
            )
          : 0;
      const duration = options.duration
        ? entry.asset.type === "image"
          ? 1
          : Math.min(1, (entry.asset.duration || 0) / options.duration)
        : 0;
      const type = options.type === "all" ? 0 : 1;
      const score = Math.min(
        1,
        (comparable ? 0.55 * semantic : 0) +
          (comparable ? 0.2 : 0.75) * keyword +
          0.1 * tags +
          0.05 * type +
          0.05 * aspect +
          0.05 * duration,
      );
      const reasons = [
        `Keyword overlap ${Math.round(keyword * 100)}%`,
        ...(comparable ? [`Semantic cosine ${semantic.toFixed(3)}`] : []),
        ...(tags ? ["Matching reviewed/indexed tags"] : []),
        ...(aspect > 0.8 ? ["Suitable aspect ratio"] : []),
        ...(duration === 1 ? ["Covers target duration"] : []),
      ];
      const missing = [
        ...(!comparable ? ["No compatible semantic embedding"] : []),
        ...(!entry.asset.width ? ["Unknown dimensions"] : []),
        ...(entry.origin === "manual" ? ["Manual description; visual content not verified"] : []),
        ...(entry.asset.type === "video" ? ["Only sampled frames were analyzed"] : []),
      ];
      return { assetId: entry.asset.id, score, reasons, missing };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId));
}
module.exports = { cosine, sampleTimes, rank, tokens };
