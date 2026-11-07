// @ts-check
/** @param {number} db */
const dbToGain = (db) => Math.pow(10, db / 20);
/** @param {number} value */
const gainToDb = (value) => (value > 0 ? 20 * Math.log10(value) : -60);
/** @param {import('zod').infer<typeof import('./schema.cjs').keySchema>[]} keys @param {number} frame */
function automationDb(keys, frame) {
  if (!keys.length) return 0;
  if (frame <= keys[0].frame) return keys[0].db;
  let low = 0,
    high = keys.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (keys[mid].frame <= frame) low = mid;
    else high = mid - 1;
  }
  const a = keys[low],
    b = keys[low + 1];
  return b ? a.db + ((b.db - a.db) * (frame - a.frame)) / (b.frame - a.frame) : a.db;
}

/** @param {number} position @param {'linear'|'equal-power'} curve */
function fadeGain(position, curve) {
  const t = Math.max(0, Math.min(1, position));
  return curve === "equal-power" ? Math.sin((t * Math.PI) / 2) : t;
}
/** @param {import('../project/types').Clip} clip @param {number} local @param {number} fps @param {number} [trackGainDb] */
function clipGain(clip, local, fps, trackGainDb = 0) {
  const a = clip.audio;
  return (
    (clip.volume ?? 1) *
    dbToGain((a?.gainDb ?? 0) + trackGainDb + automationDb(a?.keys ?? [], local * fps)) *
    Math.min(
      clip.fadeIn ? fadeGain(local / clip.fadeIn, a?.fadeCurve ?? "linear") : 1,
      clip.fadeOut ? fadeGain((clip.duration - local) / clip.fadeOut, a?.fadeCurve ?? "linear") : 1,
    )
  );
}
/** @param {import('../project/types').Project} project @param {import('../project/types').Track} track */
function audibleTrack(project, track) {
  return (
    track.visible &&
    !track.muted &&
    (!project.tracks.some((t) => t.solo && !t.muted && t.visible) || !!track.solo)
  );
}
/** @param {{sourceStart:number|null,playbackRate?:number}} clip @param {number} local @param {number} step */
const peakIndex = (clip, local, step) =>
  Math.floor(((clip.sourceStart ?? 0) + local * (clip.playbackRate ?? 1)) / step);
/** @param {[number,number][]} regions @param {{depthDb:number,attack:number,release:number,preRoll:number,gap:number}} options @param {number} start @param {number} duration @param {number} fps @param {()=>string} uuid */
function duckingKeys(regions, options, start, duration, fps, uuid) {
  /** @type {[number,number][]} */
  const merged = [];
  for (const [a, b] of [...regions].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] <= options.gap) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const frames = new Set([0, Math.max(0, Math.ceil(duration * fps) - 1)]);
  for (const [a, b] of merged) {
    for (const time of [
      a - options.preRoll - options.attack,
      a - options.preRoll,
      b,
      b + options.release,
    ])
      frames.add(
        Math.max(0, Math.min(Math.ceil(duration * fps) - 1, Math.round((time - start) * fps))),
      );
  }
  /** @param {number} time */
  const at = (time) => {
    let db = 0;
    for (const [a, b] of merged) {
      const down = a - options.preRoll,
        attack = down - options.attack;
      if (time < attack || time > b + options.release) continue;
      const value =
        time < down
          ? (options.depthDb * (time - attack)) / options.attack
          : time <= b
            ? options.depthDb
            : options.depthDb * (1 - (time - b) / options.release);
      db = Math.min(db, value);
    }
    return db;
  };
  return [...frames]
    .sort((a, b) => a - b)
    .map((frame) => ({
      id: uuid(),
      frame,
      db: at(start + frame / fps),
      origin: /** @type {'ducking'} */ ("ducking"),
    }));
}
module.exports = {
  dbToGain,
  gainToDb,
  automationDb,
  fadeGain,
  clipGain,
  audibleTrack,
  peakIndex,
  duckingKeys,
};
